"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { updateOwnSettings } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import type { Profile } from "@/lib/types";

const TIMEZONES = [
  "Europe/Chisinau",
  "Europe/Bucharest",
  "Europe/Kyiv",
  "Europe/Moscow",
  "UTC",
];

export function SettingsForm({ dict, profile }: { dict: Dictionary; profile: Profile }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const res = await updateOwnSettings({
      display_name: String(fd.get("display_name") ?? ""),
      preferred_language: String(fd.get("preferred_language") ?? "ru"),
      timezone: String(fd.get("timezone") ?? "UTC"),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(dict.common.error);
    }
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>{dict.common.name}</Label>
            <Input name="display_name" defaultValue={profile.display_name} required />
          </div>
          <div>
            <Label>Language</Label>
            <Select name="preferred_language" defaultValue={profile.preferred_language}>
              <option value="ru">Русский</option>
              <option value="ro">Română</option>
              <option value="en">English</option>
            </Select>
          </div>
          <div>
            <Label>Timezone</Label>
            <Select name="timezone" defaultValue={profile.timezone}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {dict.common.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
