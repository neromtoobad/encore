// The whitespace score: demand from Qloo against supply from Ticketmaster.
//
//   index     = a market's affinity / the mean affinity of the markets scanned
//   crowding  = comparable shows per million people / the median across markets
//   whitespace = demand (index mapped 0.6x..1.8x onto 0..1)
//                x a supply discount 1 / (1 + 0.6 x crowding), scaled to 0..100
//
// A market with no listing data is scored as if its supply were the median and
// marked unlisted, so it is never called underserved on evidence we don't have.

import { marketAffinity, related } from './qloo.ts'
import { supply as supplyFor, window90 } from './ticketmaster.ts'
import { marketsFor } from './markets.ts'
import type { Entity, MarketScore, Region, Scan, Supply, Verdict } from './types.ts'

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function verdictOf(index: number, crowding: number | null): Verdict {
  if (index < 0.85) return 'cold'
  if (crowding === null) return 'unlisted'
  if (crowding < 0.75) return 'underserved'
  if (crowding > 1.4) return 'crowded'
  return 'balanced'
}

export async function scan(e: Entity, region: Region): Promise<Scan> {
  const markets = marketsFor(region)
  const window = window90()
  const [aff, supplies, rel] = await Promise.all([
    marketAffinity(e, markets),
    Promise.all(markets.map((mk) => supplyFor(e, mk, window).catch((err): Supply => {
      console.warn(`[supply] ${mk.id}: ${(err as Error).message}`)
      return { count: null, perMillion: null, listings: [], source: 'none', window }
    }))),
    related(e, 6).catch(() => []),
  ])
  const scored = markets.map((mk, i) => ({ mk, a: aff.get(mk.id), s: supplies[i] })).filter((x) => x.a !== undefined)
  const meanA = scored.reduce((t, x) => t + (x.a as number), 0) / Math.max(1, scored.length)
  const med = median(scored.map((x) => x.s.perMillion).filter((v): v is number => v !== null && v > 0))

  const rows: MarketScore[] = scored.map(({ mk, a, s }) => {
    const affinity = a as number
    const index = meanA > 0 ? affinity / meanA : 1
    const crowding = s.perMillion === null ? null : med > 0 ? s.perMillion / med : 0
    const demand = clamp((index - 0.6) / 1.2)
    // Unknown supply is treated as the median, never as empty.
    const discount = 1 / (1 + 0.6 * (crowding ?? 1))
    const verdict = verdictOf(index, crowding)
    return { market: mk, affinity, index, supply: s, whitespace: Math.round(100 * demand * discount), verdict, why: explain(e, index, s, crowding, scored.length) }
  })
  rows.sort((x, y) => y.whitespace - x.whitespace)

  const live = supplies.filter((s) => s.source === 'ticketmaster').length
  const demo = supplies.filter((s) => s.source === 'demo').length
  return {
    entity: e,
    region,
    profile: {
      summary: profileLine(e, rel.map((r) => r.name)),
      tags: e.tags.slice(0, 8).map((t) => t.name),
      related: rel.map((r) => ({ name: r.name, id: r.id })),
    },
    markets: rows,
    sources: { demand: e.source, supply: live && demo ? 'mixed' : live ? 'ticketmaster' : 'demo' },
  }
}

function explain(e: Entity, index: number, s: Supply, crowding: number | null, n: number) {
  const demand = `${e.name}'s audience affinity for this city is ${index.toFixed(1)}× the average of the ${n} markets scanned`
  if (s.count === null) return `${demand}. No listing data here, so supply is unknown.`
  const vs = crowding === null ? '' : crowding < 1 ? ', below the median' : crowding > 1 ? ', above the median' : ', at the median'
  return `${demand}. ${s.count} comparable ${s.count === 1 ? 'show is' : 'shows are'} booked in the next 90 days (${(s.perMillion ?? 0).toFixed(1)} per million people${vs}).`
}

function profileLine(e: Entity, related: string[]) {
  const tags = e.tags.slice(0, 4).map((t) => t.name).join(', ')
  const rel = related.slice(0, 3).join(', ')
  return [tags && `Tagged ${tags}.`, rel && `Fans also love ${rel}.`].filter(Boolean).join(' ')
}
