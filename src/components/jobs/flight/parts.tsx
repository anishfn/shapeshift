"use client";

import { Ban, Check, type LucideIcon, Plus, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Flag } from "@/lib/jobs/flight/checks";
import { cn } from "@/lib/utils";

const FLAG_STYLE = {
  ok: { Icon: Check, text: "text-ink-2", icon: "text-positive", spoken: "Good:" },
  warn: { Icon: TriangleAlert, text: "text-caution-text", icon: "text-caution-text", spoken: "Heads up:" },
  block: { Icon: Ban, text: "text-destructive", icon: "text-destructive", spoken: "Ruled out:" },
} as const;

/** One preflight finding. Colour is never the only signal: each level has its own icon and a spoken prefix. */
export function FlagLine({ flag }: { flag: Flag }) {
  const style = FLAG_STYLE[flag.level];
  return (
    <span className={cn("inline-flex items-start gap-1.5 text-[13px] leading-[18px]", style.text)}>
      <style.Icon className={cn("mt-0.5 size-3.5 shrink-0", style.icon)} aria-hidden />
      <span>
        <span className="sr-only">{style.spoken} </span>
        {flag.text}
      </span>
    </span>
  );
}

/** Built from spans so it can sit inside a button. */
export function FlagList({ flags, className }: { flags: Flag[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-x-4 gap-y-1", className)}>
      {flags.map((flag) => (
        <FlagLine key={flag.kind + flag.text} flag={flag} />
      ))}
    </span>
  );
}

/** A dashed chip that changes the request when clicked. Same shape as the card placeholders. */
export function Suggestion({ children, onClick, icon: Icon = Plus }: { children: ReactNode; onClick: () => void; icon?: LucideIcon }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="border-line-strong text-muted-foreground hover:border-muted-foreground hover:text-ink-2 focus-visible:outline-ring inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-[13px] font-medium whitespace-nowrap transition-[border-color,color,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.96]"
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}

/** Where you are in a sequence: past steps are checked, the current one is bold. */
export function StepRail({ steps, current, label }: { steps: { id: string; label: string }[]; current: string; label: string }) {
  const index = steps.findIndex((s) => s.id === current);
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 font-medium">
      {steps.map((step, i) => (
        <li key={step.id} className="flex items-center gap-2" aria-current={i === index ? "step" : undefined}>
          {i > 0 && (
            <span aria-hidden className="text-line-strong">
              ·
            </span>
          )}
          <span
            className={cn(i < index && "text-ink-2", i === index && "text-foreground font-[550]", i > index && "text-muted-foreground")}
          >
            {i < index && <Check className="text-positive me-0.5 inline size-3 align-[-1px]" aria-hidden />}
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
