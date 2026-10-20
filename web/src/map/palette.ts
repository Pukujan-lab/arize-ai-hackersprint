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

/**
 * The colours of the country the law sits in: the state and county lines drawn under the pins, the
 * names those lines carry, and the historic sites that give an area its character. They are greyer than
 * the pins on purpose — the map's job is to answer "where", not to compete with its own answer.
 */
export const CONTEXT_COLORS = {
  /** Country and state outlines. */
  state: "#8d99a8",
  /** County lines: dashed, so they read as a division of land rather than a route. */
  county: "#b9c2ce",
  countyLabel: "#5b6675",
  /** Neighbourhood and suburb names, at the zooms where they mean something. */
  areaLabel: "#7c8794",
  /** Historic landmarks: monuments, memorials, forts, battlefields, ruins. */
  historic: "#a16207",
  historicLabel: "#7c5518",
};
