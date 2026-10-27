// Qloo client. With QLOO_API_KEY set, every call goes to the hackathon API
// (hackathon.api.qloo.com, key in the X-Api-Key header); without it, the same
// functions answer from demo.ts and mark the result as demo.
//
// Where the demand numbers come from:
//   market affinity  One Insights heatmap (filter.type=urn:heatmap) over a polygon
//                    covering every market, so all cities share one scale. Cells
//                    are ~150 km geohashes; each market takes its nearest cell's
//                    affinity and affinity_rank (the share of cells it beats).
//                    Destinations can't be signalled by an artist (Qloo rejects
//                    it), and a per-city heatmap rescales to 1 inside each city.
//   neighbourhoods   Insights, filter.type=urn:heatmap inside one city.
//   openers          Insights for the same entity type, signalled by the entity
//                    and biased to the city with signal.location.
//   venues/partners  Insights for places (filtered by tag) and podcasts in the city.
//   audience         Insights, filter.type=urn:demographics.

import { cached, limiter, DAY } from './cache.ts'
import { demoAffinity, demoDetail, demoEntity, demoRelated, demoSearch, qlooTypeOf } from './demo.ts'
import { km } from './markets.ts'
import type { CityDetail, Entity, Kind, Market, Pick, Spot, Supply, Tag } from './types.ts'

const KEY = process.env.QLOO_API_KEY ?? ''
const BASE = (process.env.QLOO_BASE_URL ?? 'https://hackathon.api.qloo.com').replace(/\/$/, '')
const limit = limiter(6)

export const qlooLive = () => !!KEY

type Raw = Record<string, any> // upstream JSON; parsed defensively below

