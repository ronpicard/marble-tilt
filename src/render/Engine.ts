import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { EngineApi, EngineEvents, EngineMode, ViewInsets } from './engineApi.ts'
import { createTiltInput } from './input.ts'
import { makeRadialShadowTexture, makeWoodTexture } from './textures.ts'
import { DEMO_PACE, createAutopilot } from '../game/autopilot.ts'
import { cellAt, rampAt } from '../game/board.ts'
import { approachTilt, BALL_RADIUS, FIXED_DT, GOAL_RADIUS, heightAt, HOLE_RADIUS, startState, step } from '../game/physics.ts'
import type { BallState, Level, Tilt, Vec2 } from '../game/types.ts'

// --- Look ------------------------------------------------------------------------------------

const BACKGROUND_COLOR = 0x14100c
const FLOOR_BASE_COLOR = '#c99a63'
const FLOOR_GRAIN_COLOR = '#8a6136'
const WALL_BASE_COLOR = '#5e4029'
const WALL_GRAIN_COLOR = '#2b1b10'
const RAISED_BASE_COLOR = '#a8693a'
const RAISED_GRAIN_COLOR = '#5e3517'
const RAISED_WOOD_SEED = 31
const FRAME_TINT = 0xb9a08c
const BASE_COLOR = 0x0c0805
const WELL_COLOR = 0x050403
const BEVEL_COLOR = 0x120c08
const GOAL_WELL_EMISSIVE = 0x2fae5e
const GOAL_GLOW_COLOR = 0x5fe08a
const MARBLE_COLOR = 0xdfe6ea
const START_RING_COLOR = 0xf0a53a
const GLOW_PLANE_COLOR = 0xff8a3d

/** Extra visual rotation applied to the physics tilt so the lean reads clearly on screen. */
const VISUAL_TILT_GAIN = 1.6
const WALL_HEIGHT = 0.42
const WALL_INSET = 1
const FRAME_HEIGHT = 0.46
/** World-unit height of a deck's top face above the floor; clears the marble under a bridge. */
const DECK_HEIGHT = 0.75
/** Thickness of a bridge plank, in world units. */
const BRIDGE_THICKNESS = 0.1
/**
 * Height of a wall cell that sits beside a deck, bridge or ramp: just proud of the deck, so it still
 * reads as a wall from up there without hiding the marble behind it in the isometric view.
 */
const RAISED_WALL_HEIGHT = DECK_HEIGHT + 0.15
/** Cross-section (width and thickness) of a ramp's guard rails, in world units. */
const RAIL_SIZE = 0.06
/** How far a ramp's guard rails sit above its sloped surface, in world units. */
const RAIL_RISE = 0.12
/** How fast the marble falls once it drops off a raised edge, in world units/s^2. */
const DROP_GRAVITY = 30
/** Snaps `marbleLift` to its target once the gap closes to this many world units (ramps are continuous). */
const MARBLE_LIFT_SNAP_EPS = 0.02
/** Impact speed reported to `events.onImpact` when the marble lands after dropping off a raised edge. */
const DROP_IMPACT_SPEED = 4
/** How far the frame's outer edge sits beyond the grid's edge. Negative: a rim thinner than the border cells. */
const FRAME_EXTEND = -0.4
const FLOOR_DEPTH = 0.18
/** How far the floor slab reaches in under the frame. */
const FLOOR_TUCK = 0.05
const WELL_DEPTH = 0.6
const BASE_MARGIN = 0.05
const BASE_THICKNESS = 0.3
/** How far the plinth sticks out past the box on every side. */
const BASE_LIP = 0.12
const BEVEL_RING_WIDTH = 0.05
/** ExtrudeGeometry UVs are in shape units (one per cell), so this tiles the grain every 6 cells. */
const WOOD_REPEAT = 1 / 6

const SINK_DURATION = 0.45
const RESPAWN_POP_DURATION = 0.25
const DEMO_RESTART_DELAY = 1.2
const GOAL_PARTICLE_COUNT = 60
const GOAL_PARTICLE_LIFE = 1.2
const GOAL_PARTICLE_GRAVITY = 1.8

/** The isometric view: a parallel projection looking along the board's diagonal from above. */
const CAMERA_AZIMUTH_DEG = 45
const CAMERA_ELEVATION_DEG = 45
/** How far out the camera sits. A parallel projection looks the same from any distance; this only has to clear the board. */
const CAMERA_ORBIT_DISTANCE = 80
const CAMERA_FAR = 400
const CAMERA_MARGIN = 0.06
const DEMO_SWAY_DEG = 8
const DEMO_SWAY_PERIOD = 28
/**
 * How the board's drawn tilt follows the simulated one. In play it is immediate and exaggerated so
 * the player can read it. In the demo the autopilot's quick corrections would make the board
 * shudder, so the drawn tilt is unexaggerated and eased slowly.
 */
const DEMO_VISUAL_TILT_GAIN = 0.9
const DEMO_VISUAL_TILT_RATE = 2.5
const AZIMUTH_EASE_RATE = 2
const MAX_FRAME_DT = 0.1
/** The fit never treats less than this fraction of the viewport as free, however large the insets. */
const MIN_FREE_FRACTION = 0.3
const FIT_MIN_HALF_HEIGHT = 0.5
const FIT_MAX_HALF_HEIGHT = 200
const FIT_ITERATIONS = 24

/** Board-local x for a physics point: physics x maps straight across, centred on the grid. */
function boardX(v: Vec2, cols: number): number {
  return v.x - cols / 2
}

/** Board-local z for a physics point: physics +y maps to world +z, centred on the grid. */
function boardZ(v: Vec2, rows: number): number {
  return v.y - rows / 2
}

/**
 * A point for `THREE.Shape`/`THREE.Path`, in the extruded floor's own (pre-rotation) coordinate
 * space. The floor geometry is rotated -90 degrees about X so its top face ends up facing +Y at
 * y=0 (see `buildFloor`); that rotation negates the shape's own "y" axis, so this helper bakes in
 * the counter-negation up front. The result is that a hole punched at `shapePoint(hole, ...)`
 * lines up exactly with `boardX`/`boardZ` of that same point after the geometry is built.
 */
