/** Small shared guards for the AI layer (pure, testable). */

/** Postgres unique-violation code as surfaced by supabase-js errors. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}
