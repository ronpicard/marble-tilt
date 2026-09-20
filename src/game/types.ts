/**
 * A point or vector on the board plane. One unit is one grid cell. x grows to the right and y
 * grows toward the player (down the rows of the level grid), so the centre of the cell at
 * (col, row) is (col + 0.5, row + 0.5).
 */
export interface Vec2 {
  x: number
  y: number
}

/**
 * Board tilt in radians. x > 0 tips the right edge down, so the marble accelerates toward +x;
 * y > 0 tips the near edge down, so the marble accelerates toward +y.
 */
export interface Tilt {
  x: number
  y: number
}

/**
 * 'deck' is a solid raised platform, 'bridge' is a raised plank the marble can roll over or under,
 * and 'ramp' climbs from the ground to the raised level. Everything else is at ground level.
 */
export type Cell = 'wall' | 'floor' | 'hole' | 'start' | 'goal' | 'deck' | 'bridge' | 'ramp'

/** 0 is the ground, 1 is the raised level (decks and bridges). */
export type Layer = 0 | 1

/** One cell of a ramp. A ramp may run across several cells in a row, sharing the climb between them. */
export interface Ramp {
  /** Unit step toward the high end: one of (1,0), (-1,0), (0,1), (0,-1). */
  dir: Vec2
  /** Height at the low edge of this cell, as a fraction of the raised level (0 to 1). */
  low: number
  /** Height at the high edge of this cell, as a fraction of the raised level (0 to 1). */
  high: number
}

/**
 * A level as authored: one string per row, one character per cell.
 * `#` wall, `.` floor, `O` hole, `S` start, `G` goal, `=` deck, `B` bridge, and `>` `<` `^` `v`
 * a ramp that climbs toward the east, west, north (up the grid) or south.
 */
export interface LevelDef {
  id: string
  name: string
  rows: string[]
  /** Seconds. Finishing at or under par earns three stars. */
  par: number
}

/** A parsed, validated level. */
export interface Level {
  id: string
  name: string
  par: number
  cols: number
  rows: number
  /** Row-major: the cell at (col, row) is cells[row * cols + col]. */
  cells: Cell[]
  /** Centre of the start cell. */
  start: Vec2
  /** Centre of the goal cell. */
  goal: Vec2
  /** Centres of the hole cells. */
  holes: Vec2[]
  /** Row-major like `cells`: the ramp data for a 'ramp' cell, null for every other cell. */
  ramps: (Ramp | null)[]
}

export interface BallState {
  pos: Vec2
  vel: Vec2
  /** Which level the marble is on. On a ramp it is the level the marble came from. */
  layer: Layer
}

export type StepEvent = 'none' | 'fell' | 'goal'

export interface StepResult {
  state: BallState
  event: StepEvent
  /** Speed into a wall this step, in cells per second. 0 when nothing was hit. */
  impact: number
  /** Centre of the hole or cup the marble dropped into. null unless event is 'fell' or 'goal'. */
  sink: Vec2 | null
  /** True on the step the marble rolled off a deck, bridge or ramp edge and dropped to the ground. */
  dropped: boolean
}
