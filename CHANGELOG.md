# Changelog

All notable changes to Marble Tilt are documented in this file, following the [Keep a Changelog](https://keepachangelog.com/) format.

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
