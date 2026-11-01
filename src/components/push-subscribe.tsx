"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/i18n";
import { savePushSubscription } from "@/app/actions/push";
import { toast } from "sonner";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Register /sw.js, ask permission, subscribe and save. Call from a user gesture. */
export async function subscribeToPush(): Promise<{ ok?: boolean; error?: string }> {
  await navigator.serviceWorker.register("/sw.js");
  const reg = await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { error: "denied" };
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    ) as BufferSource,
  });
  const j = sub.toJSON();
  return savePushSubscription({
    endpoint: j.endpoint!,
    p256dh: j.keys!.p256dh!,
    auth: j.keys!.auth!,
    user_agent: navigator.userAgent.slice(0, 300),
  });
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
      const res = await subscribeToPush();
      setState(res.ok ? "on" : res.error === "denied" ? "denied" : "hidden");
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

/**
 * Compact opt-in card for the athlete home. Unlike PushSubscribe it ignores
 * the "push-dismissed" flag — it simply does not render once a subscription
 * exists (or when permission is denied / push unsupported).
 */
export function PushReminderCard({ dict }: { dict: Dictionary }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = dict.athleteHome;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    if (Notification.permission === "denied") return;

    let cancelled = false;
    (async () => {
      try {
        const reg =
          (await navigator.serviceWorker.getRegistration("/sw.js")) ??
          (await navigator.serviceWorker.register("/sw.js"));
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled && !sub) setVisible(true);
      } catch {
        /* SW unavailable — stay hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const res = await subscribeToPush();
      if (res.ok) {
        setVisible(false);
        toast.success(dict.common.saved);
      } else if (res.error === "consent_required") {
        setVisible(false);
        toast.error(d.pushConsentRequired);
      } else if (res.error !== "denied") {
        setVisible(false);
      }
    } catch {
      setVisible(false);
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;
  return (
    <Card className="border-accent/30 bg-accent/5">
      <CardContent className="flex items-center justify-between gap-3 pt-4">
        <p className="text-sm">🔔 {d.pushCardText}</p>
        <Button size="sm" onClick={enable} disabled={busy} className="shrink-0">
          {d.pushCardBtn}
        </Button>
      </CardContent>
    </Card>
  );
}
