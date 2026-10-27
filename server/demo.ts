// Demo data, used for any source whose API key isn't set. Every number here is
// simulated from a seed (the same input always gives the same output), and the
// API marks the response as demo so the UI can say so. Names in the catalogue
// are real so the search box feels normal; their scores are not.

import type { CityDetail, Entity, Kind, Listing, Market, Pick, Spot, Supply, Tag } from './types.ts'

export function seeded(key: string) {
  let h = 1779033703 ^ key.length
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const QLOO_TYPE: Record<Kind, string> = {
  artist: 'urn:entity:artist',
  comedian: 'urn:entity:person',
  author: 'urn:entity:book',
  podcast: 'urn:entity:podcast',
  brand: 'urn:entity:brand',
  film: 'urn:entity:movie',
  game: 'urn:entity:video_game',
  chef: 'urn:entity:place',
}
export const qlooTypeOf = (k: Kind) => QLOO_TYPE[k]

const t = (...names: string[]): Tag[] => names.map((n) => ({ id: `demo:tag:${n.replace(/\W+/g, '_')}`, name: n }))

type Seed = [name: string, kind: Kind, tags: string[], blurb: string]
const CATALOGUE: Seed[] = [
  ['Asake', 'artist', ['afrobeats', 'amapiano', 'fuji', 'nigerian'], 'Nigerian singer blending fuji, amapiano and street-pop.'],
  ['Tems', 'artist', ['afrobeats', 'r&b', 'alté', 'nigerian'], 'Nigerian singer and songwriter.'],
  ['Burna Boy', 'artist', ['afrobeats', 'afro-fusion', 'dancehall', 'nigerian'], 'Nigerian Afro-fusion star.'],
  ['Ayra Starr', 'artist', ['afrobeats', 'afropop', 'r&b', 'nigerian'], 'Nigerian Afropop singer.'],
  ['Little Simz', 'artist', ['uk rap', 'hip hop', 'r&b', 'london'], 'London rapper.'],
  ['Phoebe Bridgers', 'artist', ['indie', 'folk', 'singer-songwriter'], 'Indie singer-songwriter.'],
  ['Khruangbin', 'artist', ['psychedelic', 'funk', 'indie'], 'Texas trio, global-funk instrumentals.'],
  ['Zach Bryan', 'artist', ['country', 'americana', 'folk'], 'Country singer-songwriter.'],
  ['Tyler Childers', 'artist', ['country', 'bluegrass', 'americana'], 'Kentucky country singer.'],
  ['Fred again..', 'artist', ['electronic', 'house', 'uk'], 'London producer.'],
  ['Ali Wong', 'comedian', ['stand-up', 'comedy'], 'Stand-up comedian.'],
  ['Taylor Tomlinson', 'comedian', ['stand-up', 'comedy'], 'Stand-up comedian.'],
  ['Basketmouth', 'comedian', ['stand-up', 'comedy', 'nigerian'], 'Nigerian stand-up comedian.'],
  ['Mark Normand', 'comedian', ['stand-up', 'comedy', 'new york'], 'New York stand-up.'],
  ['Fourth Wing', 'author', ['romantasy', 'fantasy', 'booktok'], 'Rebecca Yarros, fantasy romance.'],
  ['Things Fall Apart', 'author', ['literary', 'african literature', 'classic'], 'Chinua Achebe.'],
  ['Tomorrow, and Tomorrow, and Tomorrow', 'author', ['literary', 'gaming', 'contemporary'], 'Gabrielle Zevin.'],
  ['Call Her Daddy', 'podcast', ['comedy', 'relationships', 'culture'], 'Alex Cooper.'],
  ['Morbid', 'podcast', ['true crime', 'comedy'], 'True-crime podcast.'],
  ['The Joe Budden Podcast', 'podcast', ['hip hop', 'culture', 'comedy'], 'Hip-hop talk show.'],
  ['I Said What I Said', 'podcast', ['culture', 'nigerian', 'relationships'], 'Lagos culture podcast.'],
  ['Aimé Leon Dore', 'brand', ['streetwear', 'menswear', 'fashion'], 'New York menswear label.'],
  ['Orange Culture', 'brand', ['fashion', 'nigerian', 'menswear'], 'Lagos fashion label.'],
  ['Telfar', 'brand', ['fashion', 'streetwear', 'accessories'], 'New York fashion label.'],
  ['Everything Everywhere All at Once', 'film', ['indie', 'a24', 'sci-fi'], 'A24 multiverse film.'],
  ['Anikulapo', 'film', ['nollywood', 'drama', 'nigerian'], 'Yoruba-language epic.'],
  ['Hades', 'game', ['indie games', 'roguelike', 'gaming'], 'Supergiant roguelike.'],
  ['Stardew Valley', 'game', ['cozy games', 'indie games', 'gaming'], 'Farming sim.'],
  ['Ikoyi', 'chef', ['west african', 'fine dining', 'food'], 'London restaurant, West African spice.'],
  ['Momofuku', 'chef', ['korean american', 'food', 'casual dining'], 'New York restaurant group.'],
]

const KIND_TAGS: Record<Kind, string[]> = {
  artist: ['music'],
  comedian: ['stand-up', 'comedy'],
  author: ['literary'],
  podcast: ['culture'],
  brand: ['fashion'],
  film: ['film'],
  game: ['gaming'],
  chef: ['food'],
}

function toEntity([name, kind, tags, blurb]: Seed): Entity {
  return { id: `demo:${kind}:${slug(name)}`, name, kind, qlooType: QLOO_TYPE[kind], blurb, popularity: 0.6 + seeded(name)() * 0.38, tags: t(...tags), source: 'demo' }
}

export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function demoSearch(query: string, kind?: Kind): Entity[] {
  const q = query.trim().toLowerCase()
  const hits = CATALOGUE.filter((s) => (!kind || s[1] === kind) && (!q || s[0].toLowerCase().includes(q))).map(toEntity)
  if (hits.length || !q) return hits.slice(0, 8)
  // Anything else still works: an entity with only the kind's generic tags.
  const k = kind ?? 'artist'
  return [{ id: `demo:${k}:${slug(query)}`, name: query.trim(), kind: k, qlooType: QLOO_TYPE[k], blurb: 'Not in the demo catalogue: scored from its kind alone.', popularity: 0.5, tags: t(...KIND_TAGS[k]), source: 'demo' }]
}

export function demoEntity(id: string): Entity | undefined {
  const s = CATALOGUE.find((x) => `demo:${x[1]}:${slug(x[0])}` === id)
  if (s) return toEntity(s)
  const m = /^demo:(\w+):(.+)$/.exec(id)
  if (!m) return undefined
  const kind = m[1] as Kind
  const name = m[2].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return { id, name, kind, qlooType: QLOO_TYPE[kind], popularity: 0.5, tags: t(...(KIND_TAGS[kind] ?? ['music'])), source: 'demo' }
}

export function demoRelated(e: Entity, n = 6): Pick[] {
  const mine = new Set(e.tags.map((x) => x.name))
  return CATALOGUE.filter((s) => s[1] === e.kind && s[0] !== e.name)
    .map((s) => ({ s, overlap: s[2].filter((x) => mine.has(x)).length + seeded(e.id + s[0])() }))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, n)
    .map(({ s, overlap }) => ({ id: `demo:${s[1]}:${slug(s[0])}`, name: s[0], affinity: Math.min(0.99, 0.45 + overlap / 5), blurb: s[3], tags: s[2] }))
}

