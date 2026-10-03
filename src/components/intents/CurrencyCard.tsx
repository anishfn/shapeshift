"use client";

import { ArrowLeftRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCY_CODES, CURRENCY_LABELS, CURRENCY_SYMBOLS, type CurrencyData } from "@/lib/parse/currency";
import { AnimatedNumber, Field, HeroNumber, Meta, Missing } from "./shared";
import type { CardProps } from "./types";

const fmt = (code: string) => (n: number) => {
  const digits = Math.abs(n) >= 1000 ? 0 : 2;
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  return symbol + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

type Rate = { value: number | null; loading: boolean; error: boolean };
const RATE_IDLE: Rate = { value: null, loading: false, error: false };
type Fetched = { pair: string; value: number | null; error: boolean };

function useLiveRate(from: string, to: string, enabled: boolean): Rate {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const pair = `${from}:${to}`;
  const active = enabled && from !== to;

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    fetch(`https://api.frankfurter.dev/v1/latest?base=${from}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { rates?: Record<string, number> }) => {
        const value = data.rates?.[to];
        setFetched(typeof value === "number" ? { pair, value, error: false } : { pair, value: null, error: true });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setFetched({ pair, value: null, error: true });
      });
    return () => ctrl.abort();
  }, [from, to, active, pair]);

  if (!enabled) return RATE_IDLE;
  if (from === to) return { value: 1, loading: false, error: false };
  if (fetched?.pair !== pair) return { value: null, loading: true, error: false };
  return { value: fetched.value, loading: false, error: fetched.error };
}

export function CurrencyCard({ data, interactive }: CardProps<CurrencyData>) {
  const [codes, setCodes] = useState<{ from: string; to: string } | null>(null);
  const key = `${data.value}|${data.from}|${data.to}`;
  const [prev, setPrev] = useState(key);
  if (prev !== key) {
    setPrev(key);
    setCodes(null);
  }

  const from = codes?.from ?? data.from ?? "USD";
  const to = codes?.to ?? data.to ?? (from === "INR" ? "USD" : "INR");
  const rate = useLiveRate(from, to, data.value !== null);
  const result = rate.value !== null && data.value !== null ? data.value * rate.value : null;

  if (data.value === null || !data.from) {
    return (
      <Field index={0} className="flex items-center gap-2">
        <Missing>Type an amount and a currency, like 100 usd to inr</Missing>
      </Field>
    );
  }

  const codeSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <Select value={value} onValueChange={onChange} disabled={!interactive}>
      <SelectTrigger size="sm" aria-label={label} className="h-7 w-fit gap-1 border-none bg-secondary px-2.5 text-[13px] font-medium text-ink-2 shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCY_CODES.map((c) => (
          <SelectItem key={c} value={c}>
            {c} · {CURRENCY_LABELS[c] ?? c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Field index={0} className="flex flex-col gap-2">
          <HeroNumber className="text-ink-2">{fmt(from)(data.value)}</HeroNumber>
          {codeSelect(from, (v) => setCodes({ from: v, to }), "From currency")}
        </Field>
        <Field index={1}>
          <Button size="icon-sm" variant="ghost" aria-label="Swap currencies" disabled={!interactive} onClick={() => setCodes({ from: to, to: from })}>
            <ArrowLeftRight />
          </Button>
        </Field>
        <Field index={2} className="flex min-w-0 flex-col items-end gap-2">
          <HeroNumber>
            {rate.error ? (
              <span className="text-[15px] font-normal text-muted-foreground">Rate unavailable</span>
            ) : result === null ? (
              "—"
            ) : (
              <AnimatedNumber value={result} format={fmt(to)} />
            )}
          </HeroNumber>
          {codeSelect(to, (v) => setCodes({ from, to: v }), "To currency")}
        </Field>
      </div>
      <Field index={3}>
        <Meta>
          {rate.loading
            ? "Fetching live rate…"
            : rate.value !== null
              ? `Live · 1 ${from} = ${fmt(to)(rate.value)}`
              : "Live rate unavailable, try again shortly"}
        </Meta>
      </Field>
      <Meta className="sr-only">
        {data.value} {from} is {result} {to}
      </Meta>
    </div>
  );
}
