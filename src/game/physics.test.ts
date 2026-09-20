import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { BallState, Cell, Level, Tilt } from './types.ts'
import {
  BALL_RADIUS,
  FIXED_DT,
  MAX_SPEED,
  MAX_TILT,
  approachTilt,
  clampTilt,
  startState,
  step,
} from './physics.ts'

/**
 * Builds a `Level` by hand from row strings (`#` wall, `.` floor, `O` hole, `S` start, `G` goal),
 * without going through `parseLevel` (which is being written concurrently in `./levels.ts`).
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

  return { id, name: 'Test Level', par, cols: width, rows: height, cells, start, goal, holes }
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
    let state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 5, y: -3 } }
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
    let state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 0, y: 0 } }
    const tilt: Tilt = { x: MAX_TILT, y: 0 }
    for (let i = 0; i < 4000; i++) {
      state = step(OPEN_ROOM, state, tilt, FIXED_DT).state
      assert.ok(distanceToNearestWall(OPEN_ROOM, state.pos) >= BALL_RADIUS - 1e-6)
    }
  })

  it('the marble never penetrates a wall it is driven into a corner', () => {
    let state: BallState = { pos: { x: 3.5, y: 3.5 }, vel: { x: 0, y: 0 } }
    const tilt: Tilt = { x: MAX_TILT, y: MAX_TILT }
    for (let i = 0; i < 4000; i++) {
      state = step(OPEN_ROOM, state, tilt, FIXED_DT).state
      assert.ok(distanceToNearestWall(OPEN_ROOM, state.pos) >= BALL_RADIUS - 1e-6)
    }
  })

  it('a bounce reports positive impact and reverses the normal velocity, scaled down', () => {
    // Sitting just off the right wall, moving straight at it.
    const state: BallState = { pos: { x: 5.7, y: 2.5 }, vel: { x: 6, y: 0 } }
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
    const state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 0, y: 0 } }
    const result = step(withHole, state, ZERO_TILT, FIXED_DT)
    assert.equal(result.event, 'fell')
    assert.deepEqual(result.sink, { x: 3.5, y: 2.5 })
  })

  it('reaching the cup reports "goal"', () => {
    const state: BallState = { pos: { x: withHole.goal.x, y: withHole.goal.y }, vel: { x: 0, y: 0 } }
    const result = step(withHole, state, ZERO_TILT, FIXED_DT)
    assert.equal(result.event, 'goal')
    assert.deepEqual(result.sink, withHole.goal)
  })

  it('elsewhere on the floor reports "none" with no sink', () => {
    const state: BallState = { pos: { x: 1.5, y: 1.5 }, vel: { x: 0, y: 0 } }
    const result = step(withHole, state, ZERO_TILT, FIXED_DT)
    assert.equal(result.event, 'none')
    assert.equal(result.sink, null)
  })
})

describe('step: purity', () => {
  it('does not mutate its state or tilt arguments', () => {
    const state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 1, y: -1 } }
    const tilt: Tilt = { x: 0.1, y: -0.05 }
    const stateCopy = structuredClone(state)
    const tiltCopy = structuredClone(tilt)
    step(OPEN_ROOM, state, tilt, FIXED_DT)
    assert.deepEqual(state, stateCopy)
    assert.deepEqual(tilt, tiltCopy)
  })

  it('is deterministic: identical inputs produce identical outputs', () => {
    const state: BallState = { pos: { x: 3.5, y: 2.5 }, vel: { x: 2, y: -1.5 } }
    const tilt: Tilt = { x: 0.15, y: 0.05 }
    const a = step(OPEN_ROOM, structuredClone(state), structuredClone(tilt), FIXED_DT)
    const b = step(OPEN_ROOM, structuredClone(state), structuredClone(tilt), FIXED_DT)
    assert.deepEqual(a, b)
  })
})
