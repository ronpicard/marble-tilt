import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { BallState, Cell, Level, Ramp, Tilt, Vec2 } from './types.ts'
import {
  BALL_RADIUS,
  FIXED_DT,
  MAX_SPEED,
  MAX_TILT,
  approachTilt,
  cellAt,
  clampTilt,
  heightAt,
  startState,
  step,
} from './physics.ts'

/**
 * Builds a `Level` by hand from row strings (`#` wall, `.` floor, `O` hole, `S` start, `G` goal),
 * without going through `parseLevel` (which is being written concurrently in `./levels.ts`). None of
 * these rows use raised cells, so `ramps` is simply filled with `null`.
 */
function makeLevel(rows: string[], id = 'test', par = 10): Level {
  const height = rows.length
  const width = rows[0].length
  const cells: Cell[] = []
  let start = { x: 0.5, y: 0.5 }
  let goal = { x: 0.5, y: 0.5 }
  const holes: { x: number; y: number }[] = []

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const ch = rows[row][col]
      const centre = { x: col + 0.5, y: row + 0.5 }
      if (ch === '#') cells.push('wall')
      else if (ch === '.') cells.push('floor')
      else if (ch === 'O') {
        cells.push('hole')
        holes.push(centre)
      } else if (ch === 'S') {
        cells.push('start')
        start = centre
      } else if (ch === 'G') {
        cells.push('goal')
        goal = centre
      } else {
        throw new Error(`makeLevel: unknown cell '${ch}' at (${col}, ${row})`)
      }
    }
  }

  const ramps: (Ramp | null)[] = new Array(cells.length).fill(null)
  return { id, name: 'Test Level', par, cols: width, rows: height, cells, start, goal, holes, ramps }
}

/**
 * Builds a `Level` by hand from row strings, supporting the full board character set (`#` wall,
 * `.` floor, `O` hole, `S` start, `G` goal, `=` deck, `B` bridge, `>` `<` `^` `v` a ramp climbing
 * east/west/north/south). Independent of `parseLevel` so the physics tests below don't depend on
 * `./levels.ts`, which is being written concurrently. A maximal straight run of the same ramp
 * character along its own direction shares the climb: cell k of n (from the foot) gets
 * `low = k / n`, `high = (k + 1) / n`. Does not perform `parseLevel`'s authoring validation.
 */
function makeLayeredLevel(rows: string[], id = 'layered', par = 10): Level {
  const height = rows.length
  const width = rows[0].length
  const cells: Cell[] = new Array(height * width)
  const ramps: (Ramp | null)[] = new Array(height * width).fill(null)
  let start: Vec2 = { x: 0.5, y: 0.5 }
  let goal: Vec2 = { x: 0.5, y: 0.5 }
  const holes: Vec2[] = []

  const dirFor: Record<string, Vec2> = {
    '>': { x: 1, y: 0 },
    '<': { x: -1, y: 0 },
    '^': { x: 0, y: -1 },
    v: { x: 0, y: 1 },
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const ch = rows[row][col]
      const idx = row * width + col
      const centre = { x: col + 0.5, y: row + 0.5 }
      switch (ch) {
        case '#':
          cells[idx] = 'wall'
          break
        case '.':
          cells[idx] = 'floor'
          break
        case 'O':
          cells[idx] = 'hole'
          holes.push(centre)
          break
        case 'S':
          cells[idx] = 'start'
          start = centre
          break
        case 'G':
          cells[idx] = 'goal'
          goal = centre
          break
        case '=':
          cells[idx] = 'deck'
          break
        case 'B':
          cells[idx] = 'bridge'
          break
        case '>':
        case '<':
        case '^':
        case 'v':
          cells[idx] = 'ramp'
          break
        default:
          throw new Error(`makeLayeredLevel: unknown cell '${ch}' at (${col}, ${row})`)
      }
    }
  }

  // Fill in each ramp run: walk back to its foot, measure its length, then share the climb.
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const ch = rows[row][col]
      const dir = dirFor[ch]
      if (!dir) continue
      if (ramps[row * width + col]) continue // already filled as part of an earlier run

      let footCol = col
      let footRow = row
      while (rows[footRow - dir.y]?.[footCol - dir.x] === ch) {
        footCol -= dir.x
        footRow -= dir.y
      }

      let n = 0
      let c = footCol
      let r = footRow
      while (rows[r]?.[c] === ch) {
        n++
        c += dir.x
        r += dir.y
      }

      c = footCol
      r = footRow
      for (let k = 0; k < n; k++) {
        ramps[r * width + c] = { dir, low: k / n, high: (k + 1) / n }
        c += dir.x
        r += dir.y
      }
    }
  }

  return { id, name: 'Layered Test Level', par, cols: width, rows: height, cells, start, goal, holes, ramps }
}

