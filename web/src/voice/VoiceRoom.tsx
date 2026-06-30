import "@livekit/components-styles";

import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";

import { Track } from "livekit-client";
import type { VoiceTokenResponse } from "../api";

type VoiceRoomProps = {
  voice: VoiceTokenResponse;
  onLeave: () => void;
};

function VoiceContent() {
  const tracks = useTracks(
    [
      Track.Source.Camera,
      Track.Source.ScreenShare,
    ],
    {
      onlySubscribed: false,
    },
  );

  return (
    <>
      <RoomAudioRenderer />

      {tracks.length > 0 && (
        <div className="voice-room__stage">
          <GridLayout tracks={tracks}>
            <ParticipantTile />
          </GridLayout>
        </div>
      )}

      <div className="voice-room__bar">
        <ControlBar
          controls={{
            microphone: true,
            camera: true,
            screenShare: true,
            chat: false,
            settings: true,
            leave: true,
          }}
        />
      </div>
    </>
  );
}

export function VoiceRoom({ voice, onLeave }: VoiceRoomProps) {
  return (
    <div className="voice-room">
      <LiveKitRoom
        serverUrl={voice.url}
        token={voice.token}
        connect={true}
        audio={true}
        video={false}
        onDisconnected={onLeave}
      >
        <VoiceContent />
      </LiveKitRoom>
    </div>
  );
}