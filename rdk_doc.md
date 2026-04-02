# Random Dot Kinematogram (RDK) Component

Mostly AI generated reference so I dont have to look at the code in case I forget something minor.
Will have to have a manual go at all of this to create an actually decent reference.

## Basic Usage

```typescript
{
  name: 'rdk_trial',
  type: 'RandomDotKinematogram',
  props: {
    validKeys: ['arrowleft', 'arrowright'],
    correctResponse: 'arrowright',
    duration: 2000,
    direction: 90,
    coherence: 0.5,
  },
}
```

## Parameters

### Trial Control

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `validKeys` | `string[]` | `[]` | Valid keyboard responses. Empty array = any key valid |
| `correctResponse` | `string \| string[]` | `undefined` | The correct response(s) for this trial |
| `duration` | `number` | `1000` | Duration in ms that dots are shown (response window). Total trial time = `fixationTime + duration`. Use `-1` for infinite duration |
| `stimulusDuration` | `number` | `undefined` | How long to show stimulus in ms. Defaults to `duration`. Set lower than `duration` to hide stimulus while still accepting responses |
| `responseEndsTrial` | `boolean` | `true` | Whether response ends the trial immediately |

### Dot Motion

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dotCount` | `number` | `300` | Number of dots per frame |
| `dotSetCount` | `number` | `1` | Number of dot sets to cycle through (reduces tracking artifacts) |
| `direction` | `number` | `0` | Direction in degrees (0=up, 90=right, 180=down, 270=left) |
| `coherence` | `number` | `0.5` | Proportion of dots moving coherently (0-1) |
| `opposite` | `number` | `0` | Proportion moving in opposite direction (0 to 1-coherence) |
| `speed` | `number` | `60` | Pixels per second (frame-rate independent) |
| `dotLifetime` | `number` | `-1` | Milliseconds before dot is replaced (-1 = infinite) |
| `updateRate` | `number` | `undefined` | Update rate in Hz. `undefined` = update every frame |

### Dot Appearance

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dotRadius` | `number` | `2` | Radius of dots in pixels (for circles) or base size for characters |
| `dotCharacter` | `string` | `undefined` | Optional character/emoji to display instead of circles. If set, dots are rendered as text |
| `dotColor` | `string` | `"white"` | Color of dots (any CSS color) |
| `coherentDotColor` | `string` | `undefined` | Optional color for coherent dots. If specified, coherent dots will use this color instead of `dotColor` |
| `backgroundColor` | `string` | `"gray"` | Background color (any CSS color) |

