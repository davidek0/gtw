import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { TrendChart } from "@/components/TrendChart";
import { signIn } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pulsefold — Your week, gently held" },
      {
        name: "description",
        content:
          "Sign in to see how your sleep, heart rate and daily energy have been trending, in plain language.",
      },
      { property: "og:title", content: "Pulsefold — Your week, gently held" },
      {
        property: "og:description",
        content: "A calm view of your smartwatch data and how you've been feeling.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PatientSignIn,
});

function PatientSignIn() {
  const navigate = useNavigate();
  // Decorative curve for the preview card only (not patient data).
  const curve = [68, 67, 67.5, 66, 65.5, 66, 64.5, 64, 63.5, 63];

  function enter(email: string) {
    signIn("patient", email);
    navigate({ to: "/overview", replace: true });
  }

  return (
    <section className="relative overflow-hidden bg-mist">
      <div className="pointer-events-none absolute -top-24 -left-16 h-80 w-80 rounded-full bg-sage/10" />
      <div className="pointer-events-none absolute top-1/3 -right-10 h-72 w-72 rounded-full bg-amber/10" />
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-12 px-6 py-16 lg:flex-row lg:items-center">
        <div className="max-w-sm">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-sage" />
            <span className="text-xs font-semibold tracking-[0.2em] text-sage-deep uppercase">
              Pulsefold
            </span>
          </div>
          <h1 className="mt-6 font-display text-5xl font-medium leading-none tracking-tight text-balance">
            Your week,
            <br />
            gently held.
          </h1>
          <p className="mt-4 max-w-[38ch] text-base text-ink/70 text-pretty">
            Sign in to see how your body has been feeling and what to celebrate this week.
          </p>

          <form
            className="mt-8 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              enter(String(new FormData(e.currentTarget).get("email") ?? ""));
            }}
          >
            <input
              type="email"
              name="email"
              required
              placeholder="Email"
              aria-label="Email"
              className="rounded-xl border border-ink/10 bg-white/70 px-4 py-3 text-sm text-ink backdrop-blur-md ring-1 ring-black/5 outline-none focus:ring-sage"
            />
            <input
              type="password"
              placeholder="Password"
              aria-label="Password"
              className="rounded-xl border border-ink/10 bg-white/70 px-4 py-3 text-sm text-ink backdrop-blur-md ring-1 ring-black/5 outline-none focus:ring-sage"
            />
            <button
              type="submit"
              className="rounded-xl bg-sage-deep py-3 pr-3 pl-4 text-left text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              <span className="mr-2 inline-block align-middle">→</span> Continue
            </button>
          </form>

          <p className="mt-6 text-xs text-ink/45">
            Are you a clinician?{" "}
            <Link to="/clinician" className="font-semibold text-sage-deep underline-offset-2 hover:underline">
              Use the clinical portal
            </Link>
          </p>
        </div>

        <div className="relative hidden flex-1 lg:block">
          <div className="rounded-2xl border border-white/60 bg-white/55 p-6 shadow-[var(--shadow-glass)] backdrop-blur-xl ring-1 ring-black/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-[0.15em] text-ink/50 uppercase">
                Resting heart rate
              </span>
            </div>
            <div className="relative mt-4 h-28">
              <TrendChart values={curve} height={112} area />
            </div>
            <div className="mt-4 rounded-lg bg-sage/10 px-3 py-2 text-xs text-sage-deep">
              Your resting rate has settled a little lower this week — a quiet, positive sign.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
