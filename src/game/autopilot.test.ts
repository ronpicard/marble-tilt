import test from 'node:test'
import assert from 'node:assert/strict'
import { LEVELS } from './levels.ts'
import { TWO_STAR_FACTOR } from './progress.ts'
import { DEMO_PACE, createAutopilot, runAutopilot } from './autopilot.ts'
import { FIXED_DT, approachTilt, startState, step } from './physics.ts'
import { parseLevel } from './levels.ts'
import type { Level } from './types.ts'

test('autopilot finishes every shipped level cleanly, within a sane band around par', () => {
  for (const level of LEVELS) {
    const run = runAutopilot(level)
    assert.equal(run.finished, true, `level ${level.id} (${level.name}) did not finish`)
    assert.equal(run.falls, 0, `level ${level.id} (${level.name}) fell ${run.falls} time(s)`)
    assert.ok(
      run.time <= level.par * TWO_STAR_FACTOR,
      `level ${level.id} took ${run.time.toFixed(2)}s, expected <= ${(level.par * TWO_STAR_FACTOR).toFixed(2)} (par * TWO_STAR_FACTOR)`,
    )
    assert.ok(
      run.time > level.par * 0.5,
      `level ${level.id} took ${run.time.toFixed(2)}s, expected > ${(level.par * 0.5).toFixed(2)} (par looks too generous)`,
    )
  }
})

test('runAutopilot is deterministic', () => {
  const level = LEVELS[0]
  const first = runAutopilot(level)
  const second = runAutopilot(level)
  assert.deepEqual(first, second)
})

test('createAutopilot throws for a level with no path from start to goal', () => {
  const unsolvable: Level = {
    id: 'unsolvable',
    name: 'Unsolvable',
    par: 10,
    cols: 5,
    rows: 5,
    cells: [
      'wall', 'wall', 'wall', 'wall', 'wall',
      'wall', 'start', 'wall', 'goal', 'wall',
      'wall', 'wall', 'wall', 'wall', 'wall',
      'wall', 'wall', 'wall', 'wall', 'wall',
      'wall', 'wall', 'wall', 'wall', 'wall',
    ],
    start: { x: 1.5, y: 1.5 },
    goal: { x: 3.5, y: 1.5 },
    holes: [],
    ramps: new Array(25).fill(null),
  }

  assert.throws(() => createAutopilot(unsolvable))
})

test('the menu demo pace still finishes every shipped level without a fall, only slower', () => {
  for (const level of LEVELS) {
    const demo = runAutopilot(level, 180, DEMO_PACE)
    assert.equal(demo.finished, true, `level ${level.id} (${level.name}) did not finish at the demo pace`)
    assert.equal(demo.falls, 0, `level ${level.id} (${level.name}) fell at the demo pace`)
    assert.ok(demo.time > runAutopilot(level).time, `level ${level.id} was not slower at the demo pace`)
  }
})

test('createAutopilot rejects a pace outside its range', () => {
  assert.throws(() => createAutopilot(LEVELS[0], 0), RangeError)
  assert.throws(() => createAutopilot(LEVELS[0], 1.5), RangeError)
  assert.throws(() => createAutopilot(LEVELS[0], Number.NaN), RangeError)
})

test('the autopilot rolls a straight corridor without rocking the board back and forth', () => {
  const corridor = parseLevel({
    id: 'corridor',
    name: 'Corridor',
    par: 5,
    rows: ['#############', '#S.........G#', '#############'],
  })
  const requestTilt = createAutopilot(corridor)
  let state = startState(corridor)
  let tilt = { x: 0, y: 0 }
  let lastSign = 0
  let reversals = 0
  let finished = false

  for (let i = 0; i < 20 / FIXED_DT && !finished; i++) {
    const target = requestTilt(state)
    const sign = Math.abs(target.x) < 0.02 ? 0 : Math.sign(target.x)
    if (sign !== 0) {
      if (lastSign !== 0 && sign !== lastSign) reversals++
      lastSign = sign
    }
    tilt = approachTilt(tilt, target, FIXED_DT)
    const result = step(corridor, state, tilt, FIXED_DT)
    state = result.state
    finished = result.event === 'goal'
  }

  assert.equal(finished, true)
  // One push to get going and one to brake into the cup. Braking at every cell reversed it ~19 times.
  assert.ok(reversals <= 2, `requested tilt reversed ${reversals} times on a straight run`)
})
