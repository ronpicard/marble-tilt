import { useEffect, useRef } from 'react'
import { formatTime } from '../game/progress.ts'
import type { Stars } from '../game/progress.ts'

/** Everything ResultCard needs to describe a finished run, assembled by App from `onGoal`. */
export interface ResultInfo {
  levelNumber: number
  levelName: string
  time: number
  par: number
  stars: Stars
  isNewBest: boolean
  falls: number
}

interface ResultCardProps {
  result: ResultInfo
  isLastLevel: boolean
  onNext: () => void
  onRetry: () => void
  onMenu: () => void
}

/** Levels are always rated out of three stars. */
const STAR_COUNT = 3

/** Milliseconds between each star's pop-in, so they arrive one after another rather than at once. */
const STAR_STAGGER_MS = 120

function StarIcon({ filled, delayMs }: { filled: boolean; delayMs: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      className={`result-star ${filled ? 'filled' : ''}`}
      style={{ animationDelay: `${delayMs}ms` }}
      aria-hidden="true"
    >
      <path
        d="M12 2.5 15 9l7 1-5.2 5 1.4 7L12 18.8 5.8 22l1.4-7L2 10l7-1Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The post-run summary: time, par, stars, a "new best" callout, and the next-step buttons. */
export default function ResultCard({ result, isLastLevel, onNext, onRetry, onMenu }: ResultCardProps) {
  const nextButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    nextButtonRef.current?.focus()
  }, [])

  // Redundant with the primary button's own focus/click handling, but keeps Enter working even
  // if focus has moved elsewhere (e.g. a screen reader's virtual cursor).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      e.preventDefault()
      onNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onNext])

  return (
    <div className="modal-backdrop">
      <div className="result-card" role="dialog" aria-modal="true" aria-label="Level complete">
        <h2 className="result-title">Level complete</h2>
        <p className="result-level-name">
          {result.levelNumber}. {result.levelName}
        </p>

        <div className="result-stars" aria-label={`${result.stars} of ${STAR_COUNT} stars`}>
          {Array.from({ length: STAR_COUNT }, (_, i) => (
            <StarIcon key={i} filled={i < result.stars} delayMs={i * STAR_STAGGER_MS} />
          ))}
        </div>

        <p className="result-stats">
          {formatTime(result.time)} &middot; Par {formatTime(result.par)}
        </p>
        {result.isNewBest && <p className="result-best">New best!</p>}
        <p className="result-falls">
          {result.falls} fall{result.falls === 1 ? '' : 's'}
        </p>

        <div className="result-actions">
          <button type="button" ref={nextButtonRef} className="primary-button" onClick={onNext}>
            {isLastLevel ? 'Back to menu' : 'Next level'}
          </button>
          <button type="button" className="secondary-button" onClick={onRetry}>
            Retry
          </button>
          <button type="button" className="secondary-button" onClick={onMenu}>
            Menu
          </button>
        </div>
      </div>
    </div>
  )
}