function shapePoint(v: Vec2, cols: number, rows: number): [number, number] {
  return [v.x - cols / 2, rows / 2 - v.y]
}

interface Disposable {
  dispose(): void
}

/** Extruded floor plate: a rectangle covering the grid with a hole punched for every sink. */
function buildFloor(level: Level, texture: THREE.Texture): { mesh: THREE.Mesh } & Disposable {
  const { cols, rows } = level
  const shape = new THREE.Shape()
  // The floor tucks just inside the frame, whose sides run down past it, so the floor's own edge
  // never shows from the low isometric camera.
  const inner = 1 - FLOOR_TUCK
  const [x0, y0] = shapePoint({ x: inner, y: inner }, cols, rows)
  const [x1, y1] = shapePoint({ x: cols - inner, y: rows - inner }, cols, rows)
  shape.moveTo(x0, y0)
  shape.lineTo(x1, y0)
  shape.lineTo(x1, y1)
  shape.lineTo(x0, y1)
  shape.lineTo(x0, y0)

  const sinks: { pos: Vec2; radius: number }[] = [
    ...level.holes.map((pos) => ({ pos, radius: HOLE_RADIUS })),
    { pos: level.goal, radius: GOAL_RADIUS },
  ]
  for (const sink of sinks) {
    const [cx, cy] = shapePoint(sink.pos, cols, rows)
    const hole = new THREE.Path()
    hole.absarc(cx, cy, sink.radius, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: FLOOR_DEPTH, bevelEnabled: false, curveSegments: 32 })
  // Top face (extrude z=depth, normal +Z) rotates to normal +Y; translate so it lands at y=0 and
  // the bottom face (the underside) sits at y=-FLOOR_DEPTH.
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, -FLOOR_DEPTH, 0)

  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65, metalness: 0.05 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true

  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** True when any of (col, row)'s four orthogonal neighbours is a deck, bridge or ramp cell. */
function isAdjacentToRaised(level: Level, col: number, row: number): boolean {
  return [
    [col + 1, row],
    [col - 1, row],
    [col, row + 1],
    [col, row - 1],
  ].some(([c, r]) => {
    const neighbour = cellAt(level, c, r)
    return neighbour === 'deck' || neighbour === 'bridge' || neighbour === 'ramp'
  })
}

