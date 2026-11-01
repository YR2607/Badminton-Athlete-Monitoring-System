"use client";

import { useEffect } from "react";
import { getDictionary } from "@/i18n";

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const t = getDictionary(
    typeof document === "undefined" ? "ru" : document.documentElement.lang,
  ).errors;

  return (
    <html lang="ru">
      <body>
        <h2>{t.title}</h2>
        <p>{t.text}</p>
        <button onClick={() => retry()}>{t.retry}</button>
      </body>
    </html>
  );
}