/** Distance from a point to the nearest wall cell's edge (0 if inside a wall). */
function distanceToNearestWall(level: Level, pos: { x: number; y: number }): number {
  let nearest = Infinity
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      if (level.cells[row * level.cols + col] !== 'wall') continue
      const closestX = Math.min(Math.max(pos.x, col), col + 1)
      const closestY = Math.min(Math.max(pos.y, row), row + 1)
      const d = Math.hypot(pos.x - closestX, pos.y - closestY)
      if (d < nearest) nearest = d
    }
  }
  return nearest
}

/** A tiny seeded PRNG (LCG) so the fuzz test below is deterministic. Returns values in [0, 1). */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const OPEN_ROOM = makeLevel([
  '#######',
  '#S....#',
  '#.....#',
  '#.....#',
  '#....G#',
  '#######',
])

const ZERO_TILT: Tilt = { x: 0, y: 0 }

describe('cellAt / clampTilt / approachTilt', () => {
  it('clampTilt is circular and sanitises non-finite input', () => {
    const clamped = clampTilt({ x: 1, y: 1 })
    assert.ok(Math.abs(Math.hypot(clamped.x, clamped.y) - MAX_TILT) < 1e-9)
    assert.ok(Math.abs(clamped.x - clamped.y) < 1e-9)

    assert.deepEqual(clampTilt({ x: NaN, y: 0.1 }), { x: 0, y: 0.1 })
    assert.deepEqual(clampTilt({ x: Infinity, y: -Infinity }), { x: 0, y: 0 })
    assert.deepEqual(clampTilt({ x: 0.05, y: -0.05 }), { x: 0.05, y: -0.05 })
  })

  it('approachTilt converges to the target without overshooting', () => {
    let current: Tilt = { x: 0, y: 0 }
    // Well within MAX_TILT so clampTilt leaves it untouched.
    const target: Tilt = { x: 0.15, y: -0.08 }
    let prevDist = Math.hypot(target.x - current.x, target.y - current.y)
    for (let i = 0; i < 600; i++) {
      current = approachTilt(current, target, FIXED_DT)
      const dist = Math.hypot(target.x - current.x, target.y - current.y)
      assert.ok(dist <= prevDist + 1e-12, 'distance to target must never grow')
      assert.ok(current.x <= target.x + 1e-9, 'must not overshoot on x')
      assert.ok(current.y >= target.y - 1e-9, 'must not overshoot on y')
      prevDist = dist
    }
    assert.ok(Math.hypot(target.x - current.x, target.y - current.y) < 1e-6)
  })

  it('approachTilt clamps its target before approaching it', () => {
    let current: Tilt = { x: 0, y: 0 }
    for (let i = 0; i < 1000; i++) current = approachTilt(current, { x: 10, y: 0 }, FIXED_DT)
    assert.ok(Math.abs(current.x - MAX_TILT) < 1e-6)
  })
})

describe('step: basic motion', () => {
  it('a flat board with zero tilt and zero velocity stays put', () => {
    const state = startState(OPEN_ROOM)
    const result = step(OPEN_ROOM, state, ZERO_TILT, FIXED_DT)
    assert.deepEqual(result.state.pos, state.pos)
    assert.deepEqual(result.state.vel, { x: 0, y: 0 })
    assert.equal(result.event, 'none')
  })

  it('+x tilt rolls the marble toward +x', () => {
    let state = startState(OPEN_ROOM)
    const tilt: Tilt = { x: MAX_TILT, y: 0 }
    for (let i = 0; i < 30; i++) state = step(OPEN_ROOM, state, tilt, FIXED_DT).state
    assert.ok(state.vel.x > 0)
    assert.ok(state.pos.x > OPEN_ROOM.start.x)
    assert.ok(Math.abs(state.pos.y - OPEN_ROOM.start.y) < 1e-6)
  })

  it('+y tilt rolls the marble toward +y', () => {
    let state = startState(OPEN_ROOM)
    const tilt: Tilt = { x: 0, y: MAX_TILT }
    for (let i = 0; i < 30; i++) state = step(OPEN_ROOM, state, tilt, FIXED_DT).state
    assert.ok(state.vel.y > 0)
    assert.ok(state.pos.y > OPEN_ROOM.start.y)
    assert.ok(Math.abs(state.pos.x - OPEN_ROOM.start.x) < 1e-6)
  })

  it('drag brings a moving marble to near rest on a flat board', () => {
    let state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 5, y: -3 }, layer: 0 }
    for (let i = 0; i < 2000; i++) state = step(OPEN_ROOM, state, ZERO_TILT, FIXED_DT).state
    assert.ok(Math.hypot(state.vel.x, state.vel.y) < 1e-3)
  })

  it('speed never exceeds MAX_SPEED', () => {
    let state = startState(OPEN_ROOM)
    const tilt: Tilt = { x: MAX_TILT, y: MAX_TILT }
    for (let i = 0; i < 2000; i++) {
      const result = step(OPEN_ROOM, state, tilt, FIXED_DT)
      state = result.state
      assert.ok(Math.hypot(state.vel.x, state.vel.y) <= MAX_SPEED + 1e-9)
    }
  })
})

