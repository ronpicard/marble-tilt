import type { Tilt } from '../game/types.ts'
import type { Pose } from '../game/tilt.ts'
import { keysToTilt, orientationToTilt, pointerToTilt, rotateTilt } from '../game/tilt.ts'
import type { MotionStatus } from './engineApi.ts'

/** Degrees of device-orientation drift from neutral below which motion input is ignored. */
const MOTION_DEADBAND_DEG = 1.5

/** Fraction of the element's shorter side that a mouse must travel from centre for MAX_TILT. */
const MOUSE_REACH_FACTOR = 0.4

/** Pixels of joystick travel from the anchor point that produce MAX_TILT for touch/pen. */
const TOUCH_REACH_PX = 90

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
  reset(): void
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
 * order: keyboard (while any steering key is held), then device motion (once enabled), then the
 * pointer (mouse hover, or a touch/pen virtual joystick).
 */
export function createTiltInput(element: HTMLElement, options: TiltInputOptions = {}): TiltInput {
  const { viewAzimuth = 0 } = options
  const keys: KeyState = { left: false, right: false, up: false, down: false }
  let moved = false

  let mouseTilt: Tilt = { x: 0, y: 0 }
  // False until the first real pointermove, so a level never starts pre-tilted by a resting cursor.
  let mouseReady = false

  let touchTilt: Tilt = { x: 0, y: 0 }
  let touchAnchor: { x: number; y: number } | null = null
  let activeTouchPointerId: number | null = null

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

  function handleKeyDown(event: KeyboardEvent): void {
    if (isFormTarget(event.target)) return
    const direction = KEY_DIRECTIONS[event.key]
    if (!direction) return
    if (event.key.startsWith('Arrow')) event.preventDefault()
    keys[direction] = true
    markMoved(keysToTilt(keys))
  }

  function handleKeyUp(event: KeyboardEvent): void {
    if (isFormTarget(event.target)) return
    const direction = KEY_DIRECTIONS[event.key]
    if (!direction) return
    keys[direction] = false
  }

  function mouseReach(): number {
    const rect = element.getBoundingClientRect()
    return MOUSE_REACH_FACTOR * Math.min(rect.width, rect.height)
  }

  function handlePointerMove(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      const rect = element.getBoundingClientRect()
      const dx = event.clientX - (rect.left + rect.width / 2)
      const dy = event.clientY - (rect.top + rect.height / 2)
      mouseTilt = pointerToTilt(dx, dy, mouseReach())
      mouseReady = true
      markMoved(mouseTilt)
      return
    }
    if (activeTouchPointerId !== event.pointerId || !touchAnchor) return
    touchTilt = pointerToTilt(event.clientX - touchAnchor.x, event.clientY - touchAnchor.y, TOUCH_REACH_PX)
    markMoved(touchTilt)
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse') return
    touchAnchor = { x: event.clientX, y: event.clientY }
    activeTouchPointerId = event.pointerId
    touchTilt = { x: 0, y: 0 }
    element.setPointerCapture(event.pointerId)
  }

  function endTouch(event: PointerEvent): void {
    if (activeTouchPointerId !== event.pointerId) return
    touchAnchor = null
    activeTouchPointerId = null
    touchTilt = { x: 0, y: 0 }
  }

  function handlePointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') mouseTilt = { x: 0, y: 0 }
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
  element.addEventListener('pointerup', endTouch)
  element.addEventListener('pointercancel', endTouch)
  element.addEventListener('pointerleave', handlePointerLeave)

  return {
    getTarget(): Tilt {
      // Keys steer along the board's own axes, which in an isometric view are the screen diagonals, so they are not rotated.
      if (anyKeyHeld()) return keysToTilt(keys)
      if (motionEnabled) {
        if (!latestPose || !neutralPose) return { x: 0, y: 0 }
        return rotateTilt(orientationToTilt(latestPose, neutralPose, currentScreenAngle()), viewAzimuth)
      }
      if (activeTouchPointerId !== null) return rotateTilt(touchTilt, viewAzimuth)
      return mouseReady ? rotateTilt(mouseTilt, viewAzimuth) : { x: 0, y: 0 }
    },

    hasMoved(): boolean {
      return moved
    },

    reset(): void {
      moved = false
      mouseReady = false
      mouseTilt = { x: 0, y: 0 }
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
      element.removeEventListener('pointerup', endTouch)
      element.removeEventListener('pointercancel', endTouch)
      element.removeEventListener('pointerleave', handlePointerLeave)
      window.removeEventListener('deviceorientation', handleDeviceOrientation)
    },
  }
}
