// Drive the tour: one stop at a time, each spoken through the narrator, each ending when the voice ends
// (or when no voice can be had, after a silence). Stopping is always immediate and always silent.

import { useCallback, useEffect, useRef, useState } from "react";
import { narrate, type Narration } from "@/map/narrator";
import type { NarrationStatus } from "@/hooks/use-narration";
import type { TourStep } from "@/map/tour";

export function useTour(steps: TourStep[], onStart?: () => void) {
  /** The stop being spoken, or -1 when the walk is not running. */
  const [index, setIndex] = useState(-1);
  const [status, setStatus] = useState<NarrationStatus>("idle");
  /** How much of the current stop has been heard, so the caption keeps pace with the voice. */
  const [heard, setHeard] = useState(0);

  const session = useRef<Narration | null>(null);
  const cursor = useRef(-1);
  const stepsRef = useRef(steps);
  const goRef = useRef<(at: number) => void>(() => {});
  const onStartRef = useRef(onStart);

  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);
  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);

  const stop = useCallback(() => {
    cursor.current = -1;
    session.current?.stop();
    session.current = null;
    setIndex(-1);
    setStatus("idle");
    setHeard(0);
  }, []);

  const go = useCallback(
    (at: number) => {
      const plan = stepsRef.current;
      if (at < 0 || at >= plan.length) {
        stop();
        return;
      }
      cursor.current = at;
      setIndex(at);
      setHeard(0);
      session.current?.stop();
      setStatus("loading");
      session.current = narrate(
        plan[at].text,
        () => {
          session.current = null;
          if (cursor.current === at) goRef.current(at + 1);
        },
        {
          loading: (loading) => setStatus(loading ? "loading" : "speaking"),
          playing: () => setStatus("speaking"),
          unavailable: () => setStatus("unavailable"),
          progress: (chars) => {
            if (cursor.current === at) setHeard(chars);
          },
        },
      );
    },
    [stop],
  );

  useEffect(() => {
    goRef.current = go;
  }, [go]);

  const start = useCallback(() => {
    if (!stepsRef.current.length) return;
    onStartRef.current?.();
    goRef.current(0);
  }, []);

  // A new answer is a new walk: the old one never speaks over it.
  useEffect(() => {
    stop();
  }, [steps, stop]);

  useEffect(() => () => session.current?.stop(), []);

  const current = index >= 0 ? steps[index] ?? null : null;

  return { index, status, heard, start, stop, active: index >= 0, current };
}
