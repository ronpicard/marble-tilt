import type { Level } from '../game/types.ts'

/** Callbacks from the 3D engine to the React shell. All are invoked on the main thread. */
export interface EngineEvents {
  /** The marble hit a wall. `speed` is the speed into the wall, for scaling sound. */
  onImpact(speed: number): void
  /** The marble's rolling speed in cells per second, once per rendered frame. 0 while it is not on the board. */
  onRoll(speed: number): void
  /** The marble dropped into a hole. It respawns at the start and the clock keeps running. */
  onFall(falls: number): void
  /** The marble dropped into the cup. `time` is the run's clock in seconds. */
  onGoal(time: number, falls: number): void
  /** The run's clock, reported when it changes by a tenth of a second. Starts on the first tilt. */
  onTime(time: number): void
}

/** 'play' reads the player's tilt. 'demo' lets the autopilot roll the marble, looping forever, and fires no events. */
export type EngineMode = 'play' | 'demo'

export type MotionStatus = 'granted' | 'denied' | 'unsupported'

/** Screen space covered by UI, in CSS pixels, measured in from each edge of the canvas. */
export interface ViewInsets {
  left: number
  top: number
  right: number
  bottom: number
}

export interface EngineApi {
  /** Shows a level with the marble on its start, the clock at zero, and no falls. */
  loadLevel(level: Level): void
  /** Puts the marble back on the start of the current level and zeroes the clock and falls. */
  restart(): void
  setMode(mode: EngineMode): void
  /** Fits and centres the board in the part of the canvas the UI leaves free. */
  setViewInsets(insets: ViewInsets): void
  /** Freezes the marble and the clock. The scene keeps rendering. */
  setPaused(paused: boolean): void
  /**
   * Starts steering by the device's orientation sensor. Must be called from a user gesture:
   * iOS asks for permission. The pose at the moment of the call becomes level.
   */
  enableMotion(): Promise<MotionStatus>
  disableMotion(): void
  /** Makes the device's current pose the new level. */
  recenterMotion(): void
  /** Re-reads the canvas size. The engine also observes its canvas, so this is rarely needed. */
  resize(): void
  dispose(): void
}
