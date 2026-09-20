# Marble Tilt

Marble Tilt is a 3D wooden labyrinth that runs in the browser. Tilt the board with your mouse, arrow keys or WASD, a touch drag, or your phone's tilt sensor, and roll a steel marble past open holes into the cup. Twelve levels build from a gentle first roll to two-storey boards with ramps, decks, bridges you roll under and then over, and a walled keep behind a moat of pits. Play the [live demo](https://ronpicard.github.io/marble-tilt/) — it works on both phones and desktops.

## How to play

- Mouse: click and drag, exactly like a finger on a phone. Pressing the button does nothing by itself; drag away from the spot where you pressed and the board tilts that way, steeper the farther you drag. Let go and the board returns to flat. You can start the drag anywhere in the window.
- Keyboard: arrow keys or WASD tilt the board in steps, and the board stays where you leave it, like a hand resting on a real labyrinth. A tap adds a quarter of the full tilt, holding a key keeps tilting until it reaches the maximum, the opposite key steps back, and Space levels the board. The keys work along the board's own rows and columns, which run diagonally across the isometric view: Up is up-right, Right is down-right, Down is down-left, and Left is up-left. Two keys together tilt between them. The board levels itself whenever the marble is put back at the start.
- Touch: drag anywhere on the board like a virtual joystick — the farther from where you first touched, the steeper the tilt. Release to flatten.
- Phone tilt: turn on "Tilt with your phone" from the menu, then tilt your device itself. iOS asks for a one-time motion-access permission the first time you tap the toggle; allow it to steer by tilt. A recentre button appears during play to make your phone's current pose the new "flat," in case you weren't holding it level when you turned tilt on.
- `R` restarts the current level from the start, and `Escape` returns to the menu at any point during play.
- The clock starts on your first tilt, not the moment the level loads, so lining up your first move doesn't cost you time.
- Falling into a hole drops the marble back at the start of the level; the clock keeps running, and a falls counter in the HUD tracks how many times it has happened.
- Ramps climb to a raised level of decks and bridges. A ramp pulls the marble back down, so carry some speed into it or hold the tilt; its side rails keep you on it. Up top there are no rails: roll off the edge of a deck or a bridge and the marble drops back to the floor, which costs time but not a fall, unless a pit is waiting there. Pits and the cup only catch a marble on the floor, so a bridge carries you safely over whatever is beneath it, and you can roll underneath a bridge as well.
- Stars are based on your finish time against the level's par: finishing at or under par earns 3 stars, finishing within 1.5x par earns 2 stars, and any slower finish still earns 1 star for completing the level.
- Your best time and best star rating for each level are tracked independently and saved in your browser, so a slower run that still clears a star threshold can raise your stars without overwriting a faster best time.
- All 12 levels are unlocked from the start — pick any one from the menu grid, which shows your best time and stars earned so far for each.
- A mute toggle is available from both the menu and the in-play HUD.
- The heads-up display during a run shows the level number and name, the clock, your falls count, the level's par, and buttons to restart the level, recentre motion (shown only while phone tilt is active), mute, and return to the menu.
- The first time you play, a brief on-screen hint reminds you the clock starts when you move; it fades on its own once you tilt or after a few seconds, whichever comes first.
- Switching away to another browser tab or app pauses the run — nothing moves and the clock stops until you switch back.
- While you're deciding what to play from the menu, the board behind it keeps running in a demo mode: the same autopilot that proves every level finishable rolls a marble through the level you're about to open, at an unhurried pace so the board behind the menu tilts gently.

## The levels

Twelve boards mix three kinds of trouble. The walled mazes hide a pit at the end of every wrong turn, so a careless dead end costs you the run rather than a moment. The open boards have no walls to lean on at all: a slalom between rows of pits, a switchback of one-cell causeways, and a spiral that winds inward to a cup ringed by pits.

The two-storey boards add ramps, decks, and bridges. Up and Over crosses a dividing wall on a deck. Underpass sends you beneath a bridge, round the far room, and back over the same bridge to drop into a walled pocket that holds the cup. Drawbridge is a single plank across a moat. Four Rooms joins its rooms by doorways and, once, over the top of a wall. Mezzanine puts a small maze on a raised plaza with pits waiting beside its edges. Crossroads is a maze whose corridor passes under the walkway that later carries you to a sealed room. Citadel ends the set: a chicane, a causeway along a moat, a ramp and a bridge, and a drop into the keep.

The first board is small and hole-free, a single S-bend, so a new player's first roll always reaches the cup. Holes are never placed directly beside the start, so you always get a clean first move.

## The physics

The marble is a circle rolling on a board with two levels, the floor and a raised level of decks and bridges, simulated with a fixed timestep for determinism. Each step:

