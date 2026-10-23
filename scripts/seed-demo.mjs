#!/usr/bin/env node
// Seed 20 demo athletes (DEMO-101..120) into one "Демо-группа" with varied
// data so the coach dashboard and analytics page show every state:
// stable, inconsistent, declining, in-pain, sparse, sick, load-spike.
//
//   node scripts/seed-demo.mjs            # seeds into the project from .env.local
//   node scripts/seed-demo.mjs --cleanup  # deletes DEMO-1xx athletes (and their data)
//
// Login for every demo athlete: code `DEMO-1xx` / password `Rally-demo-2026`.
// Idempotent: reruns replace the last 14 days of demo data only.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const TZ = "Europe/Chisinau";
const DAYS = 14;
const PASSWORD = "Rally-demo-2026";
const GROUP_NAME = "Демо-группа";
const TRAIN_DAYS = [1, 3, 5]; // Mon/Wed/Fri

const NAMES = [
  "Анастасия Русу", "Ион Попеску", "Мария Чобану", "Влад Мунтяну", "Елена Гросу",
  "Думитру Лупу", "Александра Ботнарь", "Сергей Ротару", "Кристина Урсу", "Михай Гуцу",
  "Дарья Сырбу", "Андрей Цуркану", "Виктория Морозова", "Никита Балмаш", "София Доника",
  "Артём Плэчындэ", "Камила Ротару", "Глеб Мошану", "Ирина Санду", "Олег Постолаки",
];

// archetype per index: 0-5 stable, 6-10 inconsistent, 11-14 declining,
// 15-16 pain-today, 17-18 sparse, 19 sick
const KIND = i =>
  i < 6 ? "stable" : i < 11 ? "inconsistent" : i < 15 ? "declining" : i < 17 ? "pain" : i < 19 ? "sparse" : "sick";

const todayLocal = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const addDays = (d, n) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const weekdayOf = d => new Date(`${d}T12:00:00Z`).getUTCDay();
const jitter = (v, lo, hi) => Math.max(lo, Math.min(hi, v + (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0)));

function checkinScores(kind, daysAgo) {
  const base = { sleep: 8, recovery: 8, fatigue: 4, soreness: 3, stress: 4, mood: 8 };
  if (kind === "inconsistent") {
    base.sleep = 6; base.recovery = 6; base.fatigue = 6; base.stress = 6; base.mood = 6;
  }
  if (kind === "declining" && daysAgo <= 4) {
    base.sleep = 4; base.recovery = 4; base.fatigue = 8; base.soreness = 8; base.stress = 8; base.mood = 4;
  }
  if (kind === "sick" && daysAgo <= 1) {
    base.sleep = 6; base.recovery = 4; base.fatigue = 8; base.soreness = 6; base.stress = 6; base.mood = 4;
  }
  return {
    sleep_score: jitter(base.sleep, 1, 10),
    recovery_score: jitter(base.recovery, 1, 10),
    fatigue_score: jitter(base.fatigue, 1, 10),
    muscle_soreness_score: jitter(base.soreness, 1, 10),
    stress_score: jitter(base.stress, 1, 10),
    mood_score: jitter(base.mood, 1, 10),
  };
}

function shouldFill(kind, daysAgo) {
  if (kind === "sparse") return [13, 7, 1].includes(daysAgo);
  if (kind === "inconsistent") return ((daysAgo * 7 + 3) % 5) < 3; // ~60%
  return true;
}

