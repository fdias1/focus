# Focus

A lightweight system-tray app that keeps your screen awake and alerts you when something changes while you're away.

## What it does

When enabled, Focus does two things simultaneously:

1. **Wake Lock** — prevents the display from sleeping and the system from hibernating.
2. **Screen Monitoring** — after a configurable period of mouse inactivity, takes periodic screen snapshots and plays an OS notification sound whenever a meaningful visual change is detected (e.g. a new notification, a message window opening). The alarm repeats until you move the mouse.

The app always starts in the **OFF** state. One click in the system tray turns everything on or off.

## Configuration

All settings are accessible from the system tray → Settings:

| Setting | Default | Description |
|---|---|---|
| Inactivity threshold | 30 s | Time without mouse movement before scanning begins |
| Snapshot interval | 5 s | How often the screen is captured |
| Change sensitivity | 10 % | Minimum screen area that must change to trigger an alarm |
| Alarm interval | 60 s | How often the alarm sound repeats while inactive |

## States

| State | Description |
|---|---|
| OFF | App disabled, no wake lock, no monitoring |
| Active | Wake lock on, user is moving the mouse |
| Monitoring | Wake lock on, user inactive, scanning in progress |
| Alarm | Change detected, alarm firing at configured interval |

## Tech stack

- [Electron](https://www.electronjs.org/) + TypeScript
- React (configuration window)

## Requirements

- macOS or Windows
- On macOS: Screen Recording permission (prompted on first use — no admin required)

## Development

```bash
npm install
npm run dev
```

```bash
npm run build        # production build
npm run test         # unit tests
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
```

## Roadmap

- [ ] Mobile companion app with remote push notifications
- [ ] Multiple monitor support
- [ ] Scheduled monitoring windows
