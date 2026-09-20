import type { Tilt } from '../game/types.ts'
import type { Pose } from '../game/tilt.ts'
import { keysToTilt, nudgeTilt, orientationToTilt, pointerToTilt, rotateTilt } from '../game/tilt.ts'
import type { MotionStatus } from './engineApi.ts'

/** Degrees of device-orientation drift from neutral below which motion input is ignored. */
const MOTION_DEADBAND_DEG = 1.5

/** Share of the full tilt that one tap of a steering key adds. Four taps reach the maximum. */
const KEY_TAP_FRACTION = 0.25

/** Seconds a steering key must be held before it starts tilting continuously. */
const KEY_HOLD_DELAY = 0.2

/** Share of the full tilt a held steering key adds per second once it is tilting continuously. */
const KEY_HOLD_RATE = 2.5

/** The longest gap between two reads that still counts as holding, so a paused tab does not lurch. */
const KEY_HOLD_MAX_DT = 0.1

/** Pixels of drag from the spot where the pointer was pressed that produce MAX_TILT. */
const DRAG_REACH_PX = 90

/** Milliseconds to wait for a first `deviceorientation` reading before giving up. */
const MOTION_TIMEOUT_MS = 1500

interface KeyState {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
}

/** Keys that steer the board, mapped to the direction `keysToTilt` expects. */
const KEY_DIRECTIONS: Record<string, keyof KeyState> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
}

/**
 * `DeviceOrientationEvent.requestPermission`, present only on iOS Safari and absent from the
 * standard DOM typings.
 */
interface DeviceOrientationEventWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export interface TiltInputOptions {
  /** Azimuth of the camera in radians. Mouse, touch and motion tilts are screen-relative and are rotated by it into board space. */
  viewAzimuth?: number
}

export interface TiltInput {
  /** The tilt the player is asking for right now. */
  getTarget(): Tilt
  /** True once the player has asked for any non-zero tilt since the last reset(). */
  hasMoved(): boolean
  /** Forgets that the player has moved and levels the board the keys had tilted, for a fresh run. */
  reset(): void
  /** Levels the board the keys had tilted, so a marble put back at the start is not rolled straight off again. */
  level(): void
  enableMotion(): Promise<MotionStatus>
  disableMotion(): void
  recenterMotion(): void
  motionActive(): boolean
  dispose(): void
}

/** True when an event's target is a form control that should keep its own keystrokes. */
function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLButtonElement
}

/** Reads the screen's current rotation, in degrees, defaulting to portrait. */
function currentScreenAngle(): number {
  return window.screen.orientation?.angle ?? 0
}

/**
 * Combines keyboard, device-motion and pointer input into a single requested tilt, in priority
 * order: the keyboard (while the keys have the board tilted), then device motion (once enabled),
 * then the pointer (a mouse, touch or pen drag).
 *
 * The keys tilt the board and leave it there, like a hand on a real labyrinth: a tap adds a step, a
 * held key keeps adding, the opposite key steps back, and Space levels the board. A pointer works
 * as a virtual joystick, the same for a mouse as for a finger: pressing anywhere does nothing by
 * itself, dragging away from that spot tilts the board that way, and releasing levels it. Pressing
 * a pointer takes over from whatever the keys had set.
 */
