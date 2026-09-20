/** WebAudio sound effects for the marble game, entirely synthesised: a steel marble on wood. */

const MASTER_GAIN = 0.5
const MUTE_RAMP_SECONDS = 0.03
const NOISE_BUFFER_SECONDS = 1
const ROLL_SMOOTHING = 0.08
const ROLL_MAX_SPEED = 9 // matches physics MAX_SPEED; used only to normalise tone/gain
const KNOCK_MIN_SPEED = 0.6
const KNOCK_MIN_INTERVAL_S = 0.04

/** Sound effects for the marble game. Every method is a no-op until `unlock()` succeeds. */
export interface GameAudio {
  /** Creates/resumes the AudioContext; call from the first user gesture. Safe to call repeatedly. */
  unlock(): void
  setMuted(muted: boolean): void
  /** Continuous rolling rumble; gain and tone follow speed (cells/s). Call every frame; silent at 0. */
  roll(speed: number): void
  /** Short wooden knock for a wall bounce, louder with impact speed. Ignores soft hits, rate-limited. */
  knock(speed: number): void
  /** Descending whistle and soft thud for falling down a hole. */
  fall(): void
  /** Three-note rising chime for reaching the cup. */
  win(): void
  /** Tiny UI tick for menu and button interactions. */
  click(): void
  /** Stops all sound and releases the AudioContext. */
  dispose(): void
}

type AudioContextConstructor = typeof AudioContext
type ToneExtras = { type?: OscillatorType; endFreq?: number; attack?: number }

// A short envelope: near-silent, ramp up to `peak`, ramp back down, both exponential.
function scheduleEnvelope(gain: GainNode, now: number, attack: number, peak: number, duration: number): void {
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
}

// Plays one enveloped oscillator (optionally sweeping to `endFreq`) and cleans itself up.
function playTone(
  context: AudioContext, out: AudioNode, now: number,
  freq: number, duration: number, peak: number, extras: ToneExtras = {},
): void {
  const osc = context.createOscillator()
  osc.type = extras.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, now)
  if (extras.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(extras.endFreq, now + duration)
  }
  const gain = context.createGain()
  scheduleEnvelope(gain, now, extras.attack ?? 0.006, peak, duration)
  osc.connect(gain)
  gain.connect(out)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