async function get(pathname: string, params: Record<string, string | number | undefined>): Promise<Raw> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const url = `${BASE}${pathname}?${qs}`
  return cached(`qloo ${url}`, DAY, () =>
    limit(async () => {
      const res = await fetch(url, { headers: { 'X-Api-Key': KEY, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
      const body = await res.text()
      if (!res.ok) throw new Error(`Qloo ${pathname} ${res.status}: ${body.slice(0, 200)}`)
      return JSON.parse(body) as Raw
    }),
  )
}

const insights = (params: Record<string, string | number | undefined>) => get('/v2/insights', params)

function toTags(raw: unknown): Tag[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((x: Raw) => ({ id: String(x.id ?? x.tag_id ?? ''), name: String(x.name ?? ''), type: x.type ? String(x.type) : undefined }))
    .filter((x) => x.id && x.name)
}

function toEntity(x: Raw, kind: Kind): Entity {
  const p = x.properties ?? {}
  return {
    id: String(x.entity_id ?? x.id),
    name: String(x.name),
    kind,
    qlooType: qlooTypeOf(kind),
    image: p.image?.url ?? undefined,
    blurb: p.short_description ?? p.description ?? undefined,
    popularity: typeof x.popularity === 'number' ? x.popularity : undefined,
    tags: toTags(x.tags).slice(0, 40), // the signals below need the cuisine and occupation tags, which come late
    source: 'qloo',
  }
}

function toPick(x: Raw): Pick {
  const p = x.properties ?? {}
  return {
    id: String(x.entity_id ?? x.id),
    name: String(x.name),
    affinity: typeof x.query?.affinity === 'number' ? x.query.affinity : undefined,
    address: p.address ?? undefined,
    blurb: p.short_description ?? p.description ?? undefined,
    tags: toTags(x.tags).slice(0, 4).map((t) => t.name),
  }
}

const entities = (r: Raw): Raw[] => r.results?.entities ?? r.results ?? []

// Entities seen in search, so a scan can start from an id without a lookup.
const known = new Map<string, Entity>()

export async function search(query: string, kind: Kind): Promise<Entity[]> {
  if (!KEY) return demoSearch(query, kind)
  const r = await get('/search', { query, types: qlooTypeOf(kind), take: 8 })
  const out = (r.results ?? []).map((x: Raw) => toEntity(x, kind)) as Entity[]
  for (const e of out) known.set(e.id, e)
  return out
}

export async function entity(id: string, kind: Kind): Promise<Entity | undefined> {
  if (id.startsWith('demo:') || !KEY) return demoEntity(id)
  const hit = known.get(id)
  if (hit) return hit
  const r = await get('/entities', { entity_ids: id })
  const x = (r.results ?? r.entities ?? [])[0]
  if (!x) return undefined
  const e = toEntity(x, kind)
  known.set(id, e)
  return e
}

// Qloo's person graph mixes every kind of public figure: Ali Wong's nearest
// "people" are finance creators and parenting accounts. Keep person results to
// the act's own occupation (comedian for comedians).
export function sameKind(e: Entity): Record<string, string> {
  if (e.qlooType !== 'urn:entity:person') return {}
  const jobs = e.tags.filter((t) => t.id.startsWith('urn:tag:occupation:person:'))
  const job = (e.kind === 'comedian' && jobs.find((t) => t.id.endsWith(':comedian'))) || jobs[0]
  return job ? { 'filter.tags': job.id } : e.kind === 'comedian' ? { 'filter.tags': 'urn:tag:occupation:person:comedian' } : {}
}

export async function related(e: Entity, n = 8): Promise<Pick[]> {
  if (e.source === 'demo') return demoRelated(e, n)
  const r = await insights({ 'filter.type': e.qlooType, 'signal.interests.entities': e.id, ...sameKind(e), take: n + 1 })
  return entities(r).map(toPick).filter((p) => p.id !== e.id).slice(0, n)
}

// --- market affinity --------------------------------------------------------------

// From Vancouver to Nairobi, Johannesburg to Glasgow: every market sits inside.
const WORLD = 'POLYGON((-130 -40, 60 -40, 60 62, -130 62, -130 -40))'

export type Demand = { affinity: number; percentile: number }

// A heatmap signalled by a single restaurant makes Qloo time out (504 after a
// minute), so places signal by restaurant genre tags instead. Only
// urn:tag:genre:place:restaurant:* tags register on a heatmap (cuisine and
// culinary_style tags return no cells), so those are mapped across by name:
// culinary_style:qloo:fine_dining → genre:place:restaurant:fine_dining.
function heatSignal(e: Entity): Record<string, string> {
  if (e.qlooType === 'urn:entity:place') {
    const direct = e.tags.filter((t) => t.id.startsWith('urn:tag:genre:place:restaurant:')).map((t) => t.id)
    const mapped = e.tags
      .filter((t) => /^urn:tag:(cuisine|culinary_style):qloo:/.test(t.id))
      .map((t) => `urn:tag:genre:place:restaurant:${t.id.split(':').pop()}`)
    const tags = [...new Set([...direct, ...mapped])].slice(0, 4)
    if (tags.length) return { 'signal.interests.tags': tags.join(','), 'operator.signal.interests.tags': 'union' }
  }
  return { 'signal.interests.entities': e.id }
}

export async function marketAffinity(e: Entity, markets: Market[]): Promise<Map<string, Demand>> {
  const out = new Map<string, Demand>()
  if (e.source === 'demo') {
    for (const mk of markets) {
      const a = demoAffinity(e, mk)
      out.set(mk.id, { affinity: a, percentile: a })
    }
    return out
  }
  const r = await insights({ 'filter.type': 'urn:heatmap', 'filter.location': WORLD, 'output.heatmap.boundary': 'urn:geohash', ...heatSignal(e) })
  const cells = ((r.results?.heatmap ?? []) as Raw[])
    .map((p) => ({ lat: Number(p.location?.latitude), lng: Number(p.location?.longitude), affinity: Number(p.query?.affinity ?? 0), rank: Number(p.query?.affinity_rank ?? 0) }))
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
  for (const mk of markets) {
    let best: (typeof cells)[number] | null = null
    let bestKm = 110 // a cell is ~150 km across; further than this isn't this city
    for (const c of cells) {
      const d = km(mk, c)
      if (d < bestKm) [best, bestKm] = [c, d]
    }
    if (best) out.set(mk.id, { affinity: best.affinity, percentile: best.rank })
  }
  return out
}

// --- one city -------------------------------------------------------------------------

// Cities go to Qloo as coordinates, never names: a locality search for
// "Washington" lands in Washington State, "Birmingham" can be Alabama.
const point = (mk: Market) => `POINT(${mk.lng} ${mk.lat})`
const inCity = (mk: Market) => ({ 'filter.location': point(mk), 'filter.location.radius': 35_000 })

async function cityHeat(e: Entity, mk: Market): Promise<Spot[]> {
  const r = await insights({ 'filter.type': 'urn:heatmap', ...inCity(mk), ...heatSignal(e) })
  const pts: Raw[] = r.results?.heatmap ?? []
  return pts
    .map((p) => ({ lat: Number(p.location?.latitude), lng: Number(p.location?.longitude), geohash: p.location?.geohash, affinity: Number(p.query?.affinity ?? 0) }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
}

// Tag searches for the kind of room each kind of act plays, and for partners.
const VENUE_TAGS: Record<Kind, string[]> = {
  artist: ['music venue', 'concert hall', 'nightclub'],
  comedian: ['comedy club', 'performing arts theater', 'concert hall'],
  author: ['bookstore', 'library'],
  podcast: ['performing arts theater', 'music venue'],
  brand: ['boutique', 'art gallery'],
  film: ['movie theater'],
  game: ['arcade', 'bar'],
  chef: ['restaurant'],
}

async function tagId(query: string): Promise<string | null> {
  const r = await get('/v2/tags', { 'filter.query': query, take: 5 })
  const tags = toTags(r.results?.tags ?? r.results ?? [])
  const exact = tags.find((x) => x.name.toLowerCase() === query) ?? tags.find((x) => x.id.includes('place')) ?? tags[0]
  return exact?.id ?? null
}

async function places(e: Entity, mk: Market, tagQuery: string, n: number): Promise<Pick[]> {
  const tag = await tagId(tagQuery).catch(() => null)
  const r = await insights({
    'filter.type': 'urn:entity:place',
    'signal.interests.entities': e.id,
    ...inCity(mk),
    'filter.tags': tag ?? undefined,
    take: n,
  })
  return entities(r).map(toPick)
}

// A few rooms of each type (clubs and theatres, say), so a brief asking for
// 2,000 seats has something to choose from; any shortfall is filled in order.
async function venuesFor(e: Entity, mk: Market, n: number): Promise<Pick[]> {
  const tags = VENUE_TAGS[e.kind]
  const lists = await Promise.all(tags.map((tag) => places(e, mk, tag, n).catch(() => [] as Pick[])))
  const out: Pick[] = []
  const add = (p: Pick) => !out.some((x) => x.id === p.id) && out.push(p)
  const each = Math.ceil(n / tags.length)
  for (const list of lists) list.slice(0, each).forEach(add)
  for (const list of lists) for (const p of list) if (out.length < n) add(p)
  return out.slice(0, n)
}

// Acts the same fans love that are no bigger than the act itself: a support
// slot, not a co-headliner. Widens if the cap leaves too few. (Weighting this to
// the city pulled in local acts from other genres, so it isn't.)
async function openersFor(e: Entity): Promise<Pick[]> {
  const base = { 'filter.type': e.qlooType, 'signal.interests.entities': e.id, ...sameKind(e), take: 8 }
  const cap = e.popularity !== undefined ? Math.min(0.97, e.popularity) : undefined
  let r = cap !== undefined ? await insights({ ...base, 'filter.popularity.max': cap.toFixed(3) }).catch(() => null) : null
  if (!r || entities(r).length < 3) r = await insights(base)
  return entities(r).map(toPick).filter((p) => p.id !== e.id).slice(0, 5)
}

async function audience(e: Entity): Promise<CityDetail['audience']> {
  const r = await insights({ 'filter.type': 'urn:demographics', 'signal.interests.entities': e.id })
  const q = (r.results?.demographics ?? [])[0]?.query
  if (!q?.age) return null
  const LABELS: Record<string, string> = {
    '24_and_younger': '24 and under', '25_to_29': '25–29', '30_to_34': '30–34', '35_to_44': '35–44', '45_to_54': '45–54', '55_and_older': '55+',
  }
  // Qloo reports each band as an affinity around 0; turn them into relative weights.
  const rows = Object.entries(LABELS).map(([k, label]) => ({ label, w: Math.max(0.02, 1 + Number(q.age[k] ?? 0)) }))
  const sum = rows.reduce((a, b) => a + b.w, 0)
  const f = Math.max(0.02, 1 + Number(q.gender?.female ?? 0))
  const m = Math.max(0.02, 1 + Number(q.gender?.male ?? 0))
  return { age: rows.map((x) => ({ label: x.label, share: x.w / sum })), gender: q.gender ? { female: f / (f + m), male: m / (f + m) } : undefined }
}

export async function cityDetail(e: Entity, mk: Market, supply: Supply): Promise<CityDetail> {
  if (e.source === 'demo') return demoDetail(e, mk, supply)
  const soft = <T>(p: Promise<T>, fallback: T) => p.catch((err) => (console.warn(`[qloo] ${mk.id}: ${(err as Error).message}`), fallback))
  const [heat, venues, openers, podcasts, food, aud] = await Promise.all([
    soft(cityHeat(e, mk), []),
    soft(venuesFor(e, mk, 6), []),
    soft(openersFor(e), []),
    soft(insights({ 'filter.type': 'urn:entity:podcast', 'signal.interests.entities': e.id, 'signal.location': point(mk), take: 3 }).then((r) => entities(r).map((x) => ({ ...toPick(x), blurb: 'Podcast' }))), []),
    soft(places(e, mk, e.kind === 'chef' ? 'bar' : 'restaurant', 3), []),
    soft(audience(e), null),
  ])
  return { market: mk, heat, venues, openers, partners: [...podcasts, ...food], audience: aud, supply, source: 'qloo' }
}
