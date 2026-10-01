"use client";

import { useEffect, useState } from "react";

interface Settled<T> {
  key: string;
  data?: T;
  error?: Error;
}

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * Minimal async data hook for the service layer. `key` identifies the request
 * (e.g. filter values); changing it, or calling `reload`, refetches. Loading is
 * derived (no synchronous setState in the effect).
 */
export function useAsync<T>(fn: () => Promise<T>, key: string): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const requestKey = `${key}#${nonce}`;

  useEffect(() => {
    let cancelled = false;
    fn().then(
      (data) => {
        if (!cancelled) setSettled({ key: requestKey, data });
      },
      (err: unknown) => {
        if (!cancelled)
          setSettled({
            key: requestKey,
            error: err instanceof Error ? err : new Error(String(err)),
          });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const current = settled?.key === requestKey ? settled : null;
  return {
    data: current?.data ?? settled?.data,
    error: current?.error,
    loading: current === null,
    reload: () => setNonce((n) => n + 1),
  };
}
