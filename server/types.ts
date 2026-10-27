// Shapes shared by the server modules and sent to the browser as JSON.

export type Kind = 'artist' | 'comedian' | 'author' | 'podcast' | 'brand' | 'film' | 'game' | 'chef'

export type Source = 'qloo' | 'demo'

export type Tag = { id: string; name: string; type?: string }

export type Entity = {
  id: string
  name: string
  kind: Kind
  qlooType: string
  image?: string
  blurb?: string
  popularity?: number
  tags: Tag[]
  source: Source
}

export type Region = 'all' | 'na' | 'europe' | 'africa' | 'diaspora'

export type Market = {
  id: string
  name: string
  country: string
  cc: string
  lat: number
  lng: number
  region: 'na' | 'europe' | 'africa'
  metroM: number // metro population in millions, used to size supply
  diaspora?: boolean // a hub for the African diaspora
  ticketmaster: boolean // whether Discovery API covers this country
}

// act: which of the audience's acts it is; self: the act being scanned.
export type Listing = { name: string; date: string; venue: string; url?: string; sample?: boolean; act?: string; self?: boolean }

export type Supply = {
  count: number | null // shows in the matching genre; null: no listing data for this market
  perMillion: number | null
  // Shows by the acts Qloo says this audience loves most (and by the act itself),
  // within 50 km. null when that lookup didn't run (no key, or a kind that doesn't tour).
  crowd: number | null
  self: number // of those, shows by the act being scanned
  listings: Listing[] // same-crowd shows first, then genre shows
  source: 'ticketmaster' | 'demo' | 'none'
  window: { from: string; to: string }
}

// unlisted: demand is known but there is no listing data to judge supply.
export type Verdict = 'underserved' | 'balanced' | 'crowded' | 'cold' | 'unlisted'

export type MarketScore = {
  market: Market
  affinity: number // Qloo affinity of this entity's audience for the market, 0..1
  percentile: number // share of all places Qloo maps that this market beats, 0..1
  index: number // affinity relative to the mean of the markets scanned (1 = average)
  supply: Supply
  whitespace: number // 0..100
  verdict: Verdict
  why: string
}

export type Scan = {
  entity: Entity
  region: Region
  profile: { summary: string; tags: string[]; related: { name: string; id: string }[] }
  markets: MarketScore[]
  sources: { demand: Source; supply: 'ticketmaster' | 'demo' | 'mixed' }
}

export type Spot = { lat: number; lng: number; affinity: number; geohash?: string }

export type Pick = { id: string; name: string; affinity?: number; address?: string; blurb?: string; tags?: string[] }

export type CityDetail = {
  market: Market
  heat: Spot[]
  venues: Pick[]
  openers: Pick[]
  partners: Pick[] // podcasts, shops and restaurants the same crowd likes
  audience: { age: { label: string; share: number }[]; gender?: { female: number; male: number } } | null
  supply: Supply
  source: Source
}

export type PlanStop = { market_id: string; date: string; room: string; venue: string; opener: string; partner: string; why: string }

export type Plan = {
  title: string
  summary: string
  stops: PlanStop[]
  outreach: { market_id: string; to: string; subject: string; body: string }[]
  posters: { market_id: string; line: string }[]
  cautions: string[]
  planner: 'claude' | 'rules'
}

export type AgentEvent =
  | { type: 'step'; tool: string; label: string }
  | { type: 'note'; text: string }
  | { type: 'plan'; plan: Plan }
  | { type: 'error'; error: string }
  | { type: 'done' }
