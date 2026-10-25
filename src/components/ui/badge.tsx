import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

const tones = {
  neutral: "border-foreground/20 bg-foreground/8 text-foreground/80",
  ok: "border-ok/40 bg-ok/12 text-ok",
  warn: "border-warn/40 bg-warn/12 text-warn",
  danger: "border-danger/40 bg-danger/12 text-danger",
  accent: "border-accent/40 bg-accent/12 text-accent",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
