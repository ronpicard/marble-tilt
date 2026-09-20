import type { BallState, Level, Tilt, Vec2 } from './types.ts'
import { FIXED_DT, approachTilt, clampTilt, startState, step } from './physics.ts'
import { findPath } from './levels.ts'

/** Result of a full autopilot run over a level. */
export interface AutopilotRun {
  finished: boolean
  time: number
  falls: number
}

/** Steady cruising speed the autopilot aims for between waypoints, in cells/s. */
export const CRUISE_SPEED = 2.2

/** How aggressively requested tilt closes the gap between desired and actual velocity. */
export const STEERING_GAIN = 0.12

/** Distance to a waypoint at which the autopilot considers it reached and moves to the next. */
export const WAYPOINT_RADIUS = 0.3

/** Distance to the start cell that counts as "back at the start" after a respawn. */
const RESPAWN_RADIUS = 0.5

/** The autopilot only treats being near the start as a respawn once it has left the opening stretch. */
const RESPAWN_MIN_INDEX = 2

/** Euclidean distance between two points. */
function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Builds a controller that drives a marble along `findPath(level)` from start to goal. Throws if
 * the level has no path. Each call reports the tilt to request for the marble's current state:
 * it steers toward the next unreached waypoint with a desired velocity capped at CRUISE_SPEED
 * (slowing on approach), and requests the tilt that closes the gap between that desired velocity
 * and the marble's actual velocity. If the marble reappears at the start well into the route, the
 * controller assumes it fell and respawned, and starts again from the first waypoint.
 */
export function createAutopilot(level: Level): (state: BallState) => Tilt {
  const waypoints = findPath(level)
  if (!waypoints) {
    throw new Error(`Level ${level.id}: autopilot found no path from start to goal`)
  }

  let index = 0

  return (state: BallState): Tilt => {
    if (index > RESPAWN_MIN_INDEX && distance(state.pos, level.start) <= RESPAWN_RADIUS) {
      index = 0
    }
    if (index < waypoints.length - 1 && distance(state.pos, waypoints[index]) <= WAYPOINT_RADIUS) {
      index++
    }

    const target = waypoints[index]
    const dx = target.x - state.pos.x
    const dy = target.y - state.pos.y
    const dist = Math.hypot(dx, dy)
    const desiredSpeed = Math.min(CRUISE_SPEED, dist * 4)
    const desired: Vec2 =
      dist > 0 ? { x: (dx / dist) * desiredSpeed, y: (dy / dist) * desiredSpeed } : { x: 0, y: 0 }

    return clampTilt({
      x: STEERING_GAIN * (desired.x - state.vel.x),
      y: STEERING_GAIN * (desired.y - state.vel.y),
    })
  }
}

/**
 * Runs the real physics against `createAutopilot`'s controller at FIXED_DT, feeding requested
 * tilt through `approachTilt` exactly as the engine does. Respawns at the start on 'fell' (each
 * one counts toward `falls`), stops on 'goal' (finished = true) or once `maxTime` elapses.
 */
export function runAutopilot(level: Level, maxTime = 180): AutopilotRun {
  const requestTilt = createAutopilot(level)

  let state = startState(level)
  let tilt: Tilt = { x: 0, y: 0 }
  let time = 0
  let falls = 0
  let finished = false

  while (time < maxTime) {
    const target = requestTilt(state)
    tilt = approachTilt(tilt, target, FIXED_DT)
    const result = step(level, state, tilt, FIXED_DT)
    state = result.state
    time += FIXED_DT

    if (result.event === 'goal') {
      finished = true
      break
    }
    if (result.event === 'fell') {
      falls++
      state = startState(level)
      tilt = { x: 0, y: 0 }
    }
  }

  return { finished, time, falls }
}
