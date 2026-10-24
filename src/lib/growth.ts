// Growth & maturation math (Phase 4). Deterministic, unit-tested.
//
// Khamis-Roche (1994) predicted adult height — coefficients transcribed
// verbatim from the matuR package's published table (josedv82/matuR,
// data/table.rda), which implements Khamis & Roche, Pediatrics 94:504-507
// including the published errata. The model works in INCHES and POUNDS:
//   PAH_in = intercept + heightIn*hC + weightLb*wC + midParentIn*mC
// Age is rounded to the nearest half-year to index the table (4.0–17.5).

export type Sex = "male" | "female";

// [age, male: B1, h, w, midparent, female: B2, h, w, midparent]
const KR_TABLE: [number, number, number, number, number, number, number, number, number][] = [
  [4.0, -10.2567, 1.23812, -0.008724, 0.50286, -8.13250, 1.24768, -0.019435, 0.44774],
  [4.5, -10.7190, 1.15964, -0.007445, 0.52887, -6.47656, 1.22177, -0.018519, 0.41381],
  [5.0, -11.0213, 1.10674, 0.006478, 0.53919, -5.13582, 1.19932, -0.017530, 0.38467],
  [5.5, -11.1556, 1.07480, -0.005776, 0.53691, -4.13791, 1.17880, -0.016484, 0.36039],
  [6.0, -11.1138, 1.05923, -0.005295, 0.52513, -3.51039, 1.15866, -0.015400, 0.34105],
  [6.5, -11.0221, 1.05542, -0.004989, 0.50692, -3.14322, 1.13737, -0.014294, 0.32672],
  [7.0, -10.9984, 1.05877, -0.004814, 0.48538, -2.87645, 1.11342, -0.013184, 0.31748],
  [7.5, -11.0214, 1.06467, -0.047256, 0.46361, -2.66291, 1.08525, -0.012086, 0.31340],
  [8.0, -11.0696, 1.06853, -0.004678, 0.44469, -2.45559, 1.05135, -0.011019, 0.31457],
  [8.5, -11.1220, 1.06572, -0.004626, 0.43171, -2.20728, 1.01018, -0.009999, 0.32105],
  [9.0, -11.1571, 1.05166, -0.045254, 0.42776, -1.87098, 0.96020, -0.009044, 0.33291],
  [9.5, -11.1405, 1.02174, -0.004331, 0.43593, -1.06330, 0.89989, -0.008171, 0.35025],
  [10.0, -11.0380, 0.97135, -0.003998, 0.45932, 0.33468, 0.82771, -0.007397, 0.37312],
  [10.5, -10.8286, 0.89589, -0.003481, 0.50101, 1.97366, 0.74213, -0.006739, 0.40161],
  [11.0, -10.4917, 0.81239, -0.002905, 0.54781, 3.50436, 0.67173, -0.006136, 0.42042],
  [11.5, -10.0065, 0.74134, -0.002417, 0.58409, 4.57747, 0.64150, -0.005518, 0.41686],
  [12.0, -9.3522, 0.68325, -0.002008, 0.60927, 4.84365, 0.64452, -0.004894, 0.39490],
  [12.5, -8.6055, 0.63869, -0.001668, 0.62279, 4.27869, 0.67386, -0.004272, 0.35850],
  [13.0, -7.8632, 0.60818, -0.001389, 0.62407, 3.21417, 0.72260, -0.003661, 0.31163],
  [13.5, -7.1348, 0.59228, -0.001162, 0.61253, 1.83456, 0.78383, -0.003067, 0.25826],
  [14.0, -6.4299, 0.59151, -0.000978, 0.58762, 0.32425, 0.85062, -0.002500, 0.20235],
  [14.5, -5.7578, 0.60643, -0.000826, 0.54875, -1.13224, 0.91605, -0.001967, 0.14787],
  [15.0, -5.1282, 0.63757, -0.000699, 0.49536, -2.35055, 0.97319, -0.001477, 0.09880],
  [15.5, -4.5092, 0.68548, -0.000586, 0.42687, -3.10326, 1.01514, -0.001037, 0.05909],
  [16.0, -3.9292, 0.75069, -0.000480, 0.34271, -3.17885, 1.03496, -0.000655, 0.03272],
  [16.5, -3.4873, 0.83375, -0.000369, 0.24231, -2.41657, 1.02573, -0.000340, 0.02364],
  [17.0, -3.2830, 0.93520, -0.000247, 0.12510, -0.65579, 0.98054, -0.000100, 0.03584],
  [17.5, -3.4156, 1.05558, -0.000103, -0.00950, 2.26429, 0.89246, 0.000057, 0.07327],
];

