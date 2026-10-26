// Qloo client. With QLOO_API_KEY set, every call goes to the hackathon API
// (hackathon.api.qloo.com, key in the X-Api-Key header); without it, the same
// functions answer from demo.ts and mark the result as demo.
//
// Where the demand numbers come from:
//   market affinity  Insights, filter.type=urn:entity:destination, signalled by
//                    the entity: how much its audience over-indexes on each city.
//                    If destinations don't resolve, each city's heatmap is averaged.
//   neighbourhoods   Insights, filter.type=urn:heatmap inside one city.
//   openers          Insights for the same entity type, signalled by the entity
//                    and biased to the city with signal.location.query.
//   venues/partners  Insights for places (filtered by tag) and podcasts in the city.
//   audience         Insights, filter.type=urn:demographics.

import { cached, limiter, DAY } from './cache.ts'
import { demoAffinity, demoDetail, demoEntity, demoRelated, demoSearch, qlooTypeOf } from './demo.ts'
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
    tags: toTags(x.tags).slice(0, 14),
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

export async function related(e: Entity, n = 8): Promise<Pick[]> {
  if (e.source === 'demo') return demoRelated(e, n)
  const r = await insights({ 'filter.type': e.qlooType, 'signal.interests.entities': e.id, take: n + 1 })
  return entities(r).map(toPick).filter((p) => p.id !== e.id).slice(0, n)
}

// --- market affinity --------------------------------------------------------------

async function destinationId(mk: Market): Promise<string | null> {
  const r = await get('/search', { query: `${mk.name}, ${mk.country}`, types: 'urn:entity:destination', take: 3 })
  const x = (r.results ?? []).find((y: Raw) => String(y.name).toLowerCase().startsWith(mk.name.toLowerCase())) ?? (r.results ?? [])[0]
  return x ? String(x.entity_id ?? x.id) : null
}

export async function marketAffinity(e: Entity, markets: Market[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (e.source === 'demo') {
    for (const mk of markets) out.set(mk.id, demoAffinity(e, mk))
    return out
  }
  const ids = await Promise.all(markets.map((mk) => destinationId(mk).catch(() => null)))
  const byDest = new Map<string, string>()
  ids.forEach((id, i) => id && byDest.set(id, markets[i].id))
  if (byDest.size) {
    const dest = [...byDest.keys()]
    for (let i = 0; i < dest.length; i += 50) {
      const r = await insights({
        'filter.type': 'urn:entity:destination',
        'signal.interests.entities': e.id,
        'filter.results.entities': dest.slice(i, i + 50).join(','),
        take: 50,
      }).catch(() => null)
      for (const x of r ? entities(r) : []) {
        const mid = byDest.get(String(x.entity_id ?? x.id))
        if (mid && typeof x.query?.affinity === 'number') out.set(mid, x.query.affinity)
      }
    }
  }
  // Markets the destination route missed: average the top of the city's heatmap.
  const missing = markets.filter((mk) => !out.has(mk.id))
  await Promise.all(
    missing.map(async (mk) => {
      const heat = await cityHeat(e, mk).catch(() => [])
      if (!heat.length) return
      const top = heat.map((s) => s.affinity).sort((a, b) => b - a).slice(0, Math.max(3, Math.ceil(heat.length / 4)))
      out.set(mk.id, top.reduce((a, b) => a + b, 0) / top.length)
    }),
  )
  return out
}

// --- one city -------------------------------------------------------------------------

async function cityHeat(e: Entity, mk: Market): Promise<Spot[]> {
  const r = await insights({ 'filter.type': 'urn:heatmap', 'filter.location.query': mk.name, 'signal.interests.entities': e.id })
  const pts: Raw[] = r.results?.heatmap ?? []
  return pts
    .map((p) => ({ lat: Number(p.location?.latitude), lng: Number(p.location?.longitude), geohash: p.location?.geohash, affinity: Number(p.query?.affinity ?? 0) }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
}

// Tag searches for the kind of room each kind of act plays, and for partners.
const VENUE_TAG: Record<Kind, string> = {
  artist: 'music venue',
  comedian: 'comedy club',
  author: 'bookstore',
  podcast: 'theater',
  brand: 'boutique',
  film: 'movie theater',
  game: 'arcade',
  chef: 'restaurant',
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
    'filter.location.query': mk.name,
    'filter.tags': tag ?? undefined,
    take: n,
  })
  return entities(r).map(toPick)
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
    soft(places(e, mk, VENUE_TAG[e.kind], 6), []),
    soft(insights({ 'filter.type': e.qlooType, 'signal.interests.entities': e.id, 'signal.location.query': mk.name, take: 7 }).then((r) => entities(r).map(toPick).filter((p) => p.id !== e.id).slice(0, 5)), []),
    soft(insights({ 'filter.type': 'urn:entity:podcast', 'signal.interests.entities': e.id, 'signal.location.query': mk.name, take: 3 }).then((r) => entities(r).map((x) => ({ ...toPick(x), blurb: 'Podcast' }))), []),
    soft(places(e, mk, e.kind === 'chef' ? 'bar' : 'restaurant', 3), []),
    soft(audience(e), null),
  ])
  return { market: mk, heat, venues, openers, partners: [...podcasts, ...food], audience: aud, supply, source: 'qloo' }
}