// What each market leans towards, so simulated demand isn't pure noise.
const LEANS: Record<string, string[]> = {
  nyc: ['comedy', 'stand-up', 'fashion', 'streetwear', 'literary', 'hip hop', 'afrobeats', 'food', 'indie', 'a24', 'new york'],
  la: ['comedy', 'podcast', 'culture', 'fashion', 'indie', 'gaming', 'electronic', 'r&b'],
  chicago: ['comedy', 'stand-up', 'house', 'hip hop', 'food', 'indie'],
  houston: ['hip hop', 'afrobeats', 'r&b', 'country', 'nigerian', 'food'],
  dallas: ['country', 'hip hop', 'afrobeats', 'nigerian', 'true crime'],
  atlanta: ['hip hop', 'r&b', 'afrobeats', 'nigerian', 'afropop', 'culture'],
  dc: ['afrobeats', 'r&b', 'literary', 'african literature', 'culture'],
  philly: ['hip hop', 'r&b', 'comedy', 'indie'],
  miami: ['electronic', 'house', 'dancehall', 'fashion'],
  boston: ['literary', 'indie', 'folk', 'comedy'],
  phoenix: ['country', 'true crime', 'romantasy'],
  sf: ['gaming', 'indie games', 'electronic', 'food', 'psychedelic'],
  detroit: ['house', 'electronic', 'hip hop', 'r&b'],
  seattle: ['indie', 'gaming', 'indie games', 'cozy games', 'literary', 'folk'],
  minneapolis: ['indie', 'folk', 'literary', 'afropop'],
  denver: ['americana', 'bluegrass', 'folk', 'electronic', 'podcast'],
  charlotte: ['country', 'hip hop', 'true crime'],
  portland: ['indie', 'folk', 'literary', 'singer-songwriter', 'cozy games'],
  austin: ['indie', 'country', 'psychedelic', 'funk', 'comedy', 'gaming', 'podcast', 'food'],
  columbus: ['indie', 'folk', 'singer-songwriter', 'afrobeats', 'romantasy', 'true crime'],
  kc: ['country', 'americana', 'true crime', 'romantasy'],
  nashville: ['country', 'americana', 'bluegrass', 'folk', 'singer-songwriter'],
  raleigh: ['indie', 'folk', 'bluegrass', 'romantasy'],
  nola: ['funk', 'psychedelic', 'food', 'hip hop'],
  toronto: ['afrobeats', 'r&b', 'hip hop', 'comedy', 'nigerian', 'dancehall'],
  montreal: ['comedy', 'stand-up', 'electronic', 'gaming', 'indie games'],
  vancouver: ['indie', 'gaming', 'electronic'],
  calgary: ['country', 'afropop', 'nigerian'],
  london: ['afrobeats', 'nigerian', 'amapiano', 'uk rap', 'electronic', 'house', 'uk', 'comedy', 'literary', 'fashion', 'west african', 'fine dining', 'london'],
  manchester: ['indie', 'uk rap', 'electronic', 'afrobeats'],
  birmingham: ['uk rap', 'afrobeats', 'dancehall'],
  glasgow: ['indie', 'electronic', 'folk', 'comedy'],
  dublin: ['literary', 'folk', 'comedy', 'indie'],
  paris: ['fashion', 'electronic', 'afrobeats', 'food', 'fine dining'],
  amsterdam: ['electronic', 'house', 'psychedelic'],
  brussels: ['afrobeats', 'electronic', 'fashion'],
  berlin: ['electronic', 'house', 'indie games', 'gaming'],
  lagos: ['afrobeats', 'amapiano', 'fuji', 'nigerian', 'afropop', 'alté', 'nollywood', 'fashion', 'stand-up', 'culture'],
  abuja: ['afrobeats', 'afropop', 'nigerian', 'nollywood'],
  accra: ['afrobeats', 'afropop', 'amapiano', 'fashion'],
  nairobi: ['afropop', 'amapiano', 'hip hop'],
  joburg: ['amapiano', 'house', 'afropop', 'hip hop'],
}

