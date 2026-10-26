// The planning agent. It gets the scan and the user's brief ("8 dates in
// February, start in London, rooms under 1,000"), then works through tools:
// inspect a city (Qloo neighbourhoods, venues, openers, partners, audience,
// plus the shows already booked there), route a set of cities into dates, and
// finally submit the plan with its outreach drafts.
//
// Claude runs the loop when ANTHROPIC_API_KEY is set. Without it, plan() falls
// back to a rule-based planner that uses the same tools in a fixed order, so
// the app still works end to end.

import Anthropic from '@anthropic-ai/sdk'
import { cityDetail } from './qloo.ts'
import { supply as supplyFor } from './ticketmaster.ts'
import { marketById, MARKETS } from './markets.ts'
import { route, type Stop } from './route.ts'
import { addDays } from './demo.ts'
import type { AgentEvent, CityDetail, Entity, MarketScore, Plan, Scan, Supply } from './types.ts'

const MODEL = process.env.ENCORE_MODEL ?? 'claude-opus-5-5'
export const agentLive = () => !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)

// --- tools, shared by both planners ---------------------------------------------------

type Ctx = { entity: Entity; scan: Scan; details: Map<string, CityDetail>; supplies: Map<string, Supply> }

async function inspect(ctx: Ctx, id: string): Promise<CityDetail> {
  const hit = ctx.details.get(id)
  if (hit) return hit
  const mk = marketById(id)
  if (!mk) throw new Error(`Unknown market id ${id}`)
  const s = ctx.supplies.get(id) ?? (await supplyFor(ctx.entity, mk))
  const d = await cityDetail(ctx.entity, mk, s)
  ctx.details.set(id, d)
  return d
}

function detailForModel(d: CityDetail, row?: MarketScore) {
  const names = (xs: { name: string; blurb?: string; affinity?: number }[]) =>
    xs.map((x) => `${x.name}${x.blurb ? ` (${x.blurb})` : ''}${x.affinity !== undefined ? ` [affinity ${x.affinity.toFixed(2)}]` : ''}`)
  const hot = [...d.heat].sort((a, b) => b.affinity - a.affinity).slice(0, 3).map((s) => `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`)
  return {
    market: `${d.market.name}, ${d.market.country} (${d.market.id})`,
    data: d.source === 'demo' ? 'DEMO DATA: names below are placeholders, not real venues or people' : 'live Qloo data',
    score: row && { whitespace: row.whitespace, verdict: row.verdict, index: Number(row.index.toFixed(2)), why: row.why },
    hottest_areas: hot,
    venues: names(d.venues),
    openers: names(d.openers),
    partners: names(d.partners),
    audience: d.audience?.age.map((a) => `${a.label} ${(a.share * 100).toFixed(0)}%`).join(', ') ?? 'unknown',
    booked: d.supply.count === null ? 'no listing data' : `${d.supply.count} comparable shows in the next 90 days`,
    booked_dates: d.supply.listings.filter((l) => !l.sample).map((l) => `${l.date}: ${l.name} at ${l.venue}`),
  }
}

function routeFor(ctx: Ctx, ids: string[], start: string): Stop[] {
  const mks = ids.map((id) => marketById(id)).filter((m) => !!m)
  return route(mks, start, ctx.supplies)
}

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'inspect_city',
    description: "Look inside one market: Qloo's hottest neighbourhoods for this audience, venues and local acts the same fans like, partners (podcasts, restaurants, shops), the audience's age mix, and the comparable shows already booked there with dates. Call it for every city you consider including.",
    input_schema: { type: 'object', properties: { market_id: { type: 'string', description: 'A market id from the scan, e.g. "columbus"' } }, required: ['market_id'], additionalProperties: false },
    strict: true,
  },
  {
    name: 'build_route',
    description: 'Order a set of markets into a run and date each stop. Starts at the first id given, then goes to the nearest remaining city each time, leaves travel days by distance, and moves any date that clashes with a comparable show already booked in that city.',
    input_schema: {
      type: 'object',
      properties: {
        market_ids: { type: 'array', items: { type: 'string' }, description: 'Markets to include; the first is where the run starts' },
        start_date: { type: 'string', description: 'First show, YYYY-MM-DD' },
      },
      required: ['market_ids', 'start_date'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'submit_plan',
    description: 'Submit the finished plan. Call this once, last. Every venue, opener and partner named must come from inspect_city results; use the dates build_route returned.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name for the run, e.g. "Asake: The Underserved Run, Feb 2027"' },
        summary: { type: 'string', description: 'Two or three sentences: the logic of this run and what it avoids' },
        stops: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              market_id: { type: 'string' },
              date: { type: 'string' },
              room: { type: 'string', description: 'The kind and size of room, e.g. "800-cap club"' },
              venue: { type: 'string', description: 'A venue from inspect_city, or "" if none fits' },
              opener: { type: 'string', description: 'A local act or co-host from inspect_city, or ""' },
              partner: { type: 'string', description: 'A promo partner from inspect_city, or ""' },
              why: { type: 'string', description: 'One sentence of evidence for this stop, citing the numbers' },
            },
            required: ['market_id', 'date', 'room', 'venue', 'opener', 'partner', 'why'],
            additionalProperties: false,
          },
        },
        outreach: {
          type: 'array',
          description: 'Short ready-to-send drafts: venue pitches, opener invitations, promo partner asks',
          items: {
            type: 'object',
            properties: {
              market_id: { type: 'string' },
              to: { type: 'string', description: 'Who it is for, by role and name, e.g. "Booker, The Basement". No email addresses.' },
              subject: { type: 'string' },
              body: { type: 'string', description: 'Under 120 words, plain text' },
            },
            required: ['market_id', 'to', 'subject', 'body'],
            additionalProperties: false,
          },
        },
        posters: {
          type: 'array',
          description: 'One poster line per stop, tuned to what that city\'s audience loves',
          items: { type: 'object', properties: { market_id: { type: 'string' }, line: { type: 'string' } }, required: ['market_id', 'line'], additionalProperties: false },
        },
        cautions: { type: 'array', items: { type: 'string' }, description: 'Risks or gaps in the evidence the user should check' },
      },
      required: ['title', 'summary', 'stops', 'outreach', 'posters', 'cautions'],
      additionalProperties: false,
    },
    strict: true,
  },
]

