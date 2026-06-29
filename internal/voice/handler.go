package voice

import (
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
)

type Handler struct {
	sfu        *SFU
	logger     *slog.Logger
	api        *webrtc.API
	iceServers []webrtc.ICEServer
}

func NewHandler(logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}

	return &Handler{
		sfu:        NewSFU(logger),
		logger:     logger,
		api:        newWebRTCAPI(logger),
		iceServers: loadICEServers(logger),
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

const (
	signalReadLimit = 64 * 1024
	signalPongWait  = 60 * time.Second
	signalPingEvery = 30 * time.Second
)

func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	channelID := r.URL.Query().Get("channel_id")
	userID := r.URL.Query().Get("user_id")
	username := r.URL.Query().Get("username")

	if username == "" {
		username = userID
	}

	if channelID == "" {
		http.Error(w, "channel_id is required", http.StatusBadRequest)
		return
	}

	if userID == "" {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("failed to upgrade voice websocket", "error", err)
		return
	}

	ws := NewSafeWS(conn)
	configureSignalWebSocket(conn)

	heartbeatDone := make(chan struct{})
	defer close(heartbeatDone)
	go keepSignalWebSocketAlive(ws, heartbeatDone, h.logger, userID, channelID)

	pc, err := h.newPeerConnection()

	if err != nil {
		_ = ws.WriteJSON(SignalMessage{
			Type:  MessageTypeError,
			Error: "failed to create peer connection",
		})
		_ = ws.Close()
		return
	}

	_, err = pc.AddTransceiverFromKind(
		webrtc.RTPCodecTypeAudio,
		webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		},
	)
	if err != nil {
		_ = ws.WriteJSON(SignalMessage{
			Type:  MessageTypeError,
			Error: "failed to add audio transceiver",
		})
		_ = pc.Close()
		_ = ws.Close()
		return
	}

	room := h.sfu.GetRoom(channelID)

	peer := &Peer{
		ID:       newPeerID(),
		UserID:   userID,
		Username: username,
		RoomID:   channelID,
		pc:       pc,
		ws:       ws,
		Room:     room,
		logger:   h.logger,
		Settings: defaultVoiceSettings(),
		senders:  make(map[string]*webrtc.RTPSender),
	}

	if replacedPeer := room.AddPeer(peer); replacedPeer != nil {
		h.logger.Info(
			"replaced existing voice peer",
			"user_id", userID,
			"channel_id", channelID,
		)
		replacedPeer.close()
	}

	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		candidateInit := candidate.ToJSON()

		err := ws.WriteJSON(SignalMessage{
			Type:      MessageTypeCandidate,
			Candidate: &candidateInit,
		})
		if err != nil {
			h.logger.Warn("failed to send ICE cadidate", "user_id", userID, "error", err)
		}
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		h.logger.Info(
			"voice peer connection state changed",
			"user_id", userID,
			"channel_id", channelID,
			"state", state.String(),
		)

		switch state {
		case webrtc.PeerConnectionStateFailed,
			webrtc.PeerConnectionStateClosed:
			room.RemovePeer(peer)
			_ = pc.Close()
			_ = ws.Close()
		}
	})
	pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		if remoteTrack.Kind() != webrtc.RTPCodecTypeAudio {
			return
		}

		h.logger.Info(
			"received audio track",
			"user_id", userID,
			"channel_id", channelID,
			"track_id", remoteTrack.ID(),
			"codec", remoteTrack.Codec().MimeType,
		)

		localTrack, relayTrackID, err := room.AddRelayTrack(peer, remoteTrack)
		if err != nil {
			h.logger.Error("failed to add relay track", "error", err)
			return
		}

		defer room.RemoveRelayTrack(relayTrackID)

		for {
			rtpPacket, _, err := remoteTrack.ReadRTP()
			if err != nil {
				h.logger.Info(
					"audio track stopped",
					"usaer_id", userID,
					"channel_id", channelID,
					"track_id", remoteTrack.ID(),
				)
				return
			}

			if err := localTrack.WriteRTP(rtpPacket); err != nil {
				h.logger.Warn(
					"failed to forward RTP packet",
					"user_id", userID,
					"channel_id", channelID,
					"track_id", remoteTrack.ID(),
					"error", err,
				)
				return
			}
		}
	})

	defer func() {
		room.RemovePeer(peer)
		_ = pc.Close()
		_ = ws.Close()
	}()

	for {
		var msg SignalMessage

		if err := conn.ReadJSON(&msg); err != nil {
			h.logger.Info(
				"voice websocket disconnected",
				"user_id", userID,
				"channel_id", channelID,
				"error", err,
			)
			return
		}

		switch msg.Type {
		case MessageTypeOffer:
			if msg.SDP == nil {
				continue
			}

			if err := pc.SetRemoteDescription(*msg.SDP); err != nil {
				h.logger.Warn("failed to set remote offer", "user_id", userID, "error", err)
				continue
			}

			answer, err := pc.CreateAnswer(nil)
			if err != nil {
				h.logger.Warn("failed to create answer", "user_id", userID, "error", err)
				continue
			}

			if err := pc.SetLocalDescription(answer); err != nil {
				h.logger.Warn("failed to set local answer", "user_id", userID, "error", err)
				continue
			}

			err = ws.WriteJSON(SignalMessage{
				Type: MessageTypeAnswer,
				SDP:  pc.LocalDescription(),
			})

			if err != nil {
				h.logger.Warn("failed to send answer", "user_id", userID, "error", err)
				continue
			}

		case MessageTypeAnswer:
			if msg.SDP == nil {
				continue
			}

			if err := pc.SetRemoteDescription(*msg.SDP); err != nil {
				h.logger.Warn("failed to set remote answer", "user_id", userID, "error", err)
				continue
			}

		case MessageTypeCandidate:
			if msg.Candidate == nil {
				continue
			}

			if err := pc.AddICECandidate(*msg.Candidate); err != nil {
				h.logger.Warn("failed to add remote ICE candidate", "user_id", userID, "error", err)
				continue
			}
		case MessageTypeSettings:
			if msg.Settings == nil {
				continue
			}

			settings := sanitizeVoiceSettings(*msg.Settings)
			if room.UpdatePeerSettings(peer, settings) {
				go room.BroadcastVoiceState()
			}
		}
	}
}

