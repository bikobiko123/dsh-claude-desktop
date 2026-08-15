import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { SessionSearchResult } from '../../shared/agent-client'
import { Dialog } from './Dialog'

export function SearchDialog({ onClose, onSearch, onSelect }: { onClose(): void; onSearch(query: string, signal: AbortSignal): Promise<readonly SessionSearchResult[]>; onSelect(id: string): void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly SessionSearchResult[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!query.trim()) { setResults([]); return }; const controller = new AbortController(); setLoading(true); const timer = setTimeout(() => void onSearch(query.trim(), controller.signal).then((rows) => { setResults(rows); setActive(0) }).catch((e) => { if (e?.name !== 'AbortError') setResults([]) }).finally(() => setLoading(false)), 180); return () => { clearTimeout(timer); controller.abort() } }, [onSearch, query])
  function key(event: KeyboardEvent<HTMLInputElement>) { if (event.key === 'ArrowDown') { event.preventDefault(); setActive((v) => Math.min(results.length - 1, v + 1)) } else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((v) => Math.max(0, v - 1)) } else if (event.key === 'Enter' && results[active]) { event.preventDefault(); onSelect(results[active].sessionId); onClose() } }
  return <Dialog description="Search conversation titles and message content." initialFocus={inputRef} onClose={onClose} title="Search conversations"><div className="dialog-body search-dialog"><input aria-activedescendant={results[active] ? `search-result-${active}` : undefined} aria-autocomplete="list" aria-controls="search-results" onChange={(e) => setQuery(e.target.value)} onKeyDown={key} placeholder="Search conversations…" ref={inputRef} role="combobox" value={query}/><div aria-label="Search results" className="search-results" id="search-results" role="listbox">{loading && <div className="search-empty">Searching…</div>}{!loading && query && !results.length && <div className="search-empty">No matching conversations</div>}{results.map((result, index) => <button aria-selected={index === active} className={index === active ? 'search-result search-result-active' : 'search-result'} id={`search-result-${index}`} key={result.sessionId} onClick={() => { onSelect(result.sessionId); onClose() }} onMouseEnter={() => setActive(index)} role="option" type="button"><strong>{result.title || 'Untitled conversation'}</strong>{result.snippet && <span>{result.snippet}</span>}</button>)}</div></div></Dialog>
}
