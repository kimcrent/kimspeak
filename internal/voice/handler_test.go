package voice

import (
	"reflect"
	"testing"
)

func TestSplitEnvListTrimsAndDropsEmptyValues(t *testing.T) {
	got := splitEnvList(" stun:one:19302, ,turn:two:3478 ,, turn:three:5349 ")
	want := []string{"stun:one:19302", "turn:two:3478", "turn:three:5349"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("splitEnvList() = %#v, want %#v", got, want)
	}
}
