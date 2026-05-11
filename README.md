# Focus

A lightweight system-tray app that keeps your screen awake and alerts you when something changes while you're away.

## What it does

When enabled, Focus does two things simultaneously:

1. **Wake Lock** — prevents the display from sleeping and the system from hibernating.
2. **Screen Monitoring** — after a configurable period of mouse inactivity, takes periodic screen snapshots and plays an OS notification sound whenever a meaningful visual change is detected (e.g. a new notification, a message window opening). The alarm repeats until you move the mouse.

The app always starts in the **Active** state. One click in the system tray turns everything on or off.

## Remote notifications (PWA)

Focus can push alerts to your phone via a companion PWA at `https://focus-server-three.vercel.app/mobile`.

- Open the PWA in Safari (iOS) or Chrome (Android/desktop) and add it to your Home Screen
- Enable push notifications when prompted
- In the desktop app: enable **Remote (push to mobile)** and click **Pair Device**
- Scan the QR code with the PWA's scanner or enter the code manually

When a change is detected, all paired devices receive a push notification. When you return to your desk (mouse movement), the notification list on paired devices is cleared automatically.

## Configuration

All settings are accessible from the system tray → Settings:

| Setting | Default | Description |
|---|---|---|
| Inactivity threshold | 30 s | Time without mouse movement before scanning begins |
| Snapshot interval | 5 s | How often the screen is captured |
| Change sensitivity | 0.1 % | Minimum percentage of screen chunks that must change to trigger an alarm |
| Alarm interval | 60 s | How often the alarm sound repeats while inactive |

### Watch areas

Click **+ Add Watch Area** to draw a rectangle on any connected display. Only pixels within that area are checked for changes. Multiple watch areas can be defined across different displays. Displays without a watch area are ignored when any area is configured.

## States

| State | Description |
|---|---|
| OFF | App disabled, no wake lock, no monitoring |
| Active | Wake lock on, user is moving the mouse |
| Monitoring | Wake lock on, user inactive, scanning in progress |
| Alarm | Change detected, alarm firing at configured interval |

## Tech stack

- [Electron](https://www.electronjs.org/) + TypeScript — desktop app
- React — configuration window
- Next.js — server + PWA (hosted on Vercel)
- Neon (Postgres) — pairing and subscription storage

## Requirements

- macOS or Windows
- On macOS: Screen Recording permission (prompted on first use — no admin required)

## Development

```bash
# Install all dependencies (desktop + server)
npm install

# Desktop (Electron)
cd desktop && npm run dev

# Server (Next.js)
cd server && npm run dev
```

```bash
# Desktop
cd desktop
npm run build        # production build
npm run test         # unit tests
npm run typecheck    # TypeScript type checking
```

## Releases

Binaries for macOS (Apple Silicon + Intel) and Windows are published automatically to [GitHub Releases](https://github.com/fdias1/focus/releases) when a version tag is pushed:

```bash
git tag v0.2.0 && git push origin v0.2.0
```
