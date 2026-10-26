// Supply: how many comparable shows a market already has booked, from the
// Ticketmaster Discovery API (events.json, filtered by classification, a 50 km
// radius around the city, and a date window). Without TICKETMASTER_API_KEY the
// counts come from demo.ts. Kinds that don't tour through ticketed venues
// (brands, chefs) and markets Ticketmaster doesn't cover get no supply figure.

import { cached, limiter, HOUR } from './cache.ts'
import { demoSupply } from './demo.ts'
import type { Entity, Kind, Listing, Market, Supply } from './types.ts'

const KEY = process.env.TICKETMASTER_API_KEY ?? ''
const limit = limiter(4) // the free tier allows 5 requests a second

export const ticketmasterLive = () => !!KEY

// Ticketmaster classification names per kind. Music narrows to a genre below.
const CLASS: Record<Kind, string | null> = {
  artist: 'Music',
  comedian: 'Comedy',
  author: 'Spoken Word',
  podcast: 'Comedy',
  brand: null,
  film: 'Film',
  game: 'Miscellaneous',
  chef: null,
}

// Qloo tag words that map onto Ticketmaster music genres.
const GENRES: [RegExp, string][] = [
  [/afro|amapiano|fuji|dancehall|reggae/i, 'World'],
  [/hip.?hop|rap|grime|trap/i, 'Hip-Hop/Rap'],
  [/r&b|rnb|soul/i, 'R&B'],
  [/country|americana|bluegrass/i, 'Country'],
  [/electronic|house|techno|edm/i, 'Dance/Electronic'],
  [/folk|singer.songwriter/i, 'Folk'],
  [/indie|alternative|psychedelic/i, 'Alternative'],
  [/jazz|funk/i, 'Jazz'],
  [/rock|punk|metal/i, 'Rock'],
  [/latin|reggaeton/i, 'Latin'],
  [/pop/i, 'Pop'],
]

export function classificationFor(e: Entity): string | null {
  const base = CLASS[e.kind]
  if (base !== 'Music') return base
  for (const tag of e.tags) for (const [re, genre] of GENRES) if (re.test(tag.name)) return genre
  return 'Music'
}

export function window90(from = new Date()) {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1))
  const end = new Date(start.getTime() + 90 * 86_400_000)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

export async function supply(e: Entity, mk: Market, window = window90()): Promise<Supply> {
  const cls = classificationFor(e)
  if (!cls || !mk.ticketmaster) return { count: null, perMillion: null, listings: [], source: 'none', window }
  if (!KEY) return demoSupply(e, mk, window)
  const params = new URLSearchParams({
    apikey: KEY,
    classificationName: cls,
    latlong: `${mk.lat},${mk.lng}`,
    radius: '50',
    unit: 'km',
    countryCode: mk.cc,
    startDateTime: `${window.from}T00:00:00Z`,
    endDateTime: `${window.to}T23:59:59Z`,
    sort: 'date,asc',
    size: '40',
  })
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`
  const r = await cached(`tm ${url.replace(KEY, '')}`, 6 * HOUR, () =>
    limit(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`Ticketmaster ${res.status}: ${(await res.text()).slice(0, 160)}`)
      return (await res.json()) as { page?: { totalElements?: number }; _embedded?: { events?: any[] } }
    }),
  )
  const count = r.page?.totalElements ?? 0
  const listings: Listing[] = (r._embedded?.events ?? []).slice(0, 12).map((ev) => ({
    name: String(ev.name),
    date: String(ev.dates?.start?.localDate ?? ''),
    venue: String(ev._embedded?.venues?.[0]?.name ?? ''),
    url: ev.url ? String(ev.url) : undefined,
  }))
  return { count, perMillion: count / mk.metroM, listings, source: 'ticketmaster', window }
}
