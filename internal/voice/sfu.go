package voice

import (
	"fmt"
	"log/slog"
	"sync"

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
		})

		peers = append(peers, peer)
	}
	return users, peers
}

type RelayTrack struct {
	ID        string
	OwnerID   string
	OwnerPeer *Peer
	Track     *webrtc.TrackLocalStaticRTP
}

type Peer struct {
	UserID   string
	Username string
	RoomID   string

	pc *webrtc.PeerConnection
	ws *SafeWS

	Room   *Room
	logger *slog.Logger

	mu      sync.Mutex
	senders map[string]*webrtc.RTPSender

	negotiationMu sync.Mutex
}

func (r *Room) AddPeer(peer *Peer) {
	var previousPeer *Peer

	r.mu.Lock()

	if existingPeer, ok := r.peers[peer.UserID]; ok && existingPeer != peer {
		previousPeer = existingPeer
		r.removePeerLocked(existingPeer)
	}

	r.peers[peer.UserID] = peer

	for trackID, relayTrack := range r.tracks {
		if relayTrack.OwnerID == peer.UserID {
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
		peer.senders[trackID] = sender

		go drainRTCP(sender)
	}

	r.mu.Unlock()

	if previousPeer != nil {
		previousPeer.close()
	}

	go r.BroadcastVoiceState()
}

func (r *Room) RemovePeer(peer *Peer) {
	r.mu.Lock()
	changed := r.removePeerLocked(peer)
	r.mu.Unlock()

	if !changed {
		return
	}

	go r.BroadcastVoiceState()
}

func (r *Room) removePeerLocked(peer *Peer) bool {
	changed := false

	if currentPeer, ok := r.peers[peer.UserID]; ok && currentPeer == peer {
		delete(r.peers, peer.UserID)
		changed = true
	}

	for trackID, relayTrack := range r.tracks {
		if relayTrack.OwnerPeer != peer {
			continue
		}

		r.removeRelayTrackLocked(trackID)
		changed = true
	}

	return changed
}

func (r *Room) AddRelayTrack(ownerPeer *Peer, remoteTrack *webrtc.TrackRemote) (*webrtc.TrackLocalStaticRTP, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for trackID, relayTrack := range r.tracks {
		if relayTrack.OwnerPeer != ownerPeer {
			continue
		}

		r.removeRelayTrackLocked(trackID)
	}

	trackID := fmt.Sprintf("%s_%p_%s", ownerPeer.UserID, ownerPeer, remoteTrack.ID())

	localTrack, err := webrtc.NewTrackLocalStaticRTP(
		remoteTrack.Codec().RTPCodecCapability,
		trackID,
		remoteTrack.StreamID(),
	)
	if err != nil {
		return nil, "", err
	}

	r.tracks[trackID] = &RelayTrack{
		ID:        trackID,
		OwnerID:   ownerPeer.UserID,
		OwnerPeer: ownerPeer,
		Track:     localTrack,
	}

	for _, receiverPeer := range r.peers {
		if receiverPeer.UserID == ownerPeer.UserID {
			continue
		}
		sender, err := receiverPeer.pc.AddTrack(localTrack)
		if err != nil {
			r.logger.Warn(
				"failed to add relay track to peer",
				"room_id", r.id,
				"user_id", receiverPeer.UserID,
				"track_id", trackID,
				"error", err,
			)
			continue
		}
		receiverPeer.senders[trackID] = sender

		go drainRTCP(sender)
		go receiverPeer.negotiate()
	}
	return localTrack, trackID, nil
}

func (r *Room) RemoveRelayTrack(trackID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.removeRelayTrackLocked(trackID)
}

func (r *Room) removeRelayTrackLocked(trackID string) {
	delete(r.tracks, trackID)

	for _, peer := range r.peers {
		peer.removeSender(trackID)
		go peer.negotiate()
	}
}

func (p *Peer) removeSender(trackID string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	sender, ok := p.senders[trackID]
	if !ok {
		return
	}

	delete(p.senders, trackID)

	if err := p.pc.RemoveTrack(sender); err != nil {
		p.logger.Warn(
			"failed to remove sender",
			"user_id", p.UserID,
			"track_id", trackID,
			"error", err,
		)
	}
}

func (p *Peer) close() {
	_ = p.pc.Close()
	_ = p.ws.Close()
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
