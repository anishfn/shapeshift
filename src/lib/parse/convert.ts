import convert from "convert-units";

export type ConvertData = {
  value: number | null;
  from: string | null;
  to: string | null;
  result: number | null;
};

/** Aliases → convert-units abbreviations. */
export const UNIT_ALIASES: Record<string, string> = {
  km: "km", kms: "km", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km",
  mi: "mi", mile: "mi", miles: "mi",
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm",
  mm: "mm", millimeter: "mm", millimeters: "mm",
  ft: "ft", foot: "ft", feet: "ft",
  in: "in", inch: "in", inches: "in",
  yd: "yd", yard: "yd", yards: "yd",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gram: "g", grams: "g",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  oz: "oz", ounce: "oz", ounces: "oz",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  gal: "gal", gallon: "gal", gallons: "gal",
  cup: "cup", cups: "cup",
  c: "C", "°c": "C", celsius: "C", centigrade: "C",
  f: "F", "°f": "F", fahrenheit: "F",
  k: "K", kelvin: "K",
  "km/h": "km/h", kmh: "km/h", kph: "km/h",
  mph: "m/h",
};

const DEFAULT_TARGET: Record<string, string> = {
  km: "mi", mi: "km", m: "ft", cm: "in", mm: "in", ft: "m", in: "cm", yd: "m",
  kg: "lb", g: "oz", lb: "kg", oz: "g",
  l: "gal", ml: "fl-oz", gal: "l", cup: "ml",
  C: "F", F: "C", K: "C",
  "km/h": "m/h", "m/h": "km/h",
};

export const UNIT_LABELS: Record<string, string> = {
  km: "km", mi: "mi", m: "m", cm: "cm", mm: "mm", ft: "ft", in: "in", yd: "yd",
  kg: "kg", g: "g", lb: "lb", oz: "oz", mcg: "mcg", mg: "mg", mt: "t", t: "ton",
  l: "L", ml: "mL", gal: "gal", cup: "cup", "fl-oz": "fl oz", tsp: "tsp", Tbs: "tbsp", pnt: "pint", qt: "qt",
  C: "°C", F: "°F", K: "K",
  "km/h": "km/h", "m/h": "mph", "m/s": "m/s", knot: "knot",
};

const UNIT_PATTERN = Object.keys(UNIT_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[/.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const FULL_RE = new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\s+(?:to|in|into|as|=|->)\\s+(${UNIT_PATTERN})(?![a-z])`, "i");
const PART_RE = new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})(?![a-z])`, "i");

export function unitOptions(unit: string): string[] {
  try {
    const measure = convert().describe(unit as convert.Unit).measure;
    return convert()
      .possibilities(measure)
      .filter((u) => u in UNIT_LABELS);
  } catch {
    return [];
  }
}

export function convertValue(value: number, from: string, to: string): number | null {
  try {
    return convert(value).from(from as convert.Unit).to(to as convert.Unit);
  } catch {
    return null;
  }
}

export function parseConvert(text: string): ConvertData {
  const t = text.toLowerCase().replace(/degrees?\s+/g, "°").replace(/°\s+/g, "°");
  const full = t.match(FULL_RE);
  if (full) {
    const value = Number(full[1]);
    const from = UNIT_ALIASES[full[2]];
    const to = UNIT_ALIASES[full[3]];
    const result = convertValue(value, from, to);
    if (result !== null) return { value, from, to, result };
    // Units don't match (e.g. km to kg): keep the number and source unit, let the user pick a valid target.
    return { value, from, to: null, result: null };
  }
  const part = t.match(PART_RE);
  if (part) {
    const value = Number(part[1]);
    const from = UNIT_ALIASES[part[2]];
    const to = DEFAULT_TARGET[from] ?? null;
    return { value, from, to, result: to ? convertValue(value, from, to) : null };
  }
  return { value: null, from: null, to: null, result: null };
}

export function completeConvert(d: ConvertData) {
  return (d.value !== null ? 0.4 : 0) + (d.from ? 0.3 : 0) + (d.result !== null ? 0.3 : 0);
}
