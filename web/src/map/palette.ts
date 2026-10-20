// The colours the map paints with. WebGL paint values are plain strings, so the map's data encoding
// cannot come from the Tailwind tokens the rest of the app uses; these constants are the single
// source of truth for both the pins/links drawn on the canvas and the legend drawn over it.

import type { ArcType, Category } from "@/lib/citations";

export const CATEGORY_COLORS: Record<Category, string> = {
  county: "#2563eb",
  state: "#7c3aed",
  statute: "#0d9488",
  federal: "#b45309",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  county: "County court",
  state: "Colorado court",
  statute: "Colorado statute",
  federal: "Federal",
};

export const ARC_COLORS: Record<ArcType, string> = {
  cc: "#2563eb",
  cs: "#7c3aed",
  st: "#0d9488",
  fed: "#b45309",
  other: "#64748b",
};

export const ARC_LABELS: Record<ArcType, string> = {
  cc: "County to county",
  cs: "County to state",
  st: "Statute",
  fed: "Federal",
  other: "Link",
};
