import { useEffect, useRef, useState } from "react";
import { Mic, PhoneOff } from "lucide-react";
import type { PipecatClient, TranscriptData } from "@pipecat-ai/client-js";
import { saveVoiceSummary } from "@/lib/voice-summary";

type CallState =
  | "idle"
  | "connecting"
  | "listening"
  | "patient-speaking"
  | "ai-speaking"
  | "summarizing"
  | "finished"
  | "error";

const stateCopy: Record<CallState, string> = {
  idle: "Starta när du är redo",
  connecting: "Ansluter mikrofonen…",
  listening: "AI:n lyssnar",
  "patient-speaking": "Du pratar",
  "ai-speaking": "AI:n svarar",
  summarizing: "AI:n sammanfattar samtalet…",
  finished: "Sammanfattningen är klar",
  error: "Samtalet kunde inte startas",
};

export function VoiceCheckinCard({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}) {
  const clientRef = useRef<PipecatClient | null>(null);
  const resultTokenRef = useRef<string | null>(null);
  const collectingRef = useRef<string | null>(null);
  const failedRef = useRef(false);
  const mountedRef = useRef(true);
  const [state, setState] = useState<CallState>("idle");
  const [lastHeard, setLastHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      failedRef.current = true;
      const client = clientRef.current;
      clientRef.current = null;
      if (client?.connected) void client.disconnect();
    };
  }, []);

  async function startCall() {
    if (clientRef.current) return;
    setState("connecting");
    setError(null);
    failedRef.current = false;
    setLastHeard("");
    setLastReply("");
    const resultToken = crypto.randomUUID();
    resultTokenRef.current = resultToken;

    let client: PipecatClient | null = null;
    try {
      const [{ PipecatClient }, { SmallWebRTCTransport }] = await Promise.all([
        import("@pipecat-ai/client-js"),
        import("@pipecat-ai/small-webrtc-transport"),
      ]);
      client = new PipecatClient({
        transport: new SmallWebRTCTransport(),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onConnected: () => setState("listening"),
          onDisconnected: () => {
            clientRef.current = null;
            if (!failedRef.current) void collectSummary(resultToken);
          },
          onUserStartedSpeaking: () => setState("patient-speaking"),
          onUserStoppedSpeaking: () => setState("listening"),
          onBotStartedSpeaking: () => setState("ai-speaking"),
          onBotStoppedSpeaking: () => setState("listening"),
          onUserTranscript: (data: TranscriptData) => {
            if (data.final) setLastHeard(data.text);
          },
          onBotOutput: (data) => {
            if (data.text.trim()) setLastReply(data.text.trim());
          },
          onDeviceError: () =>
            fail("Tillåt mikrofonen i webbläsaren och försök igen."),
          onError: () => fail("Voice-servern svarade med ett fel."),
        },
      });
      clientRef.current = client;
      await client.startBotAndConnect({
        endpoint: `${voiceServerUrl()}/start`,
        requestData: {
          transport: "webrtc",
          enableDefaultIceServers: true,
          body: { subjectId: patientId, patientName, resultToken },
        },
      });
    } catch (cause) {
      fail(
        cause instanceof Error
          ? cause.message
          : "Kunde inte ansluta till voice-servern.",
      );
      clientRef.current = null;
      if (client?.connected) await client.disconnect();
    }
  }

  async function stopCall() {
    const client = clientRef.current;
    if (!client) return;
    setState("summarizing");
    await client.disconnect();
    clientRef.current = null;
    const resultToken = resultTokenRef.current;
    if (resultToken && !failedRef.current) void collectSummary(resultToken);
  }

  function fail(message: string) {
    failedRef.current = true;
    const client = clientRef.current;
    clientRef.current = null;
    if (client?.connected) void client.disconnect();
    setError(message);
    setState("error");
  }

  async function collectSummary(resultToken: string) {
    if (collectingRef.current === resultToken) return;
    collectingRef.current = resultToken;
    if (mountedRef.current) setState("summarizing");

    try {
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await delay(attempt === 0 ? 300 : 1_000);
        const response = await fetch(
          `${voiceServerUrl()}/api/checkin-results/${resultToken}`,
          { cache: "no-store" },
        );
        if (response.status === 404) continue;
        if (!response.ok) throw new Error(`Voice-servern svarade ${response.status}`);

        const result = (await response.json()) as {
          ready: boolean;
          summary?: string;
          status?: string | null;
          endedAt?: string;
          error?: string;
        };
        if (!result.ready) continue;
        if (!result.summary) {
          throw new Error(
            result.error || "AI:n kunde inte skapa någon sammanfattning.",
          );
        }

        saveVoiceSummary(patientId, {
          summary: result.summary,
          status: result.status ?? null,
          endedAt: result.endedAt || new Date().toISOString(),
        });
        if (mountedRef.current) {
          setError(null);
          setState("finished");
        }
        return;
      }
      throw new Error("Sammanfattningen tog för lång tid. Försök igen.");
    } catch (cause) {
      if (mountedRef.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Kunde inte hämta AI-sammanfattningen.",
        );
        setState("error");
      }
    } finally {
      if (collectingRef.current === resultToken) collectingRef.current = null;
    }
  }

  const active = ["listening", "patient-speaking", "ai-speaking"].includes(
    state,
  );

  return (
    <section className="mt-8 rounded-2xl border border-sage/25 bg-sage/10 p-6 shadow-[var(--shadow-panel)] backdrop-blur-xl ring-1 ring-black/5">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-sage-deep uppercase">
            Daglig incheckning
          </p>
          <h2 className="mt-1 font-display text-2xl font-medium text-ink">
            Prata med din AI
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/60">
            Berätta hur du mår. Efter samtalet skriver AI:n en kort
            sammanfattning som visas under Kundens mående. Den sparas bara i
            den här webbläsaren.
          </p>
        </div>
        <button
          type="button"
          onClick={active ? stopCall : startCall}
          disabled={state === "connecting" || state === "summarizing"}
          className={`inline-flex min-w-40 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
            active
              ? "bg-risk text-primary-foreground hover:bg-risk-deep"
              : "bg-sage-deep text-white hover:bg-sage"
          }`}
        >
          {active ? (
            <PhoneOff className="size-4" />
          ) : (
            <Mic className="size-4" />
          )}
          {state === "connecting"
            ? "Ansluter…"
            : active
              ? "Avsluta samtalet"
              : "Starta samtal"}
        </button>
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-xl bg-white/50 px-4 py-3 ring-1 ring-black/5">
        <span
          className={`size-2.5 rounded-full ${active ? "animate-pulse bg-sage" : state === "error" ? "bg-risk" : "bg-ink/20"}`}
        />
        <p className="text-sm font-semibold text-ink/70">{stateCopy[state]}</p>
      </div>

      {(lastHeard || lastReply) && (
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-white/40 p-4">
            <p className="text-[10px] font-semibold tracking-wider text-ink/40 uppercase">
              Senast uppfattat
            </p>
            <p className="mt-1 text-ink/70">{lastHeard || "—"}</p>
          </div>
          <div className="rounded-xl bg-white/40 p-4">
            <p className="text-[10px] font-semibold tracking-wider text-ink/40 uppercase">
              AI:n
            </p>
            <p className="mt-1 text-ink/70">{lastReply || "—"}</p>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-3 text-sm font-semibold text-risk-deep">{error}</p>
      )}
    </section>
  );
}

function voiceServerUrl(): string {
  const configured = import.meta.env.VITE_VOICE_SERVER_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${window.location.protocol}//${window.location.hostname}:7860`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
