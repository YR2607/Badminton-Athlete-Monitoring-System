import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { markAllRead } from "@/app/actions/notifications";

export async function NotificationsBell() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, created_at")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(10);
  const unread = data ?? [];

  if (unread.length === 0) {
    return (
      <span className="p-2 text-muted/50" aria-hidden>
        <Bell size={18} />
      </span>
    );
  }

  return (
    <details className="relative">
      <summary className="relative list-none cursor-pointer rounded-lg p-2 text-muted hover:bg-foreground/5">
        <Bell size={18} />
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
          {unread.length}
        </span>
      </summary>
      <div className="absolute right-0 mt-2 w-80 rounded-xl border border-border bg-surface p-3 shadow-lg">
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {unread.map((n) => (
            <li key={n.id} className="rounded-lg bg-foreground/5 p-2 text-sm">
              <p className="font-medium">{n.title}</p>
              {n.body ? <p className="text-xs text-muted">{n.body}</p> : null}
            </li>
          ))}
        </ul>
        <form action={markAllRead} className="mt-2">
          <button className="w-full rounded-lg bg-foreground/5 py-1.5 text-xs hover:bg-foreground/10">
            ✓
          </button>
        </form>
      </div>
    </details>
  );
}