### Aperture

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apertureShape` | `'circle' \| 'ellipse' \| 'square' \| 'rectangle'` | `'ellipse'` | Shape of the aperture |
| `apertureWidth` | `number` | `600` | Width in CSS pixels (diameter for circle). Automatically scales for retina displays |
| `apertureHeight` | `number` | `400` | Height in CSS pixels (ignored for circle/square). Automatically scales for retina displays |
| `apertureCenterX` | `number` | `window.innerWidth/2` | X-coordinate of aperture center in CSS pixels |
| `apertureCenterY` | `number` | `window.innerHeight/2` | Y-coordinate of aperture center in CSS pixels |
| `reinsertMode` | `'random' \| 'opposite' \| 'oppositeSimple' \| 'wrap'` | `'opposite'` | How to reinsert out-of-bounds dots (see below) |

### Reinsertion Modes

When a dot exits the aperture boundary, `reinsertMode` controls where it reappears:

| Mode | Circle/Ellipse | Rectangle/Square |
|------|----------------|------------------|
| `'random'` | Random position inside aperture | Random position inside aperture |
| `'opposite'` (default) | Ray-cast: traces backward along movement trajectory to find entry point | Ray-cast: traces backward along movement trajectory to find entry point |
| `'oppositeSimple'` | Mirror through center (clamped to boundary) | Edge-based: appears at opposite edge, preserving the other coordinate |
| `'wrap'` | Toroidal wrap on bounding box (x/y wrap independently) | Toroidal wrap on bounding box (x/y wrap independently) |

**`'opposite'` mode** (recommended): Uses ray-casting to find where the dot would have entered if it had continued from the opposite side. This maintains the coherent motion direction across the aperture boundary, producing more natural-looking motion.

**`'oppositeSimple'` mode**: A simpler algorithm that doesn't account for movement direction:
- For circles/ellipses: mirrors the dot position through the center
- For rectangles: places the dot at the opposite edge while preserving the non-crossing coordinate

**`'wrap'` mode**: Toroidal wrapping on the bounding box. X and Y coordinates wrap independently via modulo arithmetic. Preserves relative dot positions for axis-aligned motion. For diagonal motion, the pattern tiles but trajectories appear discontinuous at wrap boundaries.

### RDK Algorithm

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `noiseMovement` | `'randomTeleport' \| 'randomWalk' \| 'randomDirection'` | `'randomDirection'` | How noise dots move (see below) |
| `reassignEveryMs` | `number` | `undefined` | Time-based reassignment of dot roles. `undefined` = never reassign (fixed), `0` = reassign every update, `> 0` = reassign every X milliseconds |

### Fixation Cross

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `showFixation` | `boolean` | `false` | Show fixation cross |
| `fixationTime` | `number` | `500` | Duration in ms to show fixation before dots appear. Added to `duration` for total trial time |
| `fixationWidth` | `number` | `15` | Width in pixels |
| `fixationHeight` | `number` | `15` | Height in pixels |
| `fixationColor` | `string` | `"white"` | Color |
| `fixationThickness` | `number` | `2` | Line thickness |

### Border

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `showBorder` | `boolean` | `false` | Show aperture border |
| `borderWidth` | `number` | `1` | Border width in pixels |
| `borderColor` | `string` | `"black"` | Border color |

### Noise Movement & Dot Assignment

The RDK algorithm is controlled by two orthogonal parameters:

**`noiseMovement`** - How noise dots move:
- `'randomTeleport'`: Noise dots jump to random locations each frame
- `'randomWalk'`: Noise dots move in a new random direction each frame
- `'randomDirection'`: Each noise dot has its own consistent random direction (default)

**`reassignEveryMs`** - How often dot roles are reassigned:
- `undefined` (default): Each dot is permanently designated as signal (coherent/opposite) or noise
- `0`: Dots are randomly assigned to signal/noise each update
- `> 0`: Dots keep their assignment for the specified milliseconds, then get reassigned

**Timing consistency**: This parameter uses wall-clock time, independent of `updateRate` and screen refresh rate. This ensures consistent reassignment timing across all devices:
- `reassignEveryMs: 100` → reassigns every 100ms regardless of refresh rate
- Works correctly on 60Hz, 120Hz, or any screen refresh rate

| noiseMovement | reassignEveryMs | Behavior |
|---------------|-----------------|----------|
| `'randomTeleport'` | `undefined` | Fixed dots, noise jumps randomly |
| `'randomWalk'` | `undefined` | Fixed dots, noise walks randomly |
| `'randomDirection'` | `undefined` | Fixed dots, noise has consistent random direction |
| `'randomTeleport'` | `0` | Dynamic assignment every update, noise jumps randomly |
| `'randomWalk'` | `0` | Dynamic assignment every update, noise walks randomly |
| `'randomDirection'` | `0` | Dynamic assignment every update, noise has consistent random direction |
| Any | `100` | Reassign every 100 milliseconds |

## Data Returned

The component returns the following data object when the trial ends:

```typescript
{
  rt: number | null,              // Reaction time in ms (null if no response)
  response: string | null,        // Key pressed (null if no response)
  correct: boolean | null,        // Whether response was correct (null if no correctResponse specified)
  duration: number,               // Duration the trial was set to run
  direction: number,              // Direction of coherent motion
  coherence: number,              // Coherence level
  framesDisplayed: number         // Number of frames actually displayed
}
```

## Examples

### Simple Left/Right Motion Discrimination

```typescript
{
  name: 'motion_discrimination',
  type: 'RandomDotKinematogram',
  props: {
    validKeys: ['arrowleft', 'arrowright'],
    correctResponse: 'arrowright',
    duration: 2000,

    direction: 90,              // Rightward
    coherence: 0.7,             // 70% coherence
    dotCount: 150,
    dotRadius: 3,
    speed: 120,                 // Pixels per second

    apertureShape: 'circle',
    apertureWidth: 500,

    showFixation: true,
    showBorder: true,
  },
}
```

### High Difficulty Task

```typescript
{
  name: 'difficult_trial',
  type: 'RandomDotKinematogram',
  props: {
    coherence: 0.1,             // Only 10% coherent
    direction: 180,             // Downward
    duration: 3000,

    dotCount: 300,
    speed: 60,                  // Slower movement (pixels per second)

    noiseMovement: 'randomWalk',
    reassignEveryMs: 0,  // reassign every update (harder variant)
  },
}
```

### Four-Direction Choice

```typescript
{
  name: 'four_direction',
  type: 'RandomDotKinematogram',
  props: {
    validKeys: ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'],
    correctResponse: 'arrowup',

    direction: 0,               // Upward
    coherence: 0.5,
    duration: 2500,
  },
}
```

### Opposite Motion

```typescript
{
  name: 'opposite_motion',
  type: 'RandomDotKinematogram',
  props: {
    direction: 90,              // Rightward
    coherence: 0.4,             // 40% rightward
    opposite: 0.4,     // 40% leftward
    // 20% random

    validKeys: ['arrowleft', 'arrowright'],
    correctResponse: 'arrowright',
  },
}
```

### Staircasing Coherence

```typescript
// Example of varying coherence across trials
const coherenceLevels = [0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 0.95];

