import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { TrendChart } from "@/components/TrendChart";
import { statusLabel, formatValue, type Patient, type Status } from "@/lib/health-data";
import { useRole, signOut } from "@/lib/session";
import { usePatients } from "@/lib/backend";
import { SourceBadge } from "@/components/SourceBadge";

export const Route = createFileRoute("/worklist")({
  head: () => ({
    meta: [
      { title: "Patient worklist — Pulsefold Clinical" },
      {
        name: "description",
        content:
          "Triage view of monitored patients with deviation warnings for declining vitals and self-reported decline.",
      },
      { property: "og:title", content: "Patient worklist — Pulsefold Clinical" },
      {
        property: "og:description",
        content: "Triage monitored patients by risk, with clear warnings on declining readings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Worklist,
});

const tone: Record<Status, { card: string; badge: string; text: string; chart: string; note: string }> = {
  risk: {
    card: "border-l-4 border-risk bg-risk-tint/70",
    badge: "bg-risk text-primary-foreground pulse-once",
    text: "text-risk",
    chart: "text-risk",
    note: "bg-risk/10 text-risk-deep",
  },
  watch: {
    card: "border-l-4 border-amber bg-amber/10",
    badge: "bg-amber text-ink pulse-once",
    text: "text-amber-deep",
    chart: "text-amber",
    note: "bg-amber/15 text-amber-deep",
  },
  stable: {
    card: "border-l-4 border-sage bg-sage/10",
    badge: "bg-sage text-primary-foreground",
    text: "text-sage-deep",
    chart: "text-sage",
    note: "bg-sage/15 text-sage-deep",
  },
};

function headlineMetric(p: Patient) {
  if (p.status === "stable") return p.metrics.find((m) => m.key === "hrv")!;
  if (p.status === "watch") return p.metrics.find((m) => m.key === "sleep")!;
  return p.metrics.find((m) => m.key === "rhr")!;
}

function Worklist() {
  const navigate = useNavigate();
  const { role, ready } = useRole();
  const { patients, source, error } = usePatients();

  useEffect(() => {
    if (ready && role !== "clinician") navigate({ to: "/clinician" });
  }, [ready, role, navigate]);

  const counts = {
    risk: patients.filter((p) => p.status === "risk").length,
    watch: patients.filter((p) => p.status === "watch").length,
    stable: patients.filter((p) => p.status === "stable").length,
  };
  const ordered = [...patients].sort(
    (a, b) =>
      ["risk", "watch", "stable"].indexOf(a.status) - ["risk", "watch", "stable"].indexOf(b.status),
  );

  return (
    <section className="min-h-screen bg-mist">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="mb-6"><SourceBadge source={source} error={error} /></div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-sage-deep uppercase">
              Triage · {patients.length} patients
            </p>
            <h1 className="mt-1 font-display text-2xl font-medium tracking-tight text-balance">
              Patient worklist
            </h1>
          </div>
          <div className="flex gap-4 text-xs font-medium">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-sage" />
              {counts.stable} stable
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber" />
              {counts.watch} watch
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-risk" />
              {counts.risk} at risk
            </span>
          </div>
        </div>

        {counts.risk > 0 && (
          <div className="mt-5 rounded-xl border-l-4 border-risk bg-risk/10 px-4 py-3 text-sm font-semibold text-risk-deep">
            ⚠ {counts.risk} patients show a declining pattern requiring review within 72 hours.
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((p) => {
            const t = tone[p.status];
            const m = headlineMetric(p);
            const topFlag = p.flags[0]!;
            return (
              <Link
                key={p.id}
                to="/patient/$id"
                params={{ id: p.id }}
                className={`block rounded-xl p-5 ring-1 ring-black/5 backdrop-blur-md transition-transform hover:-translate-y-1 ${t.card}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-display text-lg font-semibold text-ink">{p.name}</span>
                    <p className="text-xs text-ink/50">
                      {p.age}
                      {p.sex} · {p.condition}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${t.badge}`}
                  >
                    {statusLabel[p.status]}
                  </span>
                </div>
                <div className="mt-4 flex items-end justify-between gap-2">
                  <div>
                    <span className="whitespace-nowrap text-xs text-ink/50">{m.label}</span>
                    <p className={`font-display text-2xl font-semibold ${p.status === "risk" ? t.text : "text-ink"}`}>
                      {formatValue(m)}
                      {m.key === "rhr" || m.key === "hrv" ? (
                        <span className="text-xs font-medium text-ink/40">{m.unit}</span>
                      ) : null}
                    </p>
                  </div>
                  <span className={`text-right text-xs font-semibold ${t.text}`}>
                    {m.clinicalNote.split(".")[0]}
                  </span>
                </div>
                <div className="relative mt-3 h-12">
                  <TrendChart values={m.values} tone={t.chart} height={48} />
                </div>
                <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${t.note}`}>
                  {p.status === "stable" ? topFlag.title : `⚠ ${topFlag.title}`}
                </p>
              </Link>
            );
          })}
        </div>

        <button
          onClick={() => {
            signOut();
            navigate({ to: "/clinician" });
          }}
          className="mt-10 text-xs font-semibold text-ink/45 underline-offset-2 hover:underline"
        >
          Sign out
        </button>
      </div>
    </section>
  );
}
