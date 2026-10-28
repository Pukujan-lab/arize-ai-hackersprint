import { useEffect, useState } from "react";

/** True while the window is at least `px` wide, so a side column can sit beside the chat instead of over it. */
export function useWide(px = 1024): boolean {
  const query = `(min-width: ${px}px)`;
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setWide(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return wide;
}
