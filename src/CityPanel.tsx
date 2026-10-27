// One market opened up: the evidence behind its score, and who to call there.

import { X, MapPin, Mic2, Handshake, Users, CalendarDays, ExternalLink } from 'lucide-react'
import type { CityDetail, MarketScore } from './api.ts'
import { VERDICT, fmtDate, topPct } from './labels.ts'

type Props = { row: MarketScore; detail: CityDetail | null; error: string | null; onClose: () => void; openerLabel: string }

export default function CityPanel({ row, detail, error, onClose, openerLabel }: Props) {
  const v = VERDICT[row.verdict]
  const s = row.supply
  return (
    <aside className="city">
      <header className="city-head">
        <div>
          <p className="eyebrow">{row.market.country}</p>
          <h2>{row.market.name}</h2>
        </div>
        <span className="badge" style={{ '--c': v.color } as React.CSSProperties}>{v.label}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close city">
          <X size={18} />
        </button>
      </header>

      <div className="stats">
        <Stat label="Whitespace" value={String(row.whitespace)} unit="/100" />
        <Stat label="Demand" value={`${topPct(row.percentile)}%`} unit="top of places" />
        <Stat label="Booked, 90 days" value={s.count === null ? '—' : String(s.count)} unit={s.count === null ? 'no data' : s.crowd ? `genre · ${s.crowd} same crowd` : 'genre shows'} />
        <Stat label="Per million" value={s.perMillion === null ? '—' : s.perMillion.toFixed(1)} unit="" />
      </div>
      <p className="why">{row.why}</p>

      {error && <p className="error">{error}</p>}
      {!detail && !error && <p className="muted pad">Reading Qloo for {row.market.name}…</p>}

      {detail && (
        <>
          {detail.source === 'demo' && <p className="demo-note">Demo data: names below are placeholders until the Qloo key is connected.</p>}
          <Section icon={<MapPin size={15} />} title="Where the crowd is">
            <p className="muted">The map shows Qloo's heatmap for this audience across {row.market.name}. Hotter colours mean higher affinity.</p>
          </Section>
          <Section icon={<MapPin size={15} />} title="Rooms that fit">
            <Picks items={detail.venues} empty="No venues matched this audience." />
          </Section>
          <Section icon={<Mic2 size={15} />} title={openerLabel}>
            <Picks items={detail.openers} empty="No local matches." />
          </Section>
          <Section icon={<Handshake size={15} />} title="Promo partners">
            <Picks items={detail.partners} empty="No partners matched." />
          </Section>
          {detail.audience && (
            <Section icon={<Users size={15} />} title="Who the crowd is">
              <div className="bars">
                {detail.audience.age.map((a) => (
                  <div className="bar-row" key={a.label}>
                    <span>{a.label}</span>
                    <div className="bar"><i style={{ width: `${Math.round(a.share * 100 * 2.4)}%` }} /></div>
                    <b>{Math.round(a.share * 100)}%</b>
                  </div>
                ))}
              </div>
              {detail.audience.gender && <p className="muted small">Skews {detail.audience.gender.female >= 0.5 ? 'female' : 'male'} ({Math.round(Math.max(detail.audience.gender.female, detail.audience.gender.male) * 100)}%).</p>}
            </Section>
          )}
          <Section icon={<CalendarDays size={15} />} title="Already booked here">
            {s.count !== null && (
              <p className="muted small">
                Next 90 days within 50 km. {s.crowd !== null && 'Tagged shows are by this act or the 15 acts its audience loves most, per Qloo; the rest are the matching genre.'}
              </p>
            )}
            {s.count === null ? (
              <p className="muted">Ticketmaster has little or no listing data for this market, so supply is unknown.</p>
            ) : s.listings.length ? (
              <ul className="listings">
                {s.listings.slice(0, 8).map((l, i) => {
                  const d = fmtDate(l.date)
                  return (
                    <li key={i}>
                      <span className="mini-date">{d.mon} {d.day}</span>
                      <span className="grow">
                        {l.act && <b className={l.self ? 'act self' : 'act'}>{l.self ? 'You' : l.act}</b>}
                        {l.name}
                        {l.venue && <em> · {l.venue}</em>}
                        {l.sample && <em className="tag-demo">demo</em>}
                      </span>
                      {l.url && <a href={l.url} target="_blank" rel="noreferrer" aria-label="Open listing"><ExternalLink size={13} /></a>}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="muted">Nothing comparable booked in the next 90 days.</p>
            )}
          </Section>
        </>
      )}
    </aside>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <b>{value}</b>
      <small>{unit}</small>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="sec">
      <h3>{icon}{title}</h3>
      {children}
    </section>
  )
}

function Picks({ items, empty }: { items: CityDetail['venues']; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>
  return (
    <ul className="picks">
      {items.map((p) => (
        <li key={p.id}>
          <span className="grow">
            <b>{p.name}</b>
            {(p.blurb || p.address) && <small>{p.blurb ?? p.address}</small>}
          </span>
          {p.affinity !== undefined && <span className="aff">{Math.round(p.affinity * 100)}</span>}
        </li>
      ))}
    </ul>
  )
}
