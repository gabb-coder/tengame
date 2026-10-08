# Tengame

A browser-based 3D multiplayer driving game (up to 4 players per room).
See [PLAN.md](PLAN.md) for the roadmap.

**Current status: milestone 5.** You drive a car with suspension, steering, tire grip,
an automatic 6-speed gearbox, and synthesized engine and tire sounds around a small town:
a 3×3 grid of blocks with named streets, 48 houses, sidewalks, street lamps, trees, and a
stunt park with ramps in the middle. Get out of the car to walk around, open front doors
and go inside: every house has a furnished living room, kitchen, bedroom(s) and bathroom,
real windows, and two-story houses have stairs to an upper floor. Friends who join your room appear as their own
cars or characters, and doors they open open for you too.

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
npm test          # car handling, walking, town and floor-plan, and server tests
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