describe('step: wall collisions', () => {
  it('the marble never penetrates a wall it is driven straight into', () => {
    let state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    const tilt: Tilt = { x: MAX_TILT, y: 0 }
    for (let i = 0; i < 4000; i++) {
      state = step(OPEN_ROOM, state, tilt, FIXED_DT).state
      assert.ok(distanceToNearestWall(OPEN_ROOM, state.pos) >= BALL_RADIUS - 1e-6)
    }
  })

  it('the marble never penetrates a wall it is driven into a corner', () => {
    let state: BallState = { pos: { x: 3.5, y: 3.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    const tilt: Tilt = { x: MAX_TILT, y: MAX_TILT }
    for (let i = 0; i < 4000; i++) {
      state = step(OPEN_ROOM, state, tilt, FIXED_DT).state
      assert.ok(distanceToNearestWall(OPEN_ROOM, state.pos) >= BALL_RADIUS - 1e-6)
    }
  })

  it('a bounce reports positive impact and reverses the normal velocity, scaled down', () => {
    // Sitting just off the right wall, moving straight at it.
    const state: BallState = { pos: { x: 5.7, y: 2.5 }, vel: { x: 6, y: 0 }, layer: 0 }
    const result = step(OPEN_ROOM, state, ZERO_TILT, FIXED_DT)
    assert.ok(result.impact > 0)
    assert.ok(result.state.vel.x < 0, 'velocity into the wall must reverse')
    assert.ok(
      Math.abs(result.state.vel.x) < Math.abs(state.vel.x),
      'restitution must reduce the speed',
    )
  })
})

describe('step: sinking', () => {
  const withHole = makeLevel(['#######', '#S....#', '#..O..#', '#.....#', '#....G#', '#######'])

  it('rolling over a hole reports "fell" with that hole as the sink', () => {
    const state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    const result = step(withHole, state, ZERO_TILT, FIXED_DT)
    assert.equal(result.event, 'fell')
    assert.deepEqual(result.sink, { x: 3.5, y: 2.5 })
  })

  it('reaching the cup reports "goal"', () => {
    const state: BallState = {
      pos: { x: withHole.goal.x, y: withHole.goal.y },
      vel: { x: 0, y: 0 },
      layer: 0,
    }
    const result = step(withHole, state, ZERO_TILT, FIXED_DT)
    assert.equal(result.event, 'goal')
    assert.deepEqual(result.sink, withHole.goal)
  })

  it('elsewhere on the floor reports "none" with no sink', () => {
    const state: BallState = { pos: { x: 1.5, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    const result = step(withHole, state, ZERO_TILT, FIXED_DT)
    assert.equal(result.event, 'none')
    assert.equal(result.sink, null)
  })
})

describe('step: purity', () => {
  it('does not mutate its state or tilt arguments', () => {
    const state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 1, y: -1 }, layer: 0 }
    const tilt: Tilt = { x: 0.1, y: -0.05 }
    const stateCopy = structuredClone(state)
    const tiltCopy = structuredClone(tilt)
    step(OPEN_ROOM, state, tilt, FIXED_DT)
    assert.deepEqual(state, stateCopy)
    assert.deepEqual(tilt, tiltCopy)
  })

  it('is deterministic: identical inputs produce identical outputs', () => {
    const state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 2, y: -1.5 }, layer: 0 }
    const tilt: Tilt = { x: 0.15, y: 0.05 }
    const a = step(OPEN_ROOM, structuredClone(state), structuredClone(tilt), FIXED_DT)
    const b = step(OPEN_ROOM, structuredClone(state), structuredClone(tilt), FIXED_DT)
    assert.deepEqual(a, b)
  })
})

