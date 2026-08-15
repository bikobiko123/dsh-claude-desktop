import { describe, expect, it, vi } from 'vitest'
import type {
  ConversationSnapshot,
  ISessions,
  IWorkspaces,
  SessionFace,
  SessionListState,
  WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createRc6AgentClient } from './agent-client.js'
import { mapAgentSnapshot, mapConversationSnapshot } from './mappers.js'

class Observable<T> {
  listeners = new Set<() => void>()
  constructor(public value: T) {}
  getSnapshot = (): T => this.value
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  set(value: T): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }
}

function workspaceState(): WorkspaceListState {
  return {
    items: [{
      workspaceId: 'w1' as never,
      path: '/tmp/project',
      title: 'Project',
      sessionIds: ['s1' as never, 's2' as never],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: 'w1' as never,
  }
}

function sessionState(current: string | undefined = 's1'): SessionListState {
  return {
    ids: ['s1' as never, 's2' as never],
    byId: {
      ['s1' as never]: { id: 's1' as never, displayTitle: 'First', running: true, blank: false, updatedAt: 1000 },
      ['s2' as never]: { id: 's2' as never, displayTitle: 'Second', running: false, blank: false, updatedAt: 2000 },
    },
    current: current as never,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function conversation(sessionId = 's1', pending: ConversationSnapshot['pending'] = []): ConversationSnapshot {
  return {
    sessionId: sessionId as never,
    views: {} as never,
    chat: {} as never,
    nodes: [
      { kind: 'user', seq: 1, time: 1000, content: [{ type: 'text', text: 'Hello' }], source: {} },
      { kind: 'assistant', seq: 2, time: 2000, turn: 1, step: 1, blocks: [
        { kind: 'text', text: 'Hi' },
        { kind: 'reasoning', text: 'hidden' },
        { kind: 'tool-call', callId: 'c1', name: 'read', argsRaw: '{"file":"a"}' },
      ] },
      { kind: 'tool-result', seq: 3, time: 3000, callId: 'c1', call: { name: 'read', argsRaw: '{}' }, callTime: 2500,
        content: [{ type: 'text', text: 'file contents' }], isError: false, callView: null, resultView: null, subCalls: [] },
      { kind: 'context', seq: 4, time: 4000, content: [{ type: 'text', text: 'not rendered' }], source: {}, provenance: {} as never, form: null },
    ],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'Streaming' }] },
    runningCalls: [{ callId: 'c2', name: 'bash', argsRaw: 'pwd', turn: 2, step: 1, time: 5000, callView: null, subCalls: [] }],
    pending,
    queue: [],
    running: true,
    subagent: null,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
  }
}

function pendingWait<K extends 'approval' | 'question'>(kind: K, key: string, sessionId: string, payload: unknown, respond: ReturnType<typeof vi.fn>) {
  return { kind, key, sessionId, payload, respond } as unknown as ConversationSnapshot['pending'][number]
}

function pendingFixtures(sessionId = 's1') {
  const approvalRespond = vi.fn(async () => ({ accepted: true as const }))
  const questionRespond = vi.fn(async () => ({ accepted: true as const }))
  const approval = pendingWait('approval', 'approval:approval-rpc', sessionId, {
    approvalId: 'approval-1',
    toolName: 'bash',
    callId: 'call-1',
    reason: 'Run the project tests',
  }, approvalRespond)
  const question = pendingWait('question', 'question:question-rpc', sessionId, {
    questions: [{
      id: 'mode',
      header: 'Choose mode',
      question: 'How should I continue?',
      detail: 'Select one option.',
      options: [{ label: 'Safe', description: 'Use conservative defaults.' }, { label: 'Fast' }],
      multiSelect: false,
    }],
  }, questionRespond)
  return { approval, question, approvalRespond, questionRespond }
}

function sessionFace(id: string, source = new Observable(conversation(id))): SessionFace {
  return {
    sessionId: id as never,
    projections: { faceOf: () => new Observable(undefined) },
    getSnapshot: source.getSnapshot,
    subscribe: source.subscribe,
    prompt: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
    cancel: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
    rename: vi.fn(async (title: string) => ({ ok: true as const, value: { title, seq: 10 } })) as never,
    loadOlder: vi.fn() as never,
    command: vi.fn() as never,
    readAttachment: vi.fn() as never,
    updateQueue: vi.fn() as never,
  }
}

function services() {
  const sessionsList = new Observable(sessionState())
  const workspacesList = new Observable(workspaceState())
  const s1Source = new Observable(conversation('s1'))
  const s2Source = new Observable(conversation('s2'))
  const faces = new Map([['s1', sessionFace('s1', s1Source)], ['s2', sessionFace('s2', s2Source)]])
  const sessions = {
    list: sessionsList,
    open: vi.fn((id: string) => sessionsList.set(sessionState(id))),
    binding: vi.fn((id: string) => faces.has(id) ? { sessionId: id, session: faces.get(id), ctx: {} } : undefined),
    search: vi.fn(async () => ({ ok: true as const, value: { items: [{ sessionId: 's1', snippet: 'matching text' }], hasMore: true } })),
  } as unknown as ISessions
  const workspaces = {
    list: workspacesList,
    connectWorkspace: vi.fn(async () => 's2'),
    startSession: vi.fn(),
    create: vi.fn(async ({ path }: { path: string }) => ({
      workspaceId: 'w2', path, title: 'Created', sessionIds: [],
      createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    })),
    archiveSession: vi.fn(async () => undefined),
    listDirectory: vi.fn(async (path?: string) => ({
      path: path ?? '/tmp/project',
      home: '/tmp',
      crumbs: [{ name: 'project', path: '/tmp/project', hidden: false }],
      entries: [{ name: 'src', path: '/tmp/project/src', hidden: false }],
      truncated: false,
    })),
    openPath: vi.fn(async () => undefined),
  } as unknown as IWorkspaces
  const api = {
    sessions: {
      models: vi.fn(async () => ({ result: { ok: true as const, value: { current: { provider: 'p', model: 'm' }, routable: true, groups: [], failures: [] } } })),
      selectModel: vi.fn(async () => ({ result: { ok: true as const, value: { selected: true } } })),
    },
    skills: { list: vi.fn(async () => ({ result: { ok: true as const, value: { skills: [{ name: 'review', description: 'Review code', modelInvocable: true }] } } })) },
    subagents: {
      prompt: vi.fn(async () => ({ result: { ok: true as const, value: { messageId: 'm1' } } })),
      interrupt: vi.fn(async () => ({ result: { ok: true as const, value: { accepted: true } } })),
    },
    goals: {
      create: vi.fn(async () => ({ result: { ok: true as const, value: { ref: { id: 'g1', revision: 1 } } } })),
      edit: vi.fn(async () => ({ result: { ok: true as const, value: { ref: { id: 'g1', revision: 2 } } } })),
      pause: vi.fn(async () => ({ result: { ok: true as const, value: { ref: { id: 'g1', revision: 2 } } } })),
      resume: vi.fn(async () => ({ result: { ok: true as const, value: { ref: { id: 'g1', revision: 2 } } } })),
      complete: vi.fn(async () => ({ result: { ok: true as const, value: { ref: { id: 'g1', revision: 2 } } } })),
      clear: vi.fn(async () => ({ result: { ok: true as const, value: { cleared: true } } })),
    },
  }
  return { sessions, workspaces, api, sessionsList, workspacesList, s1Source, s2Source, faces }
}

function modelCatalog(provider: string, model: string) {
  return { result: { ok: true as const, value: { current: { provider, model }, routable: true, groups: [], failures: [] } } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}
describe('rc6 snapshot mappers', () => {
  it('maps immutable workspace/session/current conversation models', () => {
    const mapped = mapAgentSnapshot(sessionState(), workspaceState(), sessionFace('s1'))
    expect(mapped.workspaces).toEqual([{ id: 'w1', name: 'Project', path: '/tmp/project' }])
    expect(mapped.sessions[0]).toMatchObject({ id: 's1', title: 'First', running: true, workspaceId: 'w1' })
    expect(mapped.selectedWorkspaceId).toBe('w1')
    expect(mapped.selectedSessionId).toBe('s1')
    expect(Object.isFrozen(mapped)).toBe(true)
    expect(Object.isFrozen(mapped.sessions)).toBe(true)
  })

  it('renders projected user, assistant and tool activity without raw events', () => {
    const mapped = mapConversationSnapshot(conversation(), 'First')
    expect(mapped.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Hello'],
      ['assistant', 'Hi\nTool call: read\n{"file":"a"}'],
      ['system', 'Tool read completed\nfile contents'],
      ['system', 'Tool bash running\npwd'],
      ['assistant', 'Streaming'],
    ])
    expect(mapped.messages.some((message) => message.content.includes('hidden'))).toBe(false)
  })

  it('maps pending waits into immutable presentational interactions', () => {
    const pending = pendingFixtures()
    const mapped = mapConversationSnapshot(conversation('s1', [pending.approval, pending.question]), 'First')
    expect(mapped.interactions).toEqual([
      {
        kind: 'approval', key: pending.approval.key, sessionId: 's1', toolName: 'bash', callId: 'call-1', reason: 'Run the project tests',
      },
      {
        kind: 'question', key: pending.question.key, sessionId: 's1', questions: [{
          id: 'mode', header: 'Choose mode', question: 'How should I continue?', detail: 'Select one option.',
          options: [{ label: 'Safe', description: 'Use conservative defaults.' }, { label: 'Fast' }], multiSelect: false,
        }],
      },
    ])
    expect(Object.isFrozen(mapped.interactions)).toBe(true)
    expect(Object.isFrozen(mapped.interactions[1])).toBe(true)
  })
})

describe('Rc6AgentClient', () => {
  it('rebinds session subscriptions when current selection changes and disposes cleanly', () => {
    const fixture = services()
    const client = createRc6AgentClient({ ...fixture, api: fixture.api as never })
    const listener = vi.fn()
    const unsubscribe = client.model.subscribe(listener)
    expect(fixture.s1Source.listeners.size).toBe(1)

    fixture.sessionsList.set(sessionState('s2'))
    expect(fixture.s1Source.listeners.size).toBe(0)
    expect(fixture.s2Source.listeners.size).toBe(1)
    expect(client.model.getSnapshot().conversation?.sessionId).toBe('s2')

    const afterSelection = listener.mock.calls.length
    fixture.s1Source.set(conversation('s1'))
    expect(listener).toHaveBeenCalledTimes(afterSelection)
    fixture.s2Source.set({ ...conversation('s2'), running: false })
    expect(listener).toHaveBeenCalledTimes(afterSelection + 1)

    unsubscribe()
    client.dispose()
    expect(fixture.sessionsList.listeners.size).toBe(0)
    expect(fixture.workspacesList.listeners.size).toBe(0)
    expect(fixture.s2Source.listeners.size).toBe(0)
  })

  it('keeps the newest session catalog when old and new model responses resolve out of order', async () => {
    const fixture = services()
    const pending = new Map<string, ReturnType<typeof deferred<ReturnType<typeof modelCatalog>>>>()
    vi.mocked(fixture.api.sessions.models).mockImplementation(((args: { sessionId: string }) => {
      const request = deferred<ReturnType<typeof modelCatalog>>()
      pending.set(String(args.sessionId), request)
      return request.promise
    }) as never)
    const client = createRc6AgentClient({ ...fixture, api: fixture.api as never })
    fixture.sessionsList.set(sessionState('s2'))
    pending.get('s2')?.resolve(modelCatalog('provider-s2', 'model-s2'))
    await pending.get('s2')?.promise
    pending.get('s1')?.resolve(modelCatalog('provider-s1', 'model-s1'))
    await pending.get('s1')?.promise
    await Promise.resolve()
    expect(client.model.getSnapshot().selectedSessionId).toBe('s2')
    expect(client.model.getSnapshot().models?.current).toEqual({ provider: 'provider-s2', model: 'model-s2' })
    client.dispose()
  })
  it('invalidates model loads when the selected id changes even without session bindings', async () => {
    const fixture = services()
    const first = deferred<ReturnType<typeof modelCatalog>>()
    vi.mocked(fixture.api.sessions.models).mockImplementation(((args: { sessionId: string }) => args.sessionId === 's1' ? first.promise : Promise.resolve(modelCatalog('p2', 'm2'))) as never)
    const client = createRc6AgentClient({ ...fixture, api: fixture.api as never })
    fixture.faces.delete('s1')
    fixture.faces.delete('s2')
    fixture.sessionsList.set(sessionState('s2'))
    first.resolve(modelCatalog('p1', 'm1'))
    await first.promise
    await Promise.resolve()
    expect(client.model.getSnapshot().selectedSessionId).toBe('s2')
    expect(client.model.getSnapshot().models?.current).toEqual({ provider: 'p2', model: 'm2' })
    client.dispose()
  })

  it('does not refresh a different session after a late selectModel response', async () => {
    const fixture = services()
    const selection = deferred<unknown>()
    vi.mocked(fixture.api.sessions.selectModel).mockReturnValue(selection.promise as never)
    const client = createRc6AgentClient({ ...fixture, api: fixture.api as never })
    const before = vi.mocked(fixture.api.sessions.models).mock.calls.length
    const pending = client.selectModel('s1', { provider: 'p', model: 'm' })
    fixture.sessionsList.set(sessionState('s2'))
    selection.resolve({ result: { ok: true as const, value: { selected: true } } })
    await pending
    expect(vi.mocked(fixture.api.sessions.models).mock.calls.length).toBeGreaterThan(before)
    expect(vi.mocked(fixture.api.sessions.models).mock.calls.at(-1)).toEqual([{ sessionId: 's2' }])
    client.dispose()
  })
  it('delegates selection, workspace connection, prompt, and cancel', async () => {
    const fixture = services()
    const client = createRc6AgentClient({ ...fixture, api: fixture.api as never })
    client.selectSession('s2')
    expect(fixture.sessions.open).toHaveBeenCalledWith('s2')

    await client.selectWorkspace('w1')
    expect(fixture.workspaces.connectWorkspace).toHaveBeenCalledWith('w1')
    expect(fixture.sessions.open).toHaveBeenCalledWith('s2')

    const created = await client.createSession('w1')
    expect(created).toMatchObject({ id: 's2', workspaceId: 'w1' })

    await client.sendMessage('s1', { text: 'Hello runtime', images: [] })
    expect(fixture.faces.get('s1')!.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'Hello runtime' }], 'queue')
    await client.cancel('s1')
    expect(fixture.faces.get('s1')!.cancel).toHaveBeenCalledOnce()
    client.dispose()
  })

  it('delegates workspace directory browsing and openPath', async () => {
    const fixture = services()
    const client = createRc6AgentClient({ ...fixture, api: fixture.api as never })
    const listing = await client.listDirectory('/tmp/project')
    expect(fixture.workspaces.listDirectory).toHaveBeenCalledWith('/tmp/project', undefined)
    expect(listing).toEqual({
      path: '/tmp/project',
      home: '/tmp',
      crumbs: [{ name: 'project', path: '/tmp/project', hidden: false }],
      entries: [{ name: 'src', path: '/tmp/project/src', hidden: false }],
      truncated: false,
    })
    expect(Object.isFrozen(listing.entries)).toBe(true)
    await client.openPath('/tmp/project/file.txt')
    expect(fixture.workspaces.openPath).toHaveBeenCalledWith('/tmp/project/file.txt')
    client.dispose()
  })

  it('delegates approval and question answers through the original PendingWait objects', async () => {
    const fixture = services()
    const pending = pendingFixtures()
    fixture.s1Source.set(conversation('s1', [pending.approval, pending.question]))
    const client = createRc6AgentClient({ ...fixture, api: fixture.api as never })

    await client.answerApproval('s1', pending.approval.key, 'allowed-once')
    expect(pending.approvalRespond).toHaveBeenCalledWith({
      ok: true, value: { sessionId: 's1', approvalId: 'approval-1', outcome: 'allowed-once' },
    })

    await client.answerQuestions('s1', pending.question.key, [{ id: 'mode', selected: ['Safe'], custom: 'Carefully' }])
    expect(pending.questionRespond).toHaveBeenCalledWith({
      ok: true, value: { sessionId: 's1', answer: { answers: [{ id: 'mode', selected: ['Safe'], custom: 'Carefully' }] } },
    })
    client.dispose()
  })

  it('projects skills and delegates skill, goal, and continuable subagent actions through official contracts', async () => {
    const fixture = services()
    const client = createRc6AgentClient({ ...fixture, api: fixture.api as never })
    await client.refresh()
    expect(client.model.getSnapshot().activity?.skills).toEqual([{ name: 'review', description: 'Review code', modelInvocable: true }])

    await client.invokeSkill('s1', 'review', 'src')
    expect(fixture.faces.get('s1')!.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '/review src' }], 'queue')
    await client.createGoal('s1', 'Ship slice', 4)
    expect(fixture.api.goals.create).toHaveBeenCalledWith({ sessionId: 's1', objective: 'Ship slice', maxGoalRounds: 4 })
    await client.pauseGoal('s1', { id: 'g1', revision: 2 })
    expect(fixture.api.goals.pause).toHaveBeenCalledWith({ sessionId: 's1', ref: { id: 'g1', revision: 2 } })
    await client.promptSubagent('s1', 'child', 'Continue')
    expect(fixture.api.subagents.prompt).toHaveBeenCalledWith(expect.objectContaining({ parentSessionId: 's1', childSessionId: 'child', mode: 'continuable' }), expect.any(AbortSignal))
    await client.interruptSubagent('s1', 'child')
    expect(fixture.api.subagents.interrupt).toHaveBeenCalledWith({ parentSessionId: 's1', childSessionId: 'child', mode: 'continuable' })
    client.dispose()
  })

  it('surfaces runtime business failures and unknown sessions', async () => {
    const fixture = services()
    const failed = fixture.faces.get('s1')!
    vi.mocked(failed.prompt).mockResolvedValueOnce({ ok: false, error: { code: 'rejected', message: 'No route' } } as never)
    const client = createRc6AgentClient({ ...fixture, api: fixture.api as never })
    await expect(client.sendMessage('s1', { text: 'x', images: [] })).rejects.toThrow('No route')
    await expect(client.cancel('missing')).rejects.toThrow('Unknown Harness session missing')
    client.dispose()
  })
})
