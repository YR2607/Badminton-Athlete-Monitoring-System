export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-lg bg-foreground/10" />
        <div className="h-4 w-72 max-w-full rounded-lg bg-foreground/10" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-foreground/10" />
        ))}
      </div>
      <div className="h-56 rounded-2xl bg-foreground/10" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-2xl bg-foreground/10" />
        ))}
      </div>
    </div>
  );
}
