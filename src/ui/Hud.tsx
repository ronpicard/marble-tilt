import { useEffect, useRef, useState } from 'react'
import { formatTime } from '../game/progress.ts'
import type { Level } from '../game/types.ts'

/** How long the first-play hint stays up before it fades on its own. */
const HINT_DURATION_MS = 4000

interface HudProps {
  level: Level
  levelNumber: number
  time: number
  falls: number
  muted: boolean
  motionActive: boolean
  /** True only on the very first time the player enters play this session. */
  showHint: boolean
  onBack: () => void
  onRestart: () => void
  onRecenter: () => void
  onToggleMute: () => void
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        d="M15 5 8 12l7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 12a8 8 0 1 1 2.6 5.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M4 17v-5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RecenterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="m16 9 5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function UnmuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * The in-play chrome: a small translucent top bar (back, level, clock, falls, par, restart,
 * an optional recentre-motion button, and mute) plus a one-time hint toast for the very first
 * level of the session. Stays clear of the board's centre and respects safe-area insets.
 */
export default function Hud({
  level,
  levelNumber,
  time,
  falls,
  muted,
  motionActive,
  showHint,
  onBack,
  onRestart,
  onRecenter,
  onToggleMute,
}: HudProps) {
  // Captured once at mount: Hud only exists while the player is in play, so it remounts fresh
  // each time play is (re-)entered, and `showHint` is true only on the very first mount of the
  // session. Ignoring later prop changes keeps a live hint from being cut off by an unrelated
  // re-render (e.g. the clock ticking) once it is already showing.
  const [hintVisible, setHintVisible] = useState(showHint)

  useEffect(() => {
    if (!hintVisible) return
    const timer = window.setTimeout(() => setHintVisible(false), HINT_DURATION_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hintTimeRef = useRef(time)
  hintTimeRef.current = time
  useEffect(() => {
    if (hintTimeRef.current > 0) setHintVisible(false)
  }, [time])

  return (
    <>
      <div className="hud-top-bar">
        <button type="button" className="icon-button" aria-label="Back to menu" onClick={onBack}>
          <BackIcon />
        </button>

        <div className="hud-title">
          <span className="hud-level-name">
            {levelNumber}. {level.name}
          </span>
          <span className="hud-stats">
            <span className="hud-clock">{formatTime(time)}</span>
            <span className="hud-dot" aria-hidden="true">
              &middot;
            </span>
            <span className="hud-falls">Falls {falls}</span>
            <span className="hud-dot" aria-hidden="true">
              &middot;
            </span>
            <span className="hud-par">Par {formatTime(level.par)}</span>
          </span>
        </div>

        <div className="hud-actions">
          {motionActive && (
            <button type="button" className="icon-button" aria-label="Recentre tilt" onClick={onRecenter}>
              <RecenterIcon />
            </button>
          )}
          <button type="button" className="icon-button" aria-label="Restart level" onClick={onRestart}>
            <RestartIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={onToggleMute}
          >
            {muted ? <MuteIcon /> : <UnmuteIcon />}
          </button>
        </div>
      </div>

      <div className={`hud-hint ${hintVisible ? 'visible' : ''}`} role="status">
        Tilt gently — the clock starts when you move
      </div>
    </>
  )
}
