// Calls to the Encore server. Types come straight from the server so the two
// can't drift.

import type { AgentEvent, CityDetail, Entity, Kind, Region, Scan } from '../server/types.ts'

export type { AgentEvent, CityDetail, Entity, Kind, MarketScore, Plan, Region, Scan, Verdict } from '../server/types.ts'

export type Status = { qloo: 'live' | 'demo'; ticketmaster: 'live' | 'demo'; agent: 'claude' | 'rules' }

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export const getStatus = () => getJson<Status>('/api/status')

export const searchEntities = (q: string, kind: Kind, signal?: AbortSignal) =>
  getJson<{ results: Entity[] }>(`/api/search?${new URLSearchParams({ q, kind })}`, signal).then((r) => r.results)

export const getScan = (id: string, kind: Kind, region: Region) => getJson<Scan>(`/api/scan?${new URLSearchParams({ id, kind, region })}`)

export const getCity = (id: string, kind: Kind, region: Region, market: string) =>
  getJson<CityDetail>(`/api/city?${new URLSearchParams({ id, kind, region, market })}`)

export async function* streamPlan(body: { id: string; kind: Kind; region: Region; brief: string }, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const res = await fetch('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `Plan failed (${res.status})`)
  }
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) yield JSON.parse(line) as AgentEvent
    }
  }
}