const SYSTEM = `You are Encore, a booking strategist for anyone who takes their work on the road: musicians, comedians, authors, podcasters, brands doing pop-ups, film screenings, game events, chefs.

You plan runs from evidence. The scan you receive ranks markets by a whitespace score: Qloo's measure of how much this audience over-indexes on a city (demand), discounted by how many comparable shows Ticketmaster already lists there in the next 90 days (supply). "Underserved" means high demand and few comparable shows. "Unlisted" means there is no listing data, so supply is unknown; say so rather than calling it underserved.

How to work:
- Read the user's brief and follow it: number of dates, region, start city, timing, room size.
- Pick candidates mostly from the top of the scan, but use judgement: one anchor city with big demand can be worth a crowded market. Avoid "cold" markets.
- Call inspect_city for each city you are seriously considering before you commit to it. Inspect several at once when you can.
- Call build_route with your chosen cities, then submit_plan.
- Name venues, openers and partners only from inspect_city results. If a result says DEMO DATA, use those placeholder names as given and add a caution that the plan uses demo data.
- Write outreach as the artist's team, warm and specific, citing why that city (the numbers). One draft per stop at least, for the venue; add opener or partner drafts where they are strong.
- Keep notes between tool calls to one short sentence.`

function briefMessage(scan: Scan, brief: string, start: string) {
  const rows = scan.markets.slice(0, 18).map((r) =>
    `${r.market.id} | ${r.market.name} | whitespace ${r.whitespace} | ${r.verdict} | demand ${r.index.toFixed(2)}x | ${r.supply.count === null ? 'no listings data' : `${r.supply.count} booked (${(r.supply.perMillion ?? 0).toFixed(1)}/M)`}`,
  )
  return [
    `Entity: ${scan.entity.name} (${scan.entity.kind}). ${scan.profile.summary}`,
    `Data: demand from ${scan.sources.demand === 'qloo' ? 'live Qloo' : 'DEMO data'}, supply from ${scan.sources.supply}.`,
    `Earliest start date: ${start}.`,
    `Brief from the user: ${brief.trim() || 'No brief. Plan a sensible first run of 6 to 8 dates in the region scanned.'}`,
    '',
    'Scan, best whitespace first (id | city | score | verdict | demand | supply):',
    ...rows,
  ].join('\n')
}

// --- Claude planner ----------------------------------------------------------------------

let client: Anthropic | null = null

async function* planWithClaude(ctx: Ctx, brief: string, start: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY, maxRetries: 3 })
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: briefMessage(ctx.scan, brief, start) }]
  for (let turn = 0; turn < 14; turn++) {
    const res = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
        output_config: { effort: 'medium' },
        // A request Claude declines is retried server-side on a model Anthropic picks for that case.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal },
    )
    if (res.stop_reason === 'refusal') throw new Error('The model declined this request.')
    if (res.stop_reason === 'max_tokens') throw new Error('The plan ran out of room; try a shorter brief.')
    messages.push({ role: 'assistant', content: res.content })
    for (const b of res.content) if (b.type === 'text' && b.text.trim()) yield { type: 'note', text: b.text.trim() }
    if (res.stop_reason === 'pause_turn') continue
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (!uses.length) throw new Error('The agent stopped without submitting a plan.')
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    let submitted: Plan | null = null
    for (const u of uses) {
      const input = u.input as Record<string, any>
      if (u.name === 'submit_plan') {
        submitted = { ...(input as Omit<Plan, 'planner'>), planner: 'claude' }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: 'Plan received.' })
        continue
      }
      try {
        if (u.name === 'inspect_city') {
          const mk = marketById(String(input.market_id))
          yield { type: 'step', tool: u.name, label: `Inspecting ${mk?.name ?? input.market_id}` }
          const d = await inspect(ctx, String(input.market_id))
          const row = ctx.scan.markets.find((r) => r.market.id === d.market.id)
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(detailForModel(d, row)) })
        } else if (u.name === 'build_route') {
          const ids = (input.market_ids as string[]) ?? []
          yield { type: 'step', tool: u.name, label: `Routing ${ids.length} cities` }
          await Promise.all(ids.map((id) => inspect(ctx, id).catch(() => null)))
          const stops = routeFor(ctx, ids, String(input.start_date ?? start))
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(stops.map((s) => ({ market_id: s.market.id, city: s.market.name, date: s.date, travel_km: s.travelKm, moved: s.moved }))) })
        } else {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: `Unknown tool ${u.name}`, is_error: true })
        }
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: (err as Error).message, is_error: true })
      }
    }
    if (submitted) {
      yield { type: 'plan', plan: submitted }
      return
    }
    messages.push({ role: 'user', content: results })
  }
  throw new Error('The agent took too many steps without finishing.')
}

