"use client";

import { useEffect } from "react";
import Link from "next/link";
import { getDictionary } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function clientDict() {
  return getDictionary(
    typeof document === "undefined" ? "ru" : document.documentElement.lang,
  );
}

export default function Error({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const t = clientDict().errors;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <p className="text-sm text-muted">{t.text}</p>
          <div className="flex gap-2">
            <Button onClick={() => retry()}>{t.retry}</Button>
            <Link href="/">
              <Button variant="outline">{t.home}</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
