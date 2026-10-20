// Narration: the browser's own voice first, the server's chain second.
//
// The order used to be the other way round, and it is why the voice felt broken: the server chain has to
// reach Fish Audio, then ElevenLabs, then a local Kokoro service, and when none of them answers the line
// waits out its give-up timeout before anything is heard. The browser's `speechSynthesis` needs no
// network, no key and no clip — it starts on the click that asked for it, and on Edge and Windows it is
// the Microsoft natural voices, which is the voice people already recognise from reading a page aloud.
// So the browser speaks, and only a browser that cannot speak at all — or that errors mid-line — hands
// the line to `/api/tts_ts`, whose clips are still cached and still better than silence.

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
/** A clip that has not arrived by now is treated as absent, so a slow server cannot stall the walk. */
const REQUEST_GIVE_UP_MS = 7000;
/** The browser's pace, near enough: it reads about fifteen characters a second. */
const CHAR_MS = 70;
/** How long past that pace a line is given before it is treated as ended anyway. */
const SPEECH_GRACE_MS = 6000;

export type Narration = { stop: () => void };

export type NarrationHooks = {
  /** The reader has muted the voice: the line ends on its own timer without fetching or playing. */
  muted?: boolean;
  /** Told when this line's clip is being fetched, so the page can say so while it waits. */
  loading?: (loading: boolean) => void;
  /** The voice is speaking: the page can show a live indicator. */
  playing?: () => void;
  /** No voice could be had at all, so the line continues in silence and the page says so. */
  unavailable?: () => void;
  /** How much of the line has been heard, in characters, so a caption can follow the voice. */
  progress?: (chars: number) => void;
};

/** A line that is only timed, not spoken: a walk still advances while the reader has the voice off. */
function silent(onEnd: () => void): Narration {
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

// ---------------- the browser's own voice

const canSpeak = () =>
  typeof window !== "undefined" &&
  !!window.speechSynthesis &&
  typeof window.SpeechSynthesisUtterance === "function";

/**
 * The best voice the machine already has. Natural and neural voices win, then the ones the platforms
 * ship by name, then anything local — a local voice starts at once, where a network voice can wait.
 */
let chosen: SpeechSynthesisVoice | null | undefined;

function score(voice: SpeechSynthesisVoice): number {
  let value = 0;
  if (/natural|neural/i.test(voice.name)) value += 6;
  if (/google/i.test(voice.name)) value += 5;
  if (/microsoft/i.test(voice.name)) value += 4;
  if (/aria|jenny|guy|ava|samantha|allison|zoe|serena/i.test(voice.name)) value += 3;
  if (/^en[-_]us/i.test(voice.lang)) value += 2;
  if (voice.localService) value += 1;
  return value;
}

function voice(): SpeechSynthesisVoice | null {
  if (chosen !== undefined) return chosen;
  const voices = window.speechSynthesis.getVoices?.() ?? [];
  // Some browsers fill the list a beat after the page loads; until then, let the default speak.
  if (!voices.length) return null;
  const english = voices.filter((candidate) => /^en(-|_|$)/i.test(candidate.lang));
  const pool = english.length ? english : voices;
  chosen = [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
  return chosen;
}

/**
 * Speak through the browser, calling `handOver` instead if the browser refuses. The line's own length
 * bounds it, so a browser that never reports the end cannot leave the walk saying it is still speaking.
 */
function speakHere(text: string, onEnd: () => void, hooks: NarrationHooks, handOver: () => void): Narration {
  const synth = window.speechSynthesis;
  let finished = false;
  let began = false;
  let watchdog: number | null = null;
  let startCheck: number | null = null;

  const disarm = () => {
    if (watchdog !== null) {
      window.clearTimeout(watchdog);
      watchdog = null;
    }
    if (startCheck !== null) {
      window.clearTimeout(startCheck);
      startCheck = null;
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    disarm();
    // If the line is ending on its own length rather than on its own end event, the voice is still
    // going: silence it before the next stop starts speaking over it.
    try {
      if (synth.speaking || synth.pending) synth.cancel();
    } catch {
      // Nothing was speaking.
    }
    hooks.progress?.(text.length);
    onEnd();
  };

  const give = () => {
    if (finished) return;
    finished = true;
    disarm();
    handOver();
  };

  const element = new SpeechSynthesisUtterance(text);
  const picked = voice();
  if (picked) element.voice = picked;
  element.lang = picked?.lang || "en-US";
  // A shade faster than the default: the reader is following a map, not listening to an audiobook.
  element.rate = 1.05;
  element.pitch = 1;

  element.onstart = () => {
    began = true;
    hooks.loading?.(false);
    hooks.playing?.();
    hooks.progress?.(0);
  };
  // Word boundaries are what make the caption keep pace with the voice.
  element.onboundary = (event) => hooks.progress?.(event.charIndex + (event.charLength ?? 0));
  element.onend = finish;
  element.onerror = (event) => {
    // A line we cancelled ourselves is not a failure; anything else hands the line to the server chain.
    if (event.error === "interrupted" || event.error === "canceled") return finish();
    give();
  };

  // `onend` is not guaranteed — a backgrounded tab, or a voice that stalls, never fires it — so the
  // line is bounded by its own length. Only then is the walk allowed to move on.
  const bound = () => {
    watchdog = window.setTimeout(finish, text.length * CHAR_MS + SPEECH_GRACE_MS);
  };

  const begin = () => {
    if (finished) return;
    try {
      synth.speak(element);
    } catch {
      give();
      return;
    }
    bound();
    // A machine with no voice installed accepts the utterance and says nothing at all: give it a
    // moment to start, and hand the line to the server rather than leaving a silence behind it.
    startCheck = window.setTimeout(() => {
      startCheck = null;
      if (!finished && !began) give();
    }, 1500);
  };

  // Speaking over a line that is still going needs the old one cancelled first, and some browsers drop
  // an utterance queued in the same tick as a cancel. Nothing speaking is the common case — the walk
  // advances only once a line has ended — so only that case is deferred.
  let interrupted = false;
  try {
    if (synth.speaking || synth.pending) {
      synth.cancel();
      interrupted = true;
    }
  } catch {
    // No queue to clear.
  }
  if (interrupted) window.setTimeout(begin, 40);
  else begin();

  return {
    stop() {
      if (finished) return;
      finished = true;
      disarm();
      try {
        synth.cancel();
      } catch {
        // Nothing was speaking: nothing to cancel.
      }
    },
  };
}

// ---------------- the server's chain

const cache = new Map<string, Promise<Clip>>();

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

/** Speak a line from a `/api/tts_ts` clip, calling onEnd when it finishes or when none can be played. */
function playClip(text: string, onEnd: () => void, hooks: NarrationHooks): Narration {
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

/**
 * Speak a line. The browser speaks it; a browser that cannot, or that errors, hands the line to the
 * server's chain. Either way the line ends once, so the caller advances once.
 */
export function narrate(text: string, onEnd: () => void, hooks: NarrationHooks = {}): Narration {
  if (hooks.muted) return silent(onEnd);
  if (!canSpeak()) return playClip(text, onEnd, hooks);

  // A clip that takes over from a failed browser voice; the caller's stop must reach whichever is live.
  const handover: { clip: Narration | null } = { clip: null };
  const here = speakHere(text, onEnd, hooks, () => {
    handover.clip = playClip(text, onEnd, hooks);
  });

  return {
    stop() {
      here.stop();
      handover.clip?.stop();
    },
  };
}
