import type { BallState, Cell, Level, StepEvent, StepResult, Tilt, Vec2 } from './types.ts'

/** Radius of the marble, in grid cells. */
export const BALL_RADIUS = 0.3

/** The marble falls when its centre comes within this distance of a hole's centre. */
export const HOLE_RADIUS = 0.4

/** The marble sinks when its centre comes within this distance of the cup's centre. */
export const GOAL_RADIUS = 0.4

/** Largest tilt magnitude allowed, in radians. Clamped circularly, not per axis. */
export const MAX_TILT = 0.2

/** Acceleration applied per radian of tilt, in cells/s^2 (small-angle: uses the tilt directly). */
export const TILT_ACCEL = 90

/** Rolling drag coefficient, in 1/s. Velocity decays as `vel *= exp(-ROLL_DRAG * dt)`. */
export const ROLL_DRAG = 0.9

/** Marble speed is clamped to this, in cells/s. */
export const MAX_SPEED = 9

/** Fraction of normal speed kept after bouncing off a wall. */
export const WALL_RESTITUTION = 0.35

/** How fast the board's actual tilt follows the requested tilt, in 1/s. */
export const TILT_RESPONSE = 10

/** Fixed simulation timestep, in seconds. */
export const FIXED_DT = 1 / 120

/** Clamps a value between `lo` and `hi`. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi)
}

/** Euclidean distance between two points. */
function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Looks up the cell at (col, row). Cells outside the level bounds are walls. */
export function cellAt(level: Level, col: number, row: number): Cell {
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return 'wall'
  return level.cells[row * level.cols + col]
}

/** Clamps a tilt to MAX_TILT circularly (not per axis). Non-finite components become 0. */
export function clampTilt(tilt: Tilt): Tilt {
  const x = Number.isFinite(tilt.x) ? tilt.x : 0
  const y = Number.isFinite(tilt.y) ? tilt.y : 0
  const magnitude = Math.hypot(x, y)
  if (magnitude <= MAX_TILT) return { x, y }
  const scale = MAX_TILT / magnitude
  return { x: x * scale, y: y * scale }
}

/**
 * Moves the board's actual tilt toward a (clamped) requested tilt, at a rate governed by
 * TILT_RESPONSE. This models the board taking time to physically follow player input.
 */
export function approachTilt(current: Tilt, target: Tilt, dt: number): Tilt {
  const clamped = clampTilt(target)
  const factor = 1 - Math.exp(-TILT_RESPONSE * dt)
  return {
    x: current.x + (clamped.x - current.x) * factor,
    y: current.y + (clamped.y - current.y) * factor,
  }
}

/** The marble's state at the start of a level: resting at the start cell's centre. */
export function startState(level: Level): BallState {
  return { pos: { x: level.start.x, y: level.start.y }, vel: { x: 0, y: 0 } }
}

/** Result of pushing a circle out of every overlapping wall cell once. */
interface WallResolution {
  pos: Vec2
  vel: Vec2
  impact: number
}

/**
 * Resolves the marble against every wall cell in the 3x3 block around its current cell: finds
 * the closest point on the wall's unit square to the marble's centre, and if that point is closer
 * than BALL_RADIUS, pushes the marble out along the normal and reflects the velocity component
 * moving into the wall, scaled by WALL_RESTITUTION. Handles the degenerate case where the centre
 * is already inside a wall cell by pushing out along the axis with the smallest overlap.
 */
function resolveWalls(level: Level, pos: Vec2, vel: Vec2): WallResolution {
  let p = { x: pos.x, y: pos.y }
  let v = { x: vel.x, y: vel.y }
  let impact = 0

  const centreCol = Math.floor(p.x)
  const centreRow = Math.floor(p.y)

  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      const col = centreCol + dCol
      const row = centreRow + dRow
      if (cellAt(level, col, row) !== 'wall') continue

      const left = col
      const right = col + 1
      const top = row
      const bottom = row + 1
      const closestX = clamp(p.x, left, right)
      const closestY = clamp(p.y, top, bottom)

      let normalX: number
      let normalY: number
      let separation: number

      if (closestX === p.x && closestY === p.y) {
        // The centre is inside the wall cell: push out along whichever edge is nearest.
        const edges = [
          { amount: p.x - left, nx: -1, ny: 0 },
          { amount: right - p.x, nx: 1, ny: 0 },
          { amount: p.y - top, nx: 0, ny: -1 },
          { amount: bottom - p.y, nx: 0, ny: 1 },
        ]
        let nearest = edges[0]
        for (const edge of edges) {
          if (edge.amount < nearest.amount) nearest = edge
        }
        normalX = nearest.nx
        normalY = nearest.ny
        separation = -nearest.amount
      } else {
        const dx = p.x - closestX
        const dy = p.y - closestY
        separation = Math.hypot(dx, dy)
        if (separation === 0) {
          normalX = 0
          normalY = 0
        } else {
          normalX = dx / separation
          normalY = dy / separation
        }
      }

      if (separation < BALL_RADIUS) {
        const overlap = BALL_RADIUS - separation
        p = { x: p.x + normalX * overlap, y: p.y + normalY * overlap }

        const normalVel = v.x * normalX + v.y * normalY
        if (normalVel < 0) {
          impact = Math.max(impact, -normalVel)
          const reflected = (1 + WALL_RESTITUTION) * normalVel
          v = { x: v.x - reflected * normalX, y: v.y - reflected * normalY }
        }
      }
    }
  }

  return { pos: p, vel: v, impact }
}

/**
 * Advances the marble by one fixed timestep: accelerates by the (clamped) tilt, applies rolling
 * drag, clamps speed, moves, then resolves wall collisions (run twice so corners settle). Reports
 * whether the marble sank into the cup or a hole. Does not mutate `state` or `tilt`.
 */
export function step(level: Level, state: BallState, tilt: Tilt, dt: number): StepResult {
  const clampedTilt = clampTilt(tilt)

  let vel: Vec2 = {
    x: state.vel.x + TILT_ACCEL * clampedTilt.x * dt,
    y: state.vel.y + TILT_ACCEL * clampedTilt.y * dt,
  }

  const dragFactor = Math.exp(-ROLL_DRAG * dt)
  vel = { x: vel.x * dragFactor, y: vel.y * dragFactor }

  const speed = Math.hypot(vel.x, vel.y)
  if (speed > MAX_SPEED) {
    const scale = MAX_SPEED / speed
    vel = { x: vel.x * scale, y: vel.y * scale }
  }

  let pos: Vec2 = { x: state.pos.x + vel.x * dt, y: state.pos.y + vel.y * dt }

  let impact = 0
  for (let pass = 0; pass < 2; pass++) {
    const resolved = resolveWalls(level, pos, vel)
    pos = resolved.pos
    vel = resolved.vel
    impact = Math.max(impact, resolved.impact)
  }

  let event: StepEvent = 'none'
  let sink: Vec2 | null = null
  if (distance(pos, level.goal) <= GOAL_RADIUS) {
    event = 'goal'
    sink = level.goal
  } else {
    for (const hole of level.holes) {
      if (distance(pos, hole) <= HOLE_RADIUS) {
        event = 'fell'
        sink = hole
        break
      }
    }
  }

  return { state: { pos, vel }, event, impact, sink }
}
