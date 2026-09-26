import { createFileRoute } from "@tanstack/react-router";
import { usePatients } from "@/lib/backend";
import { PatientMetricGrid } from "@/components/PatientMetricGrid";
import { SourceBadge } from "@/components/SourceBadge";

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
  const { patients, source, error } = usePatients();
  const patient = patients[0];

  if (!patient) {
    return (
      <section className="grid min-h-screen place-items-center bg-mist px-6 text-center">
        <div>
          <SourceBadge source={source} error={error} />
          <p className="mt-4 text-sm text-ink/70">
            {source === "backend" ? "No health data found for your account yet." : "Connect to your laptop to see your data."}
          </p>
        </div>
      </section>
    );
  }

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

        <PatientMetricGrid patient={patient} />
      </div>
    </section>
  );
}