export function demoAffinity(e: Entity, mk: Market) {
  const lean = new Set(LEANS[mk.id] ?? [])
  const hits = e.tags.filter((x) => lean.has(x.name.toLowerCase())).length
  const noise = seeded(`${e.id}|${mk.id}`)()
  return Math.min(0.97, 0.18 + noise * 0.3 + hits * 0.14 + Math.log10(1 + mk.metroM) * 0.04)
}

// How many comparable shows a market books in 90 days, per million people.
const SUPPLY_RATE: Record<Kind, number> = { artist: 9, comedian: 6, podcast: 1.2, author: 0, brand: 0, film: 0, game: 0, chef: 0 }

export function demoSupply(e: Entity, mk: Market, window: Supply['window']): Supply {
  if (!mk.ticketmaster || SUPPLY_RATE[e.kind] === 0) return { count: null, perMillion: null, listings: [], crowd: null, self: 0, source: 'none', window }
  const r = seeded(`supply|${e.kind}|${e.tags[0]?.name ?? ''}|${mk.id}`)
  const lean = (LEANS[mk.id] ?? []).filter((x) => e.tags.some((y) => y.name === x)).length
  const perMillion = SUPPLY_RATE[e.kind] * (0.25 + r() * 1.3 + lean * 0.35) * (mk.metroM > 8 ? 1.4 : 1)
  const count = Math.max(0, Math.round(perMillion * mk.metroM * 0.35))
  const listings: Listing[] = Array.from({ length: Math.min(count, 6) }, (_, i) => ({
    name: `Comparable ${e.kind === 'artist' ? 'show' : 'event'} ${i + 1}`,
    date: addDays(window.from, Math.floor(r() * 88)),
    venue: `${mk.name} venue`,
    sample: true,
  })).sort((a, b) => a.date.localeCompare(b.date))
  return { count, perMillion: count / mk.metroM, listings, crowd: null, self: 0, source: 'demo', window }
}

