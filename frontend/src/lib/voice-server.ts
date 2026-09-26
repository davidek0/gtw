/** Base URL of the Pipecat voice server (same host, port 7860, unless configured). */
export function voiceServerUrl(): string {
  const configured = (
    import.meta.env["VITE_VOICE_SERVER_URL"] as string | undefined
  )?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${window.location.protocol}//${window.location.hostname}:7860`;
}
