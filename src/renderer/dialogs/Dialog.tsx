import { useEffect, useRef, type ReactNode } from 'react'

export function Dialog({ title, description, onClose, children, initialFocus }: {
  title: string
  description?: string
  onClose(): void
  children: ReactNode
  initialFocus?: React.RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const target = initialFocus?.current ?? panelRef.current?.querySelector<HTMLElement>('input,button,select,textarea,[tabindex]:not([tabindex="-1"])')
    target?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !panelRef.current) return
      const items = [...panelRef.current.querySelectorAll<HTMLElement>('input,button,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((item) => !item.hasAttribute('disabled'))
      if (!items.length) return
      const first = items[0]; const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); previous?.focus() }
  }, [initialFocus, onClose])
  return <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div aria-describedby={description ? 'dialog-description' : undefined} aria-labelledby="dialog-title" aria-modal="true" className="app-dialog" ref={panelRef} role="dialog">
      <header><div><h2 id="dialog-title">{title}</h2>{description && <p id="dialog-description">{description}</p>}</div><button aria-label="Close dialog" onClick={onClose} type="button">×</button></header>
      {children}
    </div>
  </div>
}