const CM_PER_IN = 2.54;
const LB_PER_KG = 2.20462;

/** Exact decimal age in years between two YYYY-MM-DD dates. */
export function decimalAge(birthDate: string, onDate: string): number {
  const ms = Date.parse(`${onDate}T12:00:00Z`) - Date.parse(`${birthDate}T12:00:00Z`);
  return ms / (365.25 * 24 * 3600 * 1000);
}

/** Age rounded to the nearest 0.5y, clamped to the table's 4.0–17.5 range. */
export function tableAge(ageYears: number): number | null {
  const rounded = Math.round(ageYears / 0.5) * 0.5;
  if (rounded < 4 || rounded > 17.5) return null;
  return rounded;
}

export interface KhamisRocheResult {
  pahCm: number; // predicted adult height, cm
  pctPah: number; // current height as % of PAH
  tableAge: number;
}

/**
 * Predicted adult height (Khamis-Roche 1994, via matuR).
 * Returns null when the table cannot cover the age or inputs are missing.
 */
export function khamisRoche(
  sex: Sex,
  heightCm: number,
  weightKg: number,
  motherCm: number,
  fatherCm: number,
  ageYears: number,
): KhamisRocheResult | null {
  const tAge = tableAge(ageYears);
  if (tAge === null) return null;
  const row = KR_TABLE.find((r) => r[0] === tAge);
  if (!row) return null;

  const hIn = heightCm / CM_PER_IN;
  const wLb = weightKg * LB_PER_KG;
  const midIn = (motherCm + fatherCm) / 2 / CM_PER_IN;

  const [b, hc, wc, mc] = sex === "male" ? [row[1], row[2], row[3], row[4]] : [row[5], row[6], row[7], row[8]];
  const pahCm = (b + hIn * hc + wLb * wc + midIn * mc) * CM_PER_IN;
  if (!Number.isFinite(pahCm) || pahCm <= 0) return null;
  return {
    pahCm: Math.round(pahCm * 10) / 10,
    pctPah: Math.round((heightCm / pahCm) * 1000) / 10,
    tableAge: tAge,
  };
}

export interface GrowthMeasurementLike {
  measured_on: string;
  height_cm: number;
  weight_kg: number | null;
}

/**
 * Growth velocity in cm/year from the two most recent measurements.
 * Needs a gap of at least ~2 months for a meaningful rate; otherwise null.
 */
export function growthVelocity(ms: GrowthMeasurementLike[]): number | null {
  const s = ms
    .slice()
    .sort((a, b) => a.measured_on.localeCompare(b.measured_on))
    .filter((m) => m.height_cm > 0);
  if (s.length < 2) return null;
  const [prev, last] = [s[s.length - 2], s[s.length - 1]];
  const years =
    (Date.parse(`${last.measured_on}T12:00:00Z`) - Date.parse(`${prev.measured_on}T12:00:00Z`)) /
    (365.25 * 24 * 3600 * 1000);
  if (years < 0.15) return null; // < ~55 days apart — noise dominates
  return Math.round(((last.height_cm - prev.height_cm) / years) * 10) / 10;
}

export type MaturationCategory = "pre_spurt" | "in_spurt" | "post_spurt";

/** %PAH → category. Defaults from the spec: <=87 pre, 88–95 spurt, >95 post. */
export function maturationCategory(
  pctPah: number,
  bandLow = 88,
  bandHigh = 95,
): MaturationCategory {
  if (pctPah < bandLow) return "pre_spurt";
  if (pctPah <= bandHigh) return "in_spurt";
  return "post_spurt";
}
