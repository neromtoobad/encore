// The finished run: dated stops like a tour poster, then the outreach pack.

import { useState } from 'react'
import { ArrowLeft, Copy, Check, Mail, Sparkles, TriangleAlert } from 'lucide-react'
import type { Plan, Scan } from './api.ts'
import { fmtDate } from './labels.ts'

type Props = { plan: Plan; scan: Scan; onBack: () => void }

export default function PlanView({ plan, scan, onBack }: Props) {
  const city = (id: string) => scan.markets.find((r) => r.market.id === id)?.market.name ?? id
  const poster = new Map(plan.posters.map((p) => [p.market_id, p.line]))
  return (
    <div className="plan">
      <button className="link-btn" onClick={onBack}>
        <ArrowLeft size={15} /> Back to markets
      </button>
      <p className="eyebrow">{plan.planner === 'claude' ? 'Planned by the Encore agent' : 'Rule-based plan'}</p>
      <h2 className="plan-title">{plan.title}</h2>
      <p className="lede">{plan.summary}</p>

      <ol className="dates">
        {plan.stops.map((s, i) => {
          const d = fmtDate(s.date)
          return (
            <li key={`${s.market_id}-${i}`}>
              <div className="date-block">
                <span>{d.mon}</span>
                <b>{d.day}</b>
                <small>{d.dow}</small>
              </div>
              <div className="grow">
                <h3>{city(s.market_id)}</h3>
                <p className="stop-meta">{[s.room, s.venue].filter(Boolean).join(' · ')}</p>
                {(s.opener || s.partner) && (
                  <p className="stop-meta">
                    {s.opener && <>With <b>{s.opener}</b></>}
                    {s.opener && s.partner && ' · '}
                    {s.partner && <>Promo: <b>{s.partner}</b></>}
                  </p>
                )}
                <p className="stop-why">{s.why}</p>
                {poster.get(s.market_id) && <p className="poster-line">“{poster.get(s.market_id)}”</p>}
              </div>
            </li>
          )
        })}
      </ol>

      <h3 className="pack-title">
        <Sparkles size={16} /> Outreach pack
      </h3>
      <div className="drafts">
        {plan.outreach.map((o, i) => (
          <Draft key={i} to={o.to} city={city(o.market_id)} subject={o.subject} body={o.body} />
        ))}
      </div>

      {plan.cautions.length > 0 && (
        <div className="cautions">
          <h3>
            <TriangleAlert size={15} /> Check before you book
          </h3>
          <ul>
            {plan.cautions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Draft({ to, city, subject, body }: { to: string; city: string; subject: string; body: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <article className="draft">
      <p className="eyebrow">{city}</p>
      <h4>{to}</h4>
      <p className="subject">{subject}</p>
      <p className="body">{body}</p>
      <div className="draft-actions">
        <button className="btn ghost" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
        <a className="btn ghost" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
          <Mail size={14} /> Open as email
        </a>
      </div>
    </article>
  )
}
