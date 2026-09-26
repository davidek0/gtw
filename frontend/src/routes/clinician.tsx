import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { signIn } from "@/lib/session";

export const Route = createFileRoute("/clinician")({
  head: () => ({
    meta: [
      { title: "Clinical portal — Pulsefold" },
      {
        name: "description",
        content:
          "Restricted clinician sign-in for reviewing patient vitals, trend deviations and triage alerts.",
      },
      { property: "og:title", content: "Clinical portal — Pulsefold" },
      {
        property: "og:description",
        content: "Sign in to review patient telemetry and triage alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ClinicianSignIn,
});

function ClinicianSignIn() {
  const navigate = useNavigate();

  return (
    <section className="relative overflow-hidden bg-ink">
      <div className="pointer-events-none absolute top-0 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sage/15" />
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-20">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-7 backdrop-blur-xl ring-1 ring-black/5">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-amber" />
            <span className="text-xs font-semibold tracking-[0.2em] text-white/70 uppercase">
              Pulsefold · Clinical
            </span>
          </div>
          <h1 className="mt-5 font-display text-3xl font-medium leading-tight tracking-tight text-white text-balance">
            Clinician worklist
          </h1>
          <p className="mt-2 text-sm text-white/55 text-pretty">
            Restricted access. Sign in to review patient vitals and triage alerts.
          </p>
          <form
            className="mt-6 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              signIn("clinician");
              navigate({ to: "/worklist" });
            }}
          >
            <input
              placeholder="Username"
              aria-label="Clinician ID"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-amber"
            />
            <input
              type="password"
              placeholder="Password"
              aria-label="Passphrase"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-amber"
            />
            <button
              type="submit"
              className="rounded-xl bg-amber py-3 pr-3 pl-4 text-left text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5"
            >
              <span className="mr-2 inline-block align-middle">→</span> Access worklist
            </button>
          </form>
          <p className="mt-5 text-xs text-white/40">
            Patients sign in from the{" "}
            <Link to="/" className="font-semibold text-white/70 underline-offset-2 hover:underline">
              main portal
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