/** Interior wall boxes (instanced), the outer framed border, and the base slab beneath it all. */
function buildWalls(level: Level, texture: THREE.Texture): { group: THREE.Group } & Disposable {
  const { cols, rows, cells } = level
  const group = new THREE.Group()

  interface WallCell {
    col: number
    row: number
    height: number
  }
  const interiorCells: WallCell[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (cells[row * cols + col] !== 'wall') continue
      const onBorder = col === 0 || row === 0 || col === cols - 1 || row === rows - 1
      if (onBorder) continue
      const height = isAdjacentToRaised(level, col, row) ? RAISED_WALL_HEIGHT : WALL_HEIGHT
      interiorCells.push({ col, row, height })
    }
  }

  // Unit-height geometry, scaled per instance so a wall beside a deck/bridge/ramp can stand taller.
  const wallGeometry = new THREE.BoxGeometry(WALL_INSET, 1, WALL_INSET)
  const wallMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75, metalness: 0.05 })
  if (interiorCells.length > 0) {
    const wallsMesh = new THREE.InstancedMesh(wallGeometry, wallMaterial, interiorCells.length)
    wallsMesh.castShadow = true
    wallsMesh.receiveShadow = true
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    interiorCells.forEach((cell, i) => {
      const centre = { x: cell.col + 0.5, y: cell.row + 0.5 }
      position.set(boardX(centre, cols), cell.height / 2, boardZ(centre, rows))
      scale.set(1, cell.height, 1)
      matrix.compose(position, quaternion, scale)
      wallsMesh.setMatrixAt(i, matrix)
    })
    wallsMesh.instanceMatrix.needsUpdate = true
    group.add(wallsMesh)
  }

  // Outer frame: a taller rim whose inner face is the border cells' inner edge (where the marble
  // actually bounces), built from four boxes sharing one unit geometry (scaled per side). Its sides
  // run down to the plinth, so from the isometric camera the board reads as one solid wooden box.
  const frameGeometry = new THREE.BoxGeometry(1, 1, 1)
  const frameMaterial = new THREE.MeshStandardMaterial({ map: texture, color: FRAME_TINT, roughness: 0.7, metalness: 0.05 })
  const outerW = cols / 2 + FRAME_EXTEND
  const outerH = rows / 2 + FRAME_EXTEND
  const innerW = cols / 2 - 1
  const innerH = rows / 2 - 1
  const bars = [
    { x: 0, z: -(outerH + innerH) / 2, w: 2 * outerW, d: outerH - innerH },
    { x: 0, z: (outerH + innerH) / 2, w: 2 * outerW, d: outerH - innerH },
    { x: -(outerW + innerW) / 2, z: 0, w: outerW - innerW, d: 2 * innerH },
    { x: (outerW + innerW) / 2, z: 0, w: outerW - innerW, d: 2 * innerH },
  ]
  const boxDepth = WELL_DEPTH + BASE_MARGIN
  for (const bar of bars) {
    const mesh = new THREE.Mesh(frameGeometry, frameMaterial)
    mesh.scale.set(bar.w, FRAME_HEIGHT + boxDepth, bar.d)
    mesh.position.set(bar.x, (FRAME_HEIGHT - boxDepth) / 2, bar.z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // A plinth beneath the whole board. It sits below the deepest well so it never blocks the
  // view down into a hole (the well's own bottom disc is what the player actually sees).
  const baseGeometry = new THREE.BoxGeometry(2 * (outerW + BASE_LIP), BASE_THICKNESS, 2 * (outerH + BASE_LIP))
  const baseMaterial = new THREE.MeshStandardMaterial({ color: BASE_COLOR, roughness: 0.9 })
  const base = new THREE.Mesh(baseGeometry, baseMaterial)
  const baseTopY = -boxDepth
  base.position.set(0, baseTopY - BASE_THICKNESS / 2, 0)
  base.receiveShadow = true
  group.add(base)

  return {
    group,
    dispose() {
      wallGeometry.dispose()
      wallMaterial.dispose()
      frameGeometry.dispose()
      frameMaterial.dispose()
      baseGeometry.dispose()
      baseMaterial.dispose()
    },
  }
}

/**
 * A wedge prism for one ramp cell, in local unit-cell space, climbing along local +X: the top
 * surface runs from y = low * DECK_HEIGHT at x = -0.5 to y = high * DECK_HEIGHT at x = 0.5, solid
 * down to y = 0 on every side. Built from non-indexed triangles (no shared vertices) so
 * `computeVertexNormals` yields flat per-face shading, with simple top-down planar UVs.
 */
function buildRampWedgeGeometry(low: number, high: number): THREE.BufferGeometry {
  const lowY = low * DECK_HEIGHT
  const highY = high * DECK_HEIGHT
  const a0: [number, number, number] = [-0.5, 0, -0.5]
  const a1: [number, number, number] = [-0.5, 0, 0.5]
  const b0: [number, number, number] = [0.5, 0, -0.5]
  const b1: [number, number, number] = [0.5, 0, 0.5]
  const c0: [number, number, number] = [-0.5, lowY, -0.5]
  const c1: [number, number, number] = [-0.5, lowY, 0.5]
  const d0: [number, number, number] = [0.5, highY, -0.5]
  const d1: [number, number, number] = [0.5, highY, 0.5]

  const triangles: [number, number, number][][] = [
    [a0, b0, b1], [a0, b1, a1], // bottom
    [c0, d1, d0], [c0, c1, d1], // sloped top
    [a0, a1, c1], [a0, c1, c0], // low end (x = -0.5)
    [b0, d0, d1], [b0, d1, b1], // high end (x = 0.5)
    [a0, d0, b0], [a0, c0, d0], // back side (z = -0.5)
    [a1, b1, d1], [a1, d1, c1], // front side (z = 0.5)
  ]

  const positions: number[] = []
  const uvs: number[] = []
  for (const triangle of triangles) {
    for (const [x, y, z] of triangle) {
      positions.push(x, y, z)
      uvs.push(x + 0.5, z + 0.5)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

/** World-Y rotation that turns a wedge built for local +X into one climbing toward `dir` (physics +y is world +z). */
function rampYaw(dir: Vec2): number {
  return Math.atan2(-dir.y, dir.x)
}

/** Adds a ramp cell's two guard rails (local, unrotated) to `group`, following its slope. */
function addRampRails(group: THREE.Group, low: number, high: number, geometry: THREE.BoxGeometry, material: THREE.Material): void {
  const lowY = low * DECK_HEIGHT
  const highY = high * DECK_HEIGHT
  const tilt = Math.atan2(highY - lowY, 1)
  const midY = (lowY + highY) / 2 + RAIL_RISE
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(geometry, material)
    rail.rotation.z = tilt
    rail.position.set(0, midY, side * (0.5 - RAIL_SIZE / 2))
    rail.castShadow = true
    rail.receiveShadow = true
    group.add(rail)
  }
}

/**
 * The raised level: solid deck platforms, open bridge planks, and the ramp wedges (with guard
 * rails) that climb between the ground and the raised level.
 */
function buildRaised(level: Level, deckTexture: THREE.Texture, wallTexture: THREE.Texture): { group: THREE.Group } & Disposable {
  const { cols, rows } = level
  const group = new THREE.Group()

  const deckCells: Vec2[] = []
  const bridgeCells: Vec2[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = cellAt(level, col, row)
      if (cell === 'deck') deckCells.push({ x: col + 0.5, y: row + 0.5 })
      else if (cell === 'bridge') bridgeCells.push({ x: col + 0.5, y: row + 0.5 })
    }
  }

  const raisedMaterial = new THREE.MeshStandardMaterial({ map: deckTexture, roughness: 0.7, metalness: 0.05 })

  const deckGeometry = new THREE.BoxGeometry(1, DECK_HEIGHT, 1)
  if (deckCells.length > 0) {
    const deckMesh = new THREE.InstancedMesh(deckGeometry, raisedMaterial, deckCells.length)
    deckMesh.castShadow = true
    deckMesh.receiveShadow = true
    const matrix = new THREE.Matrix4()
    deckCells.forEach((cell, i) => {
      matrix.makeTranslation(boardX(cell, cols), DECK_HEIGHT / 2, boardZ(cell, rows))
      deckMesh.setMatrixAt(i, matrix)
    })
    deckMesh.instanceMatrix.needsUpdate = true
    group.add(deckMesh)
  }

  const bridgeGeometry = new THREE.BoxGeometry(1, BRIDGE_THICKNESS, 1)
  if (bridgeCells.length > 0) {
    const bridgeMesh = new THREE.InstancedMesh(bridgeGeometry, raisedMaterial, bridgeCells.length)
    bridgeMesh.castShadow = true
    bridgeMesh.receiveShadow = true
    const matrix = new THREE.Matrix4()
    bridgeCells.forEach((cell, i) => {
      matrix.makeTranslation(boardX(cell, cols), DECK_HEIGHT - BRIDGE_THICKNESS / 2, boardZ(cell, rows))
      bridgeMesh.setMatrixAt(i, matrix)
    })
    bridgeMesh.instanceMatrix.needsUpdate = true
    group.add(bridgeMesh)
  }

  const railGeometry = new THREE.BoxGeometry(1, RAIL_SIZE, RAIL_SIZE)
  const railMaterial = new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.75, metalness: 0.05 })
  const rampGeometries: THREE.BufferGeometry[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (cellAt(level, col, row) !== 'ramp') continue
      const ramp = rampAt(level, col, row)
      if (!ramp) continue

      const wedgeGeometry = buildRampWedgeGeometry(ramp.low, ramp.high)
      rampGeometries.push(wedgeGeometry)
      const wedgeMesh = new THREE.Mesh(wedgeGeometry, raisedMaterial)
      wedgeMesh.castShadow = true
      wedgeMesh.receiveShadow = true

      const cellGroup = new THREE.Group()
      cellGroup.add(wedgeMesh)
      addRampRails(cellGroup, ramp.low, ramp.high, railGeometry, railMaterial)
      cellGroup.rotation.y = rampYaw(ramp.dir)
      const centre = { x: col + 0.5, y: row + 0.5 }
      cellGroup.position.set(boardX(centre, cols), 0, boardZ(centre, rows))
      group.add(cellGroup)
    }
  }

  return {
    group,
    dispose() {
      deckGeometry.dispose()
      bridgeGeometry.dispose()
      raisedMaterial.dispose()
      railGeometry.dispose()
      railMaterial.dispose()
      for (const geometry of rampGeometries) geometry.dispose()
    },
  }
}

