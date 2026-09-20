import type { BallState, Layer, Level, StepEvent, StepResult, Tilt, Vec2 } from './types.ts'
import { type CellRef, cellAt, isOpen, layerAfter, rampAt } from './board.ts'

export { cellAt } from './board.ts'

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

/** Gravity's pull back down a full-height ramp cell, in cells/s^2. Scaled by a cell's `high - low`. */
export const RAMP_ACCEL = 12

/** Clamps a value between `lo` and `hi`. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi)
}

/** Euclidean distance between two points. */
function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
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

/** The marble's state at the start of a level: resting at the start cell's centre, on the ground. */
export function startState(level: Level): BallState {
  return { pos: { x: level.start.x, y: level.start.y }, vel: { x: 0, y: 0 }, layer: 0 }
}

/**
 * Height of the marble's centre above the ground, from 0 (ground) to 1 (the raised level). On a
 * ramp cell it is `low + (high - low) * p`, where `p` is the centre's progress through the cell
 * along `ramp.dir` (0 at the low edge, 1 at the high edge), clamped to 0..1. On a deck it is 1; on
 * a bridge it is whichever layer the marble is currently on; everywhere else it is 0.
 */
export function heightAt(level: Level, state: BallState): number {
  const col = Math.floor(state.pos.x)
  const row = Math.floor(state.pos.y)
  const ramp = rampAt(level, col, row)
  if (ramp) {
    const localX = state.pos.x - col
    const localY = state.pos.y - row
    const progress = clamp(0.5 + ramp.dir.x * (localX - 0.5) + ramp.dir.y * (localY - 0.5), 0, 1)
    return ramp.low + (ramp.high - ramp.low) * progress
  }
  const cell = cellAt(level, col, row)
  if (cell === 'deck') return 1
  if (cell === 'bridge') return state.layer
  return 0
}

/** Result of pushing a circle out of every solid cell around it once. */
interface WallResolution {
  pos: Vec2
  vel: Vec2
  impact: number
}

/**
 * Pushes the marble's centre `p` out of the unit square (col, row), reflecting the velocity
 * component moving into it (scaled by WALL_RESTITUTION) and tracking the impact speed. Handles the
 * degenerate case where the centre is already inside the square by pushing out along whichever edge
 * is nearest.
 */
function pushOutOf(
  col: number,
  row: number,
  p: Vec2,
  v: Vec2,
  impact: number,
): { p: Vec2; v: Vec2; impact: number } {
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
    // The centre is inside the cell: push out along whichever edge is nearest.
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

  if (separation >= BALL_RADIUS) return { p, v, impact }

  const overlap = BALL_RADIUS - separation
  const newP = { x: p.x + normalX * overlap, y: p.y + normalY * overlap }

  const normalVel = v.x * normalX + v.y * normalY
  let newV = v
  let newImpact = impact
  if (normalVel < 0) {
    newImpact = Math.max(impact, -normalVel)
    const reflected = (1 + WALL_RESTITUTION) * normalVel
    newV = { x: v.x - reflected * normalX, y: v.y - reflected * normalY }
  }

  return { p: newP, v: newV, impact: newImpact }
}

/**
 * Resolves the marble against every solid cell in the 3x3 block around its current cell (the cell
 * it is in when this is called — the caller recomputes that each pass). A neighbour is solid iff
 * `!isOpen(level, fromCell, layer, neighbour)`, where `fromCell` is that current cell. Also handles
 * the degenerate case where the centre's own cell isn't open from `startCell` — the cell the marble
 * was in at the start of the whole step — e.g. it tunnelled diagonally into a cell only reachable
 * orthogonally; that gets pushed back out along the smallest overlap axis.
 */
