"use client";

import Link from "next/link";
import { getDictionary } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  const t = getDictionary(
    typeof document === "undefined" ? "ru" : document.documentElement.lang,
  ).errors;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>{t.notFoundTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <p className="text-sm text-muted">{t.notFoundText}</p>
          <Link href="/">
            <Button>{t.home}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
