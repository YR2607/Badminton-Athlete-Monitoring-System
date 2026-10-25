"use client";

import { useActionState, useState } from "react";
import type { Dictionary } from "@/i18n";
import { signIn, requestPasswordReset } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

export function LoginForm({ dict }: { dict: Dictionary }) {
  const d = dict.auth;
  const [state, action, pending] = useActionState(signIn, null);
  const [resetState, resetAction, resetPending] = useActionState(requestPasswordReset, null);
  const [showReset, setShowReset] = useState(false);

  return (
    <Card className="overflow-hidden">
      <div aria-hidden className="h-1.5 bg-accent" />
      <CardContent className="pt-6">
        {showReset ? (
          <form action={resetAction} className="space-y-4">
            <div>
              <Label htmlFor="reset_email">{d.email}</Label>
              <Input id="reset_email" name="email" type="email" required autoComplete="email" />
            </div>
            {resetState?.ok && <p className="text-sm text-ok">{d.resetSent}</p>}
            <Button type="submit" className="w-full" disabled={resetPending}>
              {resetPending ? d.signingIn : d.forgotPassword}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted"
              onClick={() => setShowReset(false)}
            >
              {dict.common.back}
            </button>
          </form>
        ) : (
          <form action={action} className="space-y-4">
            <div>
              <Label htmlFor="login">{d.loginId}</Label>
              <Input
                id="login"
                name="login"
                type="text"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="email"
                placeholder="ATH-001"
              />
              <p className="mt-1 text-xs text-muted">{d.loginHint}</p>
            </div>
            <div>
              <Label htmlFor="password">{d.password}</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            {state?.error && (
              <p className="text-sm text-danger">
                {state.error === "banned" ? d.banned : d.invalidCredentials}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? d.signingIn : d.signInButton}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted"
              onClick={() => setShowReset(true)}
            >
              {d.forgotPassword}
            </button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
