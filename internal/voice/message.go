package voice

import "github.com/pion/webrtc/v4"

const (
	MessageTypeOffer      = "offer"
	MessageTypeAnswer     = "answer"
	MessageTypeCandidate  = "candidate"
	MessageTypeError      = "error"
	MessageTypeVoiceState = "voice_state"
)

type VoiceUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type SignalMessage struct {
	Type      string                     `json:"type"`
	SDP       *webrtc.SessionDescription `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
	Error     string                     `json:"error,omitempty"`
	Users     []VoiceUser                `json:"users,omitempty"`
}
