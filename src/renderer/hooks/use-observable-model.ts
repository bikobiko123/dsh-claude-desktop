import { useSyncExternalStore } from 'react'
import type { ObservableModel } from '../../shared/agent-client'

/** Bind any Harness-compatible snapshot face without importing DSH UI packages. */
export function useObservableModel<T>(model: ObservableModel<T>): T {
  return useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
}

/**
 * Select a stable slice from an external model. The source snapshot remains the
 * authority; this hook performs no event folding or session projection.
 */
export function useObservableSelector<T, S>(
  model: ObservableModel<T>,
  selector: (snapshot: T) => S,
): S {
  return useSyncExternalStore(
    model.subscribe,
    () => selector(model.getSnapshot()),
    () => selector(model.getSnapshot()),
  )
}