/** The open pit under every hole and the cup, plus the cup's glow and every rim's bevel ring. */
function buildHoleDecor(level: Level): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const holeWellGeometry = new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, WELL_DEPTH, 28, 1, true)
  const holeWellMaterial = new THREE.MeshStandardMaterial({ color: WELL_COLOR, side: THREE.BackSide, roughness: 1 })
  const holeBottomGeometry = new THREE.CircleGeometry(HOLE_RADIUS, 28)
  holeBottomGeometry.rotateX(-Math.PI / 2)
  const holeBottomMaterial = new THREE.MeshStandardMaterial({ color: WELL_COLOR, roughness: 1 })
  const bevelGeometry = new THREE.RingGeometry(HOLE_RADIUS, HOLE_RADIUS + BEVEL_RING_WIDTH, 28)
  bevelGeometry.rotateX(-Math.PI / 2)
  const bevelMaterial = new THREE.MeshStandardMaterial({ color: BEVEL_COLOR, roughness: 0.6 })
  disposables.push(
    holeWellGeometry,
    holeWellMaterial,
    holeBottomGeometry,
    holeBottomMaterial,
    bevelGeometry,
    bevelMaterial,
  )

  for (const hole of level.holes) {
    const x = boardX(hole, level.cols)
    const z = boardZ(hole, level.rows)
    const well = new THREE.Mesh(holeWellGeometry, holeWellMaterial)
    well.position.set(x, -WELL_DEPTH / 2, z)
    const bottom = new THREE.Mesh(holeBottomGeometry, holeBottomMaterial)
    bottom.position.set(x, -WELL_DEPTH, z)
    const bevel = new THREE.Mesh(bevelGeometry, bevelMaterial)
    bevel.position.set(x, 0.002, z)
    group.add(well, bottom, bevel)
  }

  // The cup: a bigger well with an emissive green inside and a soft glowing rim ring.
  const goalX = boardX(level.goal, level.cols)
  const goalZ = boardZ(level.goal, level.rows)

  const goalWellGeometry = new THREE.CylinderGeometry(GOAL_RADIUS, GOAL_RADIUS, WELL_DEPTH, 32, 1, true)
  const goalWellMaterial = new THREE.MeshStandardMaterial({
    color: WELL_COLOR,
    emissive: GOAL_WELL_EMISSIVE,
    emissiveIntensity: 0.8,
    side: THREE.BackSide,
    roughness: 1,
  })
  const goalWell = new THREE.Mesh(goalWellGeometry, goalWellMaterial)
  goalWell.position.set(goalX, -WELL_DEPTH / 2, goalZ)

  const goalBottomGeometry = new THREE.CircleGeometry(GOAL_RADIUS, 32)
  goalBottomGeometry.rotateX(-Math.PI / 2)
  const goalBottomMaterial = new THREE.MeshStandardMaterial({
    color: WELL_COLOR,
    emissive: GOAL_WELL_EMISSIVE,
    emissiveIntensity: 0.5,
    roughness: 1,
  })
  const goalBottom = new THREE.Mesh(goalBottomGeometry, goalBottomMaterial)
  goalBottom.position.set(goalX, -WELL_DEPTH, goalZ)

  const glowRingGeometry = new THREE.RingGeometry(GOAL_RADIUS, GOAL_RADIUS + BEVEL_RING_WIDTH * 2, 32)
  glowRingGeometry.rotateX(-Math.PI / 2)
  const glowRingMaterial = new THREE.MeshBasicMaterial({
    color: GOAL_GLOW_COLOR,
    toneMapped: false,
  })
  const glowRing = new THREE.Mesh(glowRingGeometry, glowRingMaterial)
  glowRing.position.set(goalX, 0.004, goalZ)

  group.add(goalWell, goalBottom, glowRing)
  disposables.push(
    goalWellGeometry,
    goalWellMaterial,
    goalBottomGeometry,
    goalBottomMaterial,
    glowRingGeometry,
    glowRingMaterial,
  )

  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

