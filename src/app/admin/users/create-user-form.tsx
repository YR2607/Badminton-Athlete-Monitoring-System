"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { adminCreateUser } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import type { AppRole } from "@/lib/types";

function genPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const rand = crypto.getRandomValues(new Uint32Array(8));
  const part = (off: number) =>
    Array.from({ length: 4 }, (_, i) => chars[rand[off + i] % chars.length]).join("");
  return `Rally-${part(0)}-${part(4)}`;
}

export function CredentialsCard({
  dict,
  login,
  password,
}: {
  dict: Dictionary;
  login: string;
  password: string;
}) {
  const [copied, setCopied] = useState(false);
  const d = dict.admin;

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${d.login}: ${login}\n${dict.auth.password}: ${password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(dict.common.error);
    }
  }

  return (
    <div className="rounded-xl border border-ok/40 bg-ok/10 p-3">
      <p className="text-sm font-semibold">{d.credentialsTitle}</p>
      <p className="mt-0.5 text-xs text-muted">{d.credentialsHint}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm">
        <span>
          {d.login}: <b>{login}</b>
        </span>
        <span>
          {dict.auth.password}: <b>{password}</b>
        </span>
      </div>
      <Button size="sm" variant="secondary" className="mt-2" onClick={copy}>
        {copied ? d.copied : d.copy}
      </Button>
    </div>
  );
}

export function CreateUserForm({ dict }: { dict: Dictionary }) {
  const d = dict.admin;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<AppRole>("athlete");
  const [password, setPassword] = useState(genPassword);
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const code = String(fd.get("athlete_code") || "").trim();
    const res = await adminCreateUser({
      email: String(fd.get("email") || "").trim() || undefined,
      password,
      display_name: String(fd.get("display_name")),
      role,
      preferred_language: String(fd.get("preferred_language") || "ru"),
      timezone: String(fd.get("timezone") || "Europe/Chisinau"),
      athlete_code: code || undefined,
      birth_year: fd.get("birth_year") ? Number(fd.get("birth_year")) : undefined,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(d.userCreated);
      const email = String(fd.get("email") || "").trim();
      setIssued({ login: role === "athlete" ? code : email, password });
      setPassword(genPassword());
      (e.target as HTMLFormElement).reset();
      setRole("athlete");
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{d.createUser}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {issued && <CredentialsCard dict={dict} login={issued.login} password={issued.password} />}
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{dict.common.name}</Label>
            <Input name="display_name" required />
          </div>
          <div>
            <Label>{d.role}</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
              <option value="athlete">{dict.common.athlete}</option>
              <option value="coach">{dict.common.coach}</option>
              <option value="admin">{dict.common.admin}</option>
            </Select>
          </div>
          {role === "athlete" ? (
            <>
              <div>
                <Label>{d.athleteCode}</Label>
                <Input name="athlete_code" placeholder="ATH-001" required autoCapitalize="characters" />
                <p className="mt-1 text-xs text-muted">{d.athleteLoginHint}</p>
              </div>
              <div>
                <Label>{d.birthYear}</Label>
                <Input name="birth_year" type="number" min={1990} max={new Date().getFullYear()} inputMode="numeric" />
              </div>
            </>
          ) : null}
          <div className={role === "athlete" ? "" : "sm:col-span-2"}>
            <Label>{role === "athlete" ? d.emailOptional : d.email}</Label>
            <Input name="email" type="email" required={role !== "athlete"} autoComplete="off" />
          </div>
          <div className="sm:col-span-2">
            <Label>{d.tempPassword}</Label>
            <div className="flex gap-2">
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                autoComplete="off"
                className="font-mono"
              />
              <Button type="button" variant="secondary" onClick={() => setPassword(genPassword())}>
                {d.generate}
              </Button>
            </div>
          </div>
          <div>
            <Label>Timezone</Label>
            <Input name="timezone" defaultValue="Europe/Chisinau" />
          </div>
          <div>
            <Label>Language</Label>
            <Select name="preferred_language" defaultValue="ru">
              <option value="ru">Русский</option>
              <option value="ro">Română</option>
              <option value="en">English</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {d.createUser}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
