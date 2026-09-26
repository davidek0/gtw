import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { readBackendUrl, saveBackendUrl, testBackend } from "@/lib/backend";

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
      { title: "Connect your laptop — Pulsefold" },
      { name: "description", content: "Point Pulsefold at your own backend through a secure tunnel address." },
      { property: "og:title", content: "Connect your laptop — Pulsefold" },
      { property: "og:description", content: "Point Pulsefold at your own backend through a secure tunnel address." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Connect,
});

function Connect() {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setUrl(readBackendUrl()), []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      saveBackendUrl("");
      setMsg({ ok: true, text: "Cleared. The app now uses sample data." });
      return;
    }
    if (!url.trim().startsWith("https://")) {
      setMsg({ ok: false, text: "Use the https:// address your tunnel gives you." });
      return;
    }
    setBusy(true);
    try {
      const n = await testBackend(url);
      saveBackendUrl(url);
      setMsg({ ok: true, text: `Connected — found ${n} patients.` });
    } catch (err) {
      setMsg({ ok: false, text: `Couldn't connect: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="min-h-screen bg-mist">
      <div className="mx-auto max-w-xl px-6 py-14">
        <Link to="/" className="text-sm font-semibold text-sage-deep underline">← Back</Link>
        <h1 className="mt-4 font-display text-3xl font-medium tracking-tight">Connect your laptop</h1>
        <p className="mt-2 text-sm text-ink/70">
          Paste the secure address from ngrok or Cloudflare Tunnel. Leave empty to use sample data.
        </p>
        <form onSubmit={save} className="mt-6 space-y-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://abc123.ngrok-free.app"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full rounded-xl border border-ink/10 bg-white/70 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-sage"
          />
          <button
            disabled={busy}
            className="w-full rounded-xl bg-sage-deep px-4 py-3 text-sm font-semibold text-mist disabled:opacity-60"
          >
            {busy ? "Testing…" : "Save & test"}
          </button>
        </form>
        {msg && (
          <p className={`mt-3 text-sm font-medium ${msg.ok ? "text-sage-deep" : "text-risk-deep"}`}>{msg.text}</p>
        )}

        <div className="mt-10 rounded-xl bg-white/60 p-5 text-sm text-ink/70 ring-1 ring-black/5">
          <h2 className="font-display text-lg font-medium text-ink">What your program needs</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><code>GET /patients</code> → list of patients (same shape as the sample data)</li>
            <li><code>POST /patients/:id/feelings</code> ← {"{"} score, at {"}"}</li>
            <li>Allow requests from other sites (CORS), including the <code>ngrok-skip-browser-warning</code> header</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
