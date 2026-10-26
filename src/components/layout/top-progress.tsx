"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const FINISH_TIMEOUT = 12_000;

/** True when `url` navigates to a different route (ignores hash-only changes). */
function isRouteChange(url: URL): boolean {
  const cur = window.location;
  return url.pathname !== cur.pathname || url.search !== cur.search;
}

/**
 * Thin top progress bar for instant navigation feedback.
 * Starts on internal <a> clicks and history.pushState (router.push);
 * completes when the URL changes or after a safety timeout.
 * replaceState/pushState are only trusted when they pass a *different*
 * URL — Next.js also calls them for internal bookkeeping.
 */
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const kill = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);

  const finish = () => {
    if (!running.current) return;
    running.current = false;
    if (tick.current) clearInterval(tick.current);
    if (kill.current) clearTimeout(kill.current);
    setProgress(100);
    hide.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 220);
  };

  const begin = () => {
    running.current = true;
    if (tick.current) clearInterval(tick.current);
    if (kill.current) clearTimeout(kill.current);
    if (hide.current) clearTimeout(hide.current);
    setVisible(true);
    setProgress(12);
    tick.current = setInterval(() => {
      setProgress((p) => (p >= 88 ? p : p + Math.max(1.5, (88 - p) * 0.12)));
    }, 150);
    kill.current = setTimeout(finish, FINISH_TIMEOUT);
  };

  // URL changed → navigation finished.
  useEffect(() => {
    finish();
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (isRouteChange(url)) begin();
      } catch {
        // unparsable href — ignore
      }
    };
    const urlArgDiffers = (u: unknown) => {
      if (!u) return false;
      try {
        const url = new URL(String(u), window.location.href);
        return url.origin === window.location.origin && isRouteChange(url);
      } catch {
        return false;
      }
    };
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      if (urlArgDiffers(args[2])) begin();
      return origPush(...args);
    };
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      if (urlArgDiffers(args[2])) begin();
      return origReplace(...args);
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", begin);
    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", begin);
      if (tick.current) clearInterval(tick.current);
      if (kill.current) clearTimeout(kill.current);
      if (hide.current) clearTimeout(hide.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]">
      <div
        className="h-full bg-accent transition-[width,opacity] duration-150 ease-out"
        style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }}
      />
    </div>
  );
}

export function TopProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
