// Narration: one clip per line of text, fetched from /api/tts_ts and played in step with the tour.
// The clip is the authority on when a line ends. Its own length bounds the line, so a browser that
// never reports the clip's end cannot stall the tour; the timings it returns are only a fallback for
// the rare clip whose length is unknown.

type Clip = { audio_b64?: string; starts?: number[] } | null;

const CLIP_CHARS = 400;
/** How long a line waits before advancing when its clip never arrives, or cannot be measured. */
const SILENT_ADVANCE_MS = 2500;
/** Grace after the clip's own length for the end event to arrive. */
const END_MARGIN_MS = 400;
/** How far the clip's clock must move before a line may be extended. */
const PROGRESS_SECONDS = 0.05;
/** A cap on extensions so a misreported length cannot hold a line open indefinitely. */
const MAX_EXTENSIONS = 3;

const cache = new Map<string, Promise<Clip>>();

/** A clip that has not arrived by now is treated as absent, so a slow server cannot stall the walk. */
const REQUEST_GIVE_UP_MS = 7000;

function request(text: string): Promise<Clip> {
  const key = text.slice(0, CLIP_CHARS);
  const hit = cache.get(key);
  if (hit) return hit;
  const ask = fetch("/api/tts_ts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: key }),
  })
    .then((r) => (r.ok ? (r.json() as Promise<Clip>) : null))
    .catch(() => null);
  const pending = Promise.race([
    ask,
    new Promise<Clip>((resolve) => window.setTimeout(() => resolve(null), REQUEST_GIVE_UP_MS)),
  ]);
  cache.set(key, pending);
  return pending;
}

/**
 * Ask for a clip now so it is ready when the reader reaches that line. It is only cached: a queued
 * clip never plays, so it can never cut off the line that is speaking.
 */
export function prefetchClip(text: string): void {
  void request(text);
}

export type Narration = { stop: () => void };

export type NarrationHooks = {
  /** The reader has muted the voice: the line ends on its own timer without fetching or playing. */
  muted?: boolean;
  /** Told when this line's clip is being fetched, so the page can say so while it waits. */
  loading?: (loading: boolean) => void;
  /** The clip is playing: the page can show a live indicator. */
  playing?: () => void;
  /** No clip could be played, so the line continues in silence and the page says so. */
  unavailable?: () => void;
};

/** The clip's length in milliseconds as it reports it, else as its timings imply, else null. */
function clipLengthMs(el: HTMLAudioElement, starts: number[], chars: number): number | null {
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration * 1000;
  if (starts.length > 1) {
    const last = starts[starts.length - 1];
    const perChar = (last - starts[0]) / (starts.length - 1);
    if (perChar > 0) return (last + Math.max(0, chars - starts.length) * perChar) * 1000;
  }
  return null;
}

/** Speak a line, calling onEnd when the clip finishes or when no clip can be played. */
export function narrate(text: string, onEnd: () => void, hooks: NarrationHooks = {}): Narration {
  if (hooks.muted) {
    // Silenced: nothing is fetched and nothing is played, but the line still ends so a walk keeps
    // going. Unmuting takes effect on the next line.
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      onEnd();
    }, SILENT_ADVANCE_MS);
    return {
      stop() {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
      },
    };
  }

  let finished = false;
  let audio: HTMLAudioElement | null = null;
  let timer: number | null = null;
  let bound: number | null = null;
  let objectUrl: string | null = null;
  let detach: () => void = () => {};

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const clearBound = () => {
    if (bound !== null) {
      window.clearTimeout(bound);
      bound = null;
    }
  };

  const cleanup = () => {
    clearTimer();
    clearBound();
    detach();
    detach = () => {};
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
    // No clip can be played: the page says the voice is unavailable and the transcript carries on.
    hooks.unavailable?.();
    timer = window.setTimeout(finish, SILENT_ADVANCE_MS);
  };

  // The clip's length bounds the line. The timer fires once and ends the line; it is extended only
  // when the clip's clock has actually moved on, never merely because the element is not paused.
  const armBound = (el: HTMLAudioElement, lengthMs: number) => {
    clearBound();
    let lastTime = el.currentTime;
    let extensions = 0;
    const arm = (ms: number) => {
      bound = window.setTimeout(() => {
        bound = null;
        const now = el.currentTime;
        const progressed = now - lastTime > PROGRESS_SECONDS;
        lastTime = now;
        const known = Number.isFinite(el.duration) && el.duration > 0;
        if (progressed && known && now < el.duration && extensions < MAX_EXTENSIONS) {
          extensions += 1;
          arm(Math.max(200, (el.duration - now) * 1000));
          return;
        }
        finish();
      }, Math.max(0, ms) + END_MARGIN_MS);
    };
    arm(lengthMs);
  };

  // The clip is being fetched, which can take a moment; the page says so while it waits.
  hooks.loading?.(true);
  void request(text).then((clip) => {
    hooks.loading?.(false);
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
      const el = new Audio(url);
      audio = el;
      const starts = Array.isArray(clip.starts) ? clip.starts : [];
      const chars = Math.min(text.length, CLIP_CHARS);

      // Metadata can arrive after playback starts, so measure again once the length is known.
      let measured = false;
      const measure = () => {
        if (finished || measured) return;
        const ms = clipLengthMs(el, starts, chars);
        if (ms === null) return;
        measured = Number.isFinite(el.duration) && el.duration > 0;
        armBound(el, ms);
      };
      el.addEventListener("loadedmetadata", measure);
      el.addEventListener("durationchange", measure);
      detach = () => {
        el.removeEventListener("loadedmetadata", measure);
        el.removeEventListener("durationchange", measure);
      };

      el.onended = finish;
      el.onerror = silently;

      const length = clipLengthMs(el, starts, chars);
      if (length === null) armBound(el, SILENT_ADVANCE_MS);
      else armBound(el, length);
      measured = Number.isFinite(el.duration) && el.duration > 0;

      void el
        .play()
        .then(() => hooks.playing?.())
        .catch(silently);
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
