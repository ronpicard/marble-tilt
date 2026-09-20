import type { Cell, Layer, Level, LevelDef, Ramp, Vec2 } from './types.ts'
import { type CellRef, cellAt, isOpen, layerAfter } from './board.ts'

/** Smallest a level grid may be, in either dimension. */
const MIN_LEVEL_SIZE = 3

/** Longest a single ramp run may be, in cells. */
const MAX_RAMP_LENGTH = 3

/**
 * Maps the characters allowed in a `LevelDef` row to the `Cell` they represent: `#` wall, `.`
 * floor, `O` hole, `S` start, `G` goal, `=` deck, `B` bridge, and `>` `<` `^` `v` a ramp cell
 * (see `RAMP_DIR_BY_CHAR` for each arrow's climb direction).
 */
const CHAR_TO_CELL: Record<string, Cell> = {
  '#': 'wall',
  '.': 'floor',
  O: 'hole',
  S: 'start',
  G: 'goal',
  '=': 'deck',
  B: 'bridge',
  '>': 'ramp',
  '<': 'ramp',
  '^': 'ramp',
  v: 'ramp',
}

/** The characters that denote a ramp cell, and the unit step toward each one's high end. */
const RAMP_DIR_BY_CHAR: Record<string, Vec2> = {
  '>': { x: 1, y: 0 },
  '<': { x: -1, y: 0 },
  '^': { x: 0, y: -1 },
  v: { x: 0, y: 1 },
}

/** Ground cells a ramp may legally start from: not a hole, wall, or raised cell. */
const RAMP_FOOT_APPROACH: ReadonlySet<Cell> = new Set<Cell>(['floor', 'start', 'goal'])

/** Cells a ramp may legally lead into at its high end. */
const RAMP_TOP_LANDING: ReadonlySet<Cell> = new Set<Cell>(['deck', 'bridge'])

/** Neighbour offsets for 4-connected movement. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
]

/** The cell at (col, row), or null when that position is outside the grid. */
function cellAtIndex(cells: Cell[], cols: number, rowCount: number, col: number, row: number): Cell | null {
  if (col < 0 || row < 0 || col >= cols || row >= rowCount) return null
  return cells[row * cols + col]
}

/**
 * Scans one ramp run starting at `startCol`, `startRow` and walking in `step` (which must match
 * the run's own climb axis), filling `ramps` with each cell's `low`/`high` share and validating
 * the run: it must be at most `MAX_RAMP_LENGTH` cells, the ground cell before its foot must be
 * open ground (not a hole), and the cell after its top must be a deck or bridge. Returns the
 * number of cells consumed, so the caller can skip past the run.
 */
function fillRampRun(
  id: string,
  rows: string[],
  cols: number,
  cells: Cell[],
  ramps: (Ramp | null)[],
  ch: string,
  startCol: number,
  startRow: number,
  step: readonly [number, number],
): number {
  const [stepX, stepY] = step
  const dir = RAMP_DIR_BY_CHAR[ch]
  const rowCount = rows.length

  let n = 0
  while (true) {
    const col = startCol + stepX * n
    const row = startRow + stepY * n
    if (col < 0 || row < 0 || col >= cols || row >= rowCount || rows[row][col] !== ch) break
    n++
  }

  // The run walks from its foot toward its top when `step` matches `dir`, and the other way
  // around when the character climbs opposite to the scan direction (e.g. '<' scanned west-to-east).
  const scanIsTowardHigh = stepX === dir.x && stepY === dir.y
  const footCol = scanIsTowardHigh ? startCol : startCol + stepX * (n - 1)
  const footRow = scanIsTowardHigh ? startRow : startRow + stepY * (n - 1)
  const topCol = scanIsTowardHigh ? startCol + stepX * (n - 1) : startCol
  const topRow = scanIsTowardHigh ? startRow + stepY * (n - 1) : startRow

  if (n > MAX_RAMP_LENGTH) {
    throw new Error(`Level ${id}: ramp at row ${footRow}, col ${footCol} is ${n} cells long, max ${MAX_RAMP_LENGTH}`)
  }

  const beforeCol = footCol - dir.x
  const beforeRow = footRow - dir.y
  const before = cellAtIndex(cells, cols, rowCount, beforeCol, beforeRow)
  if (before === null || !RAMP_FOOT_APPROACH.has(before)) {
    throw new Error(
      `Level ${id}: ramp foot at row ${footRow}, col ${footCol} needs open ground (not a hole) at row ${beforeRow}, col ${beforeCol}`,
    )
  }

  const afterCol = topCol + dir.x
  const afterRow = topRow + dir.y
  const after = cellAtIndex(cells, cols, rowCount, afterCol, afterRow)
  if (after === null || !RAMP_TOP_LANDING.has(after)) {
    throw new Error(
      `Level ${id}: ramp top at row ${topRow}, col ${topCol} must lead to a deck or bridge at row ${afterRow}, col ${afterCol}`,
    )
  }

  for (let i = 0; i < n; i++) {
    const col = startCol + stepX * i
    const row = startRow + stepY * i
    const k = scanIsTowardHigh ? i : n - 1 - i
    ramps[row * cols + col] = { dir, low: k / n, high: (k + 1) / n }
  }

  return n
}

