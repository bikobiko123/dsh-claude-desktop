import type { ObservableModel } from './agent-client.js'

/** Small immutable snapshot publisher for adapter-owned renderer models. */
export interface WritableObservableModel<T> extends ObservableModel<T> {
  setSnapshot(next: T): void
}

export function createObservableModel<T>(initial: T): WritableObservableModel<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSnapshot(next) {
      if (Object.is(snapshot, next)) return
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}
