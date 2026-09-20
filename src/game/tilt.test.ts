import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TILT } from './physics.ts'
import { FULL_DEVICE_TILT_DEG, keysToTilt, orientationToTilt, pointerToTilt } from './tilt.ts'

const EPS = 1e-9

describe('pointerToTilt', () => {
  it('is zero at the anchor', () => {
    const tilt = pointerToTilt(0, 0, 100)
    assert.equal(tilt.x, 0)
    assert.equal(tilt.y, 0)
  })

  it('reaches MAX_TILT at the reach distance', () => {
    const tilt = pointerToTilt(100, 0, 100)
    assert.ok(Math.abs(tilt.x - MAX_TILT) < EPS)
    assert.ok(Math.abs(tilt.y) < EPS)
  })

  it('clamps an offset beyond the reach distance', () => {
    const tilt = pointerToTilt(500, 0, 100)
    assert.ok(Math.abs(Math.hypot(tilt.x, tilt.y) - MAX_TILT) < EPS)
  })

  it('clamps a diagonal offset circularly', () => {
    const tilt = pointerToTilt(100, 100, 100)
    assert.ok(Math.hypot(tilt.x, tilt.y) <= MAX_TILT + EPS)
    assert.ok(Math.abs(tilt.x - tilt.y) < EPS)
  })

  it('is zero when reach is non-positive or non-finite', () => {
    for (const reach of [0, -10, NaN, Infinity]) {
      const tilt = pointerToTilt(50, 50, reach)
      assert.equal(tilt.x, 0)
      assert.equal(tilt.y, 0)
    }
  })
})

describe('keysToTilt', () => {
  it('is zero with nothing held', () => {
    const tilt = keysToTilt({ left: false, right: false, up: false, down: false })
    assert.equal(tilt.x, 0)
    assert.equal(tilt.y, 0)
  })

  it('gives full MAX_TILT on a single axis, up as -y', () => {
    const right = keysToTilt({ left: false, right: true, up: false, down: false })
    assert.ok(Math.abs(right.x - MAX_TILT) < EPS)
    assert.equal(right.y, 0)

    const up = keysToTilt({ left: false, right: false, up: true, down: false })
    assert.ok(Math.abs(up.y - -MAX_TILT) < EPS)
    assert.equal(up.x, 0)
  })

  it('normalises a diagonal to MAX_TILT magnitude', () => {
    const tilt = keysToTilt({ left: false, right: true, up: true, down: false })
    assert.ok(Math.abs(Math.hypot(tilt.x, tilt.y) - MAX_TILT) < EPS)
  })

  it('cancels opposite keys', () => {
    const horizontal = keysToTilt({ left: true, right: true, up: false, down: false })
    assert.equal(horizontal.x, 0)
    assert.equal(horizontal.y, 0)

    const vertical = keysToTilt({ left: false, right: false, up: true, down: true })
    assert.equal(vertical.x, 0)
    assert.equal(vertical.y, 0)
  })
})

describe('orientationToTilt', () => {
  const neutral = { beta: 10, gamma: -5 }

  it('is zero at the neutral pose', () => {
    const tilt = orientationToTilt(neutral, neutral, 0)
    assert.equal(tilt.x, 0)
    assert.equal(tilt.y, 0)
  })

  it('reaches MAX_TILT at FULL_DEVICE_TILT_DEG', () => {
    const pose = { beta: neutral.beta, gamma: neutral.gamma + FULL_DEVICE_TILT_DEG }
    const tilt = orientationToTilt(pose, neutral, 0)
    assert.ok(Math.abs(tilt.x - MAX_TILT) < EPS)
    assert.ok(Math.abs(tilt.y) < EPS)
  })

  it('subtracts the neutral offset', () => {
    const shiftedNeutral = { beta: neutral.beta + 100, gamma: neutral.gamma + 100 }
    const shiftedPose = { beta: shiftedNeutral.beta, gamma: shiftedNeutral.gamma + FULL_DEVICE_TILT_DEG }
    const tilt = orientationToTilt(shiftedPose, shiftedNeutral, 0)
    assert.ok(Math.abs(tilt.x - MAX_TILT) < EPS)
    assert.ok(Math.abs(tilt.y) < EPS)
  })

  it('maps the raw delta that "tips the right edge down" to +x at every screen angle', () => {
    // angle 0: x = dGamma
    assert.ok(orientationToTilt({ beta: neutral.beta, gamma: neutral.gamma + 10 }, neutral, 0).x > 0)
    // angle 90: x = dBeta
    assert.ok(orientationToTilt({ beta: neutral.beta + 10, gamma: neutral.gamma }, neutral, 90).x > 0)
    // angle 180: x = -dGamma
    assert.ok(orientationToTilt({ beta: neutral.beta, gamma: neutral.gamma - 10 }, neutral, 180).x > 0)
    // angle 270: x = -dBeta
    assert.ok(orientationToTilt({ beta: neutral.beta - 10, gamma: neutral.gamma }, neutral, 270).x > 0)
  })

  it('treats an unrecognised screen angle as portrait', () => {
    const pose = { beta: neutral.beta, gamma: neutral.gamma + 10 }
    const unrecognised = orientationToTilt(pose, neutral, 45)
    const portrait = orientationToTilt(pose, neutral, 0)
    assert.equal(unrecognised.x, portrait.x)
    assert.equal(unrecognised.y, portrait.y)
  })

  it('clamps a large reading to MAX_TILT', () => {
    const pose = { beta: neutral.beta, gamma: neutral.gamma + 90 }
    const tilt = orientationToTilt(pose, neutral, 0)
    assert.ok(Math.abs(Math.hypot(tilt.x, tilt.y) - MAX_TILT) < EPS)
  })

  it('is zero for garbage input', () => {
    const tilt = orientationToTilt({ beta: NaN, gamma: Infinity }, neutral, 0)
    assert.equal(tilt.x, 0)
    assert.equal(tilt.y, 0)
  })
})
