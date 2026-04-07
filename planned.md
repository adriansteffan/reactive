# Planned: Browser-based simulation mode

## Motivation

The current simulation framework is headless — it bypasses rendering entirely and computes responseData directly in Node. This is fast (hundreds of participants in seconds) but doesn't test that the UI actually works. A browser-based mode would render components in a real browser and drive them with programmatic interactions, catching rendering bugs, event handler issues, and timing problems.

## Key design insight

The existing **simulators stay unchanged**. They already encode *what* the participant decides (pick choice B, wait 2800ms, type "hello"). Only the execution layer changes — instead of directly building responseData from simulator output, a DOM driver translates decisions into browser interactions and lets components call `next()` naturally.

```
Simulator (shared):     "participant picks choice B after 2800ms"
Headless driver (current): constructs responseData directly → fast, no DOM
DOM driver (new):          waits 2800ms, clicks the radio button → component calls next() with real data
```

## Architecture

### Two simulation modes

- `headless` (existing) — Node subprocesses, no browser, fast bulk data generation
- `browser` (new) — Playwright browser contexts, real rendering, slow but thorough

The consumer chooses the mode in their simulate.ts config. Participant definitions, simulators, and timeline are identical between modes.

### Component DOM drivers

Each component type gets a DOM driver function that maps simulator output to browser actions:

```ts
type DOMDriver = (
  page: Page,                           // Playwright page
  simulatorOutput: { value: any; duration: number },
  trialProps: Record<string, any>,
) => Promise<void>;
```

The generic driver loop per trial:
1. Wait for the component to mount (detect a known selector or mutation)
2. Call the simulator to get the participant's decision
3. Wait `duration` ms
4. Call the component-specific DOM driver
5. Wait for the experiment runner to advance (next component mounts)

### Per-component complexity

| Component | DOM driver complexity | Notes |
|---|---|---|
| Text | Trivial (~10 lines) | Wait, click button |
| PlainInput | Trivial (~10 lines) | Type into input, click button |
| Tutorial | Simple (~15 lines) | Click next arrow per slide |
| Upload | Trivial (~10 lines) | Click submit button |
| EnterFullscreen | Trivial (~5 lines) | Click button (fullscreen API may need mocking) |
| ExitFullscreen | Zero | Auto-advances |
| CheckDevice | Zero | Auto-advances |
| CanvasBlock | Medium (~30-50 lines) | Simulate mouse/keyboard events on canvas |
| RDK | Medium (~20-30 lines) | Keyboard response on canvas |
| **Quest (SurveyJS)** | **Hard (~80-100 lines)** | Per-question-type selectors against SurveyJS DOM |

**Quest is the riskiest part** — SurveyJS's internal DOM structure is an implementation detail that can change between versions. Each question type (rating, radiogroup, checkbox, text, boolean, matrix, dropdown) needs its own selector logic.

### Orchestration

Replace `child_process.spawn` workers with Playwright browser contexts:

1. Start Vite dev server (or serve the built app)
2. For each participant: open a new browser context, navigate to the app URL with appropriate params
3. Run the driver loop until the experiment completes
4. Collect results from the backend (same upload path as headless)
5. Tear down contexts and server

Concurrency is limited by browser resources rather than CPU cores. 4-8 parallel contexts is realistic.

### Synchronization

The main technical challenge beyond SurveyJS DOM selectors. Need to reliably detect:
- Component has mounted and is interactive (not mid-animation)
- `next()` has been called and the next component is rendering
- The experiment has completed

Options: MutationObserver polling, custom data attributes on the experiment runner, or Playwright's `waitForSelector` / `waitForFunction`.

## Estimated scope

~400-500 lines of new code:
- Browser orchestrator: ~100-150 lines
- Generic driver loop: ~50 lines  
- All component DOM drivers: ~200-250 lines

Existing code changes: minimal. Possibly add data attributes to ExperimentRunner for synchronization (e.g., `data-reactive-component-type` on the active component wrapper).

## Constraints

- **Speed**: ~100x slower than headless. This is for smoke testing (1-5 participants), not bulk generation.
- **Dependency**: Playwright becomes a (dev) dependency for consumers using this mode.
- **Fragility**: SurveyJS DOM selectors will need maintenance when upgrading survey-core.
- **Fullscreen**: Browser automation and fullscreen API don't mix well. EnterFullscreen/ExitFullscreen may need to be mocked or skipped in browser mode.

## Not in scope

- Replacing the headless simulation mode (it remains the default)
- Visual regression testing (screenshot comparison)
- Recording/replaying real participant sessions