describe('step: decks and bridges', () => {
  const DECK_ROOM = makeLayeredLevel(['#####', '#.==#', '#.==#', '#####'])

  it('a ground marble bounces off a deck side instead of rolling onto it', () => {
    let state: BallState = { pos: { x: 1.5, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    const tilt: Tilt = { x: MAX_TILT, y: 0 }
    let sawImpact = false
    for (let i = 0; i < 400; i++) {
      const result = step(DECK_ROOM, state, tilt, FIXED_DT)
      state = result.state
      if (result.impact > 0) sawImpact = true
      assert.ok(state.pos.x <= 2 - BALL_RADIUS + 1e-6, 'must not cross the deck edge')
      assert.equal(state.layer, 0)
    }
    assert.ok(sawImpact, 'the marble should have bounced off the deck at least once')
  })

  const BRIDGE_ROOM = makeLayeredLevel(['#####', '#...#', '#.B.#', '#...#', '#####'])

  it('a ground marble rolls under a bridge and stays on layer 0', () => {
    let state: BallState = { pos: { x: 1.5, y: 2.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    const tilt: Tilt = { x: MAX_TILT, y: 0 }
    for (let i = 0; i < 300; i++) {
      state = step(BRIDGE_ROOM, state, tilt, FIXED_DT).state
      assert.equal(state.layer, 0)
    }
    assert.ok(state.pos.x > 2.5, 'the marble should have rolled through to the far side')
  })

  it('a layer-1 marble crossing a bridge over a hole does not fall, a layer-0 marble does', () => {
    const bridgeCentre = { x: 2.5, y: 2.5 }
    const bridgeOverHole: Level = { ...BRIDGE_ROOM, holes: [bridgeCentre] }

    const onBridge: BallState = { pos: bridgeCentre, vel: { x: 0, y: 0 }, layer: 1 }
    const overResult = step(bridgeOverHole, onBridge, ZERO_TILT, FIXED_DT)
    assert.equal(overResult.event, 'none')
    assert.equal(overResult.sink, null)

    const underneath: BallState = { pos: bridgeCentre, vel: { x: 0, y: 0 }, layer: 0 }
    const underResult = step(bridgeOverHole, underneath, ZERO_TILT, FIXED_DT)
    assert.equal(underResult.event, 'fell')
    assert.deepEqual(underResult.sink, bridgeCentre)
  })

  it('a layer-1 marble rolling off a deck edge drops to layer 0 with dropped exactly once', () => {
    let state: BallState = { pos: { x: 2.5, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 1 }
    const tilt: Tilt = { x: -MAX_TILT, y: 0 }
    let dropCount = 0
    for (let i = 0; i < 400; i++) {
      const result = step(DECK_ROOM, state, tilt, FIXED_DT)
      state = result.state
      if (result.dropped) dropCount++
    }
    assert.equal(dropCount, 1)
    assert.equal(state.layer, 0)
    const col = Math.floor(state.pos.x)
    const row = Math.floor(state.pos.y)
    assert.equal(cellAt(DECK_ROOM, col, row), 'floor')
  })
})

describe('step: ramps', () => {
  const RAMP_LEVEL = makeLayeredLevel(['######', '#.>>=#', '######'])

  it('heightAt is 0 at a ramp foot edge, 1 at its top edge, continuous across a 2-cell ramp', () => {
    const footEdge: BallState = { pos: { x: 2, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    assert.ok(Math.abs(heightAt(RAMP_LEVEL, footEdge)) < 1e-9)

    const topEdge: BallState = { pos: { x: 4, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 1 }
    assert.ok(Math.abs(heightAt(RAMP_LEVEL, topEdge) - 1) < 1e-9)

    const justBefore: BallState = { pos: { x: 2.999999, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    const justAfter: BallState = { pos: { x: 3.000001, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    assert.ok(Math.abs(heightAt(RAMP_LEVEL, justBefore) - 0.5) < 0.01)
    assert.ok(Math.abs(heightAt(RAMP_LEVEL, justAfter) - 0.5) < 0.01)
  })

  it('a marble with full tilt climbs a 2-cell ramp from its foot and ends on layer 1 on the deck', () => {
    let state: BallState = { pos: { x: 1.5, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 0 }
    const tilt: Tilt = { x: MAX_TILT, y: 0 }
    for (let i = 0; i < 500; i++) state = step(RAMP_LEVEL, state, tilt, FIXED_DT).state
    assert.equal(state.layer, 1)
    const col = Math.floor(state.pos.x)
    const row = Math.floor(state.pos.y)
    assert.equal(cellAt(RAMP_LEVEL, col, row), 'deck')
    assert.ok(Math.abs(heightAt(RAMP_LEVEL, state) - 1) < 1e-6)
  })

  it('released on a ramp with a level board it rolls back down to layer 0', () => {
    let state: BallState = { pos: { x: 3.5, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 1 }
    for (let i = 0; i < 500; i++) state = step(RAMP_LEVEL, state, ZERO_TILT, FIXED_DT).state
    assert.equal(state.layer, 0)
    const col = Math.floor(state.pos.x)
    const row = Math.floor(state.pos.y)
    assert.equal(cellAt(RAMP_LEVEL, col, row), 'floor')
  })

  describe('rails', () => {
    const RAIL_LEVEL = makeLayeredLevel(['#####', '#...#', '#.>.#', '#...#', '#####'])

    it('a ramp cannot be entered from its side', () => {
      let state: BallState = { pos: { x: 2.5, y: 1.5 }, vel: { x: 0, y: 0 }, layer: 0 }
      const tilt: Tilt = { x: 0, y: MAX_TILT }
      for (let i = 0; i < 300; i++) {
        state = step(RAIL_LEVEL, state, tilt, FIXED_DT).state
        assert.equal(state.layer, 0)
        assert.ok(
          !(Math.floor(state.pos.x) === 2 && Math.floor(state.pos.y) === 2),
          'must not enter the ramp cell from the side',
        )
      }
    })

    it('a ramp cannot be left by its side from on it', () => {
      // A ramp's own downhill gravity would otherwise carry it off through the foot or top given
      // enough time, so tilt slightly uphill (need > RAMP_ACCEL's 12 cells/s^2 to hold position)
      // while pressing hard toward the rail, and only run long enough to see the rail hold, not
      // long enough for the small residual uphill drift to reach the top end.
      let state: BallState = { pos: { x: 2.5, y: 2.5 }, vel: { x: 0, y: 0 }, layer: 0 }
      const tilt: Tilt = { x: 0.14, y: -0.14283 }
      for (let i = 0; i < 100; i++) {
        state = step(RAIL_LEVEL, state, tilt, FIXED_DT).state
        assert.equal(Math.floor(state.pos.y), 2, 'must stay on the ramp, not exit through its rail')
        assert.equal(Math.floor(state.pos.x), 2, 'sanity: must still be on the ramp cell')
      }
    })

    it('a ramp cannot be entered on the ground from its top end', () => {
      let state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 0, y: 0 }, layer: 0 }
      const tilt: Tilt = { x: -MAX_TILT, y: 0 }
      for (let i = 0; i < 300; i++) {
        state = step(RAIL_LEVEL, state, tilt, FIXED_DT).state
        assert.equal(state.layer, 0)
        assert.ok(Math.floor(state.pos.x) >= 3, 'must not enter the ramp from its top end on the ground')
      }
    })
  })
})

describe('step: fuzz', () => {
  it('keeps the marble out of solid cells and its layer in step with the cell it is in', () => {
    const level = makeLayeredLevel([
      '###########',
      '#S........#',
      '#..O...G..#',
      '#.>>==B=<.#',
      '#....=....#',
      '#....=.O..#',
      '#.........#',
      '###########',
    ])

    const rand = makeLcg(0xc0ffee)
    let state = startState(level)
    let tilt: Tilt = { x: 0, y: 0 }
    let reachedRaised = false
    for (let i = 0; i < 40000; i++) {
      // Hold each random tilt for half a second so the marble really travels, ramps included.
      if (i % 60 === 0) tilt = { x: (rand() * 2 - 1) * MAX_TILT, y: (rand() * 2 - 1) * MAX_TILT }
      const result = step(level, state, tilt, FIXED_DT)
      state = result.event === 'none' ? result.state : startState(level)
      const cell = cellAt(level, Math.floor(state.pos.x), Math.floor(state.pos.y))
      assert.notEqual(cell, 'wall', `step ${i}: centre ended up in a wall cell`)
      if (state.layer === 0) {
        assert.notEqual(cell, 'deck', `step ${i}: layer-0 centre ended up in a deck cell`)
      } else {
        reachedRaised = true
        assert.ok(
          cell === 'deck' || cell === 'bridge' || cell === 'ramp',
          `step ${i}: layer-1 centre ended up on the ground (${cell})`,
        )
      }
    }
    assert.equal(reachedRaised, true, 'the fuzz run never climbed to the raised level')
  })
})
