"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { completePasswordChange } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

export function SetPasswordForm({ dict }: { dict: Dictionary }) {
  const d = dict.setPassword;
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (pw.length < 10) {
      toast.error(d.errShort);
      return;
    }
    if (pw !== pw2) {
      toast.error(d.errMismatch);
      return;
    }
    setBusy(true);
    const res = await completePasswordChange({ password: pw });
    if (!res.ok) {
      setBusy(false);
      toast.error(res.error === "forbidden" ? dict.common.error : (res.error ?? dict.common.error));
      return;
    }
    // Refresh the session so the cleared flag reaches the JWT right away.
    const sb = createClient();
    await sb.auth.refreshSession();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{d.title}</CardTitle>
          <p className="text-sm text-muted">{d.text}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>{d.newPassword}</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </div>
          <div>
            <Label>{d.confirmPassword}</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
          </div>
          <Button className="w-full" disabled={busy} onClick={() => void submit()}>
            {d.btn}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
