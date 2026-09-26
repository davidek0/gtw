import { useSyncExternalStore } from "react";
import { voiceServerUrl } from "./voice-server";

export type CheckinStatus = "completed" | "missed";

export type LocalVoiceSummary = {
  summary: string;
  status: CheckinStatus | null;
  endedAt: string;
};

/** Latest check-in per patient id. */
export type VoiceSummaries = Readonly<Record<string, LocalVoiceSummary>>;

const KEY_PREFIX = "pulsefold.voice-summary.";
const CHANGE_EVENT = "pulsefold:voice-summary";
const POLL_MS = 3_000;
const STATUSES: readonly CheckinStatus[] = ["completed", "missed"];
const EMPTY: VoiceSummaries = {};

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatCheckinTime(endedAt: string): string {
  const date = new Date(endedAt);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

/** Validates a check-in result from the voice server or localStorage. */
export function parseVoiceSummary(value: unknown): LocalVoiceSummary | null {
  if (!value || typeof value !== "object") return null;
  const { summary, status, endedAt } = value as {
    summary?: unknown;
    status?: unknown;
    endedAt?: unknown;
  };
  if (typeof summary !== "string" || !summary.trim()) return null;
  return {
    summary,
    status: STATUSES.find((known) => known === status) ?? null,
    endedAt: typeof endedAt === "string" ? endedAt : "",
  };
}

export function saveVoiceSummary(
  patientId: string,
  summary: LocalVoiceSummary,
): void {
  window.localStorage.setItem(storageKey(patientId), JSON.stringify(summary));
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, { detail: { patientId } }),
  );
}

/** All patients' latest check-ins: voice server merged with localStorage, newest wins. */
export function useVoiceSummaries(): VoiceSummaries {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export function useVoiceSummary(patientId: string): LocalVoiceSummary | null {
  return useVoiceSummaries()[patientId] ?? null;
}

// One module-level store polls GET /api/latest-checkins for every subscriber.
let remote: Record<string, LocalVoiceSummary> = {};
let snapshot: VoiceSummaries = EMPTY;
let snapshotJson = "{}";
let initialized = false;
let polling = false;
let stopStore: (() => void) | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): VoiceSummaries {
  if (!initialized) {
    initialized = true;
    rebuild();
  }
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startStore();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopStore?.();
      stopStore = null;
    }
  };
}

function startStore(): void {
  const poll = () => void pollRemote();
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) update();
  };
  const interval = window.setInterval(poll, POLL_MS);
  window.addEventListener("focus", poll);
  window.addEventListener(CHANGE_EVENT, update);
  window.addEventListener("storage", onStorage);
  stopStore = () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", poll);
    window.removeEventListener(CHANGE_EVENT, update);
    window.removeEventListener("storage", onStorage);
  };
  initialized = true;
  update();
  poll();
}

async function pollRemote(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch(`${voiceServerUrl()}/api/latest-checkins`, {
      cache: "no-store",
      signal: AbortSignal.timeout(POLL_MS),
    });
    if (!response.ok) return;
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const next: Record<string, LocalVoiceSummary> = {};
    for (const [patientId, value] of Object.entries(data)) {
      const parsed = parseVoiceSummary(value);
      if (parsed) next[patientId] = parsed;
    }
    remote = next;
    update();
  } catch {
    // Voice server unreachable: keep showing localStorage and the last poll.
  } finally {
    polling = false;
  }
}

function update(): void {
  if (rebuild()) listeners.forEach((listener) => listener());
}

/** Recomputes the merged snapshot; returns whether it changed. */
function rebuild(): boolean {
  const merged: Record<string, LocalVoiceSummary> = {};
  for (const source of [readLocalSummaries(), remote]) {
    for (const [patientId, entry] of Object.entries(source)) {
      const current = merged[patientId];
      if (!current || timeOf(entry) >= timeOf(current)) {
        merged[patientId] = entry;
      }
    }
  }
  const json = JSON.stringify(merged);
  if (json === snapshotJson) return false;
  snapshot = merged;
  snapshotJson = json;
  return true;
}

function readLocalSummaries(): Record<string, LocalVoiceSummary> {
  const result: Record<string, LocalVoiceSummary> = {};
  if (typeof window === "undefined") return result;
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const parsed = parseVoiceSummary(safeJson(storage.getItem(key)));
      if (parsed) result[key.slice(KEY_PREFIX.length)] = parsed;
    }
  } catch {
    // localStorage unavailable (private mode, blocked storage).
  }
  return result;
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function timeOf(entry: LocalVoiceSummary): number {
  const time = Date.parse(entry.endedAt);
  return Number.isNaN(time) ? 0 : time;
}

function storageKey(patientId: string): string {
  return `${KEY_PREFIX}${patientId}`;
}
