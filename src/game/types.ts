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

export type Cell = 'wall' | 'floor' | 'hole' | 'start' | 'goal'

/**
 * A level as authored: one string per row, one character per cell.
 * `#` wall, `.` floor, `O` hole, `S` start, `G` goal.
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
}

export interface BallState {
  pos: Vec2
  vel: Vec2
}

export type StepEvent = 'none' | 'fell' | 'goal'

export interface StepResult {
  state: BallState
  event: StepEvent
  /** Speed into a wall this step, in cells per second. 0 when nothing was hit. */
  impact: number
  /** Centre of the hole or cup the marble dropped into. null unless event is 'fell' or 'goal'. */
  sink: Vec2 | null
}
