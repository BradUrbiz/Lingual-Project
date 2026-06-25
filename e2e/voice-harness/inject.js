/**
 * Page-context init script.
 *
 * Installed via context.addInitScript() so it runs BEFORE the app's own code —
 * critical, because the override must be in place before useRealtimeChat.ts calls
 * navigator.mediaDevices.getUserMedia({ audio }).
 *
 * What it does:
 *   1. Replaces getUserMedia so an audio request returns a synthetic MediaStream
 *      backed by a MediaStreamAudioDestinationNode. That stream's track is created
 *      ONCE and stays live for the whole WebRTC session (the app's pc.addTrack gets
 *      a track that never ends), so we can keep feeding it new audio mid-call.
 *   2. Exposes window.__voiceHarness.speak(base64Wav): decodes the audio and plays
 *      it through the destination node -> flows down the live track -> WebRTC ->
 *      OpenAI Realtime. Between utterances the node emits digital silence, which is
 *      exactly what semantic_vad needs to detect a turn boundary.
 *
 * This function is serialized by Playwright (.toString()), so it must be
 * self-contained: no external closure references.
 */
export function voiceHarnessInit() {
  if (window.__voiceHarness) return;
  const AC = window.AudioContext || window['webkitAudioContext'];

  let ac = null;
  let dest = null;

  function ensureBus() {
    if (!ac) {
      ac = new AC();
      dest = ac.createMediaStreamDestination();
    }
    // If the app stopped our track on a previous disconnect, rebuild it so a
    // reconnect (getUserMedia called again) gets a fresh live track.
    const track = dest.stream.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') {
      dest = ac.createMediaStreamDestination();
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return dest;
  }

  const realGUM =
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : null;

  async function fakeGUM(constraints) {
    if (constraints && constraints.audio) {
      ensureBus();
      return dest.stream;
    }
    // Non-audio (e.g. camera) requests fall through to the real implementation.
    if (realGUM) return realGUM(constraints);
    return new MediaStream();
  }

  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      configurable: true,
    });
  }
  try {
    navigator.mediaDevices.getUserMedia = fakeGUM;
  } catch (_e) {
    /* read-only in some engines; legacy patch below still helps */
  }
  // Legacy callback-style API, just in case.
  navigator.getUserMedia = (c, ok, err) => fakeGUM(c).then(ok, err);

  window.__voiceHarness = {
    version: 1,
    speaking: false,
    lastDurationSec: 0,

    /** Play a base64-encoded WAV/MP3 into the live mic track. Resolves when done. */
    async speak(b64) {
      ensureBus();
      if (ac.state === 'suspended') await ac.resume().catch(() => {});

      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

      const audioBuf = await ac.decodeAudioData(u8.buffer);
      const src = ac.createBufferSource();
      src.buffer = audioBuf;
      src.connect(dest);

      this.speaking = true;
      src.start();
      await new Promise((res) => {
        src.onended = res;
      });
      this.speaking = false;
      this.lastDurationSec = audioBuf.duration;
      return audioBuf.duration;
    },

    /** Is the synthetic mic currently wired up? */
    isReady() {
      return !!dest;
    },
  };
}
