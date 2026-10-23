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

    const [uidA, uidB, uidX] = userIds;
    athleteAId = await idOf(await profOf(uidA));
    await idOf(await profOf(uidB)); // athlete B row exists; we only need A's id
    const coachXProfile = await profOf(uidX);

    const { data: g } = await admin.from("groups").insert({ name: `RLS-${stamp}` }).select().single();
    groupId = g!.id;
    await admin.from("group_memberships").insert({ group_id: groupId, athlete_id: athleteAId });
    await admin.from("coach_assignments").insert({ coach_profile_id: coachXProfile, group_id: groupId });

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
    await athleteA.from("morning_checkins").insert({
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

  it("assigned coach can read athlete A; unassigned coach cannot", async () => {
    const { data: ok } = await coachX
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", athleteAId);
    expect(ok!.length).toBeGreaterThan(0);

    const coachY = createClient(URL, ANON, { auth: { persistSession: false } });
    await coachY.auth.signInWithPassword({ email: mail("coach-y"), password: pass });
    const { data: blocked } = await coachY
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", athleteAId);
    expect(blocked).toEqual([]);
  });

  it("athlete cannot read coach_notes or alerts", async () => {
    const n = await athleteA.from("coach_notes").select("*").limit(5);
    const a = await athleteA.from("alerts").select("*").limit(5);
    expect(n.data).toEqual([]);
    expect(a.data).toEqual([]);
  });
});
