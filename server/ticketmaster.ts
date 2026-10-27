// Supply: what a market already has booked, from the Ticketmaster Discovery API.
// Two counts per market, over the next 90 days:
//
//   genre       shows in the matching Ticketmaster genre within 50 km: the
//               baseline of how busy the city's scene is.
//   same crowd  shows by the act itself and by the 15 acts Qloo says its audience
//               loves most, found by name worldwide (one call per act) and
//               assigned to any market within 50 km of the venue. These are direct
//               competitors for the same people's nights out. Most acts aren't
//               touring in any given 90 days, so this count is small and sparse.
//
// Without TICKETMASTER_API_KEY the counts come from demo.ts. Kinds that don't
// tour through ticketed venues (authors, brands, films, games, chefs) and markets
// Ticketmaster doesn't really cover get no supply figure.

import { cached, limiter, HOUR } from './cache.ts'
import { demoSupply } from './demo.ts'
import { km } from './markets.ts'
import type { Entity, Kind, Listing, Market, Pick, Supply } from './types.ts'

const KEY = process.env.TICKETMASTER_API_KEY ?? ''
// The free tier allows 5 requests a second: at most 4 in flight, starts 220 ms apart.
const inFlight = limiter(4)
let nextStart = 0
const limit = <T>(fn: () => Promise<T>) =>
  inFlight(async () => {
    const wait = Math.max(0, nextStart - Date.now())
    nextStart = Math.max(Date.now(), nextStart) + 220
    if (wait) await new Promise((r) => setTimeout(r, wait))
    return fn()
  })

export const ticketmasterLive = () => !!KEY

// Ticketmaster classification names for the kinds that tour ticketed rooms.
// Music narrows to a genre below.
const CLASS: Record<Kind, string | null> = {
  artist: 'Music',
  comedian: 'Comedy',
  podcast: 'Comedy',
  author: null,
  brand: null,
  film: null,
  game: null,
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

type Page = { page?: { totalElements?: number }; _embedded?: { events?: any[] } }

async function query(window: Supply['window'], params: Record<string, string>, ttl: number): Promise<Page> {
  const qs = new URLSearchParams({ apikey: KEY, startDateTime: `${window.from}T00:00:00Z`, endDateTime: `${window.to}T23:59:59Z`, ...params })
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${qs}`
  return cached(`tm ${url.replace(KEY, '')}`, ttl, () =>
    limit(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`Ticketmaster ${res.status}: ${(await res.text()).slice(0, 160)}`)
      return (await res.json()) as Page
    }),
  )
}

const near = (mk: Market) => ({ latlong: `${mk.lat},${mk.lng}`, radius: '50', unit: 'km', countryCode: mk.cc })

// Some countries Ticketmaster "covers" list next to nothing (France returns zero
// events for all of Paris). Below this many events of any kind in 90 days, a
// market has no usable listing data, and a zero there means nothing.
const MIN_LISTED = 50

async function covered(mk: Market, window: Supply['window']) {
  if (!mk.ticketmaster) return false
  const r = await query(window, { ...near(mk), size: '1' }, 24 * HOUR)
  return (r.page?.totalElements ?? 0) >= MIN_LISTED
}

// The coverage checks don't depend on the act, so run them once at startup.
export async function warmCoverage(markets: Market[]) {
  if (!KEY) return
  const window = window90()
  await Promise.all(markets.map((mk) => covered(mk, window).catch(() => false)))
}

// --- same-crowd shows -----------------------------------------------------------------

export type CrowdShow = Listing & { id: string; lat: number; lng: number }

// Upcoming shows by the act and the acts its audience loves, matched on the
// attraction name so "Ali Wong" doesn't pick up a tribute night.
export async function sameCrowd(e: Entity, related: Pick[], window = window90()): Promise<CrowdShow[] | null> {
  if (!KEY || !CLASS[e.kind] || e.source === 'demo') return null
  const acts = [{ name: e.name, self: true }, ...related.slice(0, 15).map((r) => ({ name: r.name, self: false }))]
  const found = await Promise.all(
    acts.map(async (act) => {
      const r = await query(window, { keyword: act.name, size: '100', sort: 'date,asc' }, 6 * HOUR).catch(() => null)
      const want = act.name.toLowerCase()
      return (r?._embedded?.events ?? [])
        .filter((ev) => (ev._embedded?.attractions ?? []).some((a: any) => String(a.name).toLowerCase() === want))
        .map((ev): CrowdShow | null => {
          const v = ev._embedded?.venues?.[0]
          const lat = Number(v?.location?.latitude)
          const lng = Number(v?.location?.longitude)
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
          return {
            id: String(ev.id),
            name: String(ev.name),
            date: String(ev.dates?.start?.localDate ?? ''),
            venue: [v?.name, v?.city?.name].filter(Boolean).join(', '),
            url: ev.url ? String(ev.url) : undefined,
            act: act.name,
            self: act.self,
            lat,
            lng,
          }
        })
        .filter((x): x is CrowdShow => !!x)
    }),
  )
  // One listing per act per night per city (Ticketmaster often lists a show twice).
  const seen = new Set<string>()
  const shows = found.flat().filter((s) => {
    const key = `${s.act}|${s.date}|${s.venue.split(', ').pop()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return shows.sort((a, b) => a.date.localeCompare(b.date))
}

// --- one market --------------------------------------------------------------------

export async function supply(e: Entity, mk: Market, window = window90(), crowd?: CrowdShow[] | null): Promise<Supply> {
  const cls = classificationFor(e)
  const none: Supply = { count: null, perMillion: null, crowd: null, self: 0, listings: [], source: 'none', window }
  if (!cls || !mk.ticketmaster) return none
  if (!KEY || e.source === 'demo') return demoSupply(e, mk, window)
  if (!(await covered(mk, window))) return none
  const r = await query(window, { ...near(mk), classificationName: cls, sort: 'date,asc', size: '40' }, 6 * HOUR)
  const count = r.page?.totalElements ?? 0
  const here = crowd ? crowd.filter((s) => km(mk, s) <= 50) : null
  const genre: Listing[] = (r._embedded?.events ?? []).map((ev) => ({
    name: String(ev.name),
    date: String(ev.dates?.start?.localDate ?? ''),
    venue: String(ev._embedded?.venues?.[0]?.name ?? ''),
    url: ev.url ? String(ev.url) : undefined,
  }))
  const mine: Listing[] = (here ?? []).map(({ name, date, venue, url, act, self }) => ({ name, date, venue, url, act, self }))
  const listings = [...mine, ...genre.filter((g) => !mine.some((m) => m.url && m.url === g.url))].slice(0, 14)
  return {
    count,
    perMillion: count / mk.metroM,
    crowd: here ? here.length : null,
    self: here ? here.filter((s) => s.self).length : 0,
    listings,
    source: 'ticketmaster',
    window,
  }
}