coherenceLevels.forEach((coh, index) => ({
  name: `rdk_${index}`,
  type: 'RandomDotKinematogram',
  props: {
    coherence: coh,
    direction: Math.random() < 0.5 ? 90 : 270,  // Random left/right
    duration: 2000,
    validKeys: ['arrowleft', 'arrowright'],
  },
}));
```

### Colored Coherent Dots

```typescript
{
  name: 'colored_coherent',
  type: 'RandomDotKinematogram',
  props: {
    direction: 90,              // Rightward
    coherence: 0.3,             // 30% coherent

    dotColor: 'white',          // Incoherent dots are white
    coherentDotColor: 'red',    // Coherent dots are red
    backgroundColor: '#1a1a1a',

    dotCount: 200,
    speed: 120,                 // Pixels per second

    validKeys: ['arrowleft', 'arrowright'],
    correctResponse: 'arrowright',
    duration: 3000,
  },
}
```

### Late Responses (Post-Stimulus)

```typescript
{
  name: 'late_response_trial',
  type: 'RandomDotKinematogram',
  props: {
    duration: 3000,               // Total response window: 3 seconds
    stimulusDuration: 1000,       // Dots visible for 1 second, then blank

    direction: 90,
    coherence: 0.7,

    validKeys: ['arrowleft', 'arrowright'],
    correctResponse: 'arrowright',

    showFixation: true,           // Fixation remains visible
  },
}
```

### Character & Emoji Dots

```typescript
{
  name: 'emoji_rdk',
  type: 'RandomDotKinematogram',
  props: {
    direction: 90,
    coherence: 0.5,

    dotCharacter: '🔴',          // Use red circle emoji instead of circles!
    dotRadius: 4,                // Controls size (font size = dotRadius * 2.5)

    backgroundColor: '#1a1a1a',

    validKeys: ['arrowleft', 'arrowright'],
    duration: 2000,
  },
}
```

**More Examples:**
```typescript
dotCharacter: '🔴'    // Red circle emoji
dotCharacter: '●'     // Filled circle character
dotCharacter: '■'     // Square
dotCharacter: '★'     // Star
dotCharacter: 'X'     // Letter X
dotCharacter: '🐝'    // Bee emoji
```

**With Coherent Colors:**
```typescript
{
  dotCharacter: '●',
  dotColor: 'white',
  coherentDotColor: 'red',  // Coherent characters will be red!
}
```