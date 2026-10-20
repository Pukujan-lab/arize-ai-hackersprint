// Drive the tour: one stop at a time, each spoken through the narrator, each ending when the voice ends
// (or when no voice can be had, after a silence). Stopping is always immediate and always silent. The
// arrows hop from one location to the next, skipping the stops that sit nowhere, so the reader can walk
// the map on its own without the prose.

import { useCallback, useEffect, useRef, useState } from "react";
import { narrate, type Narration } from "@/map/narrator";
import type { NarrationStatus } from "@/hooks/use-narration";
import type { TourStep } from "@/map/tour";

/**
 * The next stop standing somewhere other than `away`, searching from `from` in `direction`. Stops that
 * sit nowhere are passed over, so an arrow always lands the camera on a new place; -1 when there is none.
 */
function located(steps: TourStep[], from: number, direction: 1 | -1, away: string | null): number {
  for (let at = from; at >= 0 && at < steps.length; at += direction) {
    const place = steps[at].place;
    if (place && place !== away) return at;
  }
  return -1;
}

export function useTour(steps: TourStep[], onStart?: () => void) {
  /** The stop being spoken, or -1 when the walk is not running. */
  const [index, setIndex] = useState(-1);
  const [status, setStatus] = useState<NarrationStatus>("idle");
  /** How much of the current stop has been heard, so the caption keeps pace with the voice. */
  const [heard, setHeard] = useState(0);

  const session = useRef<Narration | null>(null);
  const cursor = useRef(-1);
  /** Bumped on every stop and every step, so a voice that has just been cut cannot advance the walk. */
  const run = useRef(0);
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
    run.current += 1;
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
      // Every callback below is tied to this token: the line a step replaces can finish talking after
      // the step is gone, and it must not be able to move the walk on.
      const token = (run.current += 1);
      cursor.current = at;
      setIndex(at);
      setHeard(0);
      session.current?.stop();
      session.current = null;
      setStatus("loading");
      session.current = narrate(
        plan[at].text,
        () => {
          if (token !== run.current) return;
          session.current = null;
          goRef.current(at + 1);
        },
        {
          loading: (loading) => {
            if (token === run.current) setStatus(loading ? "loading" : "speaking");
          },
          playing: () => {
            if (token === run.current) setStatus("speaking");
          },
          unavailable: () => {
            if (token === run.current) setStatus("unavailable");
          },
          progress: (chars) => {
            if (token === run.current) setHeard(chars);
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

  /** The next place the authorities stand, spoken from there. With the walk idle, it opens on the first. */
  const next = useCallback(() => {
    const plan = stepsRef.current;
    if (!plan.length) return;
    const away = cursor.current >= 0 ? plan[cursor.current]?.place ?? null : null;
    const at = located(plan, cursor.current + 1, 1, away);
    if (at < 0) return;
    if (cursor.current < 0) onStartRef.current?.();
    goRef.current(at);
  }, []);

  /** The place before this one, back down the walk. */
  const prev = useCallback(() => {
    const plan = stepsRef.current;
    if (cursor.current < 0) return;
    const at = located(plan, cursor.current - 1, -1, plan[cursor.current]?.place ?? null);
    if (at >= 0) goRef.current(at);
  }, []);

  // A new answer is a new walk: the old one never speaks over it.
  useEffect(() => {
    stop();
  }, [steps, stop]);

  useEffect(() => () => session.current?.stop(), []);

  const current = index >= 0 ? steps[index] ?? null : null;
  const here = current?.place ?? null;

  return {
    index,
    status,
    heard,
    start,
    stop,
    next,
    prev,
    active: index >= 0,
    current,
    canPrev: located(steps, index - 1, -1, here) >= 0,
    canNext: located(steps, index + 1, 1, here) >= 0,
  };
}
