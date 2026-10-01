"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  getSessionRaw,
  parseSession,
  subscribeSession,
} from "@/lib/services/session-store";
import type { Session } from "@/lib/services/types";

const subscribeNoop = () => () => {};

/**
 * Reads the mock session. `ready` is false during SSR/hydration so route
 * guards never redirect before localStorage has been read.
 */
export function useSession(): { session: Session | null; ready: boolean } {
  const raw = useSyncExternalStore(subscribeSession, getSessionRaw, () => null);
  const ready = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const session = useMemo(() => parseSession(raw), [raw]);
  return { session, ready };
}
