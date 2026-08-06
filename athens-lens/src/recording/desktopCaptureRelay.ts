export type DesktopCaptureRelay = {
  offer: RTCSessionDescriptionInit;
  connect(answer: RTCSessionDescriptionInit): Promise<void>;
  close(): void;
};

const activeRelays = new Map<string, DesktopCaptureRelay>();

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(finish, 2_000);
    function finish() {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }
    function onStateChange() {
      if (peer.iceGatheringState === "complete") finish();
    }
    peer.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function localDescription(peer: RTCPeerConnection): RTCSessionDescriptionInit {
  const description = peer.localDescription;
  if (!description) throw new Error("Could not prepare the selected tab stream.");
  return { type: description.type, sdp: description.sdp };
}

/**
 * Desktop-picker stream IDs must be redeemed by the extension page that opened
 * the picker. Relay the resulting track to the persistent offscreen recorder.
 */
export async function createDesktopCaptureRelay(
  streamId: string,
): Promise<DesktopCaptureRelay> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error Chrome desktop-capture constraints are not in DOM typings.
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
        maxWidth: 640,
        maxHeight: 360,
        maxFrameRate: 6,
      },
    },
  });
  const peer = new RTCPeerConnection({ iceServers: [] });
  let closed = false;

  try {
    for (const track of stream.getTracks()) peer.addTrack(track, stream);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);

    return {
      offer: localDescription(peer),
      async connect(answer) {
        if (closed) throw new Error("The selected tab stream is no longer available.");
        await peer.setRemoteDescription(answer);
      },
      close() {
        if (closed) return;
        closed = true;
        stream.getTracks().forEach((track) => track.stop());
        peer.close();
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    peer.close();
    throw error;
  }
}

export function keepDesktopCaptureRelay(sessionId: string, relay: DesktopCaptureRelay) {
  activeRelays.get(sessionId)?.close();
  activeRelays.set(sessionId, relay);
}

export function closeDesktopCaptureRelay(sessionId: string) {
  activeRelays.get(sessionId)?.close();
  activeRelays.delete(sessionId);
}