- Tilting the board accelerates the marble along the tilt direction, scaled by `TILT_ACCEL`. Tilt itself is clamped to `MAX_TILT`, circularly rather than per axis, so a diagonal push never exceeds the same maximum as a straight one.
- The board doesn't snap to the tilt you ask for — it eases toward it over time at a rate set by `TILT_RESPONSE`, which is what gives the board a bit of physical weight and lag as you steer, rather than feeling like it's glued to your input.
- Rolling drag constantly bleeds off speed, governed by `ROLL_DRAG`, and overall speed is capped at `MAX_SPEED` so the marble can never move so far in a single step that it tunnels straight through a wall.
- The marble is treated as a circle with radius `BALL_RADIUS`. Each step, it's checked against every wall cell around its current position: the closest point on that wall's square to the marble's centre is found, and if that point is nearer than the marble's radius, the marble is pushed back out along the normal and the velocity component driving it into the wall is reflected, keeping only a fraction of that speed set by `WALL_RESTITUTION`, so a hit feels like a real bounce rather than a perfect one. This resolution runs twice per step so the marble settles cleanly in corners instead of catching on them.
- The marble is always in the cell that holds its centre, and one shared set of rules (`src/game/board.ts`) says which neighbouring cells it may enter from there and which are solid: a deck is a wall to a marble on the floor and open ground to one on the raised level, a bridge is open to both, and a ramp can be entered only through its two ends. The pathfinder uses the same rules, so the route it proves and the physics the player feels cannot disagree.
- On a ramp, gravity pulls the marble back down the slope in proportion to how steep it is (`RAMP_ACCEL`); a ramp that spreads its climb over two or three cells is gentler than a one-cell ramp. The marble's height follows its position along the ramp.
- Rolling off the edge of a deck or a bridge drops the marble to the floor. Pits and the cup are only checked while the marble is on the floor.
- The marble falls when its centre comes within `HOLE_RADIUS` of a hole's centre, and sinks into the cup the same way within `GOAL_RADIUS` of the goal's centre.

All of this runs at a fixed step of `FIXED_DT`, decoupled from the render frame rate, so the simulation behaves identically regardless of how fast or slow the browser is actually drawing frames.

Every input source feeds into the same tilt value before physics ever sees it, just scaled differently: a mouse or touch drag reaches the board's maximum tilt over a fixed pixel distance from where the drag started, the keys add to a tilt that stays put until it reaches that same maximum, and a phone's rotation reaches it once you've turned the device a fixed number of degrees from wherever you recentred it. Whichever way you're steering, the board responds the same way underneath.

## Every level is proven finishable

A breadth-first search (`findPath`) over each level's grid and its two levels — up ramps, across bridges, under them, and off deck edges — confirms a walkable route exists from the start to the cup before a level ever ships. Beyond just pathing, an autopilot drives the same physics the player uses — reading the marble's live position and velocity and steering along that path one straight run at a time, slowing only for corners and holding against the slope of a ramp, just as a real hand would, rather than teleporting along it — to prove every level is playable, not just walkable on paper. That autopilot runs inside the test suite for all twelve levels, checking that each one finishes with no falls, and it also powers the demo you see rolling behind the menu while you're deciding what to play next. Each level's par time is derived from how long the autopilot takes to finish it, so par reflects a real, physically simulated run rather than a guess at difficulty. Run the same autopilot from the command line to see the numbers for every level at once:

```bash
npm run solve
```

This prints one line per level — its size, hole count, path length, autopilot time, falls, and par — and exits with an error if any level turns out to be unfinished or costs the autopilot a fall.

Both the pathfinding and the autopilot are covered by their own test files alongside the physics tests, so a change to a level's layout or to a physics constant gets checked against every level automatically the next time the test suite runs. The same check runs in CI on every push, so a level or a physics constant can't regress into being unwinnable without the deploy failing first.

## Tech stack

- React 19 and TypeScript for the menu, HUD, and result screens
- Plain three.js for the 3D board, marble, wood textures, and lighting, drawn through an isometric (parallel-projection) camera that looks along the board's diagonal
- Vite for building and development
- Web Audio, synthesised in code at runtime — no audio files shipped with the app
- Node's built-in test runner (`node:test`), no separate test framework
- No backend — progress and mute state live in `localStorage`, and levels ship as static data
- Strict TypeScript throughout, including the game logic that has no DOM or three.js dependency at all
- GitHub Actions and GitHub Pages for continuous deployment

## Project layout

The game logic is deliberately kept separate from rendering and input, so the physics, level
data, and autopilot can be unit tested without a browser or a canvas:

```text
src/game/    physics, the two-level board rules, level definitions, tilt input mapping, the autopilot, and progress persistence
src/render/  the three.js engine, its public API, DOM input handling, and procedural textures
src/ui/      React components for the menu, HUD, result card, and canvas mount
src/audio.ts synthesised sound effects
scripts/     the level solver
```

## Development

Requires Node >= 22.12.

Everything under `src/game/` is framework-free — no DOM, no three.js, and no non-deterministic
calls like `Math.random` or `Date` — so `npm test` runs the physics, level, tilt, progress, and
autopilot tests directly in Node without spinning up a browser.

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server |
| `npm test` | Run the physics, level, tilt, progress, and autopilot tests |
| `npm run solve` | Run the autopilot over every level and report time, falls, and par |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |

## Deployment

Pushes to `main` run a GitHub Actions workflow that installs dependencies, runs the test suite,
builds the production bundle, and publishes the `dist` output to GitHub Pages.

Vite is configured with a relative `base` in `vite.config.ts`, so the built asset paths resolve
correctly whether the site is served from the domain root or from a repository subpath like
`/marble-tilt/`.

The workflow can also be triggered manually from the Actions tab (`workflow_dispatch`) without
pushing a new commit.

## License

MIT — see [LICENSE](LICENSE).