async function main() {
  const cleanup = process.argv.includes("--cleanup");
  const today = todayLocal();
  console.log(`Today (${TZ}): ${today}`);

  // --- demo athletes: create or reuse ---
  const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 500 });
  const userByEmail = new Map(users.map(u => [u.email, u]));
  const { data: athletesRows } = await sb.from("athletes").select("id, profile_id, athlete_code");
  const athleteByCode = new Map((athletesRows ?? []).map(a => [a.athlete_code, a]));

  if (cleanup) {
    const profIds = (athletesRows ?? []).filter(a => /^DEMO-1\d\d$/.test(a.athlete_code)).map(a => a.profile_id);
    if (profIds.length) {
      const { data: profs } = await sb.from("profiles").select("user_id").in("id", profIds);
      for (const p of profs ?? []) await sb.auth.admin.deleteUser(p.user_id); // cascades everything
    }
    console.log(`Removed ${profIds.length} demo athletes.`);
    return;
  }

  const athletes = [];
  for (let i = 0; i < 20; i++) {
    const code = `DEMO-${101 + i}`;
    const email = `${code.toLowerCase()}@rally.local`;
    let row = athleteByCode.get(code);
    if (!row) {
      let uid = userByEmail.get(email)?.id;
      if (!uid) {
        const { data, error } = await sb.auth.admin.createUser({
          email, password: PASSWORD, email_confirm: true,
          user_metadata: {
            display_name: NAMES[i], role: "athlete", preferred_language: "ru",
            timezone: TZ, athlete_code: code, birth_year: 2008 + (i % 5),
          },
        });
        if (error) { console.log(`createUser ${code}: ${error.message}`); continue; }
        uid = data.user.id;
      }
      const { data: prof } = await sb.from("profiles").select("id").eq("user_id", uid).single();
      const { data: ath } = prof
        ? await sb.from("athletes").select("id, profile_id, athlete_code").eq("profile_id", prof.id).single()
        : { data: null };
      row = ath;
    }
    if (!row) { console.log(`no athlete row for ${code} — skipped`); continue; }
    athletes.push({ ...row, kind: KIND(i), name: NAMES[i] });
  }
  console.log(`Athletes ready: ${athletes.length}`);

  // --- group + memberships + schedule + coach assignment ---
  let { data: group } = await sb.from("groups").select("id").eq("name", GROUP_NAME).maybeSingle();
  if (!group) {
    const { data: g, error } = await sb.from("groups").insert({ name: GROUP_NAME, description: "Демо-данные для просмотра дашбордов" }).select("id").single();
    if (error) throw error;
    group = g;
  }
  for (const a of athletes) {
    const { data: m } = await sb.from("group_memberships").select("id")
      .eq("athlete_id", a.id).eq("group_id", group.id).is("left_at", null).maybeSingle();
    if (!m) {
      const { error } = await sb.from("group_memberships").insert({ athlete_id: a.id, group_id: group.id });
      if (error) console.log(`membership ${a.athlete_code}: ${error.message}`);
    }
  }
  for (const wd of TRAIN_DAYS) {
    const { data: exists } = await sb.from("training_schedules").select("id")
      .eq("group_id", group.id).eq("weekday", wd).eq("start_time", "17:00").maybeSingle();
    if (!exists) await sb.from("training_schedules").insert({ group_id: group.id, weekday: wd, start_time: "17:00", active: true });
  }
  // --- wipe previous demo data in the window (idempotent reruns) ---
  const ids = athletes.map(a => a.id);
  const from = addDays(today, -(DAYS - 1));
  await sb.from("morning_checkins").delete().in("athlete_id", ids).gte("checkin_date", from);
  await sb.from("training_sessions").delete().in("athlete_id", ids).gte("started_at", `${from}T00:00:00Z`);
  await sb.from("alerts").delete().in("athlete_id", ids).gte("triggered_at", `${from}T00:00:00Z`);

  // --- checkins ---
  const checkins = [];
  for (const a of athletes) {
    for (let d = DAYS - 1; d >= 0; d--) {
      if (!shouldFill(a.kind, d)) continue;
      const date = addDays(today, -d);
      const row = {
        athlete_id: a.id, checkin_date: date, submitted_at: `${date}T08:00:00Z`,
        client_uuid: crypto.randomUUID(), pain_status: "none", ...checkinScores(a.kind, d),
      };
      if (a.kind === "pain" && d === 0) {
        Object.assign(row, { pain_status: "joint_tendon", pain_location: "knee", pain_side: "right", pain_severity: 6 });
      }
      if (a.kind === "sick" && d === 0) Object.assign(row, { symptoms: "кашель, слабость, боль в горле" });
      checkins.push(row);
    }
  }
  const { error: ckErr } = await sb.from("morning_checkins").insert(checkins);
  if (ckErr) throw ckErr;
  console.log(`Checkins: ${checkins.length}`);

  // --- sessions + post checkins ---
  const sessions = [];
  for (const a of athletes) {
    if (a.kind === "sparse") continue;
    for (let d = DAYS - 1; d >= 0; d--) {
      const date = addDays(today, -d);
      if (!TRAIN_DAYS.includes(weekdayOf(date))) continue;
      // Sessions carry no duration/RPE — params are no longer collected.
      sessions.push({
        athlete_id: a.id, group_id: group.id,
        started_at: `${date}T14:00:00Z`,
        client_uuid: crypto.randomUUID(),
      });
    }
  }
  const { data: insertedSessions, error: sErr } = await sb.from("training_sessions").insert(sessions).select("id, athlete_id, started_at");
  if (sErr) throw sErr;
  console.log(`Sessions: ${insertedSessions.length}`);

  const posts = insertedSessions
    .filter((_, i) => i % 2 === 0)
    .map(s => ({
      training_session_id: s.id, athlete_id: s.athlete_id,
      submitted_at: s.started_at, client_uuid: crypto.randomUUID(),
      overall_feeling: 6 + (s.id.charCodeAt(0) % 3), leg_fatigue: 4 + (s.id.charCodeAt(1) % 3),
      arm_shoulder_fatigue: 3 + (s.id.charCodeAt(2) % 3), pain_status: "none",
    }));
  const { error: pErr } = await sb.from("post_training_checkins").insert(posts);
  if (pErr) throw pErr;
  console.log(`Post checkins: ${posts.length}`);

  // --- alerts for visual variety ---
  const by = k => athletes.filter(a => a.kind === k);
  const alerts = [
    { a: by("pain")[0], rule_code: "joint_pain", severity: "review_load", d: 0,
      recommendation: "Снизить нагрузку на ноги, наблюдать колено. При усилении — к врачу." },
    { a: by("pain")[1], rule_code: "joint_pain", severity: "review_load", d: 0,
      recommendation: "Снизить нагрузку на ноги, наблюдать колено. При усилении — к врачу." },
    { a: by("sick")[0], rule_code: "illness_symptoms", severity: "priority", d: 0,
      recommendation: "Симптомы заболевания — пропустить тренировку, связаться с родителями." },
    { a: by("declining")[1], rule_code: "sustained_decline", severity: "review_load", d: 0,
      recommendation: "Готовность ниже нормы 4 дня подряд — снизить нагрузку, поговорить со спортсменом." },
    { a: by("declining")[0], rule_code: "readiness_drop", severity: "attention", d: 1,
      recommendation: "Готовность резко ниже личной нормы — облегчённая тренировка." },
    { a: athletes.find(a => a.name === "Дарья Сырбу"), rule_code: "load_spike", severity: "attention", d: 1,
      recommendation: "Нагрузка выросла >1.5× за неделю — риск перегрузки, спланировать разгрузку." },
    { a: by("inconsistent")[0], rule_code: "repeated_fatigue", severity: "attention", d: 2, status: "acknowledged",
      recommendation: "Высокая усталость несколько дней — тренер в курсе." },
  ].map(x => ({
    athlete_id: x.a.id, rule_code: x.rule_code, severity: x.severity,
    triggered_at: `${addDays(today, -x.d)}T09:30:00Z`, status: x.status ?? "open",
    evidence: { seeded_demo: true }, recommendation: x.recommendation,
    dedup_key: `demo:${x.a.id}:${x.rule_code}:${addDays(today, -x.d)}`,
  }));
  const { error: aErr } = await sb.from("alerts").upsert(alerts, { onConflict: "dedup_key" });
  if (aErr) throw aErr;
  console.log(`Alerts: ${alerts.length}`);

  console.log("\nDone. Login: code DEMO-101..DEMO-120 / password Rally-demo-2026");
  console.log("Coach: coach@rallymonitor.dev sees the whole group. Cleanup: node scripts/seed-demo.mjs --cleanup");
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
