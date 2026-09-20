import test from 'node:test'
import assert from 'node:assert/strict'
import { LEVELS } from './levels.ts'
import { TWO_STAR_FACTOR } from './progress.ts'
import { createAutopilot, runAutopilot } from './autopilot.ts'
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
  }

  assert.throws(() => createAutopilot(unsolvable))
})
