import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LevelDef, Vec2 } from './types.ts'
import { LEVEL_DEFS, LEVELS, findPath, parseLevel } from './levels.ts'

const MAX_SHIPPED_COLS = 15
const MAX_SHIPPED_ROWS = 13

function def(rows: string[], overrides: Partial<LevelDef> = {}): LevelDef {
  return { id: 'T', name: 'Test', par: 10, rows, ...overrides }
}

// --- parseLevel: happy path -------------------------------------------------

test('parseLevel maps a good grid to the right cells, start, goal and holes', () => {
  const level = parseLevel(
    def([
      '#####',
      '#S.O#',
      '#.#.#',
      '#..G#',
      '#####',
    ]),
  )

  assert.equal(level.cols, 5)
  assert.equal(level.rows, 5)
  assert.deepEqual(level.start, { x: 1.5, y: 1.5 })
  assert.deepEqual(level.goal, { x: 3.5, y: 3.5 })
  assert.deepEqual(level.holes, [{ x: 3.5, y: 1.5 }])
  assert.equal(level.cells[1 * 5 + 1], 'start')
  assert.equal(level.cells[1 * 5 + 3], 'hole')
  assert.equal(level.cells[3 * 5 + 3], 'goal')
  assert.equal(level.cells[2 * 5 + 2], 'wall')
  assert.equal(level.cells[2 * 5 + 1], 'floor')
  assert.equal(level.cells[0], 'wall')
})

// --- parseLevel: rejections --------------------------------------------------

test('parseLevel rejects too few rows, naming the level id', () => {
  assert.throws(
    () => parseLevel(def(['###', '#S#'], { id: 'bad-rows' })),
    /Level bad-rows:.*rows/,
  )
})

test('parseLevel rejects too few columns, naming the level id', () => {
  assert.throws(
    () => parseLevel(def(['#', '#', '#'], { id: 'bad-cols' })),
    /Level bad-cols:.*column/,
  )
})

test('parseLevel rejects a row whose length does not match the others, naming id and row', () => {
  assert.throws(
    () => parseLevel(def(['#####', '#S.G#', '####', '#####'], { id: 'ragged' })),
    /Level ragged: row 2/,
  )
})

test('parseLevel rejects an invalid character, naming id, row and col', () => {
  assert.throws(
    () => parseLevel(def(['#####', '#S.G#', '#.X.#', '#####'], { id: 'bad-char' })),
    /Level bad-char: invalid character 'X' at row 2, col 2/,
  )
})

test('parseLevel rejects a grid with no start', () => {
  assert.throws(
    () => parseLevel(def(['#####', '#...#', '#..G#', '#####'], { id: 'no-start' })),
    /Level no-start: expected exactly one S, found 0/,
  )
})

test('parseLevel rejects a grid with two starts', () => {
  assert.throws(
    () => parseLevel(def(['#####', '#S.S#', '#..G#', '#####'], { id: 'two-starts' })),
    /Level two-starts: expected exactly one S, found 2/,
  )
})

test('parseLevel rejects a grid with no goal', () => {
  assert.throws(
    () => parseLevel(def(['#####', '#S..#', '#...#', '#####'], { id: 'no-goal' })),
    /Level no-goal: expected exactly one G, found 0/,
  )
})

test('parseLevel rejects a grid with two goals', () => {
  assert.throws(
    () => parseLevel(def(['#####', '#S.G#', '#..G#', '#####'], { id: 'two-goals' })),
    /Level two-goals: expected exactly one G, found 2/,
  )
})

test('parseLevel rejects a non-wall border cell, naming id, row and col', () => {
  assert.throws(
    () => parseLevel(def(['#####', '.S..#', '#..G#', '#####'], { id: 'open-border' })),
    /Level open-border: border must be wall at row 1, col 0/,
  )
})

// --- findPath ----------------------------------------------------------------

test('findPath returns a contiguous 4-connected path of centres from start to goal', () => {
  const level = parseLevel(
    def([
      '#####',
      '#S..#',
      '#.#.#',
      '#..G#',
      '#####',
    ]),
  )
  const path = findPath(level)
  assert.ok(path)
  const p = path as Vec2[]
  assert.deepEqual(p[0], level.start)
  assert.deepEqual(p[p.length - 1], level.goal)
  for (let i = 1; i < p.length; i++) {
    const dx = Math.abs(p[i].x - p[i - 1].x)
    const dy = Math.abs(p[i].y - p[i - 1].y)
    const stepIsOrthogonalUnit = (dx === 1 && dy === 0) || (dx === 0 && dy === 1)
    assert.ok(stepIsOrthogonalUnit, `step ${i} is not a unit orthogonal move`)
  }
  // Never crosses a wall or hole cell.
  for (const point of p) {
    const col = Math.floor(point.x)
    const row = Math.floor(point.y)
    const cell = level.cells[row * level.cols + col]
    assert.notEqual(cell, 'wall')
    assert.notEqual(cell, 'hole')
  }
})

test('findPath returns null when the start and goal are walled off from each other', () => {
  const level = parseLevel(
    def([
      '#####',
      '#S#.#',
      '#####',
      '#.#G#',
      '#####',
    ]),
  )
  assert.equal(findPath(level), null)
})

test('findPath returns null when only a hole connects the two halves', () => {
  const level = parseLevel(
    def([
      '#####',
      '#S#G#',
      '#.O.#',
      '#####',
    ]),
  )
  assert.equal(findPath(level), null)
})

// --- shipped levels ------------------------------------------------------------

test('LEVEL_DEFS has exactly 12 levels with unique ids', () => {
  assert.equal(LEVEL_DEFS.length, 12)
  assert.equal(new Set(LEVEL_DEFS.map((lvl) => lvl.id)).size, 12)
})

test('every shipped level parses without throwing', () => {
  for (const level of LEVEL_DEFS) {
    assert.doesNotThrow(() => parseLevel(level), `level ${level.id} failed to parse`)
  }
})

test('every shipped level has a non-null path from start to goal', () => {
  for (const level of LEVELS) {
    assert.notEqual(findPath(level), null, `level ${level.id} has no path`)
  }
})

test('every shipped level is within the 15x13 maximum size', () => {
  for (const level of LEVELS) {
    assert.ok(level.cols <= MAX_SHIPPED_COLS, `level ${level.id} is too wide (${level.cols})`)
    assert.ok(level.rows <= MAX_SHIPPED_ROWS, `level ${level.id} is too tall (${level.rows})`)
  }
})

test('no shipped level has a hole orthogonally adjacent to the start', () => {
  for (const level of LEVELS) {
    for (const hole of level.holes) {
      const dx = Math.abs(hole.x - level.start.x)
      const dy = Math.abs(hole.y - level.start.y)
      const isOrthogonallyAdjacent = (dx === 1 && dy === 0) || (dx === 0 && dy === 1)
      assert.ok(!isOrthogonallyAdjacent, `level ${level.id} has a hole beside the start`)
    }
  }
})

test('every shipped level has a positive par', () => {
  for (const level of LEVELS) {
    assert.ok(level.par > 0, `level ${level.id} has non-positive par`)
  }
})

test('the shortest path is at least as long as the board\'s longer side', () => {
  // Open boards full of holes are short but hard, so the rule only keeps the cup away from the start.
  for (const level of LEVELS) {
    const path = findPath(level)
    assert.ok(path, `level ${level.id} has no path`)
    const minLength = Math.max(level.cols, level.rows)
    assert.ok(
      (path as Vec2[]).length >= minLength,
      `level ${level.id} path is ${(path as Vec2[]).length}, expected >= ${minLength}`,
    )
  }
})
