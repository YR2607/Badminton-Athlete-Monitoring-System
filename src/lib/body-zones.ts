import type { BodyZoneKey } from "@/components/forms/body-map";

/** Map a free-text / localized zone label back to a canonical zone code. */
export function detectBodyZone(raw: string | null | undefined): BodyZoneKey | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/плеч|shoulder|umăr|umar/.test(s)) return "shoulder";
  if (/локот|локтя|elbow|cot/.test(s)) return "elbow";
  if (/кист|запяст|wrist|hand|încheiet|incheiet|mân|man/.test(s)) return "wrist";
  if (/спин|поясн|back|lombar|spate/.test(s)) return "back";
  if (/бедр|пах|hip|groin|șold|sold|inghinal/.test(s)) return "hip";
  if (/колен|knee|genunchi/.test(s)) return "knee";
  if (/ахил|achil|ahil/.test(s)) return "achilles";
  // Ankle before shin: "голеностоп" contains "голен" — shin must not win it.
  if (/стоп|голеностоп|лодыж|ankle|foot|glezn|picioar|picior/.test(s)) return "ankle";
  if (/голен|икр|shin|calf|gamb/.test(s)) return "shin";
  return null;
}
