import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ModelCatalogView, ModelSelectionView } from '../../shared/agent-client'

export interface ModelPickerProps {
  catalog: ModelCatalogView
  disabled?: boolean
  onSelect(selection: ModelSelectionView): Promise<void>
}

export function ModelPicker({ catalog, disabled, onSelect }: ModelPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const root = useRef<HTMLDivElement>(null)
  const current = catalog.current
  const selected = useMemo(() => catalog.options.find((item) => item.provider === current?.provider && item.id === current.model), [catalog.options, current])

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  async function select(selection: ModelSelectionView): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      await onSelect(selection)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Model could not be selected.')
    } finally {
      setBusy(false)
    }
  }

  const label = selected?.name ?? current?.model ?? (catalog.state === 'loading' ? 'Loading models' : 'Select model')
  return (
    <div className="model-picker" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="model-button"
        disabled={disabled || catalog.state === 'loading' || catalog.options.length === 0}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>{label}</span><span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div aria-label="Model selection" className="model-popover" role="dialog">
          <header><strong>Choose model</strong><small>{catalog.routable ? 'Available for this session' : 'Current route unavailable'}</small></header>
          <div className="model-list">
            {catalog.options.map((model) => {
              const active = model.provider === current?.provider && model.id === current.model
              const effort = active ? current?.reasoningEffort : model.defaultReasoningEffort
              return (
                <section className={active ? 'model-option model-option-active' : 'model-option'} key={`${model.provider}:${model.id}`}>
                  <button disabled={busy} onClick={() => void select({ provider: model.provider, model: model.id, ...(effort ? { reasoningEffort: effort } : {}) })} type="button">
                    <span><strong>{model.name}</strong><small>{model.providerName}</small></span><span>{active ? '✓' : ''}</span>
                  </button>
                  {model.description ? <p>{model.description}</p> : null}
                  {model.reasoningEfforts.length ? (
                    <div className="reasoning-efforts" aria-label={`Reasoning effort for ${model.name}`}>
                      {model.reasoningEfforts.map((item) => (
                        <button
                          className={active && current?.reasoningEffort === item.id ? 'reasoning-active' : ''}
                          disabled={busy}
                          key={item.id}
                          onClick={() => void select({ provider: model.provider, model: model.id, reasoningEffort: item.id })}
                          title={item.description}
                          type="button"
                        >{item.name}</button>
                      ))}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
          {catalog.failures.length ? <div className="model-failures">{catalog.failures.map((failure) => <small key={failure.provider}>{failure.name}: {failure.message}</small>)}</div> : null}
          {error ? <div className="model-error" role="alert">{error}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
