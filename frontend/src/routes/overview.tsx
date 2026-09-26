import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { usePatients, sendFeeling } from "@/lib/backend";
import { SourceBadge } from "@/components/SourceBadge";
import { TrendChart } from "@/components/TrendChart";
import { formatValue } from "@/lib/health-data";
import { useRole, signOut, readUser } from "@/lib/session";

export const Route = createFileRoute("/overview")({
  head: () => ({
    meta: [
      { title: "Your overview — Pulsefold" },
      {
        name: "description",
        content:
          "How your resting heart rate, sleep, movement, recovery and daily energy have progressed.",
      },
      { property: "og:title", content: "Your overview — Pulsefold" },
      {
        property: "og:description",
        content: "A positive, plain-language look at your health trends over the last 30 days.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PatientOverview,
});

function PatientOverview() {
  const navigate = useNavigate();
  const { role, ready } = useRole();
  const { patients, source, error } = usePatients();
  // TODO: once real auth exists, ask the backend for "me" instead of matching by email.
  const user = ready ? readUser() : "";
  const patient = patients.find((p) => p.email?.toLowerCase() === user || p.id === user);
  const [myScore, setMyScore] = useState<number | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const score = myScore ?? patient?.feelingScore ?? 0;

  async function rate(n: number) {
    setMyScore(n);
    if (source !== "backend") return setSent("Not connected — not sent");
    try {
      await sendFeeling(patient!.id, n);
      setSent("Sent to your laptop");
    } catch {
      setSent("Couldn't reach your laptop");
    }
  }

  useEffect(() => {
    if (ready && role !== "patient") navigate({ to: "/" });
  }, [ready, role, navigate]);

  if (!patient) {
    return (
      <section className="grid min-h-screen place-items-center bg-mist px-6 text-center">
        <div>
          <SourceBadge source={source} error={error} />
          <p className="mt-4 text-sm text-ink/70">
            {source === "backend" ? "No health data found for your account yet." : "Connect to your laptop to see your data."}
          </p>
          <button onClick={() => { signOut(); navigate({ to: "/" }); }} className="mt-6 text-xs font-semibold text-ink/45 underline">
            Sign out
          </button>
        </div>
      </section>
    );
  }

  const cards = patient.metrics.filter((m) => m.key !== "feeling");
  const feeling = patient.metrics.find((m) => m.key === "feeling")!;

  return (
    <section className="relative min-h-screen bg-mist">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-6"><SourceBadge source={source} error={error} /></div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-sage-deep uppercase">
              Good morning, {patient.firstName}
            </p>
            <h1 className="mt-2 font-display text-3xl font-medium leading-tight tracking-tight text-balance">
              {patient.headline}
            </h1>
            <p className="mt-1 text-sm text-ink/60 text-pretty">{patient.subhead}</p>
          </div>
          <div className="rounded-xl bg-amber/12 px-3 py-2 text-center backdrop-blur-md ring-1 ring-black/5">
            <span className="block font-display text-2xl font-semibold leading-none text-sage-deep">
              {patient.streak}
            </span>
            <span className="text-[10px] font-medium tracking-[0.15em] text-ink/50 uppercase">
              day streak
            </span>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cards.map((m, i) => (
            <div
              key={m.key}
              className="rounded-xl border border-white/60 bg-white/60 p-5 shadow-[var(--shadow-panel)] backdrop-blur-xl ring-1 ring-black/5 transition-transform hover:-translate-y-1"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold tracking-[0.12em] text-ink/50 uppercase">
                  {m.label}
                </span>
                <span className="font-display text-2xl font-semibold text-ink">
                  {formatValue(m)}
                  {m.key === "rhr" || m.key === "hrv" ? (
                    <span className="ml-1 text-xs font-medium text-ink/40">{m.unit}</span>
                  ) : null}
                </span>
              </div>
              <div className="relative mt-3 h-20">
                <TrendChart values={m.values} area={m.key === "hrv"} delay={i * 120} />
              </div>
              <p className="mt-3 text-sm text-ink/70 text-pretty">{m.patientNote}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-sage/20 bg-sage/10 p-5 backdrop-blur-xl ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold tracking-[0.12em] text-sage-deep uppercase">
                How do you feel?
              </span>
              <p className="mt-1 font-display text-xl font-medium text-ink">
                &ldquo;{patient.feelingQuote}&rdquo;
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Feeling ${n} of 5`}
                  onClick={() => rate(n)}
                  className="grid size-7 place-items-center"
                >
                  <span className={`size-3 rounded-full ${n <= score ? "bg-sage" : "bg-sage/30"}`} />
                </button>
              ))}
              <span className="ml-2 font-display text-lg font-semibold text-sage-deep">
                {score}/5
              </span>
            </div>
          </div>
          <div className="relative mt-4 h-16">
            <TrendChart values={feeling.values} tone="text-sage" area delay={480} />
          </div>
          <p className="mt-2 text-sm text-sage-deep/80 text-pretty">{feeling.patientNote}</p>
          {sent && <p className="mt-1 text-xs font-semibold text-sage-deep">{sent}</p>}
        </div>

        <button
          onClick={() => {
            signOut();
            navigate({ to: "/" });
          }}
          className="mt-8 text-xs font-semibold text-ink/45 underline-offset-2 hover:underline"
        >
          Sign out
        </button>
      </div>
    </section>
  );
}
