# THE GAME — Detective Desk sequence

Second cinematic sequence after the phone-call intro: darkness → table reveal →
five case files slam onto the desk → hover → open (cover swings over the fold,
four Polaroids settle) → close and return. Animation only, no game UI.

```
npm install
npm run dev        # http://localhost:5173  (dev panel: H toggles, T runs the stress test)
```

Stack: Three.js 0.169 + GSAP 3.12 (vanilla ES modules; no framework required).
All textures are generated on canvas at load and all sound is synthesised with
Web Audio, so there are no external assets or licences to track.

## Public API (`src/DetectiveDeskScene.js`)

```js
import { DetectiveDeskScene } from './src/DetectiveDeskScene.js';
const desk = new DetectiveDeskScene(containerEl);
await desk.init();
await desk.unlockAudio();          // call inside a user gesture
desk.playIntro();                  // full hand-off from the phone-call intro
desk.playFolderEntrance();         // replay just the slam
desk.openFolder(3);  desk.closeFolder();  desk.resetDesk();
const off = desk.onFolderOpened((id) => { /* mount the case UI here */ });
desk.onStateChange((next, prev, ctx) => {});
desk.onFolderDrop((kind, caseId) => {});           // 'launch' | 'land' during the slam
desk.onPolaroidHover((caseId, photoIndex) => {});   // photoIndex null when the pointer leaves
desk.onPolaroidSelect((caseId, photoIndex) => {});  // click on a photo: hook for puzzle levels
// new DetectiveDeskScene(el, { backButton: false }) hides the built-in "Case files" back button
desk.setReducedMotion(true); desk.setMuted(true); desk.dispose();
```

## Files

| Module | Role |
|---|---|
| `config.js` | dimensions, deterministic rest layout, per-folder throw params, timings |
| `core/AnimationStateManager.js` | the 9 states + legal-transition table |
| `core/CameraDirector.js` | aspect-aware desk/open/intro poses, idle drift, impact shake |
| `core/CinematicAudioController.js` | synthesised impact / slide / settle / cover / photo foley |
| `scene/DeskEnvironment.js` | walnut table, desk lamp (VSM soft shadows), reading light, lamp-lit dust |
| `scene/CaseFolder.js` | folder geometry; cover is CPU-deformed (hinge arc + flex + corner curl) |
| `scene/PolaroidEvidence.js` | the four photos and their settle |
| `scene/PostFX.js` | depth of field, grain, vignette, fade-from-black, ACES |
| `sequences/FolderDropSequence.js` | the slam (authored physics: gravity, corner contact, friction slide) |
| `sequences/FolderHoverController.js` | raycast hover / click, drift-proof tweens |
| `sequences/FolderOpenSequence.js` | select → open, close → return timelines |
| `ui/BackButton.js` | paper-label "Case files" back button, shown only while a file is open |
| `main.js` + `index.html` | dev preview harness only |

## Using it from React Three Fiber later

The scene owns its renderer today. To move it into an R3F `<Canvas>`, keep the
modules as-is and pass R3F's `gl`, `scene` and `camera` into
`DeskEnvironment`, `CaseFolder`, `CameraDirector`, then call each `update()` from
`useFrame`. The sequences only touch `folder.pose`, `folder.cover`,
`env.levels`, and the camera director, so they port unchanged.

## Integrating with the intro

If the intro project already has a table/lamp, swap `DeskEnvironment.buildTable()`
and `buildLights()` for those (keep the `lamp`, `lampTarget`, `readingLight`
fields). The intro should end on black; `playIntro()` starts from black.
