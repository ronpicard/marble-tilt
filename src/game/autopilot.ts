import type { BallState, Level, Tilt, Vec2 } from './types.ts'
import {
  FIXED_DT,
  RAMP_ACCEL,
  TILT_ACCEL,
  approachTilt,
  clampTilt,
  startState,
  step,
} from './physics.ts'
import { findPath } from './levels.ts'
import { rampAt } from './board.ts'

/** Result of a full autopilot run over a level. */
export interface AutopilotRun {
  finished: boolean
  time: number
  falls: number
}

/** Steady cruising speed the autopilot aims for along a straight run, in cells/s. */
export const CRUISE_SPEED = 2.2

/** Speed it slows to for a corner, in cells/s. Straight-through waypoints are not slowed for at all. */
export const TURN_SPEED = 0.9

/** How much faster than TURN_SPEED it may go per cell of distance still to run before the corner. */
const BRAKING_RATE = 2.5

/** How hard it brakes into the cup at the end of the route: desired speed per cell of distance left. */
const FINAL_APPROACH_RATE = 4

/** Speed back toward the line of the current run, in cells/s per cell of sideways error. */
const LATERAL_GAIN = 4

/** How aggressively requested tilt closes the gap between desired and actual velocity. */
export const STEERING_GAIN = 0.12

/** Distance to a corner at which the autopilot considers it reached and turns onto the next run. */
export const WAYPOINT_RADIUS = 0.3

/** Distance to the start cell that counts as "back at the start" after a respawn. */
const RESPAWN_RADIUS = 0.5

/** How far from the start the marble must get before being near it again counts as a respawn. */
const RESPAWN_ARM_DISTANCE = 1.5

/** The pace the menu demo rolls at: unhurried, so the board behind the menu tilts gently. */
export const DEMO_PACE = 0.65

/** The slowest pace the autopilot accepts; below this it would stall on a steep ramp. */
const MIN_PACE = 0.2

/** Euclidean distance between two points. */
function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Reduces a cell-by-cell route to its corners: the start, every waypoint where the route changes
 * direction, and the goal. The marble rolls each straight run between them without slowing.
 */
function corners(waypoints: Vec2[]): Vec2[] {
  const kept = [waypoints[0]]
  for (let i = 1; i < waypoints.length - 1; i++) {
    const inX = waypoints[i].x - waypoints[i - 1].x
    const inY = waypoints[i].y - waypoints[i - 1].y
    const outX = waypoints[i + 1].x - waypoints[i].x
    const outY = waypoints[i + 1].y - waypoints[i].y
    if (inX !== outX || inY !== outY) kept.push(waypoints[i])
  }
  if (waypoints.length > 1) kept.push(waypoints[waypoints.length - 1])
  return kept
}

/** The tilt that holds the marble still against a ramp's slope, so climbing one costs no speed. */
function rampHold(level: Level, pos: Vec2): Tilt {
  const ramp = rampAt(level, Math.floor(pos.x), Math.floor(pos.y))
  if (!ramp) return { x: 0, y: 0 }
  const hold = (RAMP_ACCEL * (ramp.high - ramp.low)) / TILT_ACCEL
  return { x: ramp.dir.x * hold, y: ramp.dir.y * hold }
}

/**
 * Builds a controller that drives a marble along `findPath(level)` from start to goal. Throws if
 * the level has no path. Each call reports the tilt to request for the marble's current state.
 *
 * It follows the route one straight run at a time: it cruises along the run's line, steers back
 * toward that line in proportion to how far it has drifted off it, and slows only for the corner
 * at the run's end (or the cup). Braking at every cell instead would rock the board back and forth
 * several times a second. The requested tilt closes the gap between that desired velocity and the
 * marble's actual velocity, plus whatever it takes to hold against a ramp's slope. If the marble
 * reappears at the start after leaving it, the controller assumes it fell and respawned, and
 * starts the route again.
 *
 * `pace` scales its cruising and cornering speeds: 1 is the run that sets par, and the menu demo
 * uses less so the board behind the menu moves calmly. It must be finite and within 0.2 to 1.
 */
export function createAutopilot(level: Level, pace = 1): (state: BallState) => Tilt {
  if (!Number.isFinite(pace) || pace < MIN_PACE || pace > 1) {
    throw new RangeError(`Autopilot pace must be between ${MIN_PACE} and 1, got ${pace}`)
  }

  const waypoints = findPath(level)
  if (!waypoints) {
    throw new Error(`Level ${level.id}: autopilot found no path from start to goal`)
  }

  const route = corners(waypoints)
  let index = Math.min(1, route.length - 1)
  let leftStart = false

  return (state: BallState): Tilt => {
    const fromStart = distance(state.pos, level.start)
    if (fromStart > RESPAWN_ARM_DISTANCE) leftStart = true
    if (leftStart && fromStart <= RESPAWN_RADIUS) {
      index = Math.min(1, route.length - 1)
      leftStart = false
    }

    const isLast = () => index === route.length - 1
    if (!isLast() && distance(state.pos, route[index]) <= WAYPOINT_RADIUS) index++

    const from = route[Math.max(0, index - 1)]
    const target = route[index]
    const runLength = distance(from, target)
    const along: Vec2 =
      runLength > 0
        ? { x: (target.x - from.x) / runLength, y: (target.y - from.y) / runLength }
        : { x: 0, y: 0 }

    // Distance still to run along the line, and the sideways drift off it.
    const toTargetX = target.x - state.pos.x
    const toTargetY = target.y - state.pos.y
    const remaining = toTargetX * along.x + toTargetY * along.y
    const driftX = toTargetX - remaining * along.x
    const driftY = toTargetY - remaining * along.y

    const limit = isLast()
      ? Math.abs(remaining) * FINAL_APPROACH_RATE
      : TURN_SPEED * pace + Math.abs(remaining) * BRAKING_RATE
    const speed = Math.sign(remaining) * Math.min(CRUISE_SPEED * pace, limit)

    const desired: Vec2 = {
      x: along.x * speed + driftX * LATERAL_GAIN,
      y: along.y * speed + driftY * LATERAL_GAIN,
    }
    const hold = rampHold(level, state.pos)

    return clampTilt({
      x: STEERING_GAIN * (desired.x - state.vel.x) + hold.x,
      y: STEERING_GAIN * (desired.y - state.vel.y) + hold.y,
    })
  }
}

/**
 * Runs the real physics against `createAutopilot`'s controller at FIXED_DT, feeding requested
 * tilt through `approachTilt` exactly as the engine does. Respawns at the start on 'fell' (each
 * one counts toward `falls`), stops on 'goal' (finished = true) or once `maxTime` elapses.
 * `pace` is passed to `createAutopilot`.
 */
export function runAutopilot(level: Level, maxTime = 180, pace = 1): AutopilotRun {
  const requestTilt = createAutopilot(level, pace)

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