/** A subtle inlaid ring decal marking the start cell. */
function buildStartRing(level: Level): { mesh: THREE.Mesh } & Disposable {
  const geometry = new THREE.RingGeometry(BALL_RADIUS * 0.9, BALL_RADIUS * 1.25, 28)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshStandardMaterial({
    color: START_RING_COLOR,
    emissive: START_RING_COLOR,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.5,
    roughness: 0.5,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(boardX(level.start, level.cols), 0.003, boardZ(level.start, level.rows))
  return { mesh, dispose() { geometry.dispose(); material.dispose() } }
}

/** The steel marble. */
function buildMarble(): { mesh: THREE.Mesh } & Disposable {
  const geometry = new THREE.SphereGeometry(BALL_RADIUS, 48, 32)
  const material = new THREE.MeshStandardMaterial({ color: MARBLE_COLOR, metalness: 1, roughness: 0.12 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  return { mesh, dispose() { geometry.dispose(); material.dispose() } }
}

/** A cheap burst of additive points used as the goal flourish. */
interface ParticleBurst extends Disposable {
  points: THREE.Points
  velocities: Float32Array
  active: boolean
  elapsed: number
}

function buildParticleBurst(): ParticleBurst {
  const positions = new Float32Array(GOAL_PARTICLE_COUNT * 3)
  const velocities = new Float32Array(GOAL_PARTICLE_COUNT * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: GOAL_GLOW_COLOR,
    size: 0.06,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.visible = false
  points.frustumCulled = false
  return {
    points,
    velocities,
    active: false,
    elapsed: 0,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** (Re)starts the burst at `origin`, giving every particle a fresh random upward velocity. */
function startParticleBurst(burst: ParticleBurst, origin: THREE.Vector3): void {
  const positions = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < GOAL_PARTICLE_COUNT; i++) {
    positions.setXYZ(i, origin.x, origin.y, origin.z)
    const angle = Math.random() * Math.PI * 2
    const spread = 0.4 + Math.random() * 1.1
    burst.velocities[i * 3] = Math.cos(angle) * spread
    burst.velocities[i * 3 + 1] = 1.2 + Math.random() * 1.4
    burst.velocities[i * 3 + 2] = Math.sin(angle) * spread
  }
  positions.needsUpdate = true
  burst.active = true
  burst.elapsed = 0
  burst.points.visible = true
  ;(burst.points.material as THREE.PointsMaterial).opacity = 1
}

/** Advances every live particle and fades the whole burst out over its lifetime. */
function updateParticleBurst(burst: ParticleBurst, dt: number): void {
  if (!burst.active) return
  burst.elapsed += dt
  const positions = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < GOAL_PARTICLE_COUNT; i++) {
    burst.velocities[i * 3 + 1] -= GOAL_PARTICLE_GRAVITY * dt
    positions.setX(i, positions.getX(i) + burst.velocities[i * 3] * dt)
    positions.setY(i, positions.getY(i) + burst.velocities[i * 3 + 1] * dt)
    positions.setZ(i, positions.getZ(i) + burst.velocities[i * 3 + 2] * dt)
  }
  positions.needsUpdate = true
  const material = burst.points.material as THREE.PointsMaterial
  material.opacity = Math.max(0, 1 - burst.elapsed / GOAL_PARTICLE_LIFE)
  if (burst.elapsed >= GOAL_PARTICLE_LIFE) {
    burst.active = false
    burst.points.visible = false
  }
}

/** Smoothstep easing for the sink/pop animations. */
/** Puts a camera on the orbit around the board centre, looking at it. */
function placeCamera(target: THREE.Camera, azimuth: number): void {
  const elevation = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG)
  const horizontal = CAMERA_ORBIT_DISTANCE * Math.cos(elevation)
  const height = CAMERA_ORBIT_DISTANCE * Math.sin(elevation)
  target.position.set(horizontal * Math.sin(azimuth), height, horizontal * Math.cos(azimuth))
  target.lookAt(0, 0, 0)
}

/** Sizes a parallel-projection frustum: `halfHeight` world units from the centre to the top edge. */
function setFrustum(target: THREE.OrthographicCamera, halfHeight: number, aspect: number): void {
  target.left = -halfHeight * aspect
  target.right = halfHeight * aspect
  target.top = halfHeight
  target.bottom = -halfHeight
  target.updateProjectionMatrix()
}

function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/**
 * Builds the three.js scene, camera, renderer and simulation loop for one canvas. Everything the
 * engine creates (geometries, materials, textures, render targets, the renderer, the tilt input)
 * is disposed by `dispose()`, and nothing is created outside this function, so the returned
 * `EngineApi` is safe to construct and tear down repeatedly (React StrictMode double-invokes it).
 */
export function createEngine(canvas: HTMLCanvasElement, events: EngineEvents): EngineApi {
  // --- Renderer / scene / environment ----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND_COLOR)

  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const roomEnvironment = new RoomEnvironment()
  const environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.04)
  scene.environment = environmentTarget.texture
  scene.environmentIntensity = 0.6
  roomEnvironment.dispose()
  pmremGenerator.dispose()

  // --- Lights ------------------------------------------------------------------------------------
  const keyLight = new THREE.DirectionalLight(0xffdfb0, 2.4)
  keyLight.position.set(-7, 10, 6)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.bias = -0.0008
  keyLight.shadow.normalBias = 0.02
  scene.add(keyLight, keyLight.target)

  const fillLight = new THREE.DirectionalLight(0x9fc2ff, 0.4)
  fillLight.position.set(6, 3, -5)
  scene.add(fillLight)

  const hemiLight = new THREE.HemisphereLight(0x8a97ad, 0x191209, 0.5)
  scene.add(hemiLight)

  // --- Backdrop glow -------------------------------------------------------------------------------
  const glowTexture = makeRadialShadowTexture()
  const glowGeometry = new THREE.PlaneGeometry(60, 60)
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: GLOW_PLANE_COLOR,
    alphaMap: glowTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const glowPlane = new THREE.Mesh(glowGeometry, glowMaterial)
  glowPlane.rotation.x = -Math.PI / 2
  glowPlane.position.y = -8
  scene.add(glowPlane)

  // --- Shared wood textures (reused across levels; disposed once, in dispose()) --------------------
  const floorTexture = makeWoodTexture({ base: FLOOR_BASE_COLOR, grain: FLOOR_GRAIN_COLOR, seed: 1 })
  floorTexture.repeat.set(WOOD_REPEAT, WOOD_REPEAT)
  floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const wallTexture = makeWoodTexture({ base: WALL_BASE_COLOR, grain: WALL_GRAIN_COLOR, seed: 2 })
  wallTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const deckTexture = makeWoodTexture({ base: RAISED_BASE_COLOR, grain: RAISED_GRAIN_COLOR, seed: RAISED_WOOD_SEED })
  deckTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()

  // --- Camera --------------------------------------------------------------------------------------
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_FAR)
  let aspect = 1
  const baseAzimuth = THREE.MathUtils.degToRad(CAMERA_AZIMUTH_DEG)
  let azimuth = baseAzimuth
  const visualTilt = { x: 0, y: 0 }
  let insets: ViewInsets = { left: 0, top: 0, right: 0, bottom: 0 }
  let demoSwayT = 0

  // --- Board group: everything that tilts with the marble lives here, centred on its own origin ---
  const boardGroup = new THREE.Group()
  boardGroup.rotation.order = 'XYZ'
  scene.add(boardGroup)

  const marbleBuild = buildMarble()
  marbleBuild.mesh.visible = false
  boardGroup.add(marbleBuild.mesh)
  const lastMarbleWorld = new THREE.Vector3()

  const particleBurst = buildParticleBurst()
  boardGroup.add(particleBurst.points)

  // --- Input / autopilot -----------------------------------------------------------------------------
  const input = createTiltInput(canvas, { viewAzimuth: baseAzimuth })

  // --- Mutable per-run state -------------------------------------------------------------------------
  interface BoardParts extends Disposable {
    floorMesh: THREE.Mesh
    wallsGroup: THREE.Group
    holesGroup: THREE.Group
    startRingMesh: THREE.Mesh
    raisedGroup: THREE.Group
  }
  let boardParts: BoardParts | null = null
  let currentLevel: Level | null = null
  let autopilot: ((state: BallState) => Tilt) | null = null

  let state: BallState = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, layer: 0 }
  let tilt: Tilt = { x: 0, y: 0 }
  let mode: EngineMode = 'play'
  let paused = false

  // How high the marble mesh currently floats above the floor (world units), and its fall speed
  // while it is above its resting height and dropping toward it. See `updateMarbleLift`.
  let marbleLift = 0
  let marbleLiftVel = 0

  let clockRunning = false
  let time = 0
  let lastReportedTenth = -1
  let falls = 0

  type SinkPhase = 'none' | 'sinking' | 'popping'
  let sinkPhase: SinkPhase = 'none'
  let sinkT = 0
  let sinkFrom: Vec2 = { x: 0, y: 0 }
  let sinkTo: Vec2 = { x: 0, y: 0 }
  let sinkIsGoal = false
  let goalSunk = false
  let demoRestartTimer = 0

  /** Builds the meshes for one level and swaps them into `boardGroup`, disposing the old ones. */
  function buildBoardParts(level: Level): BoardParts {
    const floor = buildFloor(level, floorTexture)
    const walls = buildWalls(level, wallTexture)
    const holes = buildHoleDecor(level)
    const startRing = buildStartRing(level)
    const raised = buildRaised(level, deckTexture, wallTexture)
    return {
      floorMesh: floor.mesh,
      wallsGroup: walls.group,
      holesGroup: holes.group,
      startRingMesh: startRing.mesh,
      raisedGroup: raised.group,
      dispose() {
        floor.dispose()
        walls.dispose()
        holes.dispose()
        startRing.dispose()
        raised.dispose()
      },
    }
  }

  /** Positions the marble mesh immediately from `state`, without waiting for the next frame. */
  function snapMarbleToState(level: Level): void {
    const x = boardX(state.pos, level.cols)
    const z = boardZ(state.pos, level.rows)
    const y = BALL_RADIUS + marbleLift
    marbleBuild.mesh.position.set(x, y, z)
    marbleBuild.mesh.scale.setScalar(1)
    marbleBuild.mesh.quaternion.set(0, 0, 0, 1)
    marbleBuild.mesh.visible = true
    lastMarbleWorld.set(x, y, z)
  }

  /** Resets the marble, clock, falls and sink animation for `level`, keeping its meshes as-is. */
  function resetRunState(level: Level): void {
    state = startState(level)
    tilt = { x: 0, y: 0 }
    clockRunning = false
    time = 0
    lastReportedTenth = -1
    falls = 0
    sinkPhase = 'none'
    sinkT = 0
    goalSunk = false
    demoRestartTimer = 0
    marbleLift = 0
    marbleLiftVel = 0
    snapMarbleToState(level)
  }

  function loadLevel(level: Level): void {
    if (boardParts) {
      boardGroup.remove(
        boardParts.floorMesh,
        boardParts.wallsGroup,
        boardParts.holesGroup,
        boardParts.startRingMesh,
        boardParts.raisedGroup,
      )
      boardParts.dispose()
    }
    boardParts = buildBoardParts(level)
    boardGroup.add(
      boardParts.floorMesh,
      boardParts.wallsGroup,
      boardParts.holesGroup,
      boardParts.startRingMesh,
      boardParts.raisedGroup,
    )

    currentLevel = level
    autopilot = createAutopilot(level, DEMO_PACE)
    resetRunState(level)
    input.reset()
    fitShadowCamera(level)
    fitCamera(level)
  }

  function restart(): void {
    if (!currentLevel) return
    resetRunState(currentLevel)
    input.reset()
  }

  function setMode(next: EngineMode): void {
    mode = next
    if (currentLevel) {
      restart()
      fitCamera(currentLevel)
    }
  }

  function setViewInsets(next: ViewInsets): void {
    const clean = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)
    insets = { left: clean(next.left), top: clean(next.top), right: clean(next.right), bottom: clean(next.bottom) }
    if (currentLevel) fitCamera(currentLevel)
  }

  /** Starts the sink-and-drop animation; physics is frozen until it (and any respawn pop) ends. */
  function beginSink(sink: Vec2, isGoal: boolean): void {
    sinkPhase = 'sinking'
    sinkT = 0
    sinkFrom = { x: state.pos.x, y: state.pos.y }
    sinkTo = sink
    sinkIsGoal = isGoal
    if (isGoal && currentLevel) {
      const origin = new THREE.Vector3(boardX(sink, currentLevel.cols), 0.05, boardZ(sink, currentLevel.rows))
      startParticleBurst(particleBurst, origin)
    } else {
      falls += 1
    }
  }

  /** One fixed physics tick: advances tilt/physics, or the sink/pop animation, and the clock. */
  function fixedTick(): void {
    if (!currentLevel || paused || goalSunk) return

    if (sinkPhase !== 'none') {
      sinkT += FIXED_DT
      if (clockRunning) time += FIXED_DT
      const duration = sinkPhase === 'sinking' ? SINK_DURATION : RESPAWN_POP_DURATION
      if (sinkT < duration) return
      if (sinkPhase === 'sinking') {
        if (sinkIsGoal) {
          goalSunk = true
          sinkPhase = 'none'
        } else {
          state = startState(currentLevel)
          marbleLift = 0
          marbleLiftVel = 0
          sinkPhase = 'popping'
          sinkT = 0
        }
      } else {
        sinkPhase = 'none'
      }
      return
    }

    const target = mode === 'play' ? input.getTarget() : autopilot ? autopilot(state) : { x: 0, y: 0 }
    tilt = approachTilt(tilt, target, FIXED_DT)

    if (mode === 'play' && !clockRunning && input.hasMoved()) clockRunning = true

    const result = step(currentLevel, state, tilt, FIXED_DT)
    state = result.state
    if (clockRunning) time += FIXED_DT

    if (mode === 'play' && result.impact > 0) events.onImpact(result.impact)
    if (mode === 'play' && result.dropped) events.onImpact(DROP_IMPACT_SPEED)

    if (result.event === 'fell' && result.sink) {
      beginSink(result.sink, false)
      if (mode === 'play') events.onFall(falls)
    } else if (result.event === 'goal' && result.sink) {
      beginSink(result.sink, true)
      clockRunning = false
      if (mode === 'play') events.onGoal(time, falls)
    }
  }

  /** Rolls the marble's quaternion by the horizontal distance it moved since the last frame. */
  function rollMarble(x: number, z: number): void {
    const dx = x - lastMarbleWorld.x
    const dz = z - lastMarbleWorld.z
    const dist = Math.hypot(dx, dz)
    if (dist > 1e-6) {
      const axis = new THREE.Vector3(dz, 0, -dx).normalize()
      marbleBuild.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / BALL_RADIUS))
    }
    const y = BALL_RADIUS + marbleLift
    marbleBuild.mesh.position.set(x, y, z)
    lastMarbleWorld.set(x, y, z)
  }

  /**
   * Advances `marbleLift` toward `heightAt(level, state) * DECK_HEIGHT`: climbing a ramp or
   * stepping onto a deck/bridge is continuous, so it snaps straight there, but dropping off a
   * raised edge falls under `DROP_GRAVITY` until it reaches the (lower) target.
   */
  function updateMarbleLift(level: Level, dt: number): void {
    const target = heightAt(level, state) * DECK_HEIGHT
    if (target >= marbleLift - MARBLE_LIFT_SNAP_EPS) {
      marbleLift = target
      marbleLiftVel = 0
      return
    }
    marbleLiftVel += DROP_GRAVITY * dt
    marbleLift -= marbleLiftVel * dt
    if (marbleLift <= target) {
      marbleLift = target
      marbleLiftVel = 0
    }
  }

  /** Per-render-frame visuals: marble transform/animation, board tilt, camera, particles. */
  function updateVisuals(level: Level, dt: number): void {
    if (goalSunk) {
      marbleBuild.mesh.visible = false
    } else if (sinkPhase === 'sinking') {
      const eased = easeInOut(sinkT / SINK_DURATION)
      const fromX = boardX(sinkFrom, level.cols)
      const fromZ = boardZ(sinkFrom, level.rows)
      const toX = boardX(sinkTo, level.cols)
      const toZ = boardZ(sinkTo, level.rows)
      marbleBuild.mesh.visible = true
      marbleBuild.mesh.position.set(
        fromX + (toX - fromX) * eased,
        BALL_RADIUS - (BALL_RADIUS + WELL_DEPTH) * eased,
        fromZ + (toZ - fromZ) * eased,
      )
      marbleBuild.mesh.scale.setScalar(1 - 0.4 * eased)
    } else if (sinkPhase === 'popping') {
      const eased = easeInOut(sinkT / RESPAWN_POP_DURATION)
      marbleBuild.mesh.visible = true
      marbleBuild.mesh.position.set(boardX(state.pos, level.cols), BALL_RADIUS, boardZ(state.pos, level.rows))
      marbleBuild.mesh.scale.setScalar(eased)
    } else {
      marbleBuild.mesh.visible = true
      marbleBuild.mesh.scale.setScalar(1)
      updateMarbleLift(level, dt)
      rollMarble(boardX(state.pos, level.cols), boardZ(state.pos, level.rows))
    }

    updateParticleBurst(particleBurst, dt)

    if (mode === 'demo') {
      const ease = 1 - Math.exp(-DEMO_VISUAL_TILT_RATE * dt)
      visualTilt.x += (tilt.x * DEMO_VISUAL_TILT_GAIN - visualTilt.x) * ease
      visualTilt.y += (tilt.y * DEMO_VISUAL_TILT_GAIN - visualTilt.y) * ease
    } else {
      visualTilt.x = tilt.x * VISUAL_TILT_GAIN
      visualTilt.y = tilt.y * VISUAL_TILT_GAIN
    }
    boardGroup.rotation.x = visualTilt.y
    boardGroup.rotation.z = -visualTilt.x

    const sway =
      mode === 'demo'
        ? THREE.MathUtils.degToRad(DEMO_SWAY_DEG) * Math.sin((demoSwayT / DEMO_SWAY_PERIOD) * Math.PI * 2)
        : 0
    const targetAzimuth = baseAzimuth + sway
    if (mode === 'demo') demoSwayT += dt
    azimuth += (targetAzimuth - azimuth) * (1 - Math.exp(-AZIMUTH_EASE_RATE * dt))
    positionCamera()

    if (mode === 'demo' && goalSunk) {
      demoRestartTimer += dt
      if (demoRestartTimer >= DEMO_RESTART_DELAY) restart()
    }

    if (mode === 'play') {
      const speed = paused || sinkPhase !== 'none' || goalSunk ? 0 : Math.hypot(state.vel.x, state.vel.y)
      events.onRoll(speed)
    }
  }

  /** Places the camera on its (eased) azimuth. */
  function positionCamera(): void {
    placeCamera(camera, azimuth)
  }

  /**
   * Recomputes the size of the view so the framed board fits the part of the viewport the UI leaves
   * free, and shifts the view so the board is centred in that part. The fit projects the frame's
   * corners through a probe camera at every azimuth the camera can reach.
   */
  function fitCamera(level: Level): void {
    const viewWidth = canvas.clientWidth
    const viewHeight = canvas.clientHeight
    if (viewWidth === 0 || viewHeight === 0) return

    const freeX = Math.max(MIN_FREE_FRACTION, (viewWidth - insets.left - insets.right) / viewWidth)
    const freeY = Math.max(MIN_FREE_FRACTION, (viewHeight - insets.top - insets.bottom) / viewHeight)
    const limitX = freeX * (1 - CAMERA_MARGIN)
    const limitY = freeY * (1 - CAMERA_MARGIN)

    const halfWidth = level.cols / 2 + FRAME_EXTEND
    const halfDepth = level.rows / 2 + FRAME_EXTEND
    const hasRaised = level.cells.some((cell) => cell === 'deck' || cell === 'bridge' || cell === 'ramp')
    const cornerHeight = hasRaised ? Math.max(FRAME_HEIGHT, RAISED_WALL_HEIGHT) : FRAME_HEIGHT
    const corners: THREE.Vector3[] = []
    for (const x of [-halfWidth, halfWidth]) {
      for (const z of [-halfDepth, halfDepth]) {
        corners.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, cornerHeight, z))
      }
    }

    const sway = THREE.MathUtils.degToRad(DEMO_SWAY_DEG)
    const azimuths = mode === 'demo' ? [baseAzimuth - sway, baseAzimuth, baseAzimuth + sway] : [baseAzimuth]
    const probe = new THREE.OrthographicCamera(-1, 1, 1, -1, camera.near, camera.far)
    const projected = new THREE.Vector3()
    const fits = (halfHeight: number): boolean =>
      azimuths.every((probeAzimuth) => {
        setFrustum(probe, halfHeight, aspect)
        placeCamera(probe, probeAzimuth)
        probe.updateMatrixWorld()
        return corners.every((corner) => {
          projected.copy(corner).project(probe)
          return Math.abs(projected.x) <= limitX && Math.abs(projected.y) <= limitY
        })
      })

    let tooSmall = FIT_MIN_HALF_HEIGHT
    let bigEnough = FIT_MAX_HALF_HEIGHT
    for (let i = 0; i < FIT_ITERATIONS; i++) {
      const middle = (tooSmall + bigEnough) / 2
      if (fits(middle)) bigEnough = middle
      else tooSmall = middle
    }
    setFrustum(camera, bigEnough, aspect)

    camera.setViewOffset(
      viewWidth,
      viewHeight,
      -(insets.left - insets.right) / 2,
      -(insets.top - insets.bottom) / 2,
      viewWidth,
      viewHeight,
    )
    positionCamera()
  }

  /** Fits the key light's shadow frustum to the current board so shadows stay crisp. */
  function fitShadowCamera(level: Level): void {
    const half = Math.max(level.cols, level.rows) / 2 + 1
    const shadowCamera = keyLight.shadow.camera
    shadowCamera.left = -half
    shadowCamera.right = half
    shadowCamera.top = half
    shadowCamera.bottom = -half
    shadowCamera.near = 0.1
    shadowCamera.far = 30
    shadowCamera.updateProjectionMatrix()
  }

  // --- Resize --------------------------------------------------------------------------------------
  function handleResize(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    aspect = width / height
    if (currentLevel) fitCamera(currentLevel)
  }

  const resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(canvas)
  handleResize()

  // --- Main loop -------------------------------------------------------------------------------------
  let rafId = 0
  let lastFrameTime = 0
  let hasLastFrameTime = false
  let accumulator = 0

  function animate(now: number): void {
    rafId = requestAnimationFrame(animate)
    if (!hasLastFrameTime) {
      hasLastFrameTime = true
      lastFrameTime = now
      return
    }
    const dt = Math.min(MAX_FRAME_DT, (now - lastFrameTime) / 1000)
    lastFrameTime = now

    if (!paused) {
      accumulator += dt
      while (accumulator >= FIXED_DT) {
        fixedTick()
        accumulator -= FIXED_DT
      }
    }

    if (currentLevel) updateVisuals(currentLevel, dt)

    if (mode === 'play') {
      const tenth = Math.floor(time * 10)
      if (tenth !== lastReportedTenth) {
        lastReportedTenth = tenth
        events.onTime(time)
      }
    }

    renderer.render(scene, camera)
  }
  rafId = requestAnimationFrame(animate)

  return {
    loadLevel,
    restart,
    setMode,
    setViewInsets,
    setPaused(next: boolean) {
      paused = next
    },
    enableMotion: () => input.enableMotion(),
    disableMotion: () => input.disableMotion(),
    recenterMotion: () => input.recenterMotion(),
    resize: handleResize,
    dispose() {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      input.dispose()
      if (boardParts) {
        boardGroup.remove(
          boardParts.floorMesh,
          boardParts.wallsGroup,
          boardParts.holesGroup,
          boardParts.startRingMesh,
          boardParts.raisedGroup,
        )
        boardParts.dispose()
      }
      marbleBuild.dispose()
      particleBurst.dispose()
      floorTexture.dispose()
      wallTexture.dispose()
      deckTexture.dispose()
      glowGeometry.dispose()
      glowMaterial.dispose()
      glowTexture.dispose()
      environmentTarget.dispose()
      renderer.dispose()
    },
  }
}
