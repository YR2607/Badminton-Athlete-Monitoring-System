import { cn } from "@/lib/utils";

const AVATAR_TONES = [
  "bg-accent/10 text-accent",
  "bg-ok/10 text-ok",
  "bg-warn/15 text-warn",
  "bg-chart-5/10 text-chart-5",
  "bg-chart-6/10 text-chart-6",
] as const;

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Initials-based athlete avatar — deterministic tone, readable without an image. */
export function AthleteAvatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const sizes = { sm: "h-7 w-7 text-[10px]", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm" };
  const tone = AVATAR_TONES[hashCode(name) % AVATAR_TONES.length];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold",
        sizes[size],
        !src && tone,
        className,
      )}
      aria-hidden="true"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials || "?"
      )}
    </span>
  );
}