// --- rule-based planner ------------------------------------------------------------------

function readBrief(brief: string) {
  const n = /(\d+)\s*(?:dates|shows|stops|cities|nights|pop-?ups|screenings)/i.exec(brief)
  const startCity = MARKETS.find((m) => new RegExp(`\\b(start|open|kick off)\\w*\\s+(in|at)\\s+${m.name}\\b`, 'i').test(brief))
  return { count: n ? Math.min(14, Math.max(2, Number(n[1]))) : 7, startCity }
}

async function* planWithRules(ctx: Ctx, brief: string, start: string): AsyncGenerator<AgentEvent> {
  const { count, startCity } = readBrief(brief)
  // One continent per run: the start city's, or the best market's.
  const warm = ctx.scan.markets.filter((r) => r.verdict !== 'cold')
  const home = startCity?.region ?? warm[0]?.market.region
  const pool = warm.filter((r) => r.market.region === home && r.market.id !== startCity?.id)
  const picks = [...(startCity ? [startCity.id] : []), ...pool.map((r) => r.market.id)].slice(0, count)
  for (const id of picks) {
    yield { type: 'step', tool: 'inspect_city', label: `Inspecting ${marketById(id)?.name ?? id}` }
    await inspect(ctx, id)
  }
  yield { type: 'step', tool: 'build_route', label: `Routing ${picks.length} cities` }
  const stops = routeFor(ctx, picks, start)
  const name = ctx.entity.name
  const plan: Plan = {
    title: `${name}: ${stops.length}-date run`,
    summary: `The ${stops.length} markets with the most whitespace for ${name}'s audience in ${stops[0]?.market.region === 'na' ? 'North America' : stops[0]?.market.region === 'europe' ? 'the UK and Europe' : 'Africa'}, routed nearest-first from ${stops[0]?.market.name ?? 'the top market'}.`,
    stops: stops.map((s) => {
      const d = ctx.details.get(s.market.id) as CityDetail
      const row = ctx.scan.markets.find((r) => r.market.id === s.market.id)
      return { market_id: s.market.id, date: s.date, room: d.venues[0]?.blurb ?? '', venue: d.venues[0]?.name ?? '', opener: d.openers[0]?.name ?? '', partner: d.partners[0]?.name ?? '', why: row?.why ?? '' }
    }),
    outreach: stops.map((s) => {
      const d = ctx.details.get(s.market.id) as CityDetail
      const row = ctx.scan.markets.find((r) => r.market.id === s.market.id)
      const venue = d.venues[0]?.name ?? `a venue in ${s.market.name}`
      return {
        market_id: s.market.id,
        to: `Booker, ${venue}`,
        subject: `${name} in ${s.market.name}, ${s.date}?`,
        body: `Hi,\n\nWe're routing ${name} and ${s.market.name} is high on the list: the audience's affinity there is ${row?.index.toFixed(1) ?? '1.0'}× the average market${row?.supply.count != null ? `, and only ${row.supply.count} comparable shows are booked in the next 90 days` : ''}. We'd love to hold ${s.date} (or nearby) at ${venue}.\n\nCan you share avails and terms?\n\nThanks`,
      }
    }),
    posters: stops.map((s) => ({ market_id: s.market.id, line: `${name} · ${s.market.name} · ${new Date(s.date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}` })),
    cautions: [
      'Written by the rule-based planner: set ANTHROPIC_API_KEY for the agent to weigh the brief and write tailored outreach.',
      ...(ctx.scan.sources.demand === 'demo' ? ['Demand is demo data until QLOO_API_KEY is set; venue and partner names are placeholders.'] : []),
    ],
    planner: 'rules',
  }
  yield { type: 'plan', plan }
}

// --- entry point ---------------------------------------------------------------------

export async function* plan(entity: Entity, scan: Scan, brief: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const start = addDays(new Date().toISOString().slice(0, 10), 21)
  const ctx: Ctx = { entity, scan, details: new Map(), supplies: new Map(scan.markets.map((r) => [r.market.id, r.supply])) }
  try {
    if (agentLive()) yield* planWithClaude(ctx, brief, start, signal)
    else yield* planWithRules(ctx, brief, start)
  } catch (err) {
    if (signal?.aborted) return
    yield { type: 'error', error: (err as Error).message }
  }
}
