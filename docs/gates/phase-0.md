# Phase 0 gate: the clock runs and pauses in your browser via a link

Gate issue: [#8](https://github.com/etiennecrevier-bit/Magnat/issues/8). Production: https://magnat.etienne-crevier.workers.dev

Checked on 2026-10-14 against `main` at [`149cd2a`](https://github.com/etiennecrevier-bit/Magnat/commit/149cd2ab2eac6a3e7b79843c852ee239d26802b6).

## Status
- Automated pre-flight: **passed**. The clock, Space and phone layout checks passed in two runs; the widest-date check was added for the second run and passed there.
- Human acceptance on a real phone and laptop: **pending**. The gate passes only when Étienne ticks the four boxes on #8. A pre-flight in an emulated browser is not that acceptance.

| Gate criterion (#8) | Automated pre-flight | Human check |
| --- | --- | --- |
| The date advances by itself at ×1 | Passed: one day every 3999 ms (4000 expected) | Pending |
| Pause, ×3 and ×10 work; Space toggles pause on the laptop | Passed: rates, pause and Space below | Pending |
| Readable on the phone without zooming | Passed in three emulated phone viewports | Pending |
| CI is green on `main` | Passed: both checks green on `149cd2a` | Pending |

## How the pre-flight ran
- Headless Chrome 155 on Windows, driven over the Chrome DevTools Protocol by a throwaway script (not committed). The script started its own browser with a temporary profile and stopped it afterwards.
- It loaded the production URL, not a local build.
- A `MutationObserver` in the page logged every date change and every change of the pressed speed button with `performance.now()`, so timings are monotonic and do not depend on polling.
- The game loop keeps the partial day across a speed change (`src/ui/gameLoop.ts`), so the first date change after each tap is discarded. Rates are the average over the complete days that follow, with a ±15% tolerance.
- Phone runs used touch emulation, a mobile user agent and taps (touch events). The laptop run used mouse clicks and real key events for Space.

## Results

### Deployed build is `main`
`npm run build` on `149cd2a` produces `assets/index-bKspSMaN.js` and `assets/index-CHxj00CF.css`. The production `index.html` serves exactly these two files.

### Clock (iPhone viewport, 375×812, taps)
Both runs gave the same averages. The last column is the widest spread over both runs.

| Speed | Expected ms per day | Measured average | Complete days | Shortest / longest day |
| --- | --- | --- | --- | --- |
| ×1 (on load) | 4000 | 3999 | 5 | 3996 / 4001 |
| ×3 (after a tap) | 1333 | 1333 | 6 | 1332 / 1334 |
| ×10 (after a tap) | 400 | 400 | 13 | 396 / 404 |

- The page loads at ×1 with ×1 pressed.
- After each tap, the tapped button is the only one pressed (`aria-pressed`).
- Pause: no date change in 5 s. A tap on ×1 then resumes the clock.

### Space on the laptop (1280×800)
- With focus on the page, Space pauses. Pause is pressed and the date stays still for 4.5 s.
- Space again resumes at the last speed (×1) and the date advances.
- After a click on ×3, focus is on that button. Space then pauses once: the pressed button goes to Pause and nothing else, and no click fires. Space again resumes at ×3, once.

### Phone layout
| Viewport | Horizontal scroll | Zoom | Date font | Speed buttons | Widest date fits |
| --- | --- | --- | --- | --- | --- |
| 375×812, DPR 3, iPhone UA | None (375 = 375) | 1 | 16 px | 83×44 | 223 of 343 px |
| 320×568, DPR 2, iPhone UA | None (320 = 320) | 1 | 16 px | 69×44 | 223 of 288 px |
| 412×915, DPR 2.625, Android UA | None (412 = 412) | 1 | 16 px | 92×44 | 223 of 380 px |
| 1280×800 laptop | None | 1 | 16 px | 44×44 to 46×44 | Yes, beside the buttons |

- The viewport meta is `width=device-width, initial-scale=1.0`.
- "Widest date" is the longest date a 10-year game can show (`Dimanche 28 septembre, an 10`), measured in the date's own font. A run only shows the first days.
- Screenshots were checked by eye: the date is on its own row above four full-width buttons on phones, and on one row on the laptop.

### CI on `main`
- GitHub Actions, "Lint, typecheck, test, build": [success](https://github.com/etiennecrevier-bit/Magnat/actions/runs/38509454677/job/115674362951).
- Cloudflare, "Workers Builds: magnat" (the production deploy): [success](https://github.com/etiennecrevier-bit/Magnat/runs/115674553157).

## What only a real device can confirm
- **iOS Safari rendering.** The font there is San Francisco, not Windows' Segoe UI, so widths differ slightly. The widest date has 65 px to spare at 320 px.
- **Real touch.** The buttons have no `touch-action: manipulation`, so iOS Safari may zoom on a quick double tap (say, ×3 then ×10).
- **Landscape on iOS.** Safari can enlarge text when the phone is turned.
- **A physical keyboard.** Space on a real keyboard, with focus on the page and then on a speed button.

If any of these fails, the rule on #8 applies: open a `bug` issue with the `phase-0` label and keep the gate open.

## Acceptance (Étienne, on #8)
- [ ] The date advances by itself at ×1.
- [ ] Pause, ×3 and ×10 work; the space bar toggles pause on the laptop.
- [ ] It is readable on your phone without zooming.
- [ ] CI is green on `main`.
