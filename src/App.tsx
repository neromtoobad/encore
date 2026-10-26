import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Loader2, Route, ChevronRight, CircleCheck, CircleDot } from 'lucide-react'
import { getCity, getScan, getStatus, searchEntities, streamPlan, type CityDetail, type Entity, type Kind, type Plan, type Region, type Scan, type Status } from './api.ts'
import { KINDS, REGIONS, VERDICT, kindLabel } from './labels.ts'
import MarketMap from './MarketMap.tsx'
import CityPanel from './CityPanel.tsx'
import PlanView from './PlanView.tsx'

type Step = { label: string; done: boolean }

const OPENER_LABEL: Record<Kind, string> = {
  artist: 'Openers with the same fans',
  comedian: 'Comics to share the bill',
  author: 'Authors for a joint event',
  podcast: 'Co-hosts with the same audience',
  brand: 'Brands for a collab',
  film: 'Films for a double bill',
  game: 'Games with the same players',
  chef: 'Kitchens for a collab',
}

function readUrl() {
  const q = new URLSearchParams(location.search)
  return { id: q.get('id'), kind: (q.get('kind') as Kind) ?? 'artist', region: (q.get('region') as Region) ?? 'all', city: q.get('city') }
}

export default function App() {
  const initial = useMemo(readUrl, [])
  const [status, setStatus] = useState<Status | null>(null)
  const [kind, setKind] = useState<Kind>(initial.kind)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Entity[]>([])
  const [searching, setSearching] = useState(false)
  const [region, setRegion] = useState<Region>(initial.region)
  const [entityId, setEntityId] = useState<string | null>(initial.id)
  const [scan, setScan] = useState<Scan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(initial.city)
  const [detail, setDetail] = useState<CityDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [brief, setBrief] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const planAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    getStatus().then(setStatus).catch(() => {})
  }, [])

  // Search as you type.
  useEffect(() => {
    const q = query.trim()
    if (!q) return setResults([])
    const ac = new AbortController()
    setSearching(true)
    const t = setTimeout(() => {
      searchEntities(q, kind, ac.signal)
        .then(setResults)
        .catch((e) => !ac.signal.aborted && setError(e.message))
        .finally(() => !ac.signal.aborted && setSearching(false))
    }, 220)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [query, kind])

  // Scan whenever the entity or region changes.
  useEffect(() => {
    if (!entityId) return
    let live = true
    setScanning(true)
    setError(null)
    setPlan(null)
    getScan(entityId, kind, region)
      .then((s) => live && setScan(s))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setScanning(false))
    return () => {
      live = false
    }
  }, [entityId, region]) // eslint-disable-line react-hooks/exhaustive-deps

  // Open a city.
  useEffect(() => {
    setDetail(null)
    setDetailError(null)
    if (!selected || !entityId || !scan) return
    let live = true
    getCity(entityId, kind, region, selected)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setDetailError(e.message))
    return () => {
      live = false
    }
  }, [selected, scan]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the URL shareable.
  useEffect(() => {
    const q = new URLSearchParams()
    if (entityId) {
      q.set('id', entityId)
      q.set('kind', kind)
      if (region !== 'all') q.set('region', region)
      if (selected) q.set('city', selected)
    }
    history.replaceState(null, '', q.size ? `?${q}` : location.pathname)
  }, [entityId, kind, region, selected])

  const choose = (e: Entity) => {
    setKind(e.kind)
    setEntityId(e.id)
    setSelected(null)
    setQuery('')
    setResults([])
  }

  const runPlan = async () => {
    if (!scan || !entityId) return
    planAbort.current?.abort()
    const ac = new AbortController()
    planAbort.current = ac
    setPlanning(true)
    setPlan(null)
    setPlanError(null)
    setSteps([])
    setNotes([])
    setSelected(null)
    try {
      for await (const ev of streamPlan({ id: entityId, kind, region, brief }, ac.signal)) {
        if (ev.type === 'step') setSteps((s) => [...s.map((x) => ({ ...x, done: true })), { label: ev.label, done: false }])
        else if (ev.type === 'note') setNotes((n) => [...n, ev.text].slice(-3))
        else if (ev.type === 'plan') setPlan(ev.plan)
        else if (ev.type === 'error') setPlanError(ev.error)
      }
    } catch (e) {
      if (!ac.signal.aborted) setPlanError((e as Error).message)
    } finally {
      setSteps((s) => s.map((x) => ({ ...x, done: true })))
      if (!ac.signal.aborted) setPlanning(false)
    }
  }

  const row = scan?.markets.find((r) => r.market.id === selected) ?? null
  const routePts = useMemo(() => {
    if (!plan || !scan) return null
    return plan.stops
      .map((s) => scan.markets.find((r) => r.market.id === s.market_id)?.market)
      .filter((m) => !!m)
      .map((m, i) => ({ lat: m.lat, lng: m.lng, label: `${i + 1}. ${m.name}` }))
  }, [plan, scan])
  const demo = status && (status.qloo === 'demo' || status.ticketmaster === 'demo')
  const kindInfo = KINDS.find((k) => k.id === kind) ?? KINDS[0]

  const searchBox = (
    <div className="search">
      <div className="kinds" role="tablist" aria-label="What are you taking on the road?">
        {KINDS.map((k) => (
          <button key={k.id} role="tab" aria-selected={k.id === kind} className={k.id === kind ? 'chip on' : 'chip'} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <label className="field">
        {searching ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${kindInfo.noun}, e.g. ${kindInfo.examples[0]}`} aria-label="Search" />
      </label>
      {results.length > 0 && (
        <ul className="results">
          {results.map((e) => (
            <li key={e.id}>
              <button onClick={() => choose(e)}>
                {e.image ? <img src={e.image} alt="" /> : <span className="ph">{e.name[0]}</span>}
                <span className="grow">
                  <b>{e.name}</b>
                  <small>{e.tags.slice(0, 3).map((t) => t.name).join(' · ') || kindLabel(e.kind)}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); setEntityId(null); setScan(null); setSelected(null); setPlan(null) }}>
          <img src="/favicon.svg" alt="" />
          <span>Encore</span>
        </a>
        {status && (
          <div className="sources">
            <Pill on={status.qloo === 'live'} label="Qloo" />
            <Pill on={status.ticketmaster === 'live'} label="Ticketmaster" />
            <Pill on={status.agent === 'claude'} label="Claude agent" off="rules" />
          </div>
        )}
      </header>
      {demo && <div className="demo-bar">Demo data: numbers are simulated until the Qloo and Ticketmaster keys are connected.</div>}

      {!entityId ? (
        <main className="hero">
          <p className="eyebrow">For anyone who takes their work on the road</p>
          <h1>Find the crowd that's waiting for you.</h1>
          <p className="lede">Encore compares where your audience lives, from Qloo's taste graph, with what's already booked there, from Ticketmaster. It finds the cities that want you but aren't getting enough, then plans the run and drafts the outreach.</p>
          {searchBox}
          <p className="try">
            Try{' '}
            {kindInfo.examples.map((x, i) => (
              <button key={x} className="link-btn" onClick={() => setQuery(x)}>
                {x}
                {i < kindInfo.examples.length - 1 ? ',' : ''}
              </button>
            ))}
          </p>
          <ol className="how">
            <li><b>Demand</b> Qloo measures how much your audience over-indexes on each of 42 cities.</li>
            <li><b>Supply</b> Ticketmaster counts the comparable shows booked there in the next 90 days.</li>
            <li><b>Whitespace</b> High demand with few shows is a city waiting for you.</li>
            <li><b>The run</b> An agent inspects the best cities, routes the dates and writes the outreach.</li>
          </ol>
        </main>
      ) : (
        <main className="work">
          <section className="side">
            {searchBox}
            {scanning && !scan && <p className="muted pad"><Loader2 size={15} className="spin" /> Scanning 42 markets…</p>}
            {error && <p className="error">{error}</p>}
            {scan && (
              <>
                <div className="entity">
                  {scan.entity.image ? <img src={scan.entity.image} alt="" /> : <span className="ph big">{scan.entity.name[0]}</span>}
                  <div className="grow">
                    <p className="eyebrow">{kindLabel(scan.entity.kind)}</p>
                    <h2>{scan.entity.name}</h2>
                    <p className="muted small">{scan.profile.summary}</p>
                  </div>
                </div>

                {plan ? (
                  <PlanView plan={plan} scan={scan} onBack={() => setPlan(null)} />
                ) : (
                  <>
                    <div className="planner">
                      <label htmlFor="brief" className="eyebrow">Plan the run</label>
                      <textarea id="brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={2} placeholder="e.g. 8 dates in February, start in London, rooms under 1,000" />
                      <button className="btn" onClick={runPlan} disabled={planning}>
                        {planning ? <Loader2 size={16} className="spin" /> : <Route size={16} />} {planning ? 'Planning…' : 'Plan the run'}
                      </button>
                      {(steps.length > 0 || planError) && (
                        <ul className="steps">
                          {steps.map((s, i) => (
                            <li key={i} className={s.done ? 'done' : ''}>
                              {s.done ? <CircleCheck size={14} /> : <CircleDot size={14} className="pulse" />} {s.label}
                            </li>
                          ))}
                          {notes.map((n, i) => <li key={`n${i}`} className="note">{n}</li>)}
                          {planError && <li className="error">{planError}</li>}
                        </ul>
                      )}
                    </div>

                    <div className="regions" role="tablist" aria-label="Region">
                      {REGIONS.map((r) => (
                        <button key={r.id} role="tab" aria-selected={r.id === region} className={r.id === region ? 'chip on' : 'chip'} onClick={() => { setRegion(r.id); setSelected(null) }}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                    <div className="legend">
                      {(['underserved', 'balanced', 'crowded', 'unlisted', 'cold'] as const).map((v) => (
                        <span key={v} title={VERDICT[v].hint}><i style={{ background: VERDICT[v].color }} />{VERDICT[v].label}</span>
                      ))}
                    </div>
                    <ol className={scanning ? 'markets dim' : 'markets'}>
                      {scan.markets.map((r, i) => (
                        <li key={r.market.id}>
                          <button className={r.market.id === selected ? 'mrow on' : 'mrow'} onClick={() => setSelected(r.market.id === selected ? null : r.market.id)}>
                            <span className="rank">{i + 1}</span>
                            <span className="grow">
                              <b>{r.market.name}</b>
                              <small>
                                Demand {r.index.toFixed(1)}× · {r.supply.count === null ? 'no listings data' : `${r.supply.count} booked`}
                              </small>
                              <span className="ws-bar"><i style={{ width: `${r.whitespace}%`, background: VERDICT[r.verdict].color }} /></span>
                            </span>
                            <span className="ws">
                              <b>{r.whitespace}</b>
                              <small style={{ color: VERDICT[r.verdict].color }}>{VERDICT[r.verdict].label}</small>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </>
            )}
          </section>
          <section className="stage">
            <MarketMap markets={scan?.markets ?? []} selected={selected} detail={detail} route={routePts} onSelect={(id) => { setPlan(null); setSelected(id) }} />
            {row && <CityPanel row={row} detail={detail} error={detailError} onClose={() => setSelected(null)} openerLabel={OPENER_LABEL[scan?.entity.kind ?? 'artist']} />}
          </section>
        </main>
      )}
    </div>
  )
}

function Pill({ on, label, off = 'demo' }: { on: boolean; label: string; off?: string }) {
  return (
    <span className={on ? 'pill live' : 'pill'} title={on ? 'Live' : off}>
      <i /> {label}
      {!on && <em>{off}</em>}
    </span>
  )
}
