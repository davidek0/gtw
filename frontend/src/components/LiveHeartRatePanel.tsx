import { useEffect, useMemo, useState } from "react";
import {
  loadGarminLiveHeartRate,
  type HeartRateSample,
} from "@/lib/garmin-data";
import { TrendChart } from "./TrendChart";

const DEFAULT_DANGER_THRESHOLD = 120;

export function LiveHeartRatePanel({ patientId }: { patientId: string }) {
  const [samples, setSamples] = useState<HeartRateSample[]>([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [dangerThreshold, setDangerThreshold] = useState(
    DEFAULT_DANGER_THRESHOLD,
  );
  const [thresholdInput, setThresholdInput] = useState(
    String(DEFAULT_DANGER_THRESHOLD),
  );
  const [thresholdSaved, setThresholdSaved] = useState(false);

  useEffect(() => {
    const saved = Number(
      window.localStorage.getItem(`pulsefold.pulse-danger.${patientId}`),
    );
    if (Number.isInteger(saved) && saved >= 60 && saved <= 220) {
      setDangerThreshold(saved);
      setThresholdInput(String(saved));
    }
  }, [patientId]);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const result = await loadGarminLiveHeartRate();
        if (!result.ok) throw new Error(result.error);
        if (active) {
          setSamples(
            Array.isArray(result.data) ? [...result.data].reverse() : [],
          );
          setError(null);
          setNow(Date.now());
        }
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Kunde inte läsa livepuls",
          );
          setNow(Date.now());
        }
      }
    }

    void refresh();
    const poll = window.setInterval(refresh, 2_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, []);

  const latest = samples[samples.length - 1];
  const ageSeconds = latest
    ? Math.max(
        0,
        Math.floor((now - new Date(latest.measuredAt).getTime()) / 1_000),
      )
    : null;
  const isLive = ageSeconds !== null && ageSeconds <= 15 && !error;
  const bpm = latest?.bpm;
  const warningThreshold = Math.max(40, dangerThreshold - 20);
  const level =
    !isLive || bpm === undefined
      ? "offline"
      : bpm >= dangerThreshold
        ? "danger"
        : bpm >= warningThreshold
          ? "watch"
          : "ok";

  function saveThreshold() {
    const parsed = Math.round(Number(thresholdInput));
    if (!Number.isFinite(parsed)) {
      setThresholdInput(String(dangerThreshold));
      return;
    }
    const next = Math.min(Math.max(parsed, 60), 220);
    setDangerThreshold(next);
    setThresholdInput(String(next));
    window.localStorage.setItem(
      `pulsefold.pulse-danger.${patientId}`,
      String(next),
    );
    setThresholdSaved(true);
  }

  const presentation = {
    offline: {
      label: "Ingen färsk signal",
      panel: "border-ink/10 bg-white/55",
      text: "text-ink/45",
      dot: "bg-ink/25",
      chart: "text-ink/30",
    },
    ok: {
      label: "Inom vald gräns",
      panel: "border-sage/30 bg-sage/10",
      text: "text-sage-deep",
      dot: "bg-sage",
      chart: "text-sage-deep",
    },
    watch: {
      label: "Förhöjd puls",
      panel: "border-amber/40 bg-amber/12",
      text: "text-amber-deep",
      dot: "bg-amber",
      chart: "text-amber-deep",
    },
    danger: {
      label: "Akut varning",
      panel: "border-risk/40 bg-risk/10",
      text: "text-risk-deep",
      dot: "bg-risk animate-pulse",
      chart: "text-risk",
    },
  }[level];

  const values = useMemo(() => {
    const recent = samples.slice(-60).map((sample) => sample.bpm);
    return recent.length === 1 ? [recent[0]!, recent[0]!] : recent;
  }, [samples]);

  return (
    <div
      className={`rounded-2xl border p-6 ring-1 ring-black/5 ${presentation.panel}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div
            className={`flex items-center gap-2 text-xs font-semibold tracking-[0.14em] uppercase ${presentation.text}`}
          >
            <span className={`size-2 rounded-full ${presentation.dot}`} />
            {presentation.label}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <span
              className={`font-display text-6xl font-semibold leading-none ${presentation.text}`}
            >
              {bpm ?? "—"}
            </span>
            <span className="pb-1 text-sm font-semibold text-ink/45">bpm</span>
          </div>
          <p className="mt-2 text-xs text-ink/50">
            {isLive
              ? `Live · senaste värde för ${ageSeconds} sek sedan`
              : latest
                ? `Senaste värde för ${ageSeconds} sek sedan · starta Garmin-monitorn`
                : error || "Väntar på första Garmin-värdet"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-xl bg-white/55 px-4 py-3 ring-1 ring-black/5">
            <span className="block font-display text-xl font-semibold text-amber-deep">
              {warningThreshold}
            </span>
            <span className="text-ink/45">förhöjd</span>
          </div>
          <div className="rounded-xl bg-white/55 px-4 py-3 ring-1 ring-black/5">
            <span className="block font-display text-xl font-semibold text-risk-deep">
              {dangerThreshold}
            </span>
            <span className="text-ink/45">akut gräns</span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 rounded-xl bg-white/45 px-4 py-3 ring-1 ring-black/5">
        <label className="text-xs font-semibold text-ink/60">
          Läkarens akuta pulsgräns
          <span className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min="60"
              max="220"
              step="1"
              value={thresholdInput}
              onChange={(event) => {
                setThresholdInput(event.target.value);
                setThresholdSaved(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveThreshold();
              }}
              className="w-24 rounded-lg border border-ink/15 bg-white/80 px-3 py-2 text-base font-semibold text-ink outline-none focus:border-risk"
              aria-label="Akut pulsgräns"
            />
            <span className="text-xs font-medium text-ink/45">bpm</span>
          </span>
        </label>
        <div className="flex items-center gap-3">
          {thresholdSaved && (
            <span className="text-xs font-semibold text-sage-deep">Sparad</span>
          )}
          <button
            type="button"
            onClick={saveThreshold}
            className="rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Spara gräns
          </button>
        </div>
      </div>

      <div className="relative mt-6 h-32 rounded-xl bg-white/35 p-3 ring-1 ring-black/5">
        {values.length > 1 ? (
          <TrendChart
            values={values}
            height={104}
            tone={presentation.chart}
            area
          />
        ) : (
          <div className="grid h-full place-items-center text-xs text-ink/35">
            Pulskurvan visas när nya värden kommer in
          </div>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink/50">
        Förhöjd nivå visas 20 bpm under den valda akutgränsen. Demoindikering –
        inte ett medicintekniskt larm. Bedöm puls tillsammans med symtom,
        aktivitet, ordinationer och klinisk kontext.
      </p>
    </div>
  );
}