export function demoDetail(e: Entity, mk: Market, supply: Supply): CityDetail {
  const r = seeded(`detail|${e.id}|${mk.id}`)
  const heat: Spot[] = Array.from({ length: 60 }, () => {
    const ang = r() * Math.PI * 2
    const d = Math.sqrt(r()) * 0.16
    return { lat: mk.lat + Math.sin(ang) * d * 0.7, lng: mk.lng + Math.cos(ang) * d, affinity: Math.max(0.05, 1 - d * 4.5 + (r() - 0.5) * 0.5) }
  })
  const venueKinds: Record<Kind, string[]> = {
    artist: ['Club, 600 cap', 'Theatre, 1,800 cap', 'Warehouse, 1,200 cap', 'Live room, 350 cap'],
    comedian: ['Comedy club, 300 cap', 'Theatre, 1,500 cap', 'Bar back room, 120 cap'],
    author: ['Independent bookshop', 'Library hall', 'Arts centre'],
    podcast: ['Theatre, 1,200 cap', 'Live room, 500 cap'],
    brand: ['Gallery space', 'Concept store', 'Market stall'],
    film: ['Independent cinema', 'Arthouse screen'],
    game: ['Arcade bar', 'Convention hall'],
    chef: ['Supper-club kitchen', 'Restaurant takeover'],
  }
  const venues: Pick[] = venueKinds[e.kind].map((v, i) => ({ id: `demo:venue:${mk.id}:${i}`, name: `${mk.name} ${v.split(',')[0].toLowerCase()} ${String.fromCharCode(65 + i)}`, blurb: `${v} (demo placeholder)`, affinity: 0.9 - i * 0.08 - r() * 0.05 }))
  const partners: Pick[] = ['Local podcast', 'Record shop', 'Restaurant', 'Radio show'].map((p, i) => ({ id: `demo:partner:${mk.id}:${i}`, name: `${mk.name} ${p.toLowerCase()}`, blurb: 'Demo placeholder', affinity: 0.85 - i * 0.07 }))
  const young = e.tags.some((x) => ['afrobeats', 'amapiano', 'romantasy', 'electronic', 'uk rap', 'cozy games'].includes(x.name))
  const ages = young ? [0.27, 0.29, 0.2, 0.15, 0.06, 0.03] : [0.12, 0.18, 0.2, 0.24, 0.15, 0.11]
  const female = 0.4 + r() * 0.2
  return {
    market: mk,
    heat,
    venues,
    openers: demoRelated(e, 4),
    partners,
    audience: {
      age: ['24 and under', '25–29', '30–34', '35–44', '45–54', '55+'].map((label, i) => ({ label, share: ages[i] })),
      gender: { female, male: 1 - female },
    },
    supply,
    source: 'demo',
  }
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
