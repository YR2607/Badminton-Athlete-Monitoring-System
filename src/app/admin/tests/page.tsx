import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { TestsAdmin } from "./tests-admin";
import type { FieldTest } from "@/lib/types";

export default async function AdminTestsPage() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const supabase = await createClient();
  const { data: tests } = await supabase
    .from("field_tests")
    .select("*")
    .order("sort_order");

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold tracking-tight">{dict.tests.adminTitle}</h1>
      <TestsAdmin dict={dict} tests={(tests as FieldTest[] | null) ?? []} />
    </div>
  );
}
