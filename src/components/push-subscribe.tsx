"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/i18n";
import { savePushSubscription } from "@/app/actions/push";
import { Bell, X } from "lucide-react";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Push opt-in (flag 'push'). Registers /sw.js, offers a one-tap subscribe
 * banner until the user grants or dismisses; when a subscription already
 * exists it is silently re-saved (endpoints can rotate).
 */
export function PushSubscribe({ dict }: { dict: Dictionary }) {
  const [state, setState] = useState<"hidden" | "ask" | "on" | "denied">("hidden");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    if (localStorage.getItem("push-dismissed")) return;

    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (sub) {
          setState("on");
          const j = sub.toJSON();
          void savePushSubscription({
            endpoint: j.endpoint!,
            p256dh: j.keys!.p256dh!,
            auth: j.keys!.auth!,
            user_agent: navigator.userAgent.slice(0, 300),
          });
        } else if (Notification.permission === "denied") {
          setState("denied");
        } else {
          setState("ask");
        }
      } catch {
        /* SW registration unavailable — stay hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("denied");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
        ) as BufferSource,
      });
      const j = sub.toJSON();
      const res = await savePushSubscription({
        endpoint: j.endpoint!,
        p256dh: j.keys!.p256dh!,
        auth: j.keys!.auth!,
        user_agent: navigator.userAgent.slice(0, 300),
      });
      setState(res.ok ? "on" : "hidden");
    } catch {
      setState("hidden");
    }
  }

  if (state !== "ask") return null;
  const d = dict.push;
  return (
    <div className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md rounded-xl border border-border bg-surface p-3 shadow-lg md:bottom-6">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 shrink-0 text-accent" size={20} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{d.bannerTitle}</p>
          <p className="text-xs text-muted">{d.bannerBody}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={subscribe}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
            >
              {d.enable}
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem("push-dismissed", "1");
                setState("hidden");
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-foreground/5"
            >
              {d.later}
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label={d.later}
          className="shrink-0 text-muted"
          onClick={() => {
            localStorage.setItem("push-dismissed", "1");
            setState("hidden");
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
