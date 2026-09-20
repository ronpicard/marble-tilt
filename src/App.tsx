import { useEffect, useRef, useState } from 'react'
import { createAudio } from './audio.ts'
import type { GameAudio } from './audio.ts'
import { LEVELS } from './game/levels.ts'
import { recordResult } from './game/progress.ts'
import type { Progress } from './game/progress.ts'
import type { Level } from './game/types.ts'
import type { EngineApi, EngineEvents } from './render/engineApi.ts'
import GameCanvas from './ui/GameCanvas.tsx'
import Hud from './ui/Hud.tsx'
import Menu from './ui/Menu.tsx'
import ResultCard from './ui/ResultCard.tsx'
import type { ResultInfo } from './ui/ResultCard.tsx'
import { loadMuted, loadProgress, safeLocalStorage, saveMuted, saveProgress } from './ui/storage.ts'

/** A menu panel narrower than this share of the window is docked to the side, not a bottom sheet. */
const DOCKED_PANEL_MAX_FRACTION = 0.7

type Screen = 'menu' | 'play' | 'result'

/** How long a status toast (motion permission results, etc.) stays up before it fades. */
const TOAST_DURATION_MS = 2600

/** The level "Play" would start: the first one with no saved record, else the first level. */
function nextLevelIndex(levels: Level[], progress: Progress): number {
  for (let i = 0; i < levels.length; i++) {
    if (!progress[levels[i].id]) return i
  }
  return 0
}

/**
 * Top-level app shell. Owns the screen state machine (menu / play / result), the engine handle,
 * persisted progress and mute setting, and wires the 3D engine's events to audio, progress, and
 * the HUD/result UI. The canvas itself is mounted once, full-screen, behind every screen.
 */
