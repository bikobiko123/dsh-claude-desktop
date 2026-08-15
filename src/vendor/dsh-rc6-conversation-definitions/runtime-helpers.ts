import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'

// Runtime-value seam for the official rc.6 core bundle. This avoids importing
// its browser handoff artifact as ESM while keeping projection semantics official.
type RuntimeHelpers = {
  emptyAssistantBlock: (...args: any[]) => AssistantBlock
  toAssistantBlock: (...args: any[]) => AssistantBlock
  toAssistantBlocks: (...args: any[]) => AssistantBlock[]
  isTokenDelta: (...args: any[]) => any
  isAppendSurfaceEvent: (...args: any[]) => any
  isReplacementSurfaceEvent: (...args: any[]) => any
  contextProvenance: (...args: any[]) => any
  contextForm: (...args: any[]) => any
  displayFailureMessage: (...args: any[]) => any
}

let runtime: RuntimeHelpers | undefined
const NAMES = [
  'emptyAssistantBlock', 'toAssistantBlock', 'toAssistantBlocks', 'isTokenDelta',
  'isAppendSurfaceEvent', 'isReplacementSurfaceEvent', 'contextProvenance',
  'contextForm', 'displayFailureMessage',
] as const

export function configureConversationRuntimeHelpers(exports: Record<string, unknown>): void {
  for (const name of NAMES) {
    if (typeof exports[name] !== 'function') throw new TypeError(`DSH rc.6 runtime is missing conversation helper ${name}.`)
  }
  runtime = exports as unknown as RuntimeHelpers
}

function helper<Name extends keyof RuntimeHelpers>(name: Name): RuntimeHelpers[Name] {
  if (runtime === undefined) throw new Error('DSH rc.6 conversation runtime helpers are not configured.')
  return runtime[name]
}

export const emptyAssistantBlock: RuntimeHelpers['emptyAssistantBlock'] = (...args) => helper('emptyAssistantBlock')(...args)
export const toAssistantBlock: RuntimeHelpers['toAssistantBlock'] = (...args) => helper('toAssistantBlock')(...args)
export const toAssistantBlocks: RuntimeHelpers['toAssistantBlocks'] = (...args) => helper('toAssistantBlocks')(...args)
export const isTokenDelta: RuntimeHelpers['isTokenDelta'] = (...args) => helper('isTokenDelta')(...args)
export const isAppendSurfaceEvent: RuntimeHelpers['isAppendSurfaceEvent'] = (...args) => helper('isAppendSurfaceEvent')(...args)
export const isReplacementSurfaceEvent: RuntimeHelpers['isReplacementSurfaceEvent'] = (...args) => helper('isReplacementSurfaceEvent')(...args)
export const contextProvenance: RuntimeHelpers['contextProvenance'] = (...args) => helper('contextProvenance')(...args)
export const contextForm: RuntimeHelpers['contextForm'] = (...args) => helper('contextForm')(...args)
export const displayFailureMessage: RuntimeHelpers['displayFailureMessage'] = (...args) => helper('displayFailureMessage')(...args)
