import type { Kind, Region, Verdict } from './api.ts'

export const KINDS: { id: Kind; label: string; noun: string; examples: string[] }[] = [
  { id: 'artist', label: 'Musician', noun: 'an artist', examples: ['Asake', 'Khruangbin', 'Zach Bryan'] },
  { id: 'comedian', label: 'Comedian', noun: 'a comedian', examples: ['Ali Wong', 'Basketmouth'] },
  { id: 'author', label: 'Author', noun: 'a book', examples: ['Fourth Wing', 'Things Fall Apart'] },
  { id: 'podcast', label: 'Podcast', noun: 'a podcast', examples: ['Morbid', 'Call Her Daddy'] },
  { id: 'brand', label: 'Brand pop-up', noun: 'a brand', examples: ['Telfar', 'Aimé Leon Dore'] },
  { id: 'film', label: 'Film', noun: 'a film', examples: ['Anikulapo', 'Everything Everywhere All at Once'] },
  { id: 'game', label: 'Game', noun: 'a game', examples: ['Hades', 'Stardew Valley'] },
  { id: 'chef', label: 'Chef', noun: 'a restaurant', examples: ['Ikoyi', 'Momofuku'] },
]

export const kindLabel = (k: Kind) => KINDS.find((x) => x.id === k)?.label ?? k

export const REGIONS: { id: Region; label: string }[] = [
  { id: 'all', label: 'Everywhere' },
  { id: 'na', label: 'North America' },
  { id: 'europe', label: 'UK & Europe' },
  { id: 'africa', label: 'Africa' },
  { id: 'diaspora', label: 'Diaspora hubs' },
]

export const VERDICT: Record<Verdict, { label: string; color: string; hint: string }> = {
  underserved: { label: 'Underserved', color: '#12936a', hint: 'Fans are here and few comparable shows are booked' },
  balanced: { label: 'Balanced', color: '#d9971a', hint: 'Demand and supply roughly match' },
  crowded: { label: 'Crowded', color: '#e0472b', hint: 'Fans are here, but so are many comparable shows' },
  unlisted: { label: 'No listings data', color: '#5b6cf0', hint: 'Demand is known; Ticketmaster has no listings here' },
  cold: { label: 'Cold', color: '#98a2b3', hint: 'Below-average affinity for this audience' },
}

// "4" for a market that beats 96% of the places Qloo maps.
export const topPct = (percentile: number) => Math.max(1, Math.round((1 - percentile) * 100))

export function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00Z')
  return { mon: d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toUpperCase(), day: d.getUTCDate(), dow: d.toLocaleString('en', { weekday: 'short', timeZone: 'UTC' }) }
}
