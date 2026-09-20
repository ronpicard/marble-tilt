import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Layer, LevelDef } from './types.ts'
import { type CellRef, isOpen, layerAfter } from './board.ts'
import { parseLevel } from './levels.ts'

function def(rows: string[]): LevelDef {
  return { id: 'T', name: 'Test', par: 10, rows }
}

/**
 * One straight, single-cell ramp climbing east from a ground foot to a deck, then a deck-flanked
 * bridge continuing east, with a plain deck beyond it. Kept one cell away from the border
 * throughout, per the parser's adjacency rule. Layout (row 3, the only row with raised cells):
 * col1 floor (ramp approach) · col2 ramp (foot, low 0 high 0.5) · col3 ramp (top, low 0.5 high 1)
 * · col4 deck · col5 bridge · col6 deck · col7 floor. Row 4 has a floor cell under the ramp's foot
 * (col2) and a hole under the ramp's top (col3), both reachable only from on the ramp, which the
 * rails forbid, so they exist purely to exercise the "solid from beside it" half of the rail rule.
 */
const LEVEL = parseLevel(
  def([
    '###########',
    '#S........#',
    '#.........#',
    '#.>>=B=...#',
    '#..O......#',
    '#........G#',
    '###########',
  ]),
)

const FLOOR_BEFORE_FOOT: CellRef = { col: 1, row: 3 }
const FLOOR_NORTH_OF_FOOT: CellRef = { col: 2, row: 2 }
const FLOOR_SOUTH_OF_FOOT: CellRef = { col: 2, row: 4 }
const RAMP_FOOT: CellRef = { col: 2, row: 3 }
const RAMP_TOP: CellRef = { col: 3, row: 3 }
const FLOOR_NORTH_OF_TOP: CellRef = { col: 3, row: 2 }
const DECK: CellRef = { col: 4, row: 3 }
const FLOOR_NORTH_OF_DECK: CellRef = { col: 4, row: 2 }
const BRIDGE: CellRef = { col: 5, row: 3 }
const FLOOR_NORTH_OF_BRIDGE: CellRef = { col: 5, row: 2 }
const DECK_EAST_OF_BRIDGE: CellRef = { col: 6, row: 3 }
const WALL: CellRef = { col: 0, row: 1 }
const FLOOR_NEXT_TO_WALL: CellRef = { col: 1, row: 1 }

// --- isOpen --------------------------------------------------------------------------------

test('isOpen: a wall is solid to everything, on either layer', () => {
  const cases: Array<[Layer, boolean]> = [
    [0, false],
    [1, false],
  ]
  for (const [layer, expected] of cases) {
    assert.equal(
      isOpen(LEVEL, FLOOR_NEXT_TO_WALL, layer, WALL),
      expected,
      `layer ${layer}`,
    )
  }
})

test('isOpen: a ramp is entered from the ground only at its foot approach cell', () => {
  assert.equal(isOpen(LEVEL, FLOOR_BEFORE_FOOT, 0, RAMP_FOOT), true)
})

test('isOpen: a ramp cannot be entered from beside it, on the ground', () => {
  assert.equal(isOpen(LEVEL, FLOOR_NORTH_OF_FOOT, 0, RAMP_FOOT), false)
  assert.equal(isOpen(LEVEL, FLOOR_SOUTH_OF_FOOT, 0, RAMP_FOOT), false)
})

test('isOpen: on a ramp, only the two end cells are open (rails)', () => {
  assert.equal(isOpen(LEVEL, RAMP_FOOT, 0, RAMP_TOP), true, 'foot to top, the climb')
  assert.equal(isOpen(LEVEL, RAMP_FOOT, 0, FLOOR_NORTH_OF_FOOT), false, 'foot to its north side')
  assert.equal(isOpen(LEVEL, RAMP_FOOT, 0, FLOOR_SOUTH_OF_FOOT), false, 'foot to its south side')
  assert.equal(isOpen(LEVEL, RAMP_TOP, 1, DECK), true, 'top to the deck beyond it')
  assert.equal(isOpen(LEVEL, RAMP_TOP, 1, FLOOR_NORTH_OF_TOP), false, 'top to its north side')
})

test('isOpen: a ramp cannot be entered from beside it, on the raised level either', () => {
  assert.equal(isOpen(LEVEL, FLOOR_NORTH_OF_TOP, 1, RAMP_TOP), false)
})

test('isOpen: on the ground, decks are solid', () => {
  assert.equal(isOpen(LEVEL, FLOOR_NORTH_OF_DECK, 0, DECK), false)
})

test('isOpen: on the ground, bridges are open (roll under)', () => {
  assert.equal(isOpen(LEVEL, FLOOR_NORTH_OF_BRIDGE, 0, BRIDGE), true)
})

test('isOpen: on the ground, a ramp is open only from the ground cell at its foot', () => {
  assert.equal(isOpen(LEVEL, FLOOR_BEFORE_FOOT, 0, RAMP_FOOT), true)
})

test('isOpen: on the raised level, decks and bridges are open', () => {
  assert.equal(isOpen(LEVEL, DECK, 1, BRIDGE), true)
  assert.equal(isOpen(LEVEL, BRIDGE, 1, DECK_EAST_OF_BRIDGE), true)
})

test('isOpen: on the raised level, the ground is open (roll off the edge and drop)', () => {
  assert.equal(isOpen(LEVEL, DECK, 1, FLOOR_NORTH_OF_DECK), true)
})

test('isOpen: on the raised level, a ramp is open only from the raised cell at its top', () => {
  assert.equal(isOpen(LEVEL, DECK, 1, RAMP_TOP), true)
})

// --- layerAfter ------------------------------------------------------------------------------

test('layerAfter: leaving a ramp by its top lands on the raised level', () => {
  assert.equal(layerAfter(LEVEL, RAMP_TOP, 0, DECK), 1)
})

test('layerAfter: leaving a ramp by its foot lands on the ground', () => {
  assert.equal(layerAfter(LEVEL, RAMP_FOOT, 1, FLOOR_BEFORE_FOOT), 0)
})

test('layerAfter: moving onto a ramp keeps the current layer', () => {
  assert.equal(layerAfter(LEVEL, FLOOR_BEFORE_FOOT, 0, RAMP_FOOT), 0, 'from the ground')
  assert.equal(layerAfter(LEVEL, DECK, 1, RAMP_TOP), 1, 'from the raised level')
})

test('layerAfter: moving onto a bridge keeps the current layer', () => {
  assert.equal(layerAfter(LEVEL, FLOOR_NORTH_OF_BRIDGE, 0, BRIDGE), 0, 'from the ground')
  assert.equal(layerAfter(LEVEL, DECK, 1, BRIDGE), 1, 'from the raised level')
})
