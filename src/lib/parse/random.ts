export type RandomData =
  | { kind: "dice"; count: number; sides: number }
  | { kind: "coin" }
  | { kind: "number"; min: number; max: number }
  | { kind: "pick"; options: string[] };

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function parseRandom(text: string): RandomData {
  const t = text.toLowerCase().trim();

  if (/\b(coins?|heads|tails|toss)\b/.test(t)) return { kind: "coin" };

  const dnd = t.match(/\b(\d+)?d(\d+)\b/);
  if (dnd) return { kind: "dice", count: clamp(Number(dnd[1] ?? 1), 1, 10), sides: clamp(Number(dnd[2]), 2, 1000) };

  const dice = t.match(/\b(\d+|a|an|one|two|three|four|five|six)?\s*(?:dice|die)\b/);
  if (dice) {
    const n = dice[1] ? (WORDS[dice[1]] ?? Number(dice[1])) : 1;
    return { kind: "dice", count: clamp(n, 1, 10), sides: 6 };
  }

  const range = t.match(/\b(-?\d+)\s*(?:-|–|to|and)\s*(-?\d+)\b/);
  if (range && /\b(number|random|between|pick|choose|rng)\b/.test(t)) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    return { kind: "number", min: Math.min(a, b), max: Math.max(a, b) };
  }

  const list = t.replace(/^.*?\b(?:pick|choose|decide|random(?:ly)?|between)\b\s*(?:one|a random one)?\s*(?:from|between|of|:)?\s*/, "");
  const options = list
    .split(/\s*(?:,|\bor\b|\/|\n)\s*/)
    .map((s) => s.trim().replace(/[?.!]+$/, ""))
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  if (options.length >= 2) return { kind: "pick", options };

  return { kind: "number", min: 1, max: 100 };
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

export function rollRandom(d: RandomData, rand: () => number = Math.random): string[] {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  switch (d.kind) {
    case "coin":
      return [rand() < 0.5 ? "Heads" : "Tails"];
    case "dice":
      return Array.from({ length: d.count }, () => String(int(1, d.sides)));
    case "number":
      return [String(int(d.min, d.max))];
    case "pick":
      return [d.options[int(0, d.options.length - 1)]];
  }
}

export function describeRandom(d: RandomData) {
  switch (d.kind) {
    case "coin":
      return "Coin flip";
    case "dice":
      return d.sides === 6 ? `${d.count} ${d.count === 1 ? "die" : "dice"}` : `${d.count}d${d.sides}`;
    case "number":
      return `Number from ${d.min} to ${d.max}`;
    case "pick":
      return `Pick one of ${d.options.length}`;
  }
}

export function completeRandom() {
  return 1;
}
