import { describe, expect, it } from 'vitest'
import { registerConversationDefinitions } from '../../vendor/dsh-rc6-conversation-definitions/register.js'

describe('rc.6 local conversation definition fork', () => {
  it('registers only event definitions, fallback, and chat view in pinned order', () => {
    const calls: string[] = []
    const ctx = {
      conversationEvents: {
        register(definition: { kind: string }) { calls.push(`event:${definition.kind}`) },
        registerFallback(definition: { kind: string }) { calls.push(`fallback:${definition.kind}`) },
      },
      conversationViews: {
        register(definition: { target: string }) { calls.push(`view:${definition.target}`) },
      },
    }
    registerConversationDefinitions(ctx as any)
    expect(calls).toEqual([
      'event:inbox-next-turn', 'event:inbox-next-step', 'event:input-message',
      'event:assistant-step', 'event:tool-call', 'event:command', 'event:compaction',
      'event:model-retry', 'event:turn-error', 'event:turn-max-tokens', 'event:turn-tail',
      'fallback:unknown-surface', 'view:chat',
    ])
  })

  it('contains no presentation service requirement', () => {
    const ctx = {
      conversationEvents: { register() {}, registerFallback() {} },
      conversationViews: { register() {} },
      get slots(): never { throw new Error('slots must not be accessed') },
      get locale(): never { throw new Error('locale must not be accessed') },
      get theme(): never { throw new Error('theme must not be accessed') },
      get layout(): never { throw new Error('layout must not be accessed') },
    }
    expect(() => registerConversationDefinitions(ctx as any)).not.toThrow()
  })
})
