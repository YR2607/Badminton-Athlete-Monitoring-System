"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { setAthleteStatus, recordConsent } from "@/app/actions/admin";
import { adminDeleteUser, adminResetUserPassword } from "@/app/actions/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { CredentialsCard } from "./create-user-form";
import type { Athlete, Group, Profile } from "@/lib/types";

type Row = Profile & { athlete: Athlete | null; email: string | null; groupId: string | null };

export function UserTable({
  dict,
  profiles,
  groups,
}: {
  dict: Dictionary;
  profiles: Row[];
  groups: Pick<Group, "id" | "name">[];
}) {
  const router = useRouter();
  const d = dict.admin;
  const [issued, setIssued] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [groupId, setGroupId] = useState("");

  const visible = profiles.filter((p) => {
    if (role && p.role !== role) return false;
    if (status && (p.athlete?.status ?? "none") !== status) return false;
    if (groupId && p.groupId !== groupId) return false;
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${p.display_name} ${p.email ?? ""} ${p.athlete?.athlete_code ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

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
    const res = await recordConsent(a.id, "parental_data_processing", "granted");
    if (res.ok) {
      toast.success(d.consentGranted);
      router.refresh();
    } else {
      toast.error(dict.common.error);
    }
  }

  async function resetPassword(p: Row) {
    const res = await adminResetUserPassword(p.id);
    if (res.ok && res.password) {
      setIssued((s) => ({ ...s, [p.id]: res.password! }));
      toast.success(dict.common.saved);
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  async function removeUser(p: Row) {
    if (!window.confirm(d.deleteUserConfirm)) return;
    const res = await adminDeleteUser(p.id);
    if (res.ok) {
      toast.success(d.userDeleted);
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  const roleBadge = (p: Row) => (
    <Badge tone={p.role === "admin" ? "danger" : p.role === "coach" ? "accent" : "neutral"}>
      {dict.common[p.role as "athlete" | "coach" | "admin"]}
    </Badge>
  );

  const loginLabel = (p: Row) => p.athlete?.athlete_code ?? p.email ?? "—";

  const nameCell = (p: Row) =>
    p.athlete ? (
      <Link href={`/coach/athletes/${p.athlete.id}`} className="font-medium text-accent hover:underline">
        {p.display_name}
      </Link>
    ) : (
      <span className="font-medium">{p.display_name}</span>
    );

  const actions = (p: Row) => (
    <span className="flex flex-wrap gap-1">
      <Button size="sm" variant="secondary" onClick={() => resetPassword(p)}>
        {d.newPasswordBtn}
      </Button>
      {p.athlete && (
        <>
          <Button size="sm" variant="ghost" onClick={() => toggle(p.athlete!)}>
            {p.athlete.status === "active" ? d.deactivate : d.activate}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => consent(p.athlete!)}>
            {d.consentStatus}
          </Button>
        </>
      )}
      {p.role !== "admin" && (
        <Button size="sm" variant="ghost" onClick={() => removeUser(p)}>
          {d.deleteUser}
        </Button>
      )}
    </span>
  );

  const issuedCard = (p: Row) =>
    issued[p.id] ? (
      <div className="mt-2">
        <CredentialsCard dict={dict} login={loginLabel(p)} password={issued[p.id]} />
      </div>
    ) : null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="w-40 flex-1 sm:flex-none"
          placeholder={dict.common.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="w-32" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{d.allRoles}</option>
          <option value="athlete">{dict.common.athlete}</option>
          <option value="coach">{dict.common.coach}</option>
          <option value="admin">{dict.common.admin}</option>
        </Select>
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{d.allStatuses}</option>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
          <option value="archived">archived</option>
        </Select>
        <Select className="w-36" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">{dict.analytics.allGroups}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {visible.map((p) => (
          <Card key={p.id}>
            <CardContent className="space-y-2 pt-4">
              <div className="flex items-center justify-between gap-2">
                {nameCell(p)}
                {roleBadge(p)}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span>
                  {d.login}: <span className="font-mono">{loginLabel(p)}</span>
                </span>
                {p.athlete && (
                  <Badge tone={p.athlete.status === "active" ? "ok" : "neutral"}>
                    {p.athlete.status}
                  </Badge>
                )}
              </div>
              {actions(p)}
              {issuedCard(p)}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">{dict.common.name}</th>
              <th className="px-3 py-2 font-medium">{d.role}</th>
              <th className="px-3 py-2 font-medium">{d.login}</th>
              <th className="px-3 py-2 font-medium">{dict.common.status}</th>
              <th className="px-3 py-2 font-medium">{dict.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id} className="border-b border-border align-top last:border-0">
                <td className="px-3 py-2">{nameCell(p)}</td>
                <td className="px-3 py-2">{roleBadge(p)}</td>
                <td className="px-3 py-2 font-mono text-muted">{loginLabel(p)}</td>
                <td className="px-3 py-2">
                  {p.athlete ? (
                    <Badge tone={p.athlete.status === "active" ? "ok" : "neutral"}>
                      {p.athlete.status}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {actions(p)}
                  {issuedCard(p)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
