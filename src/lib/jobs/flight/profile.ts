import type { Profile, Traveller } from "./types";

/** The demo's saved profile: who "me", "mom", "dad" and "priya" are, where home is, how to pay. Dad has no ID on file yet. */
export const DEMO_PROFILE: Profile = {
  home: "BLR",
  travellers: [
    { id: "me", label: "You", idOnFile: true },
    { id: "mom", label: "Mom", idOnFile: true },
    { id: "dad", label: "Dad", idOnFile: false },
    { id: "priya", label: "Priya", idOnFile: true },
  ],
  payment: "Face ID · saved card",
};

/** How each traveller gets named in a sentence. Lowercase; "i" only counts as a word on its own. */
export const TRAVELLER_ALIASES: Record<string, string[]> = {
  me: ["me", "i", "myself", "i'll", "i'm"],
  mom: ["mom", "mum", "mother", "amma", "ma", "mummy"],
  dad: ["dad", "father", "papa", "appa", "daddy"],
  priya: ["priya"],
};

const ALIAS_TO_ID = new Map(Object.entries(TRAVELLER_ALIASES).flatMap(([id, aliases]) => aliases.map((a) => [a, id] as const)));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longest alias first, so "i'll" is read before the "i" inside it. */
const ALIAS_RE = new RegExp(
  `\\b(${[...ALIAS_TO_ID.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|")})\\b`,
  "gi",
);

/** Traveller ids named in the text, in text order, each once. Matches whole words only, so "in" is not "i". */
export function findTravellersIn(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.replace(/[’‘]/g, "'").matchAll(ALIAS_RE)) {
    const id = ALIAS_TO_ID.get(m[1].toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export const travellerOf = (profile: Profile, id: string): Traveller | undefined => profile.travellers.find((t) => t.id === id);
export const labelOf = (profile: Profile, id: string) => travellerOf(profile, id)?.label ?? id;

/** "You", "You and Mom", "You, Mom and Dad" */
export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