/**
 * Builds and validates the `ramps` grid for a level: finds every maximal straight run of the same
 * ramp character (horizontal runs for `>` `<`, vertical runs for `^` `v`) and fills each cell's
 * `low`/`high` share of the climb, throwing on any rule a run breaks.
 */
function buildRamps(id: string, rows: string[], cols: number, cells: Cell[]): (Ramp | null)[] {
  const rowCount = rows.length
  const ramps: (Ramp | null)[] = new Array(cols * rowCount).fill(null)

  for (let row = 0; row < rowCount; row++) {
    let col = 0
    while (col < cols) {
      const c = rows[row][col]
      if (c === '>' || c === '<') {
        col += fillRampRun(id, rows, cols, cells, ramps, c, col, row, [1, 0])
      } else {
        col++
      }
    }
  }

  for (let col = 0; col < cols; col++) {
    let row = 0
    while (row < rowCount) {
      const c = rows[row][col]
      if (c === '^' || c === 'v') {
        row += fillRampRun(id, rows, cols, cells, ramps, c, col, row, [0, 1])
      } else {
        row++
      }
    }
  }

  return ramps
}

/**
 * Validates that no `deck`, `bridge` or `ramp` cell is orthogonally adjacent to the outer border
 * ring, keeping raised things one cell away from the board's frame.
 */
function validateRaisedBorderDistance(id: string, cols: number, rowCount: number, cells: Cell[]): void {
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = cells[row * cols + col]
      if (cell !== 'deck' && cell !== 'bridge' && cell !== 'ramp') continue
      for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
        const nRow = row + dy
        const nCol = col + dx
        const onBorder = nRow === 0 || nRow === rowCount - 1 || nCol === 0 || nCol === cols - 1
        if (onBorder) {
          throw new Error(`Level ${id}: raised cell at row ${row}, col ${col} is adjacent to the border`)
        }
      }
    }
  }
}

/**
 * True when the cell at (col, row) supports a bridge from the direction (towardX, towardY) points
 * away from it: a deck or bridge cell always supports, and a ramp cell supports only when its top
 * faces back toward the bridge.
 */
function supportsBridge(
  cells: Cell[],
  ramps: (Ramp | null)[],
  cols: number,
  rowCount: number,
  col: number,
  row: number,
  towardX: number,
  towardY: number,
): boolean {
  const cell = cellAtIndex(cells, cols, rowCount, col, row)
  if (cell === 'deck' || cell === 'bridge') return true
  if (cell !== 'ramp') return false
  const ramp = ramps[row * cols + col]
  return ramp !== null && ramp.dir.x === towardX && ramp.dir.y === towardY && ramp.high === 1
}

