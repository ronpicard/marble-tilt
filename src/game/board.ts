import type { Cell, Layer, Level, Ramp } from './types.ts'

/**
 * The rules of the two-level board, shared by the physics (what the marble collides with) and the
 * pathfinder (where a route may go), so the two can never disagree.
 *
 * The marble is always "in" the cell that holds its centre. From there, each neighbouring cell is
 * either open (the marble may overlap and enter it) or solid (it bounces off that cell's square).
 */

export interface CellRef {
  col: number
  row: number
}

/** The cell at (col, row). Anything outside the grid is a wall. */
export function cellAt(level: Level, col: number, row: number): Cell {
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return 'wall'
  return level.cells[row * level.cols + col]
}

/** The ramp data at (col, row), or null when that cell is not a ramp. */
export function rampAt(level: Level, col: number, row: number): Ramp | null {
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return null
  return level.ramps[row * level.cols + col]
}

/** Ground-level cells: the marble rolls on the board's floor there. */
export function isGround(cell: Cell): boolean {
  return cell === 'floor' || cell === 'hole' || cell === 'start' || cell === 'goal'
}

/** Raised cells: the marble rolls on top of them when it is on layer 1. */
export function isRaised(cell: Cell): boolean {
  return cell === 'deck' || cell === 'bridge'
}

/** True when `to` is the cell one step from `from` in the direction (dx, dy). */
function isStep(from: CellRef, to: CellRef, dx: number, dy: number): boolean {
  return to.col === from.col + dx && to.row === from.row + dy
}

/**
 * Whether a marble whose centre is in `from`, on `layer`, may overlap and enter the neighbouring
 * cell `to` (any of the eight neighbours). False means `to` is solid to it.
 *
 * - Walls are solid to everything.
 * - On a ramp, only the cells at its two ends are open. A ramp has rails, so its sides are solid
 *   from on it and from beside it.
 * - On the ground, decks are solid (their sides are walls), bridges are open (roll under them), and
 *   a ramp is open only from the ground cell at its foot.
 * - On the raised level, decks and bridges are open, ground is open (roll off the edge and drop),
 *   and a ramp is open only from the raised cell at its top.
 */
export function isOpen(level: Level, from: CellRef, layer: Layer, to: CellRef): boolean {
  const target = cellAt(level, to.col, to.row)
  if (target === 'wall') return false

  const fromRamp = rampAt(level, from.col, from.row)
  if (fromRamp) {
    const { dir } = fromRamp
    return isStep(from, to, dir.x, dir.y) || isStep(from, to, -dir.x, -dir.y)
  }

  if (target === 'ramp') {
    const ramp = rampAt(level, to.col, to.row)
    if (!ramp) return false
    // From the ground, only the foot of the ramp lets you on; from above, only the top.
    const atFoot = isStep(to, from, -ramp.dir.x, -ramp.dir.y) && ramp.low === 0
    const atTop = isStep(to, from, ramp.dir.x, ramp.dir.y) && ramp.high === 1
    return layer === 0 ? atFoot : atTop
  }

  if (layer === 0) return target !== 'deck'
  return true
}

/**
 * The layer a marble is on once its centre has moved from `from` into the open neighbour `to`.
 * Leaving a ramp by its top lands on the raised level; leaving it by its foot lands on the ground.
 * Moving onto a ramp or a bridge keeps the current layer (a bridge can be crossed over or under).
 */
export function layerAfter(level: Level, from: CellRef, layer: Layer, to: CellRef): Layer {
  const target = cellAt(level, to.col, to.row)
  const fromRamp = rampAt(level, from.col, from.row)
  if (fromRamp && target !== 'ramp') {
    const leftByTop = isStep(from, to, fromRamp.dir.x, fromRamp.dir.y) && fromRamp.high === 1
    return leftByTop && isRaised(target) ? 1 : 0
  }
  if (target === 'deck') return 1
  if (isGround(target)) return 0
  return layer
}
