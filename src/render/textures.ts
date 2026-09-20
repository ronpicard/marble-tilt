import * as THREE from 'three'

const DEFAULT_SIZE = 1024
const STREAK_HEIGHT_MIN = 3
const STREAK_HEIGHT_MAX = 7
const STREAK_STEP = 3
const WAVE_AMPLITUDE = 7
const WAVE_FREQ_1 = 1
const WAVE_FREQ_2 = 3
const KNOT_COUNT_MIN = 2
const KNOT_COUNT_MAX = 4
const KNOT_RADIUS_MIN = 18
const KNOT_RADIUS_MAX = 42
const KNOT_RING_COUNT = 6
const KNOT_BEND_REACH = 2.2 // knot influence radius, as a multiple of the knot's own radius
const KNOT_BEND_STRENGTH = 0.6
const COLOR_VARIATION = 40 // max +/- per channel between streaks
const NOISE_STRENGTH = 10 // max +/- per channel, very fine per-pixel grain
const SHADOW_SIZE = 256

/** Deterministic 32-bit PRNG (mulberry32); same seed => same sequence, so grain is stable between loads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToCss(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.min(255, Math.max(0, v | 0))
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`
}

interface Knot { x: number; y: number; radius: number }

/**
 * Procedural planed-timber texture: horizontal grain streaks with gentle low-frequency waviness
 * (periodic across the canvas so it tiles), a few knots whose rings bend the grain, and fine noise.
 */
export function makeWoodTexture(options: {
  base: string
  grain: string
  seed: number
  size?: number
}): THREE.CanvasTexture {
  const size = options.size ?? DEFAULT_SIZE
  const rand = mulberry32(options.seed)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for wood texture')

  const [br, bg, bb] = hexToRgb(options.base)
  const [gr, gg, gb] = hexToRgb(options.grain)
  ctx.fillStyle = rgbToCss(br, bg, bb)
  ctx.fillRect(0, 0, size, size)

  const knots: Knot[] = []
  const knotCount = KNOT_COUNT_MIN + Math.floor(rand() * (KNOT_COUNT_MAX - KNOT_COUNT_MIN + 1))
  for (let i = 0; i < knotCount; i++) {
    knots.push({
      x: rand() * size,
      y: rand() * size,
      radius: KNOT_RADIUS_MIN + rand() * (KNOT_RADIUS_MAX - KNOT_RADIUS_MIN),
    })
  }

  // Whole-period sine harmonics keep the waviness seamless when the texture repeats horizontally.
  const phase1 = rand() * Math.PI * 2
  const phase2 = rand() * Math.PI * 2
  for (let y0 = 0; y0 < size; ) {
    const h = STREAK_HEIGHT_MIN + rand() * (STREAK_HEIGHT_MAX - STREAK_HEIGHT_MIN)
    const t = 0.35 + rand() * 0.5 // this streak's blend from base toward grain colour
    const jitter = (rand() - 0.5) * COLOR_VARIATION
    ctx.strokeStyle = rgbToCss(br + (gr - br) * t + jitter, bg + (gg - bg) * t + jitter, bb + (gb - bb) * t + jitter)
    ctx.lineWidth = h
    ctx.beginPath()
    for (let x = 0; x <= size; x += STREAK_STEP) {
      const angle = (x / size) * Math.PI * 2
      let dy =
        Math.sin(angle * WAVE_FREQ_1 + phase1) * WAVE_AMPLITUDE +
        Math.sin(angle * WAVE_FREQ_2 + phase2) * (WAVE_AMPLITUDE * 0.35)
      for (const knot of knots) {
        const dx = x - knot.x
        const kdy = y0 - knot.y
        const dist = Math.sqrt(dx * dx + kdy * kdy) + 0.001
        const influence = Math.min(1, (knot.radius * KNOT_BEND_REACH) / dist) ** 2
        dy += (kdy / dist) * influence * knot.radius * KNOT_BEND_STRENGTH
      }
      if (x === 0) ctx.moveTo(x, y0 + dy)
      else ctx.lineTo(x, y0 + dy)
    }
    ctx.stroke()
    y0 += h
  }

  for (const knot of knots) {
    for (let ring = KNOT_RING_COUNT; ring >= 1; ring--) {
      const radius = (knot.radius * ring) / KNOT_RING_COUNT
      const shade = ring % 2 === 0 ? -30 : 15
      ctx.strokeStyle = rgbToCss(gr + shade, gg + shade, gb + shade)
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.ellipse(knot.x, knot.y, radius, radius * (0.85 + rand() * 0.3), rand() * Math.PI, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  const image = ctx.getImageData(0, 0, size, size)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * NOISE_STRENGTH
    data[i] = Math.min(255, Math.max(0, data[i] + n))
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n))
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n))
  }
  ctx.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

/** Soft dark radial gradient on a transparent background, for contact shadows and glows. */
export function makeRadialShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = SHADOW_SIZE
  canvas.height = SHADOW_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for shadow texture')

  const centre = SHADOW_SIZE / 2
  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)')
  gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, SHADOW_SIZE, SHADOW_SIZE)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