/**
 * Validates that every `bridge` cell spans something: it needs a deck, bridge, or ramp top on
 * both its west and east neighbours, or on both its north and south neighbours.
 */
function validateBridgeSupport(id: string, cols: number, rowCount: number, cells: Cell[], ramps: (Ramp | null)[]): void {
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < cols; col++) {
      if (cells[row * cols + col] !== 'bridge') continue
      const west = supportsBridge(cells, ramps, cols, rowCount, col - 1, row, 1, 0)
      const east = supportsBridge(cells, ramps, cols, rowCount, col + 1, row, -1, 0)
      const north = supportsBridge(cells, ramps, cols, rowCount, col, row - 1, 0, 1)
      const south = supportsBridge(cells, ramps, cols, rowCount, col, row + 1, 0, -1)
      if (!((west && east) || (north && south))) {
        throw new Error(`Level ${id}: bridge at row ${row}, col ${col} has no support on two opposite sides`)
      }
    }
  }
}

/**
 * Validates a level definition and converts it into the flat, indexable form the rest of the
 * game works with. Throws when the grid is malformed, naming the level id and the offending row
 * or column so a bad level is easy to track down.
 */
export function parseLevel(def: LevelDef): Level {
  const { id, name, par, rows } = def

  if (rows.length < MIN_LEVEL_SIZE) {
    throw new Error(`Level ${id}: must have at least ${MIN_LEVEL_SIZE} rows, got ${rows.length}`)
  }
  const cols = rows[0].length
  if (cols < MIN_LEVEL_SIZE) {
    throw new Error(`Level ${id}: must have at least ${MIN_LEVEL_SIZE} columns, got ${cols}`)
  }
  for (let row = 0; row < rows.length; row++) {
    if (rows[row].length !== cols) {
      throw new Error(
        `Level ${id}: row ${row} has length ${rows[row].length}, expected ${cols}`,
      )
    }
  }

  const cells: Cell[] = new Array(cols * rows.length)
  let startCount = 0
  let goalCount = 0
  let start: Vec2 | null = null
  let goal: Vec2 | null = null
  const holes: Vec2[] = []

  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < cols; col++) {
      const ch = rows[row][col]
      const cell = CHAR_TO_CELL[ch]
      if (!cell) {
        throw new Error(`Level ${id}: invalid character '${ch}' at row ${row}, col ${col}`)
      }
      cells[row * cols + col] = cell
      const centre: Vec2 = { x: col + 0.5, y: row + 0.5 }
      if (cell === 'start') {
        startCount++
        start = centre
      } else if (cell === 'goal') {
        goalCount++
        goal = centre
      } else if (cell === 'hole') {
        holes.push(centre)
      }
    }
  }

  if (startCount !== 1) {
    throw new Error(`Level ${id}: expected exactly one S, found ${startCount}`)
  }
  if (goalCount !== 1) {
    throw new Error(`Level ${id}: expected exactly one G, found ${goalCount}`)
  }

  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < cols; col++) {
      const onBorder = row === 0 || row === rows.length - 1 || col === 0 || col === cols - 1
      if (onBorder && cells[row * cols + col] !== 'wall') {
        throw new Error(`Level ${id}: border must be wall at row ${row}, col ${col}`)
      }
    }
  }

  const ramps = buildRamps(id, rows, cols, cells)
  validateRaisedBorderDistance(id, cols, rows.length, cells)
  validateBridgeSupport(id, cols, rows.length, cells, ramps)

  return { id, name, par, cols, rows: rows.length, cells, start: start!, goal: goal!, holes, ramps }
}

/**
 * Finds a shortest route from `level.start` to `level.goal`, both on the ground layer, moving
 * 4-connected between (col, row, layer) states via `isOpen`/`layerAfter` so it agrees with the
 * physics about where the marble may roll: onto a ramp only at its foot (from the ground) or its
 * top (from the raised level), across a bridge on either layer, and off a raised edge as a legal
 * drop. Never routes through a hole cell while on the ground layer, even if the step that would
 * land there is otherwise open. Returns the centre of every cell on the route, start to goal
 * inclusive, or `null` if no such route exists.
 */
