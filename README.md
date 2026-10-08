# Tengame

A browser-based 3D multiplayer driving game (up to 4 players per room).
See [PLAN.md](PLAN.md) for the roadmap.

**Current status: milestone 7.** Drive a car with suspension, steering, tire grip, an
automatic gearbox and engine sound around a small town of 48 houses. Get out to walk around,
open front doors and explore furnished rooms (two-story houses have stairs).

Two modes, chosen when you create a room:

- **Free roam**: explore at your own pace.
- **Missions**: the server runs one mission after another for everyone in the room, and
  keeps score:
  - *Special delivery*: pick up a package and walk it to another house's front door.
  - *Street race*: everyone lines up on a grid and races through checkpoints.
  - *Lost and found*: find an item left on a table, bed or counter inside a house.

A yellow arrow at the top of the screen points to your next target, and beams of light
mark targets around town. Press **Enter** to chat in either mode.

Time of day is shared by everyone in a room: a full day takes 24 minutes, with sunrise,
sunset and night (street lamps, lit windows, headlights, stars). In free roam, press **N**
to skip ahead 2 hours. The **Graphics** menu in the top-left panel trades looks for speed:
Low (no post-processing), Medium (glow), High (glow plus ambient occlusion).

## Run locally

Requires Node.js 22+.

```sh
npm install
npm run dev
```

Open http://localhost:5173, create a room, then open the same URL in a second tab
(or click **Copy invite link**) to join as another player.

**Driving**

| Key | Action |
|---|---|
| W / ↑ | Accelerate |
| S / ↓ | Brake; hold when stopped to reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| E | Get out (when nearly stopped) |
| R | Flip the car upright where it is |
| T | Respawn at your starting spot |
| M | Mute sound |
| N | Skip 2 hours (free roam) |
| Enter | Chat |

**On foot**

| Key | Action |
|---|---|
| W A S D | Walk |
| Shift | Run |
| Space | Jump |
| Mouse / arrows | Look around (click the game to capture the mouse; Esc releases it) |
| E | Get in the car, or open/close a door |

`npm run dev` starts the game server on port 8080 and the Vite dev server on 5173
(which proxies `/ws` to the game server).

## Other commands

```sh
npm test          # car handling, walking, town/floor-plan, missions and server tests
npm run typecheck # client + server
npm run build     # build client into client/dist
npm start         # serve client/dist + WebSocket server on $PORT (default 8080)
```

## Project layout

```
client/   Three.js + Rapier game (Vite)
server/   Node WebSocket room server; also serves the built client
shared/   Message types, the town layout and house floor plans, shared by client and server
```

## Deploy to Fly.io

Rooms live in server memory, so the app must run on **exactly one machine**.

```sh
fly auth login
# Edit `app` in fly.toml to a unique name, and `primary_region` to the one closest to you.
fly launch --no-deploy --copy-config   # first time only
fly deploy --ha=false
```

Your game is then at `https://<app>.fly.dev`. Share the invite link from the HUD with friends.