export function createTiltInput(element: HTMLElement, options: TiltInputOptions = {}): TiltInput {
  const { viewAzimuth = 0 } = options
  const keys: KeyState = { left: false, right: false, up: false, down: false }
  let moved = false

  let keyTilt: Tilt = { x: 0, y: 0 }
  // When the held keys last changed, and when the held tilt was last advanced, in seconds.
  let keysChangedAt = 0
  let keysAdvancedAt = 0

  let dragTilt: Tilt = { x: 0, y: 0 }
  let dragAnchor: { x: number; y: number } | null = null
  let activeDragPointerId: number | null = null

  let motionEnabled = false
  let neutralPose: Pose | null = null
  let latestPose: Pose | null = null
  let pendingMotionResolve: ((status: MotionStatus) => void) | null = null

  function markMoved(tilt: Tilt): void {
    if (tilt.x !== 0 || tilt.y !== 0) moved = true
  }

  function anyKeyHeld(): boolean {
    return keys.left || keys.right || keys.up || keys.down
  }

  function now(): number {
    return performance.now() / 1000
  }

  /** Keeps tilting while steering keys stay held past KEY_HOLD_DELAY. */
  function advanceKeys(): void {
    if (!anyKeyHeld()) return
    const t = now()
    const holdStart = keysChangedAt + KEY_HOLD_DELAY
    const dt = Math.min(t - Math.max(keysAdvancedAt, holdStart), KEY_HOLD_MAX_DT)
    keysAdvancedAt = t
    if (dt <= 0) return
    keyTilt = nudgeTilt(keyTilt, keysToTilt(keys), KEY_HOLD_RATE * dt)
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (isFormTarget(event.target)) return
    if (event.key === ' ') {
      event.preventDefault()
      keyTilt = { x: 0, y: 0 }
      return
    }
    const direction = KEY_DIRECTIONS[event.key]
    if (!direction) return
    if (event.key.startsWith('Arrow')) event.preventDefault()
    // The browser repeats keydown while a key is held; the hold is timed in advanceKeys instead.
    if (event.repeat || keys[direction]) return
    keys[direction] = true
    keysChangedAt = now()
    keysAdvancedAt = keysChangedAt
    const tap: KeyState = { left: false, right: false, up: false, down: false }
    tap[direction] = true
    keyTilt = nudgeTilt(keyTilt, keysToTilt(tap), KEY_TAP_FRACTION)
    markMoved(keyTilt)
  }

  function handleKeyUp(event: KeyboardEvent): void {
    if (isFormTarget(event.target)) return
    const direction = KEY_DIRECTIONS[event.key]
    if (!direction) return
    keys[direction] = false
    keysChangedAt = now()
  }

  /** Releases every key, so one held while the window lost focus does not stay stuck down. */
  function handleBlur(): void {
    keys.left = keys.right = keys.up = keys.down = false
  }

  function handlePointerMove(event: PointerEvent): void {
    if (activeDragPointerId !== event.pointerId || !dragAnchor) return
    dragTilt = pointerToTilt(event.clientX - dragAnchor.x, event.clientY - dragAnchor.y, DRAG_REACH_PX)
    markMoved(dragTilt)
  }

  function handlePointerDown(event: PointerEvent): void {
    // Only the main mouse button steers; a finger or pen always reports button 0. One drag at a time.
    if (event.button !== 0 || activeDragPointerId !== null) return
    // Whichever pointer is pressed takes over from a tilt the keys left behind.
    keyTilt = { x: 0, y: 0 }
    dragAnchor = { x: event.clientX, y: event.clientY }
    activeDragPointerId = event.pointerId
    dragTilt = { x: 0, y: 0 }
    element.setPointerCapture(event.pointerId)
  }

  function endPointer(event: PointerEvent): void {
    if (activeDragPointerId !== event.pointerId) return
    dragAnchor = null
    activeDragPointerId = null
    dragTilt = { x: 0, y: 0 }
  }

  function handleDeviceOrientation(event: DeviceOrientationEvent): void {
    if (event.beta === null || event.gamma === null) return
    const pose: Pose = { beta: event.beta, gamma: event.gamma }
    latestPose = pose
    if (!neutralPose) {
      neutralPose = pose
      pendingMotionResolve?.('granted')
      return
    }
    const drift = Math.hypot(pose.beta - neutralPose.beta, pose.gamma - neutralPose.gamma)
    if (drift > MOTION_DEADBAND_DEG) moved = true
  }

  element.style.touchAction = 'none'
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  element.addEventListener('pointermove', handlePointerMove)
  element.addEventListener('pointerdown', handlePointerDown)
  element.addEventListener('pointerup', endPointer)
  element.addEventListener('pointercancel', endPointer)
  element.addEventListener('lostpointercapture', endPointer)
  window.addEventListener('blur', handleBlur)

  return {
    getTarget(): Tilt {
      // Keys steer along the board's own axes, which in an isometric view are the screen diagonals, so they are not rotated.
      advanceKeys()
      if (anyKeyHeld() || keyTilt.x !== 0 || keyTilt.y !== 0) return keyTilt
      if (motionEnabled) {
        if (!latestPose || !neutralPose) return { x: 0, y: 0 }
        return rotateTilt(orientationToTilt(latestPose, neutralPose, currentScreenAngle()), viewAzimuth)
      }
      return activeDragPointerId !== null ? rotateTilt(dragTilt, viewAzimuth) : { x: 0, y: 0 }
    },

    hasMoved(): boolean {
      return moved
    },

    reset(): void {
      moved = false
      keyTilt = { x: 0, y: 0 }
    },

    level(): void {
      keyTilt = { x: 0, y: 0 }
    },

    async enableMotion(): Promise<MotionStatus> {
      if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported'

      const withPermission = DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission
      if (typeof withPermission.requestPermission === 'function') {
        try {
          const result = await withPermission.requestPermission()
          if (result !== 'granted') return 'denied'
        } catch {
          return 'denied'
        }
      }

      neutralPose = null
      latestPose = null
      motionEnabled = true
      window.addEventListener('deviceorientation', handleDeviceOrientation)

      return new Promise<MotionStatus>((resolve) => {
        const finish = (status: MotionStatus): void => {
          clearTimeout(timeoutId)
          pendingMotionResolve = null
          resolve(status)
        }
        pendingMotionResolve = finish
        const timeoutId = setTimeout(() => {
          motionEnabled = false
          window.removeEventListener('deviceorientation', handleDeviceOrientation)
          finish('unsupported')
        }, MOTION_TIMEOUT_MS)
      })
    },

    disableMotion(): void {
      motionEnabled = false
      neutralPose = null
      latestPose = null
      window.removeEventListener('deviceorientation', handleDeviceOrientation)
    },

    recenterMotion(): void {
      if (latestPose) neutralPose = latestPose
    },

    motionActive(): boolean {
      return motionEnabled
    },

    dispose(): void {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      element.removeEventListener('pointermove', handlePointerMove)
      element.removeEventListener('pointerdown', handlePointerDown)
      element.removeEventListener('pointerup', endPointer)
      element.removeEventListener('pointercancel', endPointer)
      element.removeEventListener('lostpointercapture', endPointer)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('deviceorientation', handleDeviceOrientation)
    },
  }
}
