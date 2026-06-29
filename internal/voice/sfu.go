package voice

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

type SFU struct {
	mu     sync.RWMutex
	rooms  map[string]*Room
	logger *slog.Logger
}

func NewSFU(logger *slog.Logger) *SFU {
	return &SFU{
		rooms:  make(map[string]*Room),
		logger: logger,
	}
}

func (s *SFU) GetRoom(roomID string) *Room {
	s.mu.Lock()
	defer s.mu.Unlock()

	room, ok := s.rooms[roomID]
	if ok {
		return room
	}

	room = NewRoom(roomID, s.logger)
	s.rooms[roomID] = room

	return room
}

type Room struct {
	id     string
	mu     sync.Mutex
	peers  map[string]*Peer
	tracks map[string]*RelayTrack
	logger *slog.Logger
}

func NewRoom(id string, logger *slog.Logger) *Room {
	return &Room{
		id:     id,
		peers:  make(map[string]*Peer),
		tracks: make(map[string]*RelayTrack),
		logger: logger,
	}
}

func (r *Room) BroadcastVoiceState() {
	users, peers := r.snapshotVoiceState()

	msg := SignalMessage{
		Type:  MessageTypeVoiceState,
		Users: users,
	}

	for _, peer := range peers {
		if peer.ws == nil {
			continue
		}

		if err := peer.ws.WriteJSON(msg); err != nil {
			r.logger.Warn(
				"failed to send voice state",
				"room_id", r.id,
				"user_id", peer.UserID,
				"error", err,
			)
		}
	}
}

func (r *Room) snapshotVoiceState() ([]VoiceUser, []*Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()

	users := make([]VoiceUser, 0, len(r.peers))
	peers := make([]*Peer, 0, len(r.peers))

	for _, peer := range r.peers {
		users = append(users, VoiceUser{
			ID:       peer.UserID,
			Username: peer.Username,
			Settings: peer.Settings,
		})

		peers = append(peers, peer)
	}
	return users, peers
}

type RelayTrack struct {
	ID          string
	OwnerID     string
	OwnerPeerID string
	Track       *webrtc.TrackLocalStaticRTP
}

type Peer struct {
	ID       string
	UserID   string
	Username string
	RoomID   string

	pc *webrtc.PeerConnection
	ws *SafeWS

	Room   *Room
	logger *slog.Logger

	Settings VoiceSettings

	mu      sync.Mutex
	senders map[string]*webrtc.RTPSender

	negotiationMu sync.Mutex
}

func defaultVoiceSettings() VoiceSettings {
	return VoiceSettings{
		EchoCancellation: true,
		NoiseSuppression: true,
		AutoGainControl:  true,
		InputGain:        1,
		BitrateKbps:      64,
	}
}

func sanitizeVoiceSettings(settings VoiceSettings) VoiceSettings {
	if settings.InputGain < 0 {
		settings.InputGain = 0
	}

	if settings.InputGain > 2 {
		settings.InputGain = 2
	}

	if settings.BitrateKbps < 16 {
		settings.BitrateKbps = 16
	}

	if settings.BitrateKbps > 128 {
		settings.BitrateKbps = 128
	}

	return settings
}

func newPeerID() string {
	var id [8]byte
	if _, err := rand.Read(id[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}

	return hex.EncodeToString(id[:])
}

func (r *Room) AddPeer(peer *Peer) *Peer {
	r.mu.Lock()

	var replacedPeer *Peer
	var peersToNegotiate []*Peer

	if currentPeer, ok := r.peers[peer.UserID]; ok && currentPeer != peer {
		replacedPeer = currentPeer
		peersToNegotiate = append(peersToNegotiate, r.removePeerLocked(currentPeer)...)
	}

	r.peers[peer.UserID] = peer

	for trackID, relayTrack := range r.tracks {
		if relayTrack.OwnerID == peer.UserID || relayTrack.OwnerPeerID == peer.ID {
			continue
		}

		sender, err := peer.pc.AddTrack(relayTrack.Track)
		if err != nil {
			r.logger.Warn(
				"failed to add existing track to peer",
				"room_id", r.id,
				"user_id", peer.UserID,
				"track_id", trackID,
				"error", err,
			)
			continue
		}
		peer.addSender(trackID, sender)

		go drainRTCP(sender)
	}

	r.mu.Unlock()

	for _, peer := range peersToNegotiate {
		go peer.negotiate()
	}

	go r.BroadcastVoiceState()

	return replacedPeer
}

func (r *Room) UpdatePeerSettings(peer *Peer, settings VoiceSettings) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	currentPeer, ok := r.peers[peer.UserID]
	if !ok || currentPeer != peer {
		return false
	}

	peer.Settings = settings
	return true
}

