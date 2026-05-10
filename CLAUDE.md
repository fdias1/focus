# Focus — Project Guidelines

## Overview

Focus is an Electron + TypeScript system-tray application. It prevents screen sleep and monitors for visual changes when the user is inactive. See [issue #1](https://github.com/fdias1/focus/issues/1) for the full PRD.

## Tech stack

- **Runtime:** Electron (latest stable)
- **Language:** TypeScript (strict mode)
- **UI:** React (configuration window only)
- **Testing:** Vitest
- **Linting:** ESLint + Prettier
- **Build:** electron-builder (targets: macOS, Windows)

Use Python only if a specific feature is proven infeasible in Electron/TypeScript.

## Architecture

The app is split into the Electron main process and a renderer process. All business logic lives in the main process. The renderer is only used for the configuration window.

### Modules (main process)

```
WakeLockManager      — wraps Electron powerSaveBlocker (prevent-display-sleep + prevent-app-suspension)
InactivityDetector   — polls mouse position via screen.getCursorScreenPoint(); emits active/inactive events
ScreenScanner        — captures snapshots via desktopCapturer; crops tray region before emitting frames
ChangeDetector       — pure function: compares two pixel buffers, returns true if diff% exceeds threshold
AlarmManager         — plays OS notification sound; repeats at configurable interval; stops on reset()
StateManager         — central state machine (OFF → ACTIVE → MONITORING → ALARM); wires all modules
TrayManager          — system tray icon (state-aware) + context menu
ConfigStore          — persists user config via electron-store; validates and clamps all values
```

### State machine

```
OFF ──(toggle on)──► ACTIVE ──(inactivity threshold)──► MONITORING ──(change detected)──► ALARM
 ▲                      ▲                                     │                              │
 └──(toggle off)─────────┴────────────(mouse moved)───────────┴──────────────────────────────┘
```

### Config schema

All time values are stored internally in **seconds**.

```typescript
{
  inactivityThreshold: number  // default: 30
  snapshotInterval:    number  // default: 5
  changeSensitivity:   number  // default: 10  (percentage 0–100)
  alarmInterval:       number  // default: 60
}
```

## Key constraints

- **No admin/root permissions.** Every feature must work with standard user permissions. Screen Recording on macOS is a user-granted permission (not admin) — request it via `systemPreferences.askForMediaAccess` on first use.
- **No video recording.** ScreenScanner takes snapshots only; frames are never written to disk.
- **Tray region exclusion.** ChangeDetector must never fire on changes in the system tray area (clock, etc.). The exclusion region is computed at runtime based on platform and screen resolution.
- **App always starts in OFF state.** Do not persist the last on/off state.

## Testing

Use **Vitest** for all unit and integration tests. Run with `npm run test`.

### What to test

- `ChangeDetector` — pure function; test all threshold boundary cases and tray-region exclusion.
- `InactivityDetector` — mock `getCursorScreenPoint` and use fake timers; verify event emission.
- `AlarmManager` — verify repeat cadence and stop behavior.
- `StateManager` — integration test all state transitions; mock all sub-modules.
- `ConfigStore` — defaults, persistence round-trip, out-of-range clamping.
- `WakeLockManager` — verify correct `powerSaveBlocker` arguments.

`ScreenScanner` and `TrayManager` are covered by manual QA only (Electron API surface).

### Test rules

- Test external behavior and emitted events — never internal state or private methods.
- Use realistic inputs (real pixel buffers for ChangeDetector, real event shapes).
- Fake timers for anything time-dependent.

## Code style

- Strict TypeScript (`"strict": true`). No `any`.
- All inter-module communication through typed events (Node `EventEmitter` subclasses or a small typed bus).
- No direct cross-module references — modules communicate only through StateManager or events.
- Comments only when the WHY is non-obvious. No docblocks, no "this function does X" comments.
- All config values validated and clamped in `ConfigStore` before use anywhere else.

## IPC (main ↔ renderer)

Use typed IPC channels (contextBridge + ipcRenderer/ipcMain). Define all channel names and payload types in a shared `ipc-types.ts` file. Never expose Node APIs directly to the renderer.

## Future extension point

`AlarmManager` must expose a `notifiers` plugin slot for future remote notification support (mobile companion app). The interface should accept an array of notifier objects implementing `notify(): void`. The OS sound notifier is the default implementation.
