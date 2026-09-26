import { useEffect, useState } from "react";

export type Role = "patient" | "clinician";

const KEY = "pulsefold.demo.session";

const USER_KEY = "pulsefold.demo.user";

// TODO: replace with real auth (e.g. POST /login on your backend returning a token).
// Right now any password works; we only remember the role and the typed email/username.
export function signIn(role: Role, user = "") {
  window.localStorage.setItem(KEY, role);
  window.localStorage.setItem(USER_KEY, user.trim().toLowerCase());
}

export function readUser(): string {
  return typeof window === "undefined" ? "" : (window.localStorage.getItem(USER_KEY) ?? "");
}

export function signOut() {
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function readRole(): Role | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(KEY);
  return v === "patient" || v === "clinician" ? v : null;
}

/** null while hydrating, then the stored role (or null when signed out). */
export function useRole(): { role: Role | null; ready: boolean } {
  const [role, setRole] = useState<Role | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setRole(readRole());
    setReady(true);
  }, []);
  return { role, ready };
}