func configureSignalWebSocket(conn *websocket.Conn) {
	conn.SetReadLimit(signalReadLimit)
	_ = conn.SetReadDeadline(time.Now().Add(signalPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(signalPongWait))
	})
}

func keepSignalWebSocketAlive(ws *SafeWS, done <-chan struct{}, logger *slog.Logger, userID string, channelID string) {
	ticker := time.NewTicker(signalPingEvery)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			if err := ws.WriteControl(websocket.PingMessage, nil); err != nil {
				logger.Warn(
					"failed to ping voice websocket",
					"user_id", userID,
					"channel_id", channelID,
					"error", err,
				)
				_ = ws.Close()
				return
			}
		}
	}
}

func newWebRTCAPI(logger *slog.Logger) *webrtc.API {
	mediaEngine := &webrtc.MediaEngine{}

	if err := mediaEngine.RegisterCodec(
		webrtc.RTPCodecParameters{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType:     webrtc.MimeTypeOpus,
				ClockRate:    48000,
				Channels:     2,
				SDPFmtpLine:  "minptime=10;useinbandfec=1",
				RTCPFeedback: nil,
			},
			PayloadType: 111,
		},
		webrtc.RTPCodecTypeAudio,
	); err != nil {
		logger.Error("failed to register opus codec", "error", err)
		return webrtc.NewAPI()
	}

	settingEngine := webrtc.SettingEngine{}

	publicIP := strings.TrimSpace(os.Getenv("WEBRTC_PUBLIC_IP"))
	if publicIP != "" {
		settingEngine.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
		logger.Info("configured WebRTC public IP", "public_ip", publicIP)
	}

	udpPortValue := strings.TrimSpace(os.Getenv("WEBRTC_UDP_PORT"))
	if udpPortValue != "" {
		udpPort, err := strconv.ParseUint(udpPortValue, 10, 16)
		if err != nil || udpPort == 0 {
			logger.Error("invalid WEBRTC_UDP_PORT", "value", udpPortValue, "error", err)
		} else {
			mux, err := ice.NewMultiUDPMuxFromPort(int(udpPort))
			if err != nil {
				logger.Error("failed to configure WebRTC UDP mux", "port", udpPort, "error", err)
			} else {
				settingEngine.SetICEUDPMux(mux)
				logger.Info("configured WebRTC UDP mux", "port", udpPort)
			}
		}
	}

	return webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
		webrtc.WithSettingEngine(settingEngine),
	)
}

func (h *Handler) newPeerConnection() (*webrtc.PeerConnection, error) {
	return h.api.NewPeerConnection(webrtc.Configuration{
		ICEServers: h.iceServers,
	})
}

func loadICEServers(logger *slog.Logger) []webrtc.ICEServer {
	stunURLs := splitEnvList(os.Getenv("WEBRTC_STUN_URLS"))
	if len(stunURLs) == 0 {
		stunURLs = []string{"stun:stun.l.google.com:19302"}
	}

	iceServers := []webrtc.ICEServer{
		{
			URLs: stunURLs,
		},
	}

	turnURLs := splitEnvList(os.Getenv("WEBRTC_TURN_URLS"))
	if len(turnURLs) > 0 {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs:       turnURLs,
			Username:   strings.TrimSpace(os.Getenv("WEBRTC_TURN_USERNAME")),
			Credential: strings.TrimSpace(os.Getenv("WEBRTC_TURN_CREDENTIAL")),
		})

		if logger != nil {
			logger.Info(
				"configured WebRTC TURN servers",
				"stun_url_count", len(stunURLs),
				"turn_url_count", len(turnURLs),
			)
		}
	}

	return iceServers
}

func splitEnvList(value string) []string {
	parts := strings.Split(value, ",")
	values := make([]string, 0, len(parts))

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		values = append(values, part)
	}

	return values
}
