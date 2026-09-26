import { createFileRoute, Link } from "@tanstack/react-router";
import { statusLabel, type Status } from "@/lib/health-data";
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

const tone: Record<Status, { card: string; badge: string }> = {
  risk: {
    card: "border-l-4 border-risk bg-risk-tint/70",
    badge: "bg-risk text-primary-foreground pulse-once",
  },
  watch: {
    card: "border-l-4 border-amber bg-amber/10",
    badge: "bg-amber text-ink pulse-once",
  },
  stable: {
    card: "border-l-4 border-sage bg-sage/10",
    badge: "bg-sage text-primary-foreground",
  },
};

function Worklist() {
  const { patients, source, error } = usePatients();

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
                    <p className="mt-0.5 text-xs text-ink/50">{p.age} år</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${t.badge}`}
                  >
                    {statusLabel[p.status]}
                  </span>
                </div>
                <div className="mt-5 border-t border-ink/10 pt-4">
                  <p className="text-[10px] font-semibold tracking-[0.14em] text-ink/40 uppercase">
                    Diagnoser
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink/75">
                    {(p.diagnoses ?? [p.condition]).join(" · ")}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

      </div>
    </section>
  );
}
