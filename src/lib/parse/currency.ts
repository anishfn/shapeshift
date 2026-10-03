export type CurrencyData = {
  value: number | null;
  from: string | null;
  to: string | null;
};

const SYMBOL_TO_WORD: Record<string, string> = {
  "$": " usd ",
  "€": " eur ",
  "£": " gbp ",
  "₹": " inr ",
  "¥": " jpy ",
  "₩": " krw ",
};

export const CURRENCY_ALIASES: Record<string, string> = {
  usd: "USD", "us dollar": "USD", "us dollars": "USD", dollar: "USD", dollars: "USD", buck: "USD", bucks: "USD",
  eur: "EUR", euro: "EUR", euros: "EUR",
  gbp: "GBP", "pound sterling": "GBP", "pounds sterling": "GBP", pound: "GBP", pounds: "GBP", quid: "GBP",
  inr: "INR", rupee: "INR", rupees: "INR", rs: "INR",
  jpy: "JPY", yen: "JPY",
  cny: "CNY", yuan: "CNY", rmb: "CNY",
  aud: "AUD", "australian dollar": "AUD", "australian dollars": "AUD",
  cad: "CAD", "canadian dollar": "CAD", "canadian dollars": "CAD",
  chf: "CHF", franc: "CHF", francs: "CHF",
  sgd: "SGD", "singapore dollar": "SGD", "singapore dollars": "SGD",
  aed: "AED", dirham: "AED", dirhams: "AED",
  krw: "KRW", won: "KRW",
  nzd: "NZD", "new zealand dollar": "NZD", "new zealand dollars": "NZD",
  zar: "ZAR", rand: "ZAR",
};

export const CURRENCY_LABELS: Record<string, string> = {
  USD: "US Dollar", EUR: "Euro", GBP: "British Pound", INR: "Indian Rupee", JPY: "Japanese Yen",
  CNY: "Chinese Yuan", AUD: "Australian Dollar", CAD: "Canadian Dollar", CHF: "Swiss Franc",
  SGD: "Singapore Dollar", AED: "UAE Dirham", KRW: "South Korean Won", NZD: "New Zealand Dollar", ZAR: "South African Rand",
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥", CNY: "¥", AUD: "A$", CAD: "C$",
  CHF: "CHF ", SGD: "S$", AED: "AED ", KRW: "₩", NZD: "NZ$", ZAR: "R",
};

export const CURRENCY_CODES = ["USD", "INR", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "SGD", "AED", "KRW", "NZD", "ZAR"];

const DEFAULT_TARGET: Record<string, string> = Object.fromEntries(CURRENCY_CODES.map((c) => [c, c === "INR" ? "USD" : "INR"]));

const CODE_PATTERN = Object.keys(CURRENCY_ALIASES)
  .sort((a, b) => b.length - a.length)
  .join("|");

const CODE_RE = new RegExp(`\\b(${CODE_PATTERN})\\b`, "gi");
const AMOUNT_RE = /-?\d[\d,]*(?:\.\d+)?/;

function normalize(text: string) {
  return text.toLowerCase().replace(/[$€£₹¥₩]/g, (m) => SYMBOL_TO_WORD[m] ?? m);
}

function toNumber(raw: string) {
  return Number(raw.replace(/,/g, ""));
}

export function parseCurrency(text: string): CurrencyData {
  const t = normalize(text);
  const amount = t.match(AMOUNT_RE);
  if (!amount) return { value: null, from: null, to: null };

  const hits = [...t.matchAll(CODE_RE)].map((m) => CURRENCY_ALIASES[m[1]]);
  if (hits.length === 0) return { value: null, from: null, to: null };

  const value = toNumber(amount[0]);
  const from = hits[0];
  const to = hits[1] ?? DEFAULT_TARGET[from] ?? null;
  return { value, from, to };
}

export function completeCurrency(d: CurrencyData) {
  return (d.value !== null ? 0.4 : 0) + (d.from ? 0.3 : 0) + (d.to ? 0.3 : 0);
}
