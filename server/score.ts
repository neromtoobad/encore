// The whitespace score: demand from Qloo against supply from Ticketmaster.
//
//   percentile = the share of places on Qloo's world heatmap this market beats
//   index      = a market's affinity / the mean affinity of the markets scanned
//   crowding   = genre shows per million people / the median across markets
//                + 0.5 for each same-crowd show (an act this audience loves)
//                + 1 more for each show by the act itself
//   whitespace = demand (percentile mapped 50%..100% onto 0..1)
//                x a supply discount 1 / (1 + 0.6 x crowding), scaled to 0..100
//
// Qloo's raw affinities bunch near the top (0.7 to 1.0 across these markets),
// so the percentile carries the spread and the index says "vs these markets".
//
// A market with no listing data is scored as if its supply were the median and
// marked unlisted, so it is never called underserved on evidence we don't have.

import { marketAffinity, related } from './qloo.ts'
import { sameCrowd, supply as supplyFor, window90 } from './ticketmaster.ts'
import { marketsFor } from './markets.ts'
import type { Entity, MarketScore, Region, Scan, Supply, Verdict } from './types.ts'

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function verdictOf(index: number, percentile: number, crowding: number | null): Verdict {
  if (index < 0.9 || percentile < 0.6) return 'cold'
  if (crowding === null) return 'unlisted'
  if (crowding < 0.75) return 'underserved'
  if (crowding > 1.4) return 'crowded'
  return 'balanced'
}

export async function scan(e: Entity, region: Region): Promise<Scan> {
  const markets = marketsFor(region)
  const window = window90()
  // Supply looks up shows by the acts Qloo says this audience loves, so it needs them first.
  const supplyRun = (async () => {
    const rel = await related(e, 15).catch(() => [])
    const crowd = await sameCrowd(e, rel, window).catch(() => null)
    const s = await Promise.all(markets.map((mk) => supplyFor(e, mk, window, crowd).catch((err): Supply => {
      console.warn(`[supply] ${mk.id}: ${(err as Error).message}`)
      return { count: null, perMillion: null, crowd: null, self: 0, listings: [], source: 'none', window }
    })))
    return { rel, s }
  })()
  const [aff, { rel, s: supplies }] = await Promise.all([marketAffinity(e, markets), supplyRun])
  const scored = markets.flatMap((mk, i) => {
    const d = aff.get(mk.id)
    return d ? [{ mk, d, s: supplies[i] }] : []
  })
  const meanA = scored.reduce((t, x) => t + x.d.affinity, 0) / Math.max(1, scored.length)
  const med = median(scored.map((x) => x.s.perMillion).filter((v): v is number => v !== null && v > 0))

  const rows: MarketScore[] = scored.map(({ mk, d, s }) => {
    const index = meanA > 0 ? d.affinity / meanA : 1
    const crowding = s.perMillion === null ? null : (med > 0 ? s.perMillion / med : 0) + 0.5 * (s.crowd ?? 0) + s.self
    const demand = clamp((d.percentile - 0.5) / 0.5)
    // Unknown supply is treated as the median, never as empty.
    const discount = 1 / (1 + 0.6 * (crowding ?? 1))
    const verdict = verdictOf(index, d.percentile, crowding)
    // A cold market can rank well worldwide yet trail the markets scanned; keep it below the warm ones.
    const cap = verdict === 'cold' ? 0.35 : 1
    return {
      market: mk,
      affinity: d.affinity,
      percentile: d.percentile,
      index,
      supply: s,
      whitespace: Math.round(100 * demand * discount * cap),
      verdict,
      why: explain(e, d.percentile, index, s, crowding, scored.length),
    }
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

export const topShare = (percentile: number) => `top ${Math.max(1, Math.round((1 - percentile) * 100))}%`

function explain(e: Entity, percentile: number, index: number, s: Supply, crowding: number | null, n: number) {
  const demand = `${e.name}'s audience affinity here is in the ${topShare(percentile)} of places Qloo maps (${index.toFixed(2)}× the average of the ${n} markets scanned)`
  if (s.count === null) return `${demand}. No listing data here, so supply is unknown.`
  const vs = crowding === null ? '' : crowding < 1 ? ', below the median' : crowding > 1 ? ', above the median' : ', at the median'
  const genre = `${s.count} genre ${s.count === 1 ? 'show is' : 'shows are'} booked within 50 km in the next 90 days (${(s.perMillion ?? 0).toFixed(1)} per million people${vs})`
  if (s.crowd === null) return `${demand}. ${genre}.`
  const acts = [...new Set(s.listings.filter((l) => l.act && !l.self).map((l) => l.act))]
  const crowd = s.crowd === 0
    ? 'none by the acts this audience loves most'
    : `${s.crowd - s.self ? `${s.crowd - s.self} by acts this audience loves (${acts.slice(0, 3).join(', ')})` : ''}${s.self ? `${s.crowd - s.self ? ' and ' : ''}${s.self} by ${e.name}` : ''}`
  return `${demand}. ${genre}; ${crowd}.`
}

function profileLine(e: Entity, related: string[]) {
  const tags = e.tags.slice(0, 4).map((t) => t.name).join(', ')
  const rel = related.slice(0, 3).join(', ')
  return [tags && `Tagged ${tags}.`, rel && `Fans also love ${rel}.`].filter(Boolean).join(' ')
}
