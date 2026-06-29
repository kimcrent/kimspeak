package voice

import "github.com/pion/webrtc/v4"

const (
	MessageTypeOffer      = "offer"
	MessageTypeAnswer     = "answer"
	MessageTypeCandidate  = "candidate"
	MessageTypeError      = "error"
	MessageTypeVoiceState = "voice_state"
	MessageTypeSettings   = "voice_settings"
)

type VoiceSettings struct {
	Muted            bool    `json:"muted"`
	EchoCancellation bool    `json:"echoCancellation"`
	NoiseSuppression bool    `json:"noiseSuppression"`
	AutoGainControl  bool    `json:"autoGainControl"`
	InputGain        float64 `json:"inputGain"`
	BitrateKbps      int     `json:"bitrateKbps"`
}

type VoiceUser struct {
	ID       string        `json:"id"`
	Username string        `json:"username"`
	Settings VoiceSettings `json:"settings"`
}

type SignalMessage struct {
	Type      string                     `json:"type"`
	SDP       *webrtc.SessionDescription `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
	Settings  *VoiceSettings             `json:"settings,omitempty"`
	Error     string                     `json:"error,omitempty"`
	Users     []VoiceUser                `json:"users,omitempty"`
}
