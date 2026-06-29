package voice

import (
	"io"
	"log/slog"
	"testing"

	"github.com/pion/webrtc/v4"
)

func newDiscardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newTestPeer(id string, userID string, username string) *Peer {
	return &Peer{
		ID:       id,
		UserID:   userID,
		Username: username,
		Settings: defaultVoiceSettings(),
		senders:  make(map[string]*webrtc.RTPSender),
	}
}

func TestRemovePeerDoesNotRemoveReplacementWithSameUserID(t *testing.T) {
	room := NewRoom("room-1", newDiscardLogger())
	oldPeer := newTestPeer("old-session", "user-1", "Kim")
	newPeer := newTestPeer("new-session", "user-1", "Kim")

	if replaced := room.AddPeer(oldPeer); replaced != nil {
		t.Fatalf("unexpected replacement for first peer")
	}

	if replaced := room.AddPeer(newPeer); replaced != oldPeer {
		t.Fatalf("expected old peer to be replaced")
	}

	room.RemovePeer(oldPeer)

	if got := room.peers[newPeer.UserID]; got != newPeer {
		t.Fatalf("replacement peer was removed by stale peer cleanup")
	}
}

func TestRemovePeerOnlyRemovesTracksOwnedByThatSession(t *testing.T) {
	room := NewRoom("room-1", newDiscardLogger())
	oldPeer := newTestPeer("old-session", "user-1", "Kim")
	newPeer := newTestPeer("new-session", "user-1", "Kim")

	room.peers[newPeer.UserID] = newPeer
	room.tracks["old-track"] = &RelayTrack{
		ID:          "old-track",
		OwnerID:     oldPeer.UserID,
		OwnerPeerID: oldPeer.ID,
	}
	room.tracks["new-track"] = &RelayTrack{
		ID:          "new-track",
		OwnerID:     newPeer.UserID,
		OwnerPeerID: newPeer.ID,
	}

	room.RemovePeer(oldPeer)

	if _, ok := room.tracks["old-track"]; ok {
		t.Fatalf("stale peer track was not removed")
	}

	if _, ok := room.tracks["new-track"]; !ok {
		t.Fatalf("replacement peer track was removed by stale peer cleanup")
	}
}

func TestUpdatePeerSettingsIgnoresStalePeer(t *testing.T) {
	room := NewRoom("room-1", newDiscardLogger())
	oldPeer := newTestPeer("old-session", "user-1", "Kim")
	newPeer := newTestPeer("new-session", "user-1", "Kim")

	room.AddPeer(oldPeer)
	room.AddPeer(newPeer)

	if updated := room.UpdatePeerSettings(oldPeer, VoiceSettings{Muted: true}); updated {
		t.Fatalf("stale peer updated replacement settings")
	}

	if newPeer.Settings.Muted {
		t.Fatalf("replacement peer was muted by stale settings update")
	}

	if updated := room.UpdatePeerSettings(newPeer, VoiceSettings{Muted: true, InputGain: 1, BitrateKbps: 64}); !updated {
		t.Fatalf("current peer settings were not updated")
	}

	if !newPeer.Settings.Muted {
		t.Fatalf("current peer settings did not apply")
	}
}
