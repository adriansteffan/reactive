# Planned: CanvasBlock rework

Status: not started.

CanvasBlock runs a sequence of canvas slides with keyboard responses inside a single trial. It predates the typed timeline and still works the old way: its own timeline format, its own engine, and its own rows. It shares only the compiler (`compileTimeline` and `advanceToNextContent` in `src/core/bytecode.ts`) with the main timeline.

## Problems

### Slide functions run repeatedly

A slide can be a function of the slides recorded so far and the store (`(data, store) => slide`). The component calls that function again every time it needs the slide:

- when the slide is drawn (`processControlFlow`),
- on every animation frame while the slide is shown (`tick`, which reads `displayDurationMs`, `responseTimeLimitMs` and `allowedResponseKeys`),
- on every key press (`handleKeyPress`),
- when the slide ends (`handleSlideEnd`, which reads `ignoreData` and the metadata).

A function that draws anything at random therefore shows one slide, is timed by a second, and records the metadata of a third. Each slide should be made once, when it starts, and kept until it ends. The simulation already does this.

### A second engine

CanvasBlock steps through its bytecode itself, twice: once in the component and once in its `simulate`. Each copy builds its own rows (index, slide number, times, key, reaction time, metadata), keeps its own copy of the store, and handles timing in its own way. The main timeline has one row helper (`createTrialRow` in `src/core/rows.ts`) shared by the runner and the simulation; CanvasBlock's two copies can drift apart from each other and from it.

### Its own timeline format

Control flow is written as uppercase objects (`IF_BLOCK`, `WHILE_BLOCK`, `UPDATE_STORE`, `MARKER`, `IF_GOTO`) with `(data, store)` callbacks, and `toBlocks` translates them into the blocks the compiler understands. The main timeline uses `ifBlock`, `whileBlock`, `updateStore`, `marker` and `ifGoto`, whose callbacks receive the timeline context. Experiment authors have to learn both.

### The store

The callbacks see the experiment's store, typed like everywhere else. Changes made inside the block reach the experiment's store only when the block ends, all at once (`updateStore(storeRef.current)` in the component, `storeUpdates` in `simulate`), so the rest of the experiment cannot see them while the block runs.

### A slide that never ends

A slide without `displayDurationMs` and without `allowedResponseKeys` stays on screen forever. That should be an error during development and simulation, like other experiment mistakes.

## Open questions

- Should slides use the main timeline's builders and the timeline context, so that `ifBlock` and friends work inside a CanvasBlock too?
- Could the runner and the simulation share one slide loop with CanvasBlock, the way they share `createTrialRow`?
- Which of CanvasBlock's timing guarantees (one frame per slide, no React render between slides) must the rework keep?
