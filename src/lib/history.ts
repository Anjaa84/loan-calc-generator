// Tiny undo/redo history. Rapid edits with the same key (e.g. typing in one
// label) are merged into a single undo step.

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  lastKey?: string;
  lastAt?: number;
};

export const LIMIT = 50;
export const MERGE_MS = 600;

export const initHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function commit<T>(h: History<T>, next: T, key?: string, now = Date.now()): History<T> {
  if (next === h.present) return h;
  const merge = key !== undefined && key === h.lastKey && h.lastAt !== undefined && now - h.lastAt < MERGE_MS;
  return {
    past: merge ? h.past : [...h.past, h.present].slice(-LIMIT),
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
