import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTime,
  parseProgress,
  recordResult,
  serializeProgress,
  starsFor,
  totalStars,
} from './progress.ts'
import type { Progress } from './progress.ts'

test('starsFor: at or under par is 3 stars', () => {
  assert.equal(starsFor(10, 10), 3)
  assert.equal(starsFor(5, 10), 3)
})

test('starsFor: just over par drops to 2 stars', () => {
  assert.equal(starsFor(10.0001, 10), 2)
})

test('starsFor: exactly par * TWO_STAR_FACTOR is still 2 stars', () => {
  assert.equal(starsFor(15, 10), 2)
})

test('starsFor: just over par * TWO_STAR_FACTOR drops to 1 star', () => {
  assert.equal(starsFor(15.0001, 10), 1)
})

test('starsFor: far over par is 1 star', () => {
  assert.equal(starsFor(100, 10), 1)
})

test('recordResult: returns a new object and does not mutate its input', () => {
  const progress: Progress = { '01': { bestTime: 20, stars: 2 } }
  const snapshot = JSON.parse(JSON.stringify(progress))
  const next = recordResult(progress, '01', 8, 10)
  assert.notEqual(next, progress)
  assert.deepEqual(progress, snapshot)
})

test('recordResult: a fresh level gets its first record', () => {
  const next = recordResult({}, '01', 12, 10)
  assert.deepEqual(next, { '01': { bestTime: 12, stars: 2 } })
})

test('recordResult: keeps the lower bestTime and the higher stars independently', () => {
  // First run: slow (1 star) but establishes a bestTime.
  const afterSlow = recordResult({}, '01', 20, 10)
  assert.deepEqual(afterSlow, { '01': { bestTime: 20, stars: 1 } })

  // Second run: faster time (new bestTime), earns 3 stars.
  const afterFast = recordResult(afterSlow, '01', 8, 10)
  assert.deepEqual(afterFast, { '01': { bestTime: 8, stars: 3 } })

  // Third run: slower than the best time, but still worth 3 stars — stars must not regress
  // and bestTime must not regress either, even though this run alone was slower.
  const afterSlowAgain = recordResult(afterFast, '01', 9, 10)
  assert.deepEqual(afterSlowAgain, { '01': { bestTime: 8, stars: 3 } })
})

test('recordResult: a run that lowers bestTime but scores fewer stars does not lower stars', () => {
  const afterFirst = recordResult({}, '01', 9, 10)
  assert.deepEqual(afterFirst, { '01': { bestTime: 9, stars: 3 } })

  // A lower absolute time (8 < 9) against a much smaller par only earns 1 star for this run
  // alone, but bestTime and stars must each track their own best independently: bestTime drops
  // to 8, while stars stays at the previously earned 3 rather than being recomputed down.
  const afterSecond = recordResult(afterFirst, '01', 8, 1)
  assert.deepEqual(afterSecond, { '01': { bestTime: 8, stars: 3 } })
})

test('recordResult: leaves other levels in the progress object untouched', () => {
  const progress: Progress = { '02': { bestTime: 5, stars: 3 } }
  const next = recordResult(progress, '01', 8, 10)
  assert.deepEqual(next['02'], { bestTime: 5, stars: 3 })
  assert.deepEqual(next['01'], { bestTime: 8, stars: 3 })
})

test('parseProgress: null raw yields empty progress', () => {
  assert.deepEqual(parseProgress(null, ['01']), {})
})

test('parseProgress: malformed JSON yields empty progress', () => {
  assert.deepEqual(parseProgress('{not json', ['01']), {})
})

test('parseProgress: a JSON array is rejected', () => {
  assert.deepEqual(parseProgress('[1,2,3]', ['01']), {})
})

test('parseProgress: unknown level ids are dropped', () => {
  const raw = JSON.stringify({ '01': { bestTime: 10, stars: 3 }, '99': { bestTime: 5, stars: 2 } })
  assert.deepEqual(parseProgress(raw, ['01']), { '01': { bestTime: 10, stars: 3 } })
})

test('parseProgress: negative, NaN, or string bestTime is dropped', () => {
  const raw = JSON.stringify({
    a: { bestTime: -5, stars: 2 },
    b: { bestTime: NaN, stars: 2 },
    c: { bestTime: '10', stars: 2 },
    d: { bestTime: 0, stars: 2 },
  })
  assert.deepEqual(parseProgress(raw, ['a', 'b', 'c', 'd']), {})
})

test('parseProgress: stars outside 1..3 is dropped', () => {
  const raw = JSON.stringify({
    a: { bestTime: 10, stars: 0 },
    b: { bestTime: 10, stars: 4 },
    c: { bestTime: 10, stars: 2.5 },
    d: { bestTime: 10, stars: '3' },
  })
  assert.deepEqual(parseProgress(raw, ['a', 'b', 'c', 'd']), {})
})

test('parseProgress: round trips through serializeProgress', () => {
  const progress: Progress = {
    '01': { bestTime: 7.349, stars: 3 },
    '02': { bestTime: 22.1, stars: 1 },
  }
  const raw = serializeProgress(progress)
  assert.deepEqual(parseProgress(raw, ['01', '02']), progress)
})

test('totalStars: sums stars across all levels', () => {
  const progress: Progress = {
    '01': { bestTime: 1, stars: 3 },
    '02': { bestTime: 2, stars: 1 },
    '03': { bestTime: 3, stars: 2 },
  }
  assert.equal(totalStars(progress), 6)
})

test('totalStars: empty progress is zero', () => {
  assert.equal(totalStars({}), 0)
})

test('formatTime: examples from the spec', () => {
  assert.equal(formatTime(7.349), '0:07.3')
  assert.equal(formatTime(83.27), '1:23.2')
})

test('formatTime: zero', () => {
  assert.equal(formatTime(0), '0:00.0')
})

test('formatTime: truncates rather than rounding up', () => {
  assert.equal(formatTime(59.99), '0:59.9')
})

test('formatTime: ten minutes exactly', () => {
  assert.equal(formatTime(600), '10:00.0')
})
