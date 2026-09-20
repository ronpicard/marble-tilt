# Changelog

All notable changes to Marble Tilt are documented in this file, following the [Keep a Changelog](https://keepachangelog.com/) format.

## [1.3.1] - 2026-09-20

### Changed

- The mouse now steers exactly like a finger on a phone: click anywhere and nothing happens until you drag, then the board tilts the way you drag, steeper the farther you go, and levels when you let go. Before, pressing the button tilted the board toward the cursor at once, so a click away from the centre threw the board into a steep tilt.

## [1.3.0] - 2026-09-20

### Changed

- On desktop the mouse now tilts the board only while its left button is held: the board tilts toward the cursor, and levels when you let go. Before, the board followed the cursor whenever it moved, so it tilted by accident.
- The arrow keys and WASD now tilt the board in steps and leave it there. A tap adds a quarter of the full tilt, holding a key keeps tilting quickly up to the maximum, the opposite key steps back, and Space levels the board. Before, a key slammed the board to full tilt and it snapped back to flat on release. The board also levels itself when the marble is put back at the start after a fall.

## [1.2.0] - 2026-09-20

### Added

- Two-storey boards. Ramps climb to a raised level of decks and bridges; a ramp pulls the marble back down, so it takes some speed or a held tilt to climb. Bridges can be rolled over and under, and rolling off the edge of a deck or a bridge drops the marble back to the floor with a wooden knock.
- Seven new levels built from ramps, bridges, rooms, and small mazes: Up and Over, Underpass, Drawbridge, Four Rooms, Mezzanine, Crossroads, and Citadel. They replace Pillar Room, The Bridge, Four Corners, Swiss Cheese, The Gauntlet, Causeway, and Spiral Vault; the game still has twelve levels, and best times on the five levels that stayed are kept.

### Changed

- The board behind the menu is much calmer. The demo marble rolls at an unhurried pace and only slows for corners instead of braking at every cell, the board eases into each tilt rather than snapping to it, and the camera sways more slowly. Before, the board rocked back and forth several times a second.

## [1.1.0] - 2026-09-20

### Changed

- The board is now drawn in a true isometric view: a parallel projection looking along the board's diagonal, so it reads as a solid wooden box with no perspective distortion. Before, a steep perspective camera made the far edge of the board look pinched.
- Mouse, touch, and phone-tilt steering still follow the screen: push right and the marble rolls to the right of the screen. The arrow keys and WASD now roll the marble along the board's rows and columns, which run diagonally on screen (Up is up-right, Right is down-right).
- Walls and the frame are lower so the marble and the pits stay visible behind them from the lower camera.

## [1.0.0] - 2026-09-20

### Added

- Twelve levels of a 3D wooden labyrinth, ramping from a gentle hole-free first roll through mazes with holes tucked in dead ends to narrow bridges over open pits.
- Tilt the board with your mouse, arrow keys or WASD, a touch drag, or your phone's tilt sensor, complete with the iOS motion-permission prompt and a recentre button.
- A clock that starts on your first tilt, a falls counter, and a 1-3 star rating on each level based on your finish time against par.
- Best times and star ratings are saved in your browser, so your progress on all twelve levels is kept between visits.
- An autopilot proves every level is finishable by driving the real physics from start to cup, and plays a demo behind the menu while you choose a level.
- Synthesised sound effects for rolling, wall knocks, falls, and finishing, with a mute toggle.
- Deployed to GitHub Pages on every push to `main`.
