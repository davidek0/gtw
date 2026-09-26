import { useEffect, useState, useSyncExternalStore } from "react";
import type { Patient } from "./health-data";
import { mockPatients } from "./mock-patients";

const KEY = "pulsefold.backend.url";
const EVT = "pulsefold-backend-change";

export function readBackendUrl(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function saveBackendUrl(url: string) {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean) window.localStorage.setItem(KEY, clean);
  else window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useBackendUrl() {
  return useSyncExternalStore(subscribe, readBackendUrl, () => "");
}

/** Fetch against the tunnel. Skips ngrok's browser warning page. */
export async function backendFetch(path: string, init?: RequestInit) {
  const base = readBackendUrl();
  if (!base) throw new Error("No backend address set");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Backend replied ${res.status}`);
  return res.json();
}

export type Source = "demo" | "backend" | "error";

/** Loads all patients from GET {url}/patients, falling back to demo records. */
export function usePatients() {
  const url = useBackendUrl();
  const [state, setState] = useState<{ patients: Patient[]; source: Source; error?: string | undefined }>({
    patients: mockPatients,
    source: "demo",
  });

  useEffect(() => {
    if (!url) {
      setState({ patients: mockPatients, source: "demo" });
      return;
    }
    let alive = true;
    backendFetch("/patients")
      .then((data: Patient[]) => {
        if (alive && Array.isArray(data)) setState({ patients: data, source: "backend" });
      })
      .catch((e: Error) => {
        if (alive) setState({ patients: mockPatients, source: "error", error: e.message });
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return state;
}

export async function sendFeeling(patientId: string, score: number) {
  return backendFetch(`/patients/${encodeURIComponent(patientId)}/feelings`, {
    method: "POST",
    body: JSON.stringify({ score, at: new Date().toISOString() }),
  });
}

export async function testBackend(url: string) {
  const res = await fetch(`${url.trim().replace(/\/+$/, "")}/patients`, {
    headers: { "ngrok-skip-browser-warning": "true" },
  });
  if (!res.ok) throw new Error(`Replied ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("/patients did not return a list");
  return data.length as number;
}
