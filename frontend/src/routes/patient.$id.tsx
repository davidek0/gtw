import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { TrendChart } from "@/components/TrendChart";
import { statusLabel, formatValue, delta, type Status } from "@/lib/health-data";
import { useRole, signOut } from "@/lib/session";
import { usePatients } from "@/lib/backend";

export const Route = createFileRoute("/patient/$id")({
  head: () => ({
    meta: [
      { title: "Patient review — Pulsefold Clinical" },
      { name: "description", content: "Clinical review of 30-day telemetry trends, deviation flags and notes." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Patient review — Pulsefold Clinical" },
      { property: "og:description", content: "Clinical review of 30-day telemetry trends, deviation flags and notes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PatientDetail,
  notFoundComponent: PatientMissing,
});

function PatientMissing() {
  return (
    <div className="grid min-h-screen place-items-center bg-mist px-6 text-center">
      <div>
        <h1 className="font-display text-2xl font-medium">Patient record not found</h1>
        <Link to="/worklist" className="mt-3 inline-block text-sm font-semibold text-sage-deep underline">
          Back to worklist
        </Link>
      </div>
    </div>
  );
}

const flagTone: Record<Status, string> = {
  risk: "bg-risk/10 text-risk-deep",
  watch: "bg-amber/12 text-amber-deep",
  stable: "bg-sage/10 text-sage-deep",
};

const chartTone: Record<Status, string> = {
  risk: "text-risk",
  watch: "text-amber",
  stable: "text-sage",
};

function PatientDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { role, ready } = useRole();
  const { patients } = usePatients();
  const patient = patients.find((p) => p.id === id);

  useEffect(() => {
    if (ready && role !== "clinician") navigate({ to: "/clinician" });
  }, [ready, role, navigate]);

  if (!patient) return <PatientMissing />;

  const rhr = patient.metrics.find((m) => m.key === "rhr")!;
  const others = patient.metrics.filter((m) => m.key !== "rhr");
  const baseline = Math.round(rhr.values[0]!);

  return (
    <section className="min-h-screen bg-mist">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link to="/worklist" className="text-xs font-semibold text-ink/45 hover:text-ink">
              ← Worklist
            </Link>
            <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">{patient.name}</h1>
            <p className="text-sm text-ink/50">
              {patient.age}
              {patient.sex} · {patient.condition} · 30-day telemetry
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide uppercase ${
              patient.status === "risk"
                ? "bg-risk text-primary-foreground"
                : patient.status === "watch"
                  ? "bg-amber text-ink"
                  : "bg-sage text-primary-foreground"
            }`}
          >
            {statusLabel[patient.status]}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* charts left */}
          <div className="rounded-xl border border-white/60 bg-white/55 p-6 backdrop-blur-xl ring-1 ring-black/5">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.15em] text-ink/50 uppercase">
              <span className={`size-2 rounded-full ${patient.status === "risk" ? "bg-risk" : patient.status === "watch" ? "bg-amber" : "bg-sage"}`} />
              RHR trend · 30d
            </div>
            <p className={`mt-1 font-display text-3xl font-semibold ${chartTone[patient.status]}`}>
              {formatValue(rhr)} bpm{" "}
              <span className="text-sm font-medium text-ink/40">baseline {baseline}</span>
            </p>
            <div className="relative mt-4 h-40">
              <TrendChart
                values={rhr.values}
                tone={chartTone[patient.status]}
                height={160}
                area
                band={rhr.range}
              />
            </div>
            <p className="mt-3 text-sm text-ink/70 text-pretty">{rhr.clinicalNote}</p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {others.map((m) => {
                const d = delta(m);
                const improving = m.lowerIsBetter ? d < 0 : d > 0;
                return (
                  <div key={m.key} className="rounded-lg bg-white/60 p-3 ring-1 ring-black/5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-ink/50">{m.label}</span>
                      <span
                        className={`text-[11px] font-semibold ${improving ? "text-sage-deep" : "text-risk"}`}
                      >
                        {d > 0 ? "↑" : "↓"} {Math.abs(d)}
                        {m.key === "feeling" ? "" : ` ${m.unit}`}
                      </span>
                    </div>
                    <p className="font-display text-xl font-semibold text-ink">{formatValue(m)}</p>
                    <div className="relative mt-2 h-10">
                      <TrendChart
                        values={m.values}
                        tone={improving ? "text-sage" : chartTone[patient.status]}
                        height={40}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-ink/55 text-pretty">{m.clinicalNote}</p>
                    <p className="mt-1 text-[11px] text-ink/35">
                      Expected {m.range[0]}–{m.range[1]} {m.unit}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* annotations right */}
          <div className="rounded-xl border border-white/60 bg-white/55 p-6 backdrop-blur-xl ring-1 ring-black/5">
            <span className="text-xs font-semibold tracking-[0.12em] text-ink/50 uppercase">
              Deviation flags
            </span>
            <div className="mt-3 space-y-3">
              {patient.flags.map((f) => (
                <div key={f.title} className={`rounded-lg px-3 py-2 ${flagTone[f.level]}`}>
                  <p className="text-xs font-semibold">
                    {f.level === "stable" ? "" : "⚠ "}
                    {f.title}
                  </p>
                  <p className="mt-1 text-[11px] opacity-80 text-pretty">{f.detail}</p>
                </div>
              ))}
              <div className="rounded-lg bg-sage/10 px-3 py-2 text-xs font-medium text-sage-deep">
                Perceived feeling: &ldquo;{patient.feelingQuote}&rdquo; · {patient.feelingScore}/5
              </div>
            </div>

            <div className="mt-5 border-t border-ink/10 pt-4">
              <span className="text-xs font-semibold tracking-[0.12em] text-ink/50 uppercase">
                Clinical notes
              </span>
              <p className="mt-2 text-sm text-ink/75 text-pretty">{patient.clinicalNote}</p>
              {/* TODO: wire these to your backend, e.g. POST /patients/:id/referrals and POST /patients/:id/notes (add helpers in src/lib/backend.ts) */}
              <div className="mt-4 flex gap-2">
                <button className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-primary-foreground">
                  Refer
                </button>
                <button className="rounded-lg border border-ink/15 px-3 py-2 text-xs font-medium text-ink/70">
                  Add note
                </button>
              </div>
            </div>
          </div>
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
