// Encore server: searches Qloo, scores markets (Qloo demand against
// Ticketmaster supply), opens up one city, runs the planning agent, and serves
// the built web app. API keys stay on the server.
//
//   node server/index.ts
//
// /api/plan streams NDJSON, one AgentEvent per line, then {"type":"done"}.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnv(path.join(ROOT, '.env'))

// Imported after the env file loads: these modules read their keys at import time.
const { search, entity, cityDetail, qlooLive } = await import('./qloo.ts')
const { supply, ticketmasterLive, warmCoverage } = await import('./ticketmaster.ts')
const { scan } = await import('./score.ts')
const { plan, agentLive } = await import('./agent.ts')
const { marketById, MARKETS } = await import('./markets.ts')
type Kind = import('./types.ts').Kind
type Region = import('./types.ts').Region
type Scan = import('./types.ts').Scan

const PORT = Number(process.env.PORT ?? 8794)
const DIST = path.join(ROOT, 'dist')
const KINDS: Kind[] = ['artist', 'comedian', 'author', 'podcast', 'brand', 'film', 'game', 'chef']
const REGIONS: Region[] = ['all', 'na', 'europe', 'africa', 'diaspora']

function loadEnv(file: string) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

const kindOf = (v: string | null): Kind => (KINDS.includes(v as Kind) ? (v as Kind) : 'artist')
const regionOf = (v: string | null): Region => (REGIONS.includes(v as Region) ? (v as Region) : 'all')

// Recent scans, so the plan and city views reuse the numbers the user saw.
const scans = new Map<string, { at: number; scan: Scan }>()
async function scanFor(id: string, kind: Kind, region: Region) {
  const key = `${id}|${kind}|${region}`
  const hit = scans.get(key)
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.scan
  const e = await entity(id, kind)
  if (!e) throw new HttpError(404, 'Unknown entity')
  const s = await scan(e, region)
  scans.set(key, { at: Date.now(), scan: s })
  if (scans.size > 200) scans.delete(scans.keys().next().value as string)
  return s
}

// The agent spends API credits, so each visitor gets a handful of plans an hour.
const planned = new Map<string, number[]>()
function overPlanLimit(ip: string) {
  if (!agentLive()) return false
  const now = Date.now()
  const recent = (planned.get(ip) ?? []).filter((t) => now - t < 3_600_000)
  if (recent.length >= Number(process.env.ENCORE_PLANS_PER_HOUR ?? 12)) return true
  planned.set(ip, [...recent, now])
  return false
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 64_000) throw new HttpError(413, 'Request too large')
  }
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }

function serveStatic(pathname: string, res: http.ServerResponse) {
  const file = path.join(DIST, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
  const target = file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, 'index.html')
  if (!fs.existsSync(target)) return json(res, 404, { error: 'Web app not built: run npm run build' })
  const ext = path.extname(target)
  res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': target.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
  fs.createReadStream(target).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const q = url.searchParams
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true })

    if (url.pathname === '/api/status') {
      return json(res, 200, { qloo: qlooLive() ? 'live' : 'demo', ticketmaster: ticketmasterLive() ? 'live' : 'demo', agent: agentLive() ? 'claude' : 'rules' })
    }

    if (url.pathname === '/api/search') {
      const text = (q.get('q') ?? '').slice(0, 120)
      if (!text.trim()) return json(res, 200, { results: [] })
      return json(res, 200, { results: await search(text, kindOf(q.get('kind'))) })
    }

    if (url.pathname === '/api/scan') {
      const id = q.get('id')
      if (!id) throw new HttpError(400, 'id is required')
      return json(res, 200, await scanFor(id, kindOf(q.get('kind')), regionOf(q.get('region'))))
    }

    if (url.pathname === '/api/city') {
      const id = q.get('id')
      const mk = marketById(q.get('market') ?? '')
      if (!id || !mk) throw new HttpError(400, 'id and market are required')
      const s = await scanFor(id, kindOf(q.get('kind')), regionOf(q.get('region')))
      const row = s.markets.find((r) => r.market.id === mk.id)
      return json(res, 200, await cityDetail(s.entity, mk, row?.supply ?? (await supply(s.entity, mk))))
    }

    if (url.pathname === '/api/plan' && req.method === 'POST') {
      const body = await readJson(req)
      const id = String(body.id ?? '')
      if (!id) throw new HttpError(400, 'id is required')
      if (overPlanLimit(String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim())) {
        throw new HttpError(429, 'Plan limit reached for this hour. Try again later.')
      }
      const s = await scanFor(id, kindOf(String(body.kind)), regionOf(String(body.region)))
      const ac = new AbortController()
      res.on('close', () => ac.abort())
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
      for await (const ev of plan(s.entity, s, String(body.brief ?? '').slice(0, 1200), ac.signal)) res.write(JSON.stringify(ev) + '\n')
      res.end(JSON.stringify({ type: 'done' }) + '\n')
      return
    }

    if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found')
    serveStatic(url.pathname, res)
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 502
    if (!(err instanceof HttpError)) console.error(`[api] ${url.pathname}:`, err)
    if (res.headersSent) return res.end(JSON.stringify({ type: 'error', error: (err as Error).message }) + '\n')
    json(res, status, { error: (err as Error).message })
  }
})

server.listen(PORT, () => {
  console.log(`Encore on http://localhost:${PORT}  (qloo: ${qlooLive() ? 'live' : 'demo'}, ticketmaster: ${ticketmasterLive() ? 'live' : 'demo'}, agent: ${agentLive() ? 'claude' : 'rules'})`)
  warmCoverage(MARKETS).catch((err) => console.warn('[supply] coverage warm-up failed:', (err as Error).message))
})
