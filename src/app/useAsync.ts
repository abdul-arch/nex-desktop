// Chargement asynchrone minimal : cache memoire borne, requetes identiques mutualisees,
// resultats obsoletes ignores (changement de cle pendant le chargement).
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_ENTRIES = 60;
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function remember(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function invalidate(prefix: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Relance ; `fn` peut differer (ex. actualisation forcee). */
  reload: (fn?: () => Promise<T>) => void;
}

export function useAsync<T>(key: string | null, fn: () => Promise<T>, ttlMs = 60_000): AsyncState<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: unknown; loading: boolean }>(() => {
    const hit = key ? cache.get(key) : undefined;
    return { key, data: (hit?.value as T) ?? null, error: null, loading: !!key && !hit };
  });
  const currentKey = useRef(key);
  currentKey.current = key;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(
    (force: boolean, override?: () => Promise<T>) => {
      if (!key) return;
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < ttlMs) {
        setState({ key, data: hit.value as T, error: null, loading: false });
        return;
      }
      setState((s) => ({ key, data: s.key === key ? s.data : (hit?.value as T) ?? null, error: null, loading: true }));
      let p = force ? undefined : (inflight.get(key) as Promise<T> | undefined);
      if (!p) {
        p = (override ?? fnRef.current)();
        inflight.set(key, p);
        p.finally(() => inflight.get(key) === p && inflight.delete(key)).catch(() => {});
      }
      p.then(
        (value) => {
          remember(key, value);
          if (currentKey.current === key) setState({ key, data: value, error: null, loading: false });
        },
        (error) => {
          if (currentKey.current === key) setState((s) => ({ ...s, key, error, loading: false }));
        },
      );
    },
    [key, ttlMs],
  );

  useEffect(() => {
    run(false);
  }, [run]);

  const reload = useCallback((override?: () => Promise<T>) => run(true, override), [run]);
  const sameKey = state.key === key;
  return {
    data: sameKey ? state.data : null,
    error: sameKey ? state.error : null,
    loading: sameKey ? state.loading : !!key,
    reload,
  };
}
