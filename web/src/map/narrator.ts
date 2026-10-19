// Narration: one clip per line of text, fetched from /api/tts_ts and played in step with the tour.
// The clip is the authority on when a line ends; the character start times it returns are the
// fallback that keeps the tour moving if a browser never reports the clip's end.

type Clip = { audio_b64?: string; starts?: number[] } | null;

const CLIP_CHARS = 400;
/** How long a stop waits before advancing when its clip never arrives. */
export const SILENT_ADVANCE_MS = 2500;
const SECONDS_PER_CHAR = 0.06;

const cache = new Map<string, Promise<Clip>>();

function request(text: string): Promise<Clip> {
  const key = text.slice(0, CLIP_CHARS);
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = fetch("/api/tts_ts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: key }),
  })
    .then((r) => (r.ok ? (r.json() as Promise<Clip>) : null))
    .catch(() => null);
  cache.set(key, pending);
  return pending;
}

/** Ask for a clip now so it is ready when the reader reaches that line. */
export function prefetchClip(text: string): void {
  void request(text);
}

export type Narration = { stop: () => void };

/** The clip's length in milliseconds, from its character start times. */
function clipLengthMs(starts: number[], chars: number): number {
  if (!starts.length) return chars * SECONDS_PER_CHAR * 1000;
  const last = starts[starts.length - 1];
  const perChar = starts.length > 1 ? (last - starts[0]) / Math.max(1, starts.length - 1) : SECONDS_PER_CHAR;
  return (last + (chars - starts.length) * perChar) * 1000;
}

/** Speak a line, calling onEnd when the clip finishes or when no clip can be played. */
export function narrate(text: string, onEnd: () => void): Narration {
  let finished = false;
  let audio: HTMLAudioElement | null = null;
  let timer: number | null = null;
  let safety: number | null = null;
  let objectUrl: string | null = null;

  const cleanup = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (safety !== null) {
      window.clearTimeout(safety);
      safety = null;
    }
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    onEnd();
  };

  const silently = () => {
    if (finished || timer !== null) return;
    timer = window.setTimeout(finish, SILENT_ADVANCE_MS);
  };

  // A clip that never reports its end still cannot stall the tour: the timings bound it.
  const armSafety = (ms: number) => {
    if (safety !== null) window.clearTimeout(safety);
    safety = window.setTimeout(() => {
      safety = null;
      if (audio && !audio.paused && !audio.ended) {
        armSafety(1000);
        return;
      }
      finish();
    }, ms);
  };

  void request(text).then((clip) => {
    if (finished) return;
    if (!clip || !clip.audio_b64) {
      silently();
      return;
    }
    try {
      const binary = atob(clip.audio_b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      objectUrl = url;
      const clipAudio = new Audio(url);
      audio = clipAudio;
      clipAudio.onended = finish;
      clipAudio.onerror = silently;
      const chars = Math.min(text.length, CLIP_CHARS);
      armSafety(clipLengthMs(clip.starts || [], chars) + 2000);
      void clipAudio.play().catch(silently);
    } catch {
      silently();
    }
  });

  return {
    stop() {
      if (finished) return;
      finished = true;
      cleanup();
    },
  };
}
