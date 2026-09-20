import type { Tilt } from './types.ts'
import { MAX_TILT, clampTilt } from './physics.ts'

/** Device degrees of rotation from neutral that produce the maximum tilt magnitude. */
export const FULL_DEVICE_TILT_DEG = 22

/** A device orientation reading, in degrees, as reported by `DeviceOrientationEvent`. */
export interface Pose {
  beta: number
  gamma: number
}

/**
 * Maps a pointer's offset from an anchor point to a tilt: `reach` pixels of offset produces
 * MAX_TILT, clamped circularly beyond that. A non-positive or non-finite `reach` has nothing
 * meaningful to divide by, so it yields zero tilt.
 */
export function pointerToTilt(dx: number, dy: number, reach: number): Tilt {
  if (!(reach > 0) || !Number.isFinite(reach)) return { x: 0, y: 0 }
  const scale = MAX_TILT / reach
  return clampTilt({ x: dx * scale, y: dy * scale })
}

/**
 * Adds `fraction` of a full-strength push to a tilt that stays where it is left, clamping the
 * result to MAX_TILT (circularly). `push` is a full-magnitude direction such as `keysToTilt`
 * returns; pushing the opposite way steps the tilt back toward level and past it. Non-finite input
 * leaves the tilt unchanged.
 */
export function nudgeTilt(tilt: Tilt, push: Tilt, fraction: number): Tilt {
  if (!Number.isFinite(fraction) || !Number.isFinite(push.x) || !Number.isFinite(push.y)) {
    return { x: tilt.x, y: tilt.y }
  }
  return clampTilt({ x: tilt.x + push.x * fraction, y: tilt.y + push.y * fraction })
}

/**
 * Maps held keys to a tilt at full MAX_TILT magnitude: a single held direction gives the full
 * magnitude along that axis, and a diagonal is normalised to the same magnitude. `up` tilts -y.
 */
export function keysToTilt(keys: { left: boolean; right: boolean; up: boolean; down: boolean }): Tilt {
  const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
  const y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0)
  if (x === 0 && y === 0) return { x: 0, y: 0 }
  const scale = MAX_TILT / Math.hypot(x, y)
  return { x: x * scale, y: y * scale }
}

/**
 * Turns a screen-relative tilt (x toward the right of the screen, y toward the bottom) into board
 * space for a camera that orbits the board at `azimuth` radians (0 looks along the board's +y axis
 * from the near side). Magnitude is preserved. Non-finite input gives a level board.
 */
export function rotateTilt(tilt: Tilt, azimuth: number): Tilt {
  if (!Number.isFinite(tilt.x) || !Number.isFinite(tilt.y) || !Number.isFinite(azimuth)) {
    return { x: 0, y: 0 }
  }
  const cos = Math.cos(azimuth)
  const sin = Math.sin(azimuth)
  return {
    x: tilt.x * cos + tilt.y * sin,
    y: -tilt.x * sin + tilt.y * cos,
  }
}

/**
 * Maps a device orientation reading to a tilt: the offset from `neutral` (in degrees), rotated to
 * account for the screen's current rotation, then scaled so FULL_DEVICE_TILT_DEG of device
 * rotation produces MAX_TILT. An unrecognised `screenAngle` is treated as portrait (0). Non-finite
 * input sanitises to zero via `clampTilt`.
 */
export function orientationToTilt(pose: Pose, neutral: Pose, screenAngle: number): Tilt {
  const dBeta = pose.beta - neutral.beta
  const dGamma = pose.gamma - neutral.gamma

  let x: number
  let y: number
  switch (screenAngle) {
    case 90:
      x = dBeta
      y = -dGamma
      break
    case 180:
      x = -dGamma
      y = -dBeta
      break
    case 270:
      x = -dBeta
      y = dGamma
      break
    default:
      x = dGamma
      y = dBeta
  }

  const scale = MAX_TILT / FULL_DEVICE_TILT_DEG
  return clampTilt({ x: x * scale, y: y * scale })
}
