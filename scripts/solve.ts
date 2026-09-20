import { LEVELS, findPath } from '../src/game/levels.ts'
import { runAutopilot } from '../src/game/autopilot.ts'

/** Column widths used to line up the printed table. */
const ID_WIDTH = 4
const NAME_WIDTH = 16
const SIZE_WIDTH = 7

let anyFailed = false

console.log(
  `${'id'.padEnd(ID_WIDTH)}${'name'.padEnd(NAME_WIDTH)}${'size'.padEnd(SIZE_WIDTH)}` +
    'holes  path  time     falls  par',
)

for (const level of LEVELS) {
  const path = findPath(level)
  const pathLength = path ? path.length : 0
  const run = runAutopilot(level)
  const ok = run.finished && run.falls === 0
  if (!ok) anyFailed = true

  const size = `${level.cols}x${level.rows}`
  console.log(
    `${level.id.padEnd(ID_WIDTH)}${level.name.padEnd(NAME_WIDTH)}${size.padEnd(SIZE_WIDTH)}` +
      `${String(level.holes.length).padStart(5)}  ${String(pathLength).padStart(4)}  ` +
      `${run.time.toFixed(2).padStart(7)}  ${String(run.falls).padStart(5)}  ` +
      `${String(level.par).padStart(3)}` +
      `${ok ? '' : '  FAILED (unfinished or fell)'}`,
  )
}

if (anyFailed) {
  console.error('\nsolve: at least one level did not finish cleanly')
  process.exit(1)
}
