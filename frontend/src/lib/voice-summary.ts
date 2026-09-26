import { useEffect, useState } from "react";

export type LocalVoiceSummary = {
  summary: string;
  status: string | null;
  endedAt: string;
};

const KEY_PREFIX = "pulsefold.voice-summary.en.";
const CHANGE_EVENT = "pulsefold:voice-summary";

export function saveVoiceSummary(
  patientId: string,
  summary: LocalVoiceSummary,
): void {
  window.localStorage.setItem(storageKey(patientId), JSON.stringify(summary));
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, { detail: { patientId } }),
  );
}

export function readVoiceSummary(patientId: string): LocalVoiceSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(storageKey(patientId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<LocalVoiceSummary>;
    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) return null;
    return {
      summary: parsed.summary,
      status: typeof parsed.status === "string" ? parsed.status : null,
      endedAt:
        typeof parsed.endedAt === "string"
          ? parsed.endedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function useVoiceSummary(patientId: string): LocalVoiceSummary | null {
  const [summary, setSummary] = useState<LocalVoiceSummary | null>(null);

  useEffect(() => {
    const refresh = () => setSummary(readVoiceSummary(patientId));
    const onCustomChange = (event: Event) => {
      const changedPatient = (event as CustomEvent<{ patientId?: string }>).detail
        ?.patientId;
      if (changedPatient === patientId) refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey(patientId)) refresh();
    };

    refresh();
    window.addEventListener(CHANGE_EVENT, onCustomChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onCustomChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [patientId]);

  return summary;
}

function storageKey(patientId: string): string {
  return `${KEY_PREFIX}${patientId}`;
}
