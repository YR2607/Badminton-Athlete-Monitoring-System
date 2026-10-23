/**
 * RLS integration tests. Run against a real Supabase project:
 *   RUN_RLS_TESTS=1 \
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... SUPABASE_ANON_KEY=... \
 *   npx vitest run tests/rls.integration.test.ts
 *
 * The test creates two athletes + two coaches, proves isolation, then cleans up.
 * Requires SUPABASE_SECRET_KEY (used ONLY to provision test fixtures).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RUN = process.env.RUN_RLS_TESTS === "1";
const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

const run = RUN && URL && SERVICE && ANON ? describe : describe.skip;

run("RLS isolation", () => {
  let admin: SupabaseClient;
  let athleteA: SupabaseClient;
  let athleteB: SupabaseClient;
  let coachX: SupabaseClient;
  const userIds: string[] = [];
  let athleteAId = "";
  let groupId = "";

  const stamp = Date.now();
  const mail = (n: string) => `rls-test-${n}-${stamp}@example.test`;
  const pass = `Test-${stamp}-pass!`;

  beforeAll(async () => {
    admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

    const mkUser = async (n: string, role: string, code?: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: mail(n),
        password: pass,
        email_confirm: true,
        user_metadata: { display_name: n, role, athlete_code: code, timezone: "UTC" },
      });
      if (error) throw error;
      userIds.push(data.user.id);
      return data.user.id;
    };

    await mkUser("athlete-a", "athlete", `TA-${stamp}`);
    await mkUser("athlete-b", "athlete", `TB-${stamp}`);
    await mkUser("coach-x", "coach");
    await mkUser("coach-y", "coach");

    const profOf = async (uid: string) =>
      (await admin.from("profiles").select("id").eq("user_id", uid).single()).data!.id;
    const idOf = async (pid: string) =>
      (await admin.from("athletes").select("id").eq("profile_id", pid).single()).data!.id;

    const [uidA, uidB] = userIds;
    athleteAId = await idOf(await profOf(uidA));
    await idOf(await profOf(uidB)); // athlete B row exists; we only need A's id

    const { data: g } = await admin.from("groups").insert({ name: `RLS-${stamp}` }).select().single();
    groupId = g!.id;
    await admin.from("group_memberships").insert({ group_id: groupId, athlete_id: athleteAId });

    const signIn = async (uidIdx: number) => {
      const c = createClient(URL, ANON, { auth: { persistSession: false } });
      const email = mail(["athlete-a", "athlete-b", "coach-x", "coach-y"][uidIdx]);
      const { error } = await c.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      return c;
    };
    athleteA = await signIn(0);
    athleteB = await signIn(1);
    coachX = await signIn(2);
  }, 60000);

  afterAll(async () => {
    if (!admin) return;
    for (const uid of userIds) await admin.auth.admin.deleteUser(uid);
    if (groupId) await admin.from("groups").delete().eq("id", groupId);
  });

  it("athlete A cannot read athlete B check-ins", async () => {
    // Fixture rows go through the service client: the hardened athlete INSERT
    // policy only accepts the athlete-local "today" date.
    await admin.from("morning_checkins").insert({
      athlete_id: athleteAId,
      checkin_date: "2020-01-01",
      sleep_score: 3, recovery_score: 3, fatigue_score: 3,
      muscle_soreness_score: 3, stress_score: 3, mood_score: 3,
    });
    const { data } = await athleteB.from("morning_checkins").select("*").eq("athlete_id", athleteAId);
    expect(data).toEqual([]);
  });

  it("athlete B cannot insert a check-in as athlete A", async () => {
    const { error } = await athleteB.from("morning_checkins").insert({
      athlete_id: athleteAId,
      checkin_date: "2020-01-02",
      sleep_score: 3, recovery_score: 3, fatigue_score: 3,
      muscle_soreness_score: 3, stress_score: 3, mood_score: 3,
    });
    expect(error).not.toBeNull();
  });

  it("any coach can read athlete check-ins", async () => {
    const { data: ok } = await coachX
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", athleteAId);
    expect(ok!.length).toBeGreaterThan(0);

    const coachY = createClient(URL, ANON, { auth: { persistSession: false } });
    await coachY.auth.signInWithPassword({ email: mail("coach-y"), password: pass });
    const { data: also } = await coachY
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", athleteAId);
    expect(also!.length).toBeGreaterThan(0);
  });

  it("athlete cannot read coach_notes or alerts", async () => {
    const n = await athleteA.from("coach_notes").select("*").limit(5);
    const a = await athleteA.from("alerts").select("*").limit(5);
    expect(n.data).toEqual([]);
    expect(a.data).toEqual([]);
  });

  it("athlete cannot write training_schedules for own group", async () => {
    const { error } = await athleteA.from("training_schedules").insert({
      group_id: groupId,
      weekday: 6,
      start_time: "09:00",
    });
    expect(error).not.toBeNull();
  });

  it("coach cannot write consent_records", async () => {
    const { error } = await coachX.from("consent_records").insert({
      athlete_id: athleteAId,
      consent_type: "test",
      status: "granted",
    });
    expect(error).not.toBeNull();
  });

  it("athlete cannot backfill a morning check-in for a past date", async () => {
    const { error } = await athleteA.from("morning_checkins").insert({
      athlete_id: athleteAId,
      checkin_date: "2020-02-02",
      sleep_score: 3, recovery_score: 3, fatigue_score: 3,
      muscle_soreness_score: 3, stress_score: 3, mood_score: 3,
    });
    expect(error).not.toBeNull();
  });

  it("athlete cannot self-record an alert via record_alert", async () => {
    const { error } = await athleteA.rpc("record_alert", {
      p_athlete_id: athleteAId,
      p_rule_code: "fake",
      p_severity: "priority",
      p_evidence: {},
      p_recommendation: "x",
      p_dedup_key: `test:${stamp}`,
    });
    expect(error).not.toBeNull();
  });

  it("athlete cannot attach a post check-in to another athlete's session", async () => {
    // session belongs to athlete A; try to link athlete B's post check-in to it
    const { data: sess } = await admin
      .from("training_sessions")
      .insert({
        athlete_id: athleteAId,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const { error } = await athleteB.from("post_training_checkins").insert({
      training_session_id: sess!.id,
      athlete_id: athleteAId, // spoofed — not B's own id either
      overall_feeling: 3, leg_fatigue: 3, arm_shoulder_fatigue: 3,
    });
    expect(error).not.toBeNull();
  });
});
