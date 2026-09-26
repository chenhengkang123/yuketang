# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Two Chrome extensions for Yuketang (雨课堂, yuketang.cn). There is no build system, no dependencies, and no test suite — plain vanilla JS only. There is no userscript.

## Project layout

- `yuketang-no-pause-extension/` — Chrome Manifest V3 extension. `inject.js` runs in `world: "MAIN"` at `document_start`, so it shares the page's JS realm and can patch prototypes before Yuketang's scripts load. This is the only anti-pause implementation.
- `yuketang-auto-next-extension/` — Chrome Manifest V3 extension. When a learning-space (`/ai-workspace/lms-graph/.../video/...`) video finishes, `inject.js` clicks the top-right next-unit arrow (`.unit-arrow.arrow-reverse`). SPA navigation is tracked by polling `location.href`; unit type is told apart by the URL (`/video/` vs homework `/exercise/`). Homework/non-video units are auto-skipped by default until the next video unit (`SKIP_NON_VIDEO = false` stops there instead); a `navPending` guard keeps the 1s poll from scheduling duplicate next-clicks while a navigation is in flight, and a click that doesn't navigate within `NAV_RETRY_DELAY` is retried up to `NAV_MAX_RETRIES` times (the next-unit button isn't wired up yet on first page load) before giving up as "last unit". Runs as a plain `document_idle` content script. A page switch (bottom-left, also `Alt+N`) persists in `localStorage` key `yuketang-auto-next` (`'0'` off, default on). "本集后停" lives in `sessionStorage` key `yuketang-auto-next-stop` and cancels only the next end-of-video advance.
- `analysis/` — **Reference only, never edit or execute.** Minified single-line webpack bundles (`rainweb` chunks) downloaded from Yuketang's site for reverse-engineering. `27437.js` contains the player code the script defends against; grep it for `winTriggerHidden` to see the actual pause logic. These files are ~0.5–1.4 MB on one line — always grep/search them, never Read them whole.

## Critical maintenance rule

Edit each extension on its own: anti-pause is `yuketang-no-pause-extension/inject.js`, auto-next is `yuketang-auto-next-extension/inject.js`. They do not share a source file.

## How the anti-pause script works (5 layers)

The defense is layered because Yuketang pauses through several independent channels (all confirmed in `analysis/27437.js`: `winTriggerHidden` maps `blur`/`focusout`/`pagehide` and `document.hidden` to a `playBtn.toggle` with `xtStateType: "pause"`):

1. **Spoof visibility getters** — redefine `hidden` / `visibilityState` (+ webkit/moz/ms prefixes) on `Document.prototype` to always report visible; `hasFocus` → `true`.
2. **Block listener registration** — patch `EventTarget.prototype.addEventListener`/`removeEventListener` to silently drop `visibilitychange`-family registrations (jQuery also routes through these).
3. **Swallow handler-property assignment** — define no-op setters on `Window.prototype` (`onblur`, `onfocus`, `onpagehide`, `onpageshow`) and `Document.prototype` (`onfocusin`, `onfocusout`, `onvisibilitychange`). Yuketang registers via `window.onblur = r`, which bypasses `addEventListener`.
4. **Capture-phase backstop** — `stopImmediatePropagation` listeners (registered via the *saved original* `addEventListener`, so layer 2 doesn't block them) on `document` and `window` for any visibility/blur/focusout/pagehide/freeze event that still gets through.
5. **Auto-resume fallback** — a `setInterval` re-plays any paused, non-ended `<video>` when the page is genuinely in the background (catches heartbeat/watchdog pauses).

Layer 5's "really in background" check depends on layer 1's ordering subtlety: the *real* descriptor for `document.hidden` is captured **before** the spoof is installed, and that saved getter is the only source of truth for "is the page actually hidden." Preserve this ordering if refactoring — it's what lets auto-resume run in the background without un-pausing videos the user deliberately paused in the foreground.

## Configuration

Anti-pause config is at the top of `yuketang-no-pause-extension/inject.js`: `AUTO_RESUME`, `RESUME_INTERVAL` (ms), `DEBUG` (console logging).

## Testing

Manual only. `chrome://extensions` → Developer mode → Load unpacked → select `yuketang-no-pause-extension/` or `yuketang-auto-next-extension/`. Open a Yuketang video, switch tabs, and verify playback continues. Debug by setting `DEBUG = true` and watching the console for `[雨课堂防暂停]` lines.