export function findPath(level: Level): Vec2[] | null {
  const { cols, rows: rowCount } = level
  const startCol = Math.floor(level.start.x)
  const startRow = Math.floor(level.start.y)
  const goalCol = Math.floor(level.goal.x)
  const goalRow = Math.floor(level.goal.y)

  const key = (col: number, row: number, layer: Layer): number => (row * cols + col) * 2 + layer

  const stateCount = cols * rowCount * 2
  const visited = new Uint8Array(stateCount)
  const prev = new Int32Array(stateCount).fill(-1)

  const startKey = key(startCol, startRow, 0)
  const goalKey = key(goalCol, goalRow, 0)
  visited[startKey] = 1

  const queue: number[] = [startKey]
  let head = 0
  let found = startKey === goalKey

  while (head < queue.length && !found) {
    const stateIndex = queue[head++]
    const layer = (stateIndex % 2) as Layer
    const cellIndex = (stateIndex - layer) / 2
    const col = cellIndex % cols
    const row = (cellIndex - col) / cols
    const from: CellRef = { col, row }

    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const to: CellRef = { col: col + dx, row: row + dy }
      if (to.col < 0 || to.row < 0 || to.col >= cols || to.row >= rowCount) continue
      if (!isOpen(level, from, layer, to)) continue

      const newLayer = layerAfter(level, from, layer, to)
      if (newLayer === 0 && cellAt(level, to.col, to.row) === 'hole') continue

      const nextKey = key(to.col, to.row, newLayer)
      if (visited[nextKey]) continue
      visited[nextKey] = 1
      prev[nextKey] = stateIndex
      queue.push(nextKey)
      if (nextKey === goalKey) {
        found = true
        break
      }
    }
  }

  if (!visited[goalKey]) return null

  const path: Vec2[] = []
  let cur = goalKey
  while (cur !== -1) {
    const layer = (cur % 2) as Layer
    const cellIndex = (cur - layer) / 2
    const col = cellIndex % cols
    const row = (cellIndex - col) / cols
    path.push({ x: col + 0.5, y: row + 0.5 })
    cur = cur === startKey ? -1 : prev[cur]
  }
  path.reverse()
  return path
}

/**
 * The 12 shipped levels, in menu order. Flat boards — walled mazes with pits in the dead ends, and
 * open boards where the route threads between pits — alternate with two-level boards: ramps up to
 * decks, bridges that are rolled under and later over, rooms joined only over the top of a wall,
 * and cups that can only be reached by dropping off a deck. Grids are laid out one string per row
 * so their shape reads directly from the source.
 *
 * `id` is the key a player's best time is saved under, so a board keeps its id for life and a new
 * board gets a fresh one; ids say nothing about menu order. Each `par` is set from the autopilot's
 * time (`npm run solve`): about 0.85 of it on the mazes and about the same as it on the open
 * boards, where a player cannot safely outrun the bot by much.
 */
