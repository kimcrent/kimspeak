package voice

import (
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

type Handler struct {
	sfu    *SFU
	logger *slog.Logger
}

func NewHandler(logger *slog.Logger) *Handler {
	return &Handler{
		sfu:    NewSFU(logger),
		logger: logger,
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

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

	pc, err := newPeerConnection()

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
		UserID:   userID,
		Username: username,
		RoomID:   channelID,
		pc:       pc,
		ws:       ws,
		Room:     room,
		logger:   h.logger,
		senders:  make(map[string]*webrtc.RTPSender),
	}

	room.AddPeer(peer)

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
			webrtc.PeerConnectionStateClosed,
			webrtc.PeerConnectionStateDisconnected:
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

		localTrack, relayTrackID, err := room.AddRelayTrack(userID, remoteTrack)
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
		}
	}
}

func newPeerConnection() (*webrtc.PeerConnection, error) {
	mediaEngine := &webrtc.MediaEngine{}

	err := mediaEngine.RegisterCodec(
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
	)
	if err != nil {
		return nil, err
	}

	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
	)

	return api.NewPeerConnection(webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: []string{
					"stun:stun.l.google.com:19302",
				},
			},
		},
	})
}
