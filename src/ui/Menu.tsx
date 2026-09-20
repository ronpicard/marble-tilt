import { useEffect, useState } from 'react'
import { formatTime, totalStars } from '../game/progress.ts'
import type { Progress } from '../game/progress.ts'
import type { Level } from '../game/types.ts'

/** Every level is rated out of three stars. */
const MAX_STARS_PER_LEVEL = 3

interface MenuProps {
  levels: Level[]
  progress: Progress
  /** The level "Play" would start, and the one the demo board behind the panel is rolling. */
  currentIndex: number
  muted: boolean
  motionActive: boolean
  onPlay: () => void
  onSelectLevel: (index: number) => void
  onToggleMute: () => void
  onToggleMotion: () => void
}

/** Tracks `(pointer: coarse)` so touch devices get drag/tilt copy and the motion toggle. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const query = window.matchMedia('(pointer: coarse)')
    const onChange = () => setCoarse(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return coarse
}

function TileStarRow({ stars }: { stars: number }) {
  return (
    <span className="star-row" aria-hidden="true">
      {Array.from({ length: MAX_STARS_PER_LEVEL }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" width="1em" height="1em" className={`tile-star ${i < stars ? 'filled' : ''}`}>
          <path
            d="M12 2.5 15 9l7 1-5.2 5 1.4 7L12 18.8 5.8 22l1.4-7L2 10l7-1Z"
            fill={i < stars ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
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

function PhoneTiltIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <rect
        x="6"
        y="2"
        width="12"
        height="20"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        transform="rotate(-14 12 12)"
      />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" transform="rotate(-14 12 12)" />
    </svg>
  )
}

/**
 * Title screen: a docked panel on wide screens (so the demo board stays visible) or a bottom
 * sheet on narrow ones, with the level grid, mute, and — on touch devices — a motion toggle.
 */
export default function Menu({
  levels,
  progress,
  currentIndex,
  muted,
  motionActive,
  onPlay,
  onSelectLevel,
  onToggleMute,
  onToggleMotion,
}: MenuProps) {
  const coarsePointer = useCoarsePointer()
  const stars = totalStars(progress)
  const maxStars = levels.length * MAX_STARS_PER_LEVEL
  const howTo = coarsePointer
    ? 'Drag anywhere to tilt — or turn on motion and tilt your phone.'
    : 'Hold the mouse button to tilt the board toward the cursor, or tap the arrow keys.'

  return (
    <div className="menu-screen">
      <div className="menu-panel">
        <header className="menu-header">
          <h1 className="menu-title">Marble Tilt</h1>
          <p className="menu-tagline">Tilt the board, roll the marble home.</p>
          <p className="menu-stars">
            {stars} / {maxStars} stars
          </p>
          <button type="button" className="primary-button play-button" onClick={onPlay}>
            Play
          </button>
          <p className="how-to-line">{howTo}</p>
        </header>

        <div className="menu-controls">
          {coarsePointer && (
            <button
              type="button"
              className={`toggle-button ${motionActive ? 'active' : ''}`}
              aria-pressed={motionActive}
              onClick={onToggleMotion}
            >
              <PhoneTiltIcon /> Tilt with your phone
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={onToggleMute}
          >
            {muted ? <MuteIcon /> : <UnmuteIcon />}
          </button>
        </div>

        <div className="level-grid" role="list">
          {levels.map((level, index) => {
            const record = progress[level.id]
            const isCurrent = index === currentIndex
            return (
              <button
                key={level.id}
                type="button"
                role="listitem"
                className={`level-tile ${isCurrent ? 'current' : ''}`}
                aria-label={`Level ${index + 1}: ${level.name}`}
                onClick={() => onSelectLevel(index)}
              >
                <span className="level-tile-number">{index + 1}</span>
                <span className="level-tile-name">{level.name}</span>
                <span className="level-tile-time">{record ? formatTime(record.bestTime) : '—'}</span>
                <TileStarRow stars={record?.stars ?? 0} />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
