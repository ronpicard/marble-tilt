/** A star rating for a single level attempt: 1 (finished), 2 (under par*TWO_STAR_FACTOR) or 3 (par). */
export type Stars = 1 | 2 | 3

/** The player's best result on one level. */
export interface LevelRecord {
  bestTime: number
  stars: Stars
}

/** All of the player's saved results, keyed by level id. */
export type Progress = Record<string, LevelRecord>

/** A finish under par * TWO_STAR_FACTOR earns two stars instead of one. */
export const TWO_STAR_FACTOR = 1.5

/** Rates a finish time against a level's par: at or under par is 3 stars, under par*1.5 is 2, else 1. */
export function starsFor(time: number, par: number): Stars {
  if (time <= par) return 3
  if (time <= par * TWO_STAR_FACTOR) return 2
  return 1
}

/**
 * Folds a fresh finish into existing progress, returning a new Progress rather than mutating
 * `progress`. The best time and the best star rating are tracked independently: a slower run
 * that still clears a star threshold can raise `stars` without moving `bestTime`, and vice versa.
 */
export function recordResult(
  progress: Progress,
  levelId: string,
  time: number,
  par: number,
): Progress {
  const stars = starsFor(time, par)
  const existing = progress[levelId]
  const bestTime = existing ? Math.min(existing.bestTime, time) : time
  const bestStars: Stars = existing ? (Math.max(existing.stars, stars) as Stars) : stars
  return { ...progress, [levelId]: { bestTime, stars: bestStars } }
}

/**
 * Parses persisted progress from storage. `raw` crosses a trust boundary (it may be missing,
 * hand-edited, or written by a future/older version of this app), so this never throws: bad JSON,
 * non-objects, unknown level ids, and records with a non-finite/non-positive `bestTime` or a
 * `stars` outside 1..3 are silently dropped rather than surfaced as an error.
 */
export function parseProgress(raw: string | null, knownIds: readonly string[]): Progress {
  if (raw === null) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

  const known = new Set(knownIds)
  const result: Progress = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!known.has(id)) continue
    if (typeof value !== 'object' || value === null) continue

    const record = value as Record<string, unknown>
    const bestTime = record.bestTime
    const stars = record.stars
    if (typeof bestTime !== 'number' || !Number.isFinite(bestTime) || bestTime <= 0) continue
    if (stars !== 1 && stars !== 2 && stars !== 3) continue

    result[id] = { bestTime, stars }
  }
  return result
}

/** Serialises progress for storage. Paired with `parseProgress` for the round trip back. */
export function serializeProgress(progress: Progress): string {
  return JSON.stringify(progress)
}

/** Sums the star rating across every level the player has a record for. */
export function totalStars(progress: Progress): number {
  return Object.values(progress).reduce((sum, record) => sum + record.stars, 0)
}

/** Tenths of a second in one whole second, used to truncate (never round up) `formatTime`. */
const TENTHS_PER_SECOND = 10

/** Tenths of a second in one minute. */
const TENTHS_PER_MINUTE = 60 * TENTHS_PER_SECOND

/**
 * Formats a duration as `m:ss.t`, truncating to tenths of a second (never rounding up) so a
 * displayed time never looks faster than the run actually was. A tiny epsilon absorbs
 * floating-point noise from the `* 10` without ever truncating a genuine boundary upward.
 */
export function formatTime(seconds: number): string {
  const totalTenths = Math.floor(seconds * TENTHS_PER_SECOND + 1e-9)
  const minutes = Math.floor(totalTenths / TENTHS_PER_MINUTE)
  const remainderTenths = totalTenths - minutes * TENTHS_PER_MINUTE
  const wholeSeconds = Math.floor(remainderTenths / TENTHS_PER_SECOND)
  const tenths = remainderTenths % TENTHS_PER_SECOND
  return `${minutes}:${wholeSeconds.toString().padStart(2, '0')}.${tenths}`
}