function resolveWalls(level: Level, pos: Vec2, vel: Vec2, layer: Layer, startCell: CellRef): WallResolution {
  let p = { x: pos.x, y: pos.y }
  let v = { x: vel.x, y: vel.y }
  let impact = 0

  const fromCell: CellRef = { col: Math.floor(p.x), row: Math.floor(p.y) }

  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      if (dRow === 0 && dCol === 0) continue
      const col = fromCell.col + dCol
      const row = fromCell.row + dRow
      if (isOpen(level, fromCell, layer, { col, row })) continue
      ;({ p, v, impact } = pushOutOf(col, row, p, v, impact))
    }
  }

  if (
    (fromCell.col !== startCell.col || fromCell.row !== startCell.row) &&
    !isOpen(level, startCell, layer, fromCell)
  ) {
    ;({ p, v, impact } = pushOutOf(fromCell.col, fromCell.row, p, v, impact))
  }

  return { pos: p, vel: v, impact }
}

/**
 * When `to` is diagonally adjacent to `from` (the centre crossed a column and a row in the same
 * step), picks whichever of the two orthogonal cells between them is open, so `layerAfter` can be
 * applied as two genuine single steps (its ramp-exit rule needs that). Returns `to` unchanged when the move wasn't
 * diagonal; if neither orthogonal candidate is open (step 3 should already have blocked that), falls
 * back to one of them arbitrarily.
 */
function orthogonalTarget(level: Level, layer: Layer, from: CellRef, to: CellRef): CellRef {
  if (from.col === to.col || from.row === to.row) return to
  const viaCol: CellRef = { col: to.col, row: from.row }
  const viaRow: CellRef = { col: from.col, row: to.row }
  if (isOpen(level, from, layer, viaCol)) return viaCol
  if (isOpen(level, from, layer, viaRow)) return viaRow
  return viaCol
}

/**
 * Advances the marble by one fixed timestep: accelerates by the (clamped) tilt — plus, on a ramp,
 * gravity pulling it back down the slope — applies rolling drag, clamps speed, moves, then resolves
 * collisions against solid cells (run twice so corners settle). Updates which layer the marble is on
 * when its cell changed, and reports whether it dropped off a raised edge and whether it sank into
 * the cup or a hole (ground level only, and not while it's on a ramp). Does not mutate `state` or
 * `tilt`.
 */
export function step(level: Level, state: BallState, tilt: Tilt, dt: number): StepResult {
  const clampedTilt = clampTilt(tilt)
  const startCell: CellRef = { col: Math.floor(state.pos.x), row: Math.floor(state.pos.y) }

  let vel: Vec2 = {
    x: state.vel.x + TILT_ACCEL * clampedTilt.x * dt,
    y: state.vel.y + TILT_ACCEL * clampedTilt.y * dt,
  }

  const startRamp = rampAt(level, startCell.col, startCell.row)
  if (startRamp) {
    const rampAccel = -RAMP_ACCEL * (startRamp.high - startRamp.low)
    vel = {
      x: vel.x + rampAccel * startRamp.dir.x * dt,
      y: vel.y + rampAccel * startRamp.dir.y * dt,
    }
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
    const resolved = resolveWalls(level, pos, vel, state.layer, startCell)
    pos = resolved.pos
    vel = resolved.vel
    impact = Math.max(impact, resolved.impact)
  }

  const newCell: CellRef = { col: Math.floor(pos.x), row: Math.floor(pos.y) }
  let layer = state.layer
  if (newCell.col !== startCell.col || newCell.row !== startCell.row) {
    // A diagonal move is two single steps, through the open cell between them, so the layer always
    // ends up matching the cell the marble is really in.
    const via = orthogonalTarget(level, state.layer, startCell, newCell)
    layer = layerAfter(level, startCell, state.layer, via)
    if (via.col !== newCell.col || via.row !== newCell.row) {
      layer = layerAfter(level, via, layer, newCell)
    }
  }

  const newState: BallState = { pos, vel, layer }
  const dropped = heightAt(level, state) - heightAt(level, newState) > 0.2

  let event: StepEvent = 'none'
  let sink: Vec2 | null = null
  if (layer === 0 && cellAt(level, newCell.col, newCell.row) !== 'ramp') {
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
  }

  return { state: newState, event, impact, sink, dropped }
}