func (r *Room) RemovePeer(peer *Peer) {
	r.mu.Lock()
	peersToNegotiate := r.removePeerLocked(peer)
	r.mu.Unlock()

	for _, peer := range peersToNegotiate {
		go peer.negotiate()
	}

	go r.BroadcastVoiceState()
}

func (r *Room) removePeerLocked(peer *Peer) []*Peer {
	if currentPeer, ok := r.peers[peer.UserID]; ok && currentPeer == peer {
		delete(r.peers, peer.UserID)
	}

	peersToNegotiate := make([]*Peer, 0, len(r.peers))

	for trackID, relayTrack := range r.tracks {
		if relayTrack.OwnerPeerID != peer.ID {
			continue
		}

		delete(r.tracks, trackID)

		for _, otherPeer := range r.peers {
			if otherPeer.removeSender(trackID) {
				peersToNegotiate = append(peersToNegotiate, otherPeer)
			}
		}
	}

	return peersToNegotiate
}

func (r *Room) AddRelayTrack(owner *Peer, remoteTrack *webrtc.TrackRemote) (*webrtc.TrackLocalStaticRTP, string, error) {
	r.mu.Lock()

	trackID := fmt.Sprintf("%s_%s_%s", owner.UserID, owner.ID, remoteTrack.ID())

	localTrack, err := webrtc.NewTrackLocalStaticRTP(
		remoteTrack.Codec().RTPCodecCapability,
		trackID,
		remoteTrack.StreamID(),
	)
	if err != nil {
		r.mu.Unlock()
		return nil, "", err
	}

	r.tracks[trackID] = &RelayTrack{
		ID:          trackID,
		OwnerID:     owner.UserID,
		OwnerPeerID: owner.ID,
		Track:       localTrack,
	}

	peersToNegotiate := make([]*Peer, 0, len(r.peers))

	for _, peer := range r.peers {
		if peer.ID == owner.ID {
			continue
		}
		sender, err := peer.pc.AddTrack(localTrack)
		if err != nil {
			r.logger.Warn(
				"failed to add relay track to peer",
				"room_id", r.id,
				"user_id", peer.UserID,
				"track_id", trackID,
				"error", err,
			)
			continue
		}
		peer.addSender(trackID, sender)

		go drainRTCP(sender)
		peersToNegotiate = append(peersToNegotiate, peer)
	}
	r.mu.Unlock()

	for _, peer := range peersToNegotiate {
		go peer.negotiate()
	}

	return localTrack, trackID, nil
}

func (r *Room) RemoveRelayTrack(trackID string) {
	r.mu.Lock()

	delete(r.tracks, trackID)

	peersToNegotiate := make([]*Peer, 0, len(r.peers))

	for _, peer := range r.peers {
		if peer.removeSender(trackID) {
			peersToNegotiate = append(peersToNegotiate, peer)
		}
	}
	r.mu.Unlock()

	for _, peer := range peersToNegotiate {
		go peer.negotiate()
	}
}

func (p *Peer) close() {
	if p.pc != nil {
		_ = p.pc.Close()
	}

	if p.ws != nil {
		_ = p.ws.Close()
	}
}

func (p *Peer) addSender(trackID string, sender *webrtc.RTPSender) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.senders == nil {
		p.senders = make(map[string]*webrtc.RTPSender)
	}

	p.senders[trackID] = sender
}

func (p *Peer) removeSender(trackID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	sender, ok := p.senders[trackID]
	if !ok {
		return false
	}

	delete(p.senders, trackID)

	if p.pc != nil {
		if err := p.pc.RemoveTrack(sender); err != nil {
			p.logger.Warn(
				"failed to remove sender",
				"user_id", p.UserID,
				"track_id", trackID,
				"error", err,
			)
		}
	} else if p.logger != nil {
		p.logger.Warn(
			"failed to remove sender without peer connection",
			"user_id", p.UserID,
			"track_id", trackID,
		)
	}

	return true
}

func (p *Peer) negotiate() {
	p.negotiationMu.Lock()
	defer p.negotiationMu.Unlock()

	offer, err := p.pc.CreateOffer(nil)
	if err != nil {
		p.logger.Warn("failed to create server offer", "user_id", p.UserID, "error", err)
		return
	}
	if err := p.pc.SetLocalDescription(offer); err != nil {
		p.logger.Warn("failed to set local server offer", "user_id", p.UserID, "error", err)
		return
	}

	err = p.ws.WriteJSON(SignalMessage{
		Type: MessageTypeOffer,
		SDP:  p.pc.LocalDescription(),
	})

	if err != nil {
		p.logger.Warn("failed to send server offer", "user_id", p.UserID, "error", err)
	}
}

func drainRTCP(sender *webrtc.RTPSender) {
	buf := make([]byte, 1500)

	for {
		if _, _, err := sender.Read(buf); err != nil {
			return
		}
	}
}
