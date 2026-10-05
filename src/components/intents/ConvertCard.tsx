"use client";

import { ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ConvertData, convertValue, UNIT_LABELS, unitOptions } from "@/lib/parse/convert";
import { AnimatedNumber, Field, HeroNumber, Meta, Missing } from "./shared";
import type { CardProps } from "./types";

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
};

export function ConvertCard({ data, interactive }: CardProps<ConvertData>) {
  const [units, setUnits] = useState<{ from: string; to: string } | null>(null);
  const key = `${data.value}|${data.from}|${data.to}`;
  const [prev, setPrev] = useState(key);
  if (prev !== key) {
    setPrev(key);
    setUnits(null);
  }

  if (data.value === null || !data.from) {
    return (
      <Field index={0} className="flex items-center gap-2">
        <Missing>Type a value with a unit, like 5 miles in km</Missing>
      </Field>
    );
  }

  const from = units?.from ?? data.from;
  const to = units?.to ?? data.to ?? data.from;
  const result = convertValue(data.value, from, to);
  const options = unitOptions(from);

  const unitSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <Select value={value} onValueChange={onChange} disabled={!interactive}>
      <SelectTrigger size="sm" aria-label={label} className="h-7 w-fit gap-1 border-none bg-secondary px-2.5 text-[13px] font-medium text-ink-2 shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((u) => (
          <SelectItem key={u} value={u}>
            {UNIT_LABELS[u] ?? u}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Field index={0} className="flex flex-col gap-2">
        <HeroNumber className="text-ink-2">{fmt(data.value)}</HeroNumber>
        {unitSelect(from, (v) => setUnits({ from: v, to }), "From unit")}
      </Field>
      <Field index={1}>
        <Button size="icon-sm" variant="ghost" aria-label="Swap units" disabled={!interactive} onClick={() => setUnits({ from: to, to: from })}>
          <ArrowLeftRight />
        </Button>
      </Field>
      <Field index={2} className="flex min-w-0 flex-col items-end gap-2">
        <HeroNumber>{result === null ? "—" : <AnimatedNumber value={result} format={fmt} />}</HeroNumber>
        {unitSelect(to, (v) => setUnits({ from, to: v }), "To unit")}
      </Field>
      <Meta className="sr-only">
        {fmt(data.value)} {from} is {result === null ? "unknown" : fmt(result)} {to}
      </Meta>
    </div>
  );
}
