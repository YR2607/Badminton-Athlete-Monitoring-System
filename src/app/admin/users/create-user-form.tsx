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

export function CreateUserForm({ dict }: { dict: Dictionary }) {
  const d = dict.admin;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<AppRole>("athlete");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const res = await adminCreateUser({
      email: String(fd.get("email")),
      password: String(fd.get("password")),
      display_name: String(fd.get("display_name")),
      role,
      preferred_language: String(fd.get("preferred_language") || "ru"),
      timezone: String(fd.get("timezone") || "Europe/Chisinau"),
      athlete_code: String(fd.get("athlete_code") || "") || undefined,
      birth_year: fd.get("birth_year") ? Number(fd.get("birth_year")) : undefined,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(d.userCreated);
      (e.target as HTMLFormElement).reset();
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
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{d.email}</Label>
            <Input name="email" type="email" required />
          </div>
          <div>
            <Label>{d.tempPassword}</Label>
            <Input name="password" type="text" required minLength={10} autoComplete="off" />
          </div>
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
          {role === "athlete" && (
            <>
              <div>
                <Label>{d.athleteCode}</Label>
                <Input name="athlete_code" placeholder="ATH-001" />
              </div>
              <div>
                <Label>{d.birthYear}</Label>
                <Input name="birth_year" type="number" min={1990} max={new Date().getFullYear()} />
              </div>
            </>
          )}
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
