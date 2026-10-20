// Read a line aloud, reporting what the voice is doing. The voice itself lives in the map's narrator —
// the browser's own voice first, the server's chain behind it — so a line spoken here sounds exactly
// like a line in the walk.

import { useCallback, useEffect, useRef, useState } from "react";
import { narrate, type Narration } from "@/map/narrator";

export type NarrationStatus = "idle" | "loading" | "speaking" | "unavailable";

export function useNarration() {
  const session = useRef<Narration | null>(null);
  const [status, setStatus] = useState<NarrationStatus>("idle");

  const stop = useCallback(() => {
    session.current?.stop();
    session.current = null;
    setStatus("idle");
  }, []);

  const speak = useCallback((text: string) => {
    if (!text.trim()) return;
    session.current?.stop();
    setStatus("loading");
    session.current = narrate(
      text,
      () => {
        session.current = null;
        setStatus("idle");
      },
      {
        loading: (loading) => setStatus(loading ? "loading" : "speaking"),
        playing: () => setStatus("speaking"),
        unavailable: () => setStatus("unavailable"),
      },
    );
  }, []);

  useEffect(() => () => session.current?.stop(), []);

  return { status, speak, stop, active: status === "speaking" || status === "loading" };
}
