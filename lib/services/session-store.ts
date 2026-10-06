import type { Session } from "./types";

/**
 * Mock session persistence (localStorage). Exposes a subscribe/getSnapshot
 * pair so React can read it with useSyncExternalStore. Replace with real
 * auth state (our own sign-in) in Phase 5.
 */
const KEY = "nsw27.mock.session.v1";
const listeners = new Set<() => void>();

export function getSessionRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  return parseSession(getSessionRaw());
}

export function setSession(session: Session | null) {
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: session lasts only until reload */
  }
  listeners.forEach((l) => l());
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