export default function App() {
  const [storage] = useState(() => safeLocalStorage())
  const [audio] = useState<GameAudio>(() => createAudio())
  const [progress, setProgress] = useState<Progress>(() => loadProgress(storage, LEVELS.map((l) => l.id)))
  const [muted, setMuted] = useState<boolean>(() => loadMuted(storage))

  const [screen, setScreen] = useState<Screen>('menu')
  const [levelIndex, setLevelIndex] = useState(0)
  const [engine, setEngine] = useState<EngineApi | null>(null)
  const [time, setTime] = useState(0)
  const [falls, setFalls] = useState(0)
  const [motionActive, setMotionActive] = useState(false)
  const [result, setResult] = useState<ResultInfo | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)

  const toastTimerRef = useRef<number | undefined>(undefined)
  const toastIdRef = useRef(0)
  const unlockedAudioRef = useRef(false)
  const firstPlayShownRef = useRef(false)

  function showToast(text: string) {
    toastIdRef.current += 1
    const id = toastIdRef.current
    setToast({ id, text })
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => (current && current.id === id ? null : current))
    }, TOAST_DURATION_MS)
  }

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  // Load the right level and tilt source whenever the screen (or, in play, the level) changes.
  // The result screen intentionally does not reload: the engine is already showing the finished
  // board, and Retry/Next explicitly route back through the 'play' branch.
  useEffect(() => {
    if (!engine) return
    if (screen === 'menu') {
      engine.loadLevel(LEVELS[nextLevelIndex(LEVELS, progress)])
      engine.setMode('demo')
    } else if (screen === 'play') {
      engine.loadLevel(LEVELS[levelIndex])
      engine.setMode('play')
      setTime(0)
      setFalls(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, engine, levelIndex])

  useEffect(() => {
    if (screen === 'play') firstPlayShownRef.current = true
  }, [screen])

  // Tell the engine which part of the canvas the UI covers, so the board is fitted and centred in
  // the rest: beside the docked menu, above the menu's bottom sheet, or below the HUD bar. Sizes are
  // read with offsetWidth/offsetHeight, which entry animations (transforms) do not distort.
  useEffect(() => {
    if (!engine) return
    function updateInsets() {
      const insets = { left: 0, top: 0, right: 0, bottom: 0 }
      const panel = document.querySelector<HTMLElement>('.menu-panel')
      const bar = document.querySelector<HTMLElement>('.hud-top-bar')
      if (panel) {
        const docked = panel.offsetWidth < window.innerWidth * DOCKED_PANEL_MAX_FRACTION
        if (docked) insets.left = panel.offsetWidth
        else insets.bottom = panel.offsetHeight
      } else if (bar) {
        insets.top = bar.offsetTop + bar.offsetHeight
      }
      engine?.setViewInsets(insets)
    }
    updateInsets()
    window.addEventListener('resize', updateInsets)
    return () => window.removeEventListener('resize', updateInsets)
  }, [screen, engine])

  // Pause the simulation (not the rendering) while the tab is hidden, so a backgrounded run
  // doesn't keep ticking the clock or miss wall bounces while nobody is looking.
  useEffect(() => {
    function onVisibilityChange() {
      engine?.setPaused(document.hidden)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [engine])

  // Unlock audio on the very first user gesture, as browsers require.
  useEffect(() => {
    function unlock() {
      if (unlockedAudioRef.current) return
      unlockedAudioRef.current = true
      audio.unlock()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [audio])

  function goToMenu() {
    setResult(null)
    setScreen('menu')
  }

  function startLevel(index: number) {
    setLevelIndex(index)
    setScreen('play')
  }

  function handlePlay() {
    startLevel(nextLevelIndex(LEVELS, progress))
  }

  function restart() {
    engine?.restart()
    setTime(0)
    setFalls(0)
  }

  function handleResultNext() {
    setResult(null)
    if (levelIndex + 1 < LEVELS.length) startLevel(levelIndex + 1)
    else setScreen('menu')
  }

  function handleResultRetry() {
    setResult(null)
    startLevel(levelIndex)
  }

  function toggleMute() {
    setMuted((current) => {
      const next = !current
      audio.setMuted(next)
      saveMuted(storage, next)
      return next
    })
  }

  async function handleToggleMotion() {
    if (!engine) return
    if (motionActive) {
      engine.disableMotion()
      setMotionActive(false)
      return
    }
    const status = await engine.enableMotion()
    if (status === 'granted') {
      setMotionActive(true)
      showToast('Hold your phone flat, then tilt.')
    } else if (status === 'denied') {
      showToast('Motion access was denied. Drag to tilt instead.')
    } else {
      showToast('This device has no tilt sensor. Drag to tilt instead.')
    }
  }

  // Play-screen shortcuts: R restarts, Escape returns to the menu.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (screen !== 'play') return
      if (e.key === 'r' || e.key === 'R') restart()
      else if (e.key === 'Escape') goToMenu()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, engine, levelIndex])

  const events: EngineEvents = {
    onImpact: (speed) => audio.knock(speed),
    onRoll: (speed) => audio.roll(speed),
    onFall: (fallCount) => {
      setFalls(fallCount)
      audio.fall()
    },
    onGoal: (finishTime, fallCount) => {
      const level = LEVELS[levelIndex]
      const previous = progress[level.id]
      const nextProgress = recordResult(progress, level.id, finishTime, level.par)
      setProgress(nextProgress)
      saveProgress(storage, nextProgress)
      audio.win()
      setResult({
        levelNumber: levelIndex + 1,
        levelName: level.name,
        time: finishTime,
        par: level.par,
        stars: nextProgress[level.id].stars,
        isNewBest: !previous || finishTime < previous.bestTime,
        falls: fallCount,
      })
      setScreen('result')
    },
    onTime: (t) => setTime(t),
  }

  const showHint = screen === 'play' && !firstPlayShownRef.current

  return (
    <div className="app-root">
      <GameCanvas events={events} onReady={setEngine} />

      <div className="overlay-layer">
        {screen === 'menu' && (
          <Menu
            levels={LEVELS}
            progress={progress}
            currentIndex={nextLevelIndex(LEVELS, progress)}
            muted={muted}
            motionActive={motionActive}
            onPlay={handlePlay}
            onSelectLevel={startLevel}
            onToggleMute={toggleMute}
            onToggleMotion={handleToggleMotion}
          />
        )}

        {screen === 'play' && (
          <Hud
            level={LEVELS[levelIndex]}
            levelNumber={levelIndex + 1}
            time={time}
            falls={falls}
            muted={muted}
            motionActive={motionActive}
            showHint={showHint}
            onBack={goToMenu}
            onRestart={restart}
            onRecenter={() => engine?.recenterMotion()}
            onToggleMute={toggleMute}
          />
        )}

        {screen === 'result' && result && (
          <ResultCard
            result={result}
            isLastLevel={levelIndex === LEVELS.length - 1}
            onNext={handleResultNext}
            onRetry={handleResultRetry}
            onMenu={goToMenu}
          />
        )}

        {toast && (
          <div key={toast.id} className="toast" role="status">
            {toast.text}
          </div>
        )}
      </div>
    </div>
  )
}
