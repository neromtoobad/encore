// A small JSON cache on disk (plus memory) for upstream API responses, and a
// limiter so a scan of 40 markets doesn't fire 40 requests at once. Qloo's
// hackathon terms allow private server-side caching; .cache/ is gitignored.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache')
const mem = new Map<string, { at: number; value: unknown }>()

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const file = path.join(DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json')
  const now = Date.now()
  const hit = mem.get(key)
  if (hit && now - hit.at < ttlMs) return hit.value as T
  try {
    const disk = JSON.parse(fs.readFileSync(file, 'utf8')) as { at: number; value: T }
    if (now - disk.at < ttlMs) {
      mem.set(key, disk)
      return disk.value
    }
  } catch {
    // not cached yet
  }
  const value = await load()
  const entry = { at: now, value }
  mem.set(key, entry)
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFile(file, JSON.stringify(entry), () => {})
  return value
}

export function limiter(max: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => queue.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

export const HOUR = 3_600_000
export const DAY = 24 * HOUR
