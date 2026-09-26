import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { LiveHeartRatePanel } from "@/components/LiveHeartRatePanel";
import { statusLabel, type Status } from "@/lib/health-data";
import { usePatients } from "@/lib/backend";

export const Route = createFileRoute("/patient/$id")({
  head: () => ({
    meta: [
      { title: "Patientöversikt — Pulsefold Clinical" },
      { name: "description", content: "Klinisk analys och vald akut livedata för patienten." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PatientDetail,
  notFoundComponent: PatientMissing,
});

const statusTone: Record<Status, string> = {
  risk: "bg-risk text-primary-foreground",
  watch: "bg-amber text-ink",
  stable: "bg-sage text-primary-foreground",
};

function PatientMissing() {
  return (
    <div className="grid min-h-screen place-items-center bg-mist px-6 text-center">
      <div>
        <h1 className="font-display text-2xl font-medium">Patienten hittades inte</h1>
        <Link to="/worklist" className="mt-3 inline-block text-sm font-semibold text-sage-deep underline">
          Tillbaka till patientlistan
        </Link>
      </div>
    </div>
  );
}

function PatientDetail() {
  const { id } = Route.useParams();
  const { patients } = usePatients();
  const patient = patients.find((candidate) => candidate.id === id);
  const [liveMetric, setLiveMetric] = useState(id === "person-1" ? "heart-rate" : "none");

  if (!patient) return <PatientMissing />;

  const diagnoses = patient.diagnoses ?? [patient.condition];
  const isArtur = patient.id === "person-1";

  return (
    <section className="min-h-screen bg-mist">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <Link to="/worklist" className="text-xs font-semibold text-ink/45 hover:text-ink">
          ← Patientlista
        </Link>

        <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-medium tracking-tight">{patient.name}</h1>
            <p className="mt-1 text-sm text-ink/55">
              {patient.age} år · {diagnoses.join(" · ")}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide uppercase ${statusTone[patient.status]}`}
          >
            {statusLabel[patient.status]}
          </span>
        </header>

        <section className="mt-7 min-h-56 rounded-2xl border border-white/70 bg-white/60 p-7 shadow-[var(--shadow-panel)] backdrop-blur-xl ring-1 ring-black/5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-sage" />
            <h2 className="text-xs font-semibold tracking-[0.16em] text-sage-deep uppercase">
              Vår analys av data
            </h2>
          </div>
          <p className="mt-5 max-w-3xl font-display text-2xl font-medium leading-snug text-ink">
            {patient.clinicalNote}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {patient.flags.map((flag) => (
              <div key={flag.title} className="rounded-xl bg-mist/70 px-4 py-3 ring-1 ring-black/5">
                <p className="text-sm font-semibold text-ink">{flag.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink/55">{flag.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-risk-deep uppercase">
                Akut livedata
              </p>
              <h2 className="mt-1 font-display text-2xl font-medium">Vald av ansvarig läkare</h2>
            </div>
            <label className="text-xs font-semibold text-ink/55">
              Visa signal
              <select
                value={liveMetric}
                onChange={(event) => setLiveMetric(event.target.value)}
                className="ml-3 rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-sm font-medium text-ink outline-none focus:border-sage"
              >
                <option value="none">Ingen livedata</option>
                <option value="heart-rate" disabled={!isArtur}>
                  Puls {isArtur ? "· Garmin Venu 2" : "· ingen källa"}
                </option>
              </select>
            </label>
          </div>

          {liveMetric === "heart-rate" && isArtur ? (
            <LiveHeartRatePanel />
          ) : (
            <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-ink/15 bg-white/30 px-6 text-center">
              <div>
                <p className="font-display text-xl font-medium text-ink/65">Ingen akut signal vald</p>
                <p className="mt-1 text-sm text-ink/45">Välj en tillgänglig livedatakälla ovan.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
