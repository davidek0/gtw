import { useEffect, useMemo, useState } from "react";
import { TrendChart } from "./TrendChart";

type HeartRateSample = {
  id: string;
  bpm: number;
  measuredAt: string;
  sourceDevice: string | null;
};

const backendUrl =
  (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") ||
  "http://127.0.0.1:3000";

export function LiveHeartRatePanel() {
  const [samples, setSamples] = useState<HeartRateSample[]>([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const response = await fetch(`${backendUrl}/api/garmin-live/heart-rate?limit=90`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`Backend svarade ${response.status}`);
        const data = (await response.json()) as HeartRateSample[];
        if (active) {
          setSamples(Array.isArray(data) ? [...data].reverse() : []);
          setError(null);
          setNow(Date.now());
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Kunde inte läsa livepuls");
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
    ? Math.max(0, Math.floor((now - new Date(latest.measuredAt).getTime()) / 1_000))
    : null;
  const isLive = ageSeconds !== null && ageSeconds <= 15 && !error;
  const bpm = latest?.bpm;
  const level = !isLive || bpm === undefined ? "offline" : bpm >= 120 ? "danger" : bpm >= 100 ? "watch" : "ok";

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
    <div className={`rounded-2xl border p-6 ring-1 ring-black/5 ${presentation.panel}`}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className={`flex items-center gap-2 text-xs font-semibold tracking-[0.14em] uppercase ${presentation.text}`}>
            <span className={`size-2 rounded-full ${presentation.dot}`} />
            {presentation.label}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <span className={`font-display text-6xl font-semibold leading-none ${presentation.text}`}>
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
            <span className="block font-display text-xl font-semibold text-amber-deep">100</span>
            <span className="text-ink/45">förhöjd</span>
          </div>
          <div className="rounded-xl bg-white/55 px-4 py-3 ring-1 ring-black/5">
            <span className="block font-display text-xl font-semibold text-risk-deep">120</span>
            <span className="text-ink/45">akut gräns</span>
          </div>
        </div>
      </div>

      <div className="relative mt-6 h-32 rounded-xl bg-white/35 p-3 ring-1 ring-black/5">
        {values.length > 1 ? (
          <TrendChart values={values} height={104} tone={presentation.chart} area />
        ) : (
          <div className="grid h-full place-items-center text-xs text-ink/35">
            Pulskurvan visas när nya värden kommer in
          </div>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink/50">
        Demoindikering – inte ett medicintekniskt larm. Bedöm puls tillsammans med symtom,
        aktivitet, ordinationer och klinisk kontext.
      </p>
    </div>
  );
}
