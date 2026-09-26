export type Status = "stable" | "watch" | "risk";

export type Metric = {
  key: string;
  label: string;
  unit: string;
  /** oldest → newest, 30 daily readings */
  values: number[];
  /** clinically expected range for this patient */
  range: [number, number];
  /** patient-facing, positive framing */
  patientNote: string;
  /** clinician-facing, critical framing */
  clinicalNote: string;
  /** lower values are better (e.g. resting heart rate) */
  lowerIsBetter?: boolean;
};

// Shape your laptop backend must return from GET /patients.
// TODO: add any extra fields your backend sends here.
export type Patient = {
  id: string;
  /** used to match the patient sign-in */
  email?: string;
  name: string;
  firstName: string;
  age: number;
  sex: "F" | "M";
  condition: string;
  diagnoses?: string[];
  status: Status;
  streak: number;
  headline: string;
  subhead: string;
  feelingQuote: string;
  feelingScore: number; // 1-5
  flags: { level: Status; title: string; detail: string }[];
  clinicalNote: string;
  metrics: Metric[];
};

export const statusLabel: Record<Status, string> = {
  stable: "Stable",
  watch: "Monitor",
  risk: "High risk",
};

export function latest(m: Metric): number {
  return m.values[m.values.length - 1] ?? 0;
}

export function delta(m: Metric): number {
  const first = m.values[0] ?? 0;
  return Math.round((latest(m) - first) * 10) / 10;
}

export function formatValue(m: Metric): string {
  const v = latest(m);
  if (m.key === "sleep") {
    const h = Math.floor(v);
    const mins = Math.round((v - h) * 60);
    return `${h}h ${String(mins).padStart(2, "0")}m`;
  }
  if (m.key === "steps") return `${v.toFixed(1)}k`;
  if (m.key === "feeling") return `${v.toFixed(1)}/5`;
  return `${Math.round(v)}`;
}

