import { parseProgress, serializeProgress } from '../game/progress.ts'
import type { Progress } from '../game/progress.ts'

const MUTE_KEY = 'marble-tilt.muted'
const PROGRESS_KEY = 'marble-tilt.progress'

/**
 * localStorage throws in some iframes and private-mode browsers. This probes it once and hands
 * back either the real Storage or null, so the rest of the app never has to guard every call.
 */
export function safeLocalStorage(): Storage | null {
  try {
    const probeKey = '__marble_tilt_probe__'
    window.localStorage.setItem(probeKey, '1')
    window.localStorage.removeItem(probeKey)
    return window.localStorage
  } catch {
    return null
  }
}

export function loadMuted(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(MUTE_KEY) === '1'
  } catch {
    // Quota errors and private-mode restrictions on getItem: fall back to unmuted.
    return false
  }
}

export function saveMuted(storage: Storage | null, muted: boolean): void {
  if (!storage) return
  try {
    storage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // Quota exceeded or storage disabled mid-session: the mute preference just won't persist.
  }
}

/** Loads saved progress, dropping anything malformed or naming a level that no longer exists. */
export function loadProgress(storage: Storage | null, knownIds: readonly string[]): Progress {
  if (!storage) return parseProgress(null, knownIds)
  try {
    return parseProgress(storage.getItem(PROGRESS_KEY), knownIds)
  } catch {
    // Quota errors and private-mode restrictions on getItem: fall back to no saved progress.
    return parseProgress(null, knownIds)
  }
}

export function saveProgress(storage: Storage | null, progress: Progress): void {
  if (!storage) return
  try {
    storage.setItem(PROGRESS_KEY, serializeProgress(progress))
  } catch {
    // Quota exceeded or storage disabled mid-session: progress just won't persist this time.
  }
}
