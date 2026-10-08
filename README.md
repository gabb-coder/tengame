# Tengame

A browser-based 3D multiplayer driving game (up to 4 players per room).
See [PLAN.md](PLAN.md) for the roadmap.

**Current status: all 8 milestones done.** Drive a car with suspension, steering, tire grip, an
automatic gearbox and engine sound around a small town of 48 houses. Get out to walk around,
open front doors and explore furnished rooms (two-story houses have stairs). Cars and people
are solid, so you can bump into your friends.

The minimap in the top-right corner turns with your view and shows streets, houses, your
friends (arrows in their colors) and your next mission target (yellow diamond). Below it is
the name of the street or house you're at.

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

Surfaces (asphalt, brick, siding, roof slates, grass, floors, carpet) use real photo-scanned
textures, and living rooms, dining rooms and bedrooms have real furniture models. They come
from [Poly Haven](https://polyhaven.com) and [ambientCG](https://ambientcg.com), are CC0
(free to use for anything, no credit needed) and live in `client/public/media`. To change
or re-download them, edit the lists at the top of `scripts/fetch-assets.mjs` and run
`npm run assets`.

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
| F | Fullscreen |
| H | Hide/show the key help |
| Enter | Chat |

**On foot**

| Key | Action |
|---|---|
| W A S D | Walk |
| Shift | Run |
| Space | Jump |
| Mouse / arrows | Look around (click the game to capture the mouse; Esc releases it) |
| E | Get in the car, or open/close a door |

M, N, F, H and Enter work on foot too.

`npm run dev` starts the game server on port 8080 and the Vite dev server on 5173
(which proxies `/ws` to the game server).

## Other commands

```sh
npm test          # car handling, walking, town/floor-plan, missions and server tests
npm run typecheck # client + server
npm run build     # build client into client/dist (plus compressed copies)
npm start         # serve client/dist + WebSocket server on $PORT (default 8080)
```

## Project layout

```
client/   Three.js + Rapier game (Vite)
server/   Node WebSocket room server; also serves the built client
shared/   Message types, the town layout and house floor plans, shared by client and server
```

## Put it online with Fly.io

This gives you a link like `https://tengame-yourname.fly.dev` that friends can open from
anywhere. You run these steps once, on your own computer, in a terminal opened in the
`tengame` folder. No Docker needed: Fly builds the game on its own servers.

1. **Make a Fly.io account** at https://fly.io (it may ask for a card; one small
   always-on machine costs a few dollars a month, see https://fly.io/pricing).
2. **Install the `fly` command:**
   - macOS: `brew install flyctl` (or `curl -L https://fly.io/install.sh | sh`)
   - Linux: `curl -L https://fly.io/install.sh | sh`
   - Windows (PowerShell): `iwr https://fly.io/install.ps1 -useb | iex`

   Then close and reopen the terminal so it finds `fly`.
3. **Log in:** `fly auth login` (opens your browser).
4. **Pick a name** for your game. It becomes part of the link, so it must be unique on
   Fly, e.g. `tengame-gabriel`. Open `fly.toml` and change the first line to it:
   `app = "tengame-gabriel"`. The line below, `primary_region = "sin"`, puts the server in
   Singapore; if you and your friends are elsewhere, run `fly platform regions` and use the
   code of the closest city.
5. **Create the app:** `fly apps create tengame-gabriel` (your name from step 4).
6. **Deploy:** `fly deploy --ha=false`

   This takes a few minutes the first time. `--ha=false` keeps it to **one** machine,
   which the game needs: rooms live in that machine's memory, so with two machines
   friends could land on different ones and not find each other's room.
7. **Play:** open `https://tengame-gabriel.fly.dev`, create a room and click
   **Copy invite link** to send it to friends.

**Updating later:** after `git pull`, run `fly deploy --ha=false` again. Deploying restarts
the server, which ends any games in progress.

**If something goes wrong:** `fly logs` shows the server's output, and `fly status` shows
whether the machine is running.
