"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { setAthleteStatus, recordConsent } from "@/app/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Athlete, Profile } from "@/lib/types";

type Row = Profile & { athlete: Athlete | null };

export function UserTable({ dict, profiles }: { dict: Dictionary; profiles: Row[] }) {
  const router = useRouter();
  const d = dict.admin;

  async function toggle(a: Athlete) {
    const next = a.status === "active" ? "inactive" : "active";
    const res = await setAthleteStatus(a.id, next);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(dict.common.error);
    }
  }

  async function consent(a: Athlete) {
    const type = window.prompt(`${d.consentType} (parental_data_processing)`, "parental_data_processing");
    if (!type) return;
    const res = await recordConsent(a.id, type, "granted");
    if (res.ok) {
      toast.success(dict.common.saved);
    } else {
      toast.error(dict.common.error);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">{dict.common.name}</th>
            <th className="px-3 py-2 font-medium">{d.role}</th>
            <th className="px-3 py-2 font-medium">{d.athleteCode}</th>
            <th className="px-3 py-2 font-medium">TZ</th>
            <th className="px-3 py-2 font-medium">{dict.common.status}</th>
            <th className="px-3 py-2 font-medium">{dict.common.actions}</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-medium">{p.display_name}</td>
              <td className="px-3 py-2">
                <Badge tone={p.role === "admin" ? "danger" : p.role === "coach" ? "accent" : "neutral"}>
                  {dict.common[p.role as "athlete" | "coach" | "admin"]}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted">{p.athlete?.athlete_code ?? "—"}</td>
              <td className="px-3 py-2 text-muted">{p.timezone}</td>
              <td className="px-3 py-2">
                {p.athlete ? (
                  <Badge tone={p.athlete.status === "active" ? "ok" : "neutral"}>{p.athlete.status}</Badge>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
                {p.athlete && (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggle(p.athlete!)}>
                      {p.athlete.status === "active" ? d.deactivate : d.activate}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => consent(p.athlete!)}>
                      {d.consentStatus}
                    </Button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
