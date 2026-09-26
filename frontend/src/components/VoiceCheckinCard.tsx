import { useEffect, useRef, useState } from "react";
import { Mic, PhoneOff } from "lucide-react";
import type { PipecatClient, TranscriptData } from "@pipecat-ai/client-js";
import { voiceServerUrl } from "@/lib/voice-server";
import {
  parseVoiceSummary,
  saveVoiceSummary,
  type CheckinStatus,
} from "@/lib/voice-summary";

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
  idle: "Start when you are ready",
  connecting: "Connecting your microphone…",
  listening: "The AI is listening",
  "patient-speaking": "You are speaking",
  "ai-speaking": "The AI is responding",
  summarizing: "The AI is summarizing the conversation…",
  finished: "Your summary is ready",
  error: "Something went wrong with the conversation",
};

const finishedCopy: Record<CheckinStatus, string> = {
  completed: "Your summary is ready",
  missed: "No answer was detected",
};

const LIVE_STATES: readonly CallState[] = [
  "connecting",
  "listening",
  "patient-speaking",
  "ai-speaking",
];

export function VoiceCheckinCard({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}) {
  const clientRef = useRef<PipecatClient | null>(null);
  const botAudioRef = useRef<HTMLAudioElement | null>(null);
  const resultTokenRef = useRef<string | null>(null);
  const collectingRef = useRef<string | null>(null);
  const failedRef = useRef(false);
  const mountedRef = useRef(true);
  const [state, setState] = useState<CallState>("idle");
  const [lastHeard, setLastHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [outcome, setOutcome] = useState<CheckinStatus | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      failedRef.current = true;
      const client = clientRef.current;
      clientRef.current = null;
      if (client?.connected) void client.disconnect();
      if (botAudioRef.current) botAudioRef.current.srcObject = null;
    };
  }, []);

  async function startCall() {
    if (clientRef.current) return;
    setState("connecting");
    setError(null);
    setOutcome(null);
    failedRef.current = false;
    setLastHeard("");
    setLastReply("");
    setPlaybackBlocked(false);
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
          // The greeting may already be playing; only leave "connecting".
          onConnected: () =>
            setState((current) =>
              current === "connecting" ? "listening" : current,
            ),
          onDisconnected: () => {
            clientRef.current = null;
            if (botAudioRef.current) botAudioRef.current.srcObject = null;
            if (!failedRef.current) void collectSummary(resultToken);
          },
          onUserStartedSpeaking: () => setLiveState("patient-speaking"),
          onUserStoppedSpeaking: () => setLiveState("listening"),
          onBotStartedSpeaking: () => setLiveState("ai-speaking"),
          onBotStoppedSpeaking: () => setLiveState("listening"),
          // The patient's own mic track also arrives here; only play the bot.
          onTrackStarted: (track, participant) => {
            if (track.kind === "audio" && !participant?.local)
              void playBotAudio(track);
          },
          onTrackStopped: (track) => {
            const audio = botAudioRef.current;
            const stream = audio?.srcObject;
            if (
              audio &&
              stream instanceof MediaStream &&
              stream.getTracks().includes(track)
            ) {
              audio.srcObject = null;
            }
          },
          onUserTranscript: (data: TranscriptData) => {
            if (data.final) setLastHeard(data.text);
          },
          onBotOutput: (data) => {
            if (data.text.trim()) setLastReply(data.text.trim());
          },
          onDeviceError: () =>
            fail("Allow microphone access in your browser and try again."),
          onError: () => fail("The voice server returned an error."),
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
          : "Could not connect to the voice server.",
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

  /** Speaking events must not override summarizing/finished/error. */
  function setLiveState(next: CallState) {
    setState((current) => (LIVE_STATES.includes(current) ? next : current));
  }

  function fail(message: string) {
    failedRef.current = true;
    const client = clientRef.current;
    clientRef.current = null;
    if (client?.connected) void client.disconnect();
    setError(message);
    setState("error");
  }

  async function playBotAudio(track?: MediaStreamTrack) {
    const audio = botAudioRef.current;
    if (!audio) return;
    if (track) audio.srcObject = new MediaStream([track]);
    audio.muted = false;
    audio.volume = 1;
    try {
      await audio.play();
      if (mountedRef.current) setPlaybackBlocked(false);
    } catch {
      if (mountedRef.current) setPlaybackBlocked(true);
    }
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
        if (!response.ok)
          throw new Error(`The voice server returned ${response.status}`);

        const result = (await response.json()) as {
          ready: boolean;
          error?: string;
        };
        if (!result.ready) continue;
        const checkin = parseVoiceSummary(result);
        if (!checkin) {
          throw new Error(result.error || "The AI could not create a summary.");
        }

        saveVoiceSummary(patientId, {
          ...checkin,
          endedAt: checkin.endedAt || new Date().toISOString(),
        });
        if (mountedRef.current) {
          setError(null);
          setOutcome(checkin.status ?? "completed");
          setState("finished");
        }
        return;
      }
      throw new Error("The summary took too long. Please try again.");
    } catch (cause) {
      if (mountedRef.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not retrieve the AI summary.",
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
      <audio ref={botAudioRef} autoPlay playsInline className="hidden" />
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-sage-deep uppercase">
            Daily check-in
          </p>
          <h2 className="mt-1 font-display text-2xl font-medium text-ink">
            Talk to your AI
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/60">
            Tell us how you are feeling. After the conversation, the AI writes a
            short summary that your care team can see.
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
            ? "Connecting…"
            : active
              ? "End conversation"
              : "Start conversation"}
        </button>
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-xl bg-white/50 px-4 py-3 ring-1 ring-black/5">
        <span
          className={`size-2.5 rounded-full ${
            active
              ? "animate-pulse bg-sage"
              : state === "error"
                ? "bg-risk"
                : state === "finished"
                  ? outcome === "missed"
                    ? "bg-amber"
                    : "bg-sage"
                  : "bg-ink/20"
          }`}
        />
        <p className="text-sm font-semibold text-ink/70">
          {state === "finished" && outcome
            ? finishedCopy[outcome]
            : stateCopy[state]}
        </p>
      </div>

      {(lastHeard || lastReply) && (
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-white/40 p-4">
            <p className="text-[10px] font-semibold tracking-wider text-ink/40 uppercase">
              Last heard
            </p>
            <p className="mt-1 text-ink/70">{lastHeard || "—"}</p>
          </div>
          <div className="rounded-xl bg-white/40 p-4">
            <p className="text-[10px] font-semibold tracking-wider text-ink/40 uppercase">
              AI
            </p>
            <p className="mt-1 text-ink/70">{lastReply || "—"}</p>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-3 text-sm font-semibold text-risk-deep">{error}</p>
      )}
      {playbackBlocked && (
        <button
          type="button"
          onClick={() => void playBotAudio()}
          className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
        >
          Enable AI audio
        </button>
      )}
    </section>
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
