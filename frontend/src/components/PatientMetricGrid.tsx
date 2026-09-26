import { useEffect, useState } from "react";
import type { Patient } from "@/lib/health-data";
import { formatValue } from "@/lib/health-data";
import {
  loadGarminHealth,
  type GarminMetrics,
  type GarminRecord,
} from "@/lib/garmin-data";
import { TrendChart } from "./TrendChart";

type DisplayMetric = {
  key: string;
  label: string;
  value: string;
  unit?: string;
  values: number[];
  note: string;
};

export function PatientMetricGrid({ patient }: { patient: Patient }) {
  const isGarmin = patient.id === "person-1";
  const [garmin, setGarmin] = useState<GarminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isGarmin) return;
    let active = true;

    async function load() {
      try {
        const result = await loadGarminHealth();
        if (!result.ok) throw new Error(result.error);
        if (active) {
          setGarmin(result.data);
          setError(null);
        }
      } catch (cause) {
        if (active) {
          setGarmin(null);
          setError(
            cause instanceof Error
              ? cause.message
              : "Kunde inte läsa Garmin-data",
          );
        }
      }
    }

    void load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [isGarmin]);

  const metrics = isGarmin
    ? garminDisplayMetrics(garmin)
    : mockDisplayMetrics(patient);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-sage-deep uppercase">
            Hälsodata
          </p>
          <h2 className="mt-1 font-display text-2xl font-medium">
            Senaste mätvärden
          </h2>
        </div>
        <span className="rounded-full bg-white/55 px-3 py-1 text-xs font-semibold text-ink/55 ring-1 ring-black/5">
          {isGarmin
            ? error
              ? "Garmin · anslutningsfel"
              : "Garmin"
            : "Mockdata"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => {
          const chartValues =
            metric.values.length === 1
              ? [metric.values[0]!, metric.values[0]!]
              : metric.values;
          return (
            <article
              key={metric.key}
              className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-[var(--shadow-panel)] backdrop-blur-xl ring-1 ring-black/5"
            >
              <p className="text-[10px] font-semibold tracking-[0.14em] text-ink/45 uppercase">
                {metric.label}
              </p>
              <p className="mt-2 font-display text-3xl font-semibold text-ink">
                {metric.value}
                {metric.unit && (
                  <span className="ml-1 text-xs font-medium text-ink/40">
                    {metric.unit}
                  </span>
                )}
              </p>
              <div className="relative mt-4 h-14">
                {chartValues.length > 1 ? (
                  <TrendChart values={chartValues} height={56} area />
                ) : (
                  <div className="grid h-full place-items-center rounded-lg bg-ink/[0.03] text-[10px] text-ink/35">
                    Ingen mätserie
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink/55">
                {metric.note}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function mockDisplayMetrics(patient: Patient): DisplayMetric[] {
  const definitions = [
    ["sleep", "Sömn"],
    ["steps", "Dagliga steg"],
    ["rhr", "Puls"],
    ["hrv", "Heart rate variability"],
  ] as const;

  return definitions.map(([key, label]) => {
    const metric = patient.metrics.find((candidate) => candidate.key === key)!;
    return {
      key,
      label,
      value: formatValue(metric),
      unit: key === "rhr" || key === "hrv" ? metric.unit : undefined,
      values: metric.values,
      note: metric.clinicalNote,
    };
  });
}

function garminDisplayMetrics(data: GarminMetrics | null): DisplayMetric[] {
  const sleepValues = extractSeries(data?.sleep, (raw) => {
    const dto = objectValue(raw, "dailySleepDTO");
    const seconds = numberValue(dto, "sleepTimeSeconds");
    return seconds === null ? null : Math.round((seconds / 3600) * 10) / 10;
  });
  const stepValues = extractSeries(data?.steps, (raw) => {
    if (!Array.isArray(raw)) return null;
    return raw.reduce((total, sample) => {
      const steps = isObject(sample) ? numberValue(sample, "steps") : null;
      return total + (steps ?? 0);
    }, 0);
  });
  const pulseValues = extractSeries(data?.heart_rate, (raw) =>
    numberValue(raw, "restingHeartRate"),
  );
  const hrvValues = extractSeries(data?.hrv, (raw) => {
    const summary = objectValue(raw, "hrvSummary");
    return (
      numberValue(summary, "lastNightAvg") ??
      numberValue(summary, "weeklyAvg") ??
      numberValue(raw, "lastNightAvg") ??
      numberValue(raw, "weeklyAvg")
    );
  });

  const sleep = latest(sleepValues);
  const sleepHours =
    sleep === null
      ? "—"
      : `${Math.floor(sleep)}h ${String(Math.round((sleep % 1) * 60)).padStart(2, "0")}m`;
  const steps = latest(stepValues);
  const pulse = latest(pulseValues);
  const hrv = latest(hrvValues);

  return [
    {
      key: "sleep",
      label: "Sömn",
      value: sleepHours,
      values: sleepValues,
      note:
        sleep === null
          ? "Ingen sömnmätning från Garmin ännu."
          : "Senaste registrerade sömn från Garmin.",
    },
    {
      key: "steps",
      label: "Dagliga steg",
      value:
        steps === null ? "—" : new Intl.NumberFormat("sv-SE").format(steps),
      values: stepValues,
      note:
        steps === null
          ? "Ingen stegmätning från Garmin ännu."
          : "Dagens registrerade steg från Garmin.",
    },
    {
      key: "heart_rate",
      label: "Puls",
      value: pulse === null ? "—" : String(Math.round(pulse)),
      unit: pulse === null ? undefined : "bpm",
      values: pulseValues,
      note:
        pulse === null
          ? "Ingen vilopuls från Garmin ännu."
          : "Senaste vilopuls registrerad av Garmin.",
    },
    {
      key: "hrv",
      label: "Heart rate variability",
      value: hrv === null ? "—" : String(Math.round(hrv)),
      unit: hrv === null ? undefined : "ms",
      values: hrvValues,
      note:
        hrv === null
          ? "Garmin har inte lämnat något HRV-värde ännu."
          : "Senaste nattliga HRV från Garmin.",
    },
  ];
}

function extractSeries(
  records: GarminRecord[] | undefined,
  extract: (data: unknown) => number | null,
): number[] {
  if (!records) return [];
  return [...records]
    .reverse()
    .map((record) => extract(record.data))
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
}

function latest(values: number[]): number | null {
  return values[values.length - 1] ?? null;
}

function objectValue(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!isObject(value)) return null;
  const nested = value[key];
  return isObject(nested) ? nested : null;
}

function numberValue(value: unknown, key: string): number | null {
  if (!isObject(value)) return null;
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