export const LEVEL_DEFS: LevelDef[] = [
  {
    id: '01',
    name: 'First Roll',
    par: 7,
    rows: [
      '#######',
      '#S....#',
      '#####.#',
      '#.....#',
      '#.#####',
      '#....G#',
      '#######',
    ],
  },
  {
    id: '13',
    name: 'Up and Over',
    par: 7,
    rows: [
      '#############',
      '#S....#....G#',
      '#.....#.....#',
      '#..>=====<..#',
      '#.....#.....#',
      '#.....#.....#',
      '#############',
    ],
  },
  {
    id: '03',
    name: 'Slalom',
    par: 9,
    rows: [
      '###########',
      '#S.O...O.G#',
      '#..O.O.O..#',
      '#..O.O.O..#',
      '#....O....#',
      '#....O....#',
      '###########',
    ],
  },
  {
    id: '14',
    name: 'Underpass',
    par: 10,
    rows: [
      '#############',
      '#S....#.....#',
      '#.....=<<...#',
      '#..O..=...O.#',
      '#.....B.....#',
      '#..O##=.....#',
      '#..#G.=.O...#',
      '#...##......#',
      '#############',
    ],
  },
  {
    id: '04',
    name: 'Dead Ends',
    par: 13,
    rows: [
      '###########',
      '#G....#.OO#',
      '#####.#.###',
      '#...#.#...#',
      '#.#.#.###.#',
      '#.#S#...#.#',
      '#.#####.#.#',
      '#....O#.#.#',
      '#.#.###.#.#',
      '#O#.......#',
      '###########',
    ],
  },
  {
    id: '15',
    name: 'Drawbridge',
    par: 9,
    rows: [
      '###############',
      '#S....OOO.....#',
      '#..O..OOO..O..#',
      '#.....OOO.....#',
      '#..>>=BBB=<<..#',
      '#.....OOO.....#',
      '#..O..OOO..O..#',
      '#.....OOO....G#',
      '###############',
    ],
  },
  {
    id: '16',
    name: 'Four Rooms',
    par: 13,
    rows: [
      '###############',
      '#S.....#.....G#',
      '#......#..O...#',
      '#..O...#......#',
      '#.....O#...O..#',
      '#......#O.....#',
      '###.#######.###',
      '#......#O.....#',
      '#O.....#....O.#',
      '#..>>===<<....#',
      '#......#......#',
      '#O...O.#..O...#',
      '###############',
    ],
  },
  {
    id: '08',
    name: 'Switchback',
    par: 15,
    rows: [
      '###########',
      '#S........#',
      '##OOOOOOO.#',
      '#.........#',
      '#.OOOOOOOO#',
      '#.........#',
      '#OOOOOOOO.#',
      '#........G#',
      '###########',
    ],
  },
  {
    id: '17',
    name: 'Mezzanine',
    par: 13,
    rows: [
      '###############',
      '#.............#',
      '#......O......#',
      '#...======###.#',
      '#...=#=##=.G#.#',
      '#.>>===#==###.#',
      '#...=#===#....#',
      '#...===#==.O..#',
      '#.O...........#',
      '#.........O..S#',
      '###############',
    ],
  },
  {
    id: '18',
    name: 'Crossroads',
    par: 18,
    rows: [
      '###############',
      '#######......O#',
      '#S..#..v..#...#',
      '#.#.#..v..#.#.#',
      '#.#...#=#...#.#',
      '#.####.=.####.#',
      '#......B......#',
      '#.####.=.####.#',
      '######.=.######',
      '#######.#######',
      '#.....O.O.....#',
      '#G............#',
      '###############',
    ],
  },
  {
    id: '12',
    name: 'Whirlpool',
    par: 20,
    rows: [
      '###############',
      '#S..#.........#',
      '#.#.#.OOOOOOO.#',
      '#.#...O.....O.#',
      '#.###.O.OOO.O.#',
      '#...#.O.OGO.O.#',
      '###.#.O.O...O.#',
      '#O..#.O.OOOOO.#',
      '#.###.O.......#',
      '#.#...OOOOOOO.#',
      '#.#.#.........#',
      '#...#OOOOOOOOO#',
      '###############',
    ],
  },
  {
    id: '19',
    name: 'Citadel',
    par: 16,
    rows: [
      '###############',
      '#.............#',
      '#..OOOOOOO..O.#',
      '#..O#####O....#',
      '#.#O#...#O.#.##',
      '#..O#.G.#O....#',
      '##.O#...=B<<..#',
      '#..O#.O.#O....#',
      '#.#O#...#O.##.#',
      '#..O#####O....#',
      '#..OOOOOOO..O.#',
      '#S......#.....#',
      '###############',
    ],
  },
]

export const LEVELS: Level[] = LEVEL_DEFS.map(parseLevel)
