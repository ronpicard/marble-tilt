import type { Cell, Level, LevelDef, Vec2 } from './types.ts'

/** Smallest a level grid may be, in either dimension. */
const MIN_LEVEL_SIZE = 3

/** Maps the characters allowed in a `LevelDef` row to the `Cell` they represent. */
const CHAR_TO_CELL: Record<string, Cell> = {
  '#': 'wall',
  '.': 'floor',
  O: 'hole',
  S: 'start',
  G: 'goal',
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

  return { id, name, par, cols, rows: rows.length, cells, start: start!, goal: goal!, holes }
}

/** Neighbour offsets for 4-connected movement, used by `findPath`. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
]

/**
 * Finds a shortest route from `level.start` to `level.goal` over 4-connected floor/start/goal
 * cells (walls and holes both block movement), returning the centre of every cell on the route
 * from start to goal inclusive, or `null` if no such route exists.
 */
export function findPath(level: Level): Vec2[] | null {
  const { cols, rows, cells } = level
  const startCol = Math.floor(level.start.x)
  const startRow = Math.floor(level.start.y)
  const goalCol = Math.floor(level.goal.x)
  const goalRow = Math.floor(level.goal.y)

  const isOpen = (col: number, row: number): boolean => {
    const cell = cells[row * cols + col]
    return cell === 'floor' || cell === 'start' || cell === 'goal'
  }

  const visited = new Uint8Array(cols * rows)
  const prev = new Int32Array(cols * rows).fill(-1)
  const startIndex = startRow * cols + startCol
  const goalIndex = goalRow * cols + goalCol
  visited[startIndex] = 1

  const queue: number[] = [startIndex]
  let head = 0
  let found = startIndex === goalIndex
  while (head < queue.length && !found) {
    const index = queue[head++]
    const col = index % cols
    const row = (index - col) / cols
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nextCol = col + dx
      const nextRow = row + dy
      if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) continue
      if (!isOpen(nextCol, nextRow)) continue
      const nextIndex = nextRow * cols + nextCol
      if (visited[nextIndex]) continue
      visited[nextIndex] = 1
      prev[nextIndex] = index
      queue.push(nextIndex)
      if (nextIndex === goalIndex) {
        found = true
        break
      }
    }
  }

  if (!visited[goalIndex]) return null

  const path: Vec2[] = []
  let cur = goalIndex
  while (cur !== -1) {
    const col = cur % cols
    const row = (cur - col) / cols
    path.push({ x: col + 0.5, y: row + 0.5 })
    cur = cur === startIndex ? -1 : prev[cur]
  }
  path.reverse()
  return path
}

/**
 * The 12 shipped levels. They alternate between walled mazes with pits in the dead ends and open
 * boards where the route is a bridge or a slalom between pits. Grids are laid out one string per
 * row so their shape reads directly from the source. Each `par` is set from the autopilot's time
 * (`npm run solve`): about 0.85 of it on the mazes and about the same as it on the open boards,
 * where a player cannot safely outrun the bot by much.
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
    id: '02',
    name: 'Pillar Room',
    par: 6,
    rows: [
      '#########',
      '#S......#',
      '#.##.##.#',
      '#.#.O.#.#',
      '#.#...#.#',
      '#.#.O.#.#',
      '#.#####.#',
      '#......G#',
      '#########',
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
    id: '05',
    name: 'The Bridge',
    par: 7,
    rows: [
      '#############',
      '#S..OOOOO..G#',
      '#...OOOOO...#',
      '#...........#',
      '#...OOOOO...#',
      '#...OOOOO...#',
      '#############',
    ],
  },
  {
    id: '06',
    name: 'Four Corners',
    par: 15,
    rows: [
      '###########',
      '#G#O#....O#',
      '#.#.#.#.###',
      '#.#...#...#',
      '#.###.###.#',
      '#...#..S#.#',
      '###.#####.#',
      '#O#...#...#',
      '#.###.#.#.#',
      '#.......#O#',
      '###########',
    ],
  },
  {
    id: '07',
    name: 'Swiss Cheese',
    par: 7,
    rows: [
      '###########',
      '#S...O....#',
      '#..O...O..#',
      '#.O..O...O#',
      '#...O..O..#',
      '#O.O..O...#',
      '#....O..O.#',
      '#.O.O....G#',
      '###########',
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
    id: '09',
    name: 'The Gauntlet',
    par: 20,
    rows: [
      '#############',
      '#OO...#...OO#',
      '#####.#.#.###',
      '#...#.#S#...#',
      '#.#.#.#####.#',
      '#.#.#...#...#',
      '#.#.###.#.###',
      '#.#..O#.#...#',
      '#.#.###.###.#',
      '#.#G#...#...#',
      '#.###.###.#.#',
      '#.........#O#',
      '#############',
    ],
  },
  {
    id: '10',
    name: 'Causeway',
    par: 9,
    rows: [
      '#############',
      '#S.OOOOOOOOO#',
      '#..OOOOOOOOO#',
      '#O...OOOOOOO#',
      '#OOO.OOOOOOO#',
      '#OOO....OOOO#',
      '#OOOOOO.OOOO#',
      '#OOOOOO...OO#',
      '#OOOOOOOO.OO#',
      '#OOOOOOOO..G#',
      '#############',
    ],
  },
  {
    id: '11',
    name: 'Spiral Vault',
    par: 27,
    rows: [
      '###############',
      '#G#.....#OO...#',
      '#.#.###.#####.#',
      '#.#...#.......#',
      '#.###.#######.#',
      '#...#.....#OO.#',
      '###.###O#.###.#',
      '#O#...#O#...#.#',
      '#.###.#####.#.#',
      '#...#.#.....#.#',
      '#.#.#.#.#####.#',
      '#O#.....#S....#',
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
]

/** The 12 shipped levels, parsed and validated. */
export const LEVELS: Level[] = LEVEL_DEFS.map(parseLevel)
