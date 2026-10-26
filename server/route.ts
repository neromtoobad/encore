// Orders chosen markets into a run and gives each a date. Nearest neighbour
// from the first city, so the run never doubles back across an ocean more than
// it has to; gaps grow with distance; a date already taken by a comparable show
// in that city moves to the next free day.

import { addDays } from './demo.ts'
import { km } from './markets.ts'
import type { Market, Supply } from './types.ts'

export type Stop = { market: Market; date: string; travelKm: number; moved?: string }

export function gapDays(dist: number) {
  if (dist < 450) return 1 // a drive
  if (dist < 4500) return 2 // a long drive or a flight
  return 3 // across an ocean
}

export function route(markets: Market[], start: string, supplies: Map<string, Supply>, opts: { restEvery?: number } = {}): Stop[] {
  if (!markets.length) return []
  const restEvery = opts.restEvery ?? 4
  const left = [...markets]
  const order = [left.shift() as Market]
  while (left.length) {
    const here = order[order.length - 1]
    left.sort((a, b) => km(here, a) - km(here, b))
    order.push(left.shift() as Market)
  }
  const stops: Stop[] = []
  let date = start
  order.forEach((mk, i) => {
    const prev = order[i - 1]
    const dist = prev ? km(prev, mk) : 0
    if (prev) date = addDays(date, gapDays(dist) + (i % restEvery === 0 ? 1 : 0))
    const taken = new Set((supplies.get(mk.id)?.listings ?? []).filter((l) => !l.sample).map((l) => l.date))
    let d = date
    let moved: string | undefined
    for (let tries = 0; taken.has(d) && tries < 3; tries++) {
      moved = `${d} already has a comparable show booked`
      d = addDays(d, 1)
    }
    date = d
    stops.push({ market: mk, date: d, travelKm: Math.round(dist), moved })
  })
  return stops
}
