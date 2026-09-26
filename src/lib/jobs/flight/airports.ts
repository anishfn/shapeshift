export const AIRPORTS = {
  BLR: { city: "Bengaluru", offset: "+05:30" },
  DEL: { city: "Delhi", offset: "+05:30" },
  CCU: { city: "Kolkata", offset: "+05:30" },
  KTM: { city: "Kathmandu", offset: "+05:45" },
  BOM: { city: "Mumbai", offset: "+05:30" },
  GOI: { city: "Goa", offset: "+05:30" },
  HYD: { city: "Hyderabad", offset: "+05:30" },
  MAA: { city: "Chennai", offset: "+05:30" },
  PNQ: { city: "Pune", offset: "+05:30" },
  COK: { city: "Kochi", offset: "+05:30" },
  PKR: { city: "Pokhara", offset: "+05:45" },
} as const satisfies Record<string, { city: string; offset: string }>;

export type AirportCode = keyof typeof AIRPORTS;

export const isAirportCode = (s: string): s is AirportCode => Object.hasOwn(AIRPORTS, s);
export const cityOf = (code: AirportCode) => AIRPORTS[code].city;
export const offsetOf = (code: AirportCode) => AIRPORTS[code].offset;

/** Every way people write a city in a sentence: the name, the code, the old name. Lowercase, one space between words. */
export const AIRPORT_ALIASES: Record<string, AirportCode> = {
  bangalore: "BLR",
  bengaluru: "BLR",
  blr: "BLR",
  delhi: "DEL",
  "new delhi": "DEL",
  del: "DEL",
  kolkata: "CCU",
  calcutta: "CCU",
  ccu: "CCU",
  kathmandu: "KTM",
  ktm: "KTM",
  mumbai: "BOM",
  bombay: "BOM",
  bom: "BOM",
  goa: "GOI",
  goi: "GOI",
  hyderabad: "HYD",
  hyd: "HYD",
  chennai: "MAA",
  madras: "MAA",
  maa: "MAA",
  pune: "PNQ",
  pnq: "PNQ",
  kochi: "COK",
  cochin: "COK",
  cok: "COK",
  pokhara: "PKR",
  pkr: "PKR",
};

/** One word or phrase to an airport, or null when it is not one we know. */
export function findAirport(word: string): AirportCode | null {
  const key = word.toLowerCase().replace(/\s+/g, " ").trim();
  return Object.hasOwn(AIRPORT_ALIASES, key) ? AIRPORT_ALIASES[key] : null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longest alias first, so "new delhi" wins over "delhi" at the same spot. */
const ALIAS_RE = new RegExp(
  `\\b(${Object.keys(AIRPORT_ALIASES)
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|")})\\b`,
  "gi",
);

export type AirportHit = { code: AirportCode; index: number; length: number };

/** Every city named in the text as a whole word, in text order, never overlapping. */
export function findAirportsIn(text: string): AirportHit[] {
  const hits: AirportHit[] = [];
  for (const m of text.matchAll(ALIAS_RE)) {
    const code = findAirport(m[1]);
    if (code) hits.push({ code, index: m.index, length: m[0].length });
  }
  return hits;
}
