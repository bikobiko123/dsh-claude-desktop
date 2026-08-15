import { describe, expect, it, vi } from 'vitest'
import { createObservableModel } from './observable-model.js'

describe('createObservableModel', () => {
  it('publishes immutable snapshot replacements', () => {
    const model = createObservableModel({ value: 1 })
    const listener = vi.fn()
    const unsubscribe = model.subscribe(listener)

    model.setSnapshot({ value: 2 })

    expect(model.getSnapshot()).toEqual({ value: 2 })
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    model.setSnapshot({ value: 3 })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('does not notify for the identical snapshot reference', () => {
    const snapshot = { value: 1 }
    const model = createObservableModel(snapshot)
    const listener = vi.fn()
    model.subscribe(listener)

    model.setSnapshot(snapshot)

    expect(listener).not.toHaveBeenCalled()
  })
})
