"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
    >
      {label}
    </button>
  );
}