/** Plays one enveloped, band-passed slice of the shared noise buffer and cleans itself up. */
function playNoiseBurst(
  context: AudioContext, out: AudioNode, buffer: AudioBuffer, now: number,
  freq: number, q: number, duration: number, peak: number, attack = 0.003,
): void {
  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = q
  const gain = context.createGain()
  scheduleEnvelope(gain, now, attack, peak, duration)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(out)
  source.onended = () => {
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  source.start(now)
  source.stop(now + duration + 0.02)
}

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  let unlocked = false
  let muted = false
  let lastKnockAt = -Infinity
  // Persistent nodes for the continuous roll rumble, created lazily on first use.
  let rollSource: AudioBufferSourceNode | null = null
  let rollFilter: BiquadFilterNode | null = null
  let rollGain: GainNode | null = null

  function ensureContext(): boolean {
    if (ctx && master) return true
    try {
      const w = window as unknown as {
        AudioContext?: AudioContextConstructor
        webkitAudioContext?: AudioContextConstructor
      }
      const Ctor = w.AudioContext ?? w.webkitAudioContext
      if (!Ctor) return false
      const context = new Ctor()
      const gain = context.createGain()
      gain.gain.value = muted ? 0 : MASTER_GAIN
      gain.connect(context.destination)
      ctx = context
      master = gain
      return true
    } catch {
      ctx = null
      master = null
      return false
    }
  }

  function unlock(): void {
    try {
      if (!ensureContext() || !ctx) return
      if (ctx.state === 'suspended') void ctx.resume()
      unlocked = true
    } catch { /* no-op: audio is optional */ }
  }

  function setMuted(nextMuted: boolean): void {
    muted = nextMuted
    if (!ctx || !master) return
    try {
      const now = ctx.currentTime
      const target = muted ? 0 : MASTER_GAIN
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(target, now + MUTE_RAMP_SECONDS)
    } catch { /* no-op: audio is optional */ }
  }

  function canPlay(): boolean {
    return unlocked && !muted && ctx !== null && master !== null
  }

  /** Runs `action` with the live context/master gain when playable, and never throws. */
  function withAudio(action: (context: AudioContext, out: GainNode) => void): void {
    if (!canPlay() || !ctx || !master) return
    try {
      action(ctx, master)
    } catch { /* no-op: audio is optional */ }
  }

  /** One shared noise buffer, generated once and reused by every noise-based sound. */
  function getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (noiseBuffer) return noiseBuffer
    const length = Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    noiseBuffer = buffer
    return buffer
  }

  /** Starts the looping rumble source once; later calls just retune its filter/gain. */
  function ensureRollNodes(context: AudioContext, out: GainNode): void {
    if (rollSource) return
    const source = context.createBufferSource()
    source.buffer = getNoiseBuffer(context)
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 220
    filter.Q.value = 0.8
    const gain = context.createGain()
    gain.gain.value = 0
    source.connect(filter)
    filter.connect(gain)
    gain.connect(out)
    source.start()
    rollSource = source
    rollFilter = filter
    rollGain = gain
  }

  function roll(speed: number): void {
    withAudio((context, out) => {
      ensureRollNodes(context, out)
      if (!rollGain || !rollFilter) return
      const s = Math.min(1, Math.max(0, speed) / ROLL_MAX_SPEED)
      const now = context.currentTime
      rollGain.gain.setTargetAtTime(s > 0.01 ? 0.03 + s * 0.15 : 0, now, ROLL_SMOOTHING)
      rollFilter.frequency.setTargetAtTime(220 + s * 900, now, ROLL_SMOOTHING)
    })
  }

  function knock(speed: number): void {
    if (speed < KNOCK_MIN_SPEED) return
    withAudio((context, out) => {
      const now = context.currentTime
      if (now - lastKnockAt < KNOCK_MIN_INTERVAL_S) return
      lastKnockAt = now
      const amount = Math.min(1, speed / ROLL_MAX_SPEED)
      // Filtered noise burst (the crack against the rail) plus a low wooden thunk.
      playNoiseBurst(context, out, getNoiseBuffer(context), now, 900 + amount * 500, 1.4, 0.05, 0.06 + amount * 0.16)
      playTone(context, out, now, 150, 0.09, 0.08 + amount * 0.18, { endFreq: 80, attack: 0.004 })
    })
  }

  function fall(): void {
    withAudio((context, out) => {
      const now = context.currentTime
      const whistleDuration = 0.4
      playTone(context, out, now, 700, whistleDuration, 0.14, { endFreq: 120, attack: 0.03 })
      playTone(context, out, now + whistleDuration * 0.85, 110, 0.12, 0.16, { endFreq: 55 })
    })
  }

  function win(): void {
    withAudio((context, out) => {
      const now = context.currentTime
      const freqs = [392, 523.25, 659.25] // G4, C5, E5: a warm, woody rising triad
      const stagger = 0.11
      freqs.forEach((freq, i) => {
        playTone(context, out, now + i * stagger, freq, 0.3, 0.16, { type: 'triangle', attack: 0.02 })
      })
    })
  }

  function click(): void {
    withAudio((context, out) => {
      playTone(context, out, context.currentTime, 950, 0.035, 0.04, { type: 'square', attack: 0.004 })
    })
  }

  function dispose(): void {
    try {
      if (rollSource) {
        rollSource.stop()
        rollSource.disconnect()
      }
      rollFilter?.disconnect()
      rollGain?.disconnect()
      master?.disconnect()
      void ctx?.close()
    } catch { /* no-op: audio is optional */ } finally {
      rollSource = null
      rollFilter = null
      rollGain = null
      ctx = null
      master = null
      unlocked = false
    }
  }

  return { unlock, setMuted, roll, knock, fall, win, click, dispose }
}
