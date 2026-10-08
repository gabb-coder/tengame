# Tengame – Project Plan

A browser-based 3D driving game with enterable, fully furnished houses.
Realistic art style, up to 4 players per room, two modes (free-roam and missions).

## Decisions

| Topic | Decision |
|---|---|
| Platform | Browser (desktop) |
| Art style | Realistic (PBR, HDR lighting, baked interior lightmaps) |
| Modes | Free-roam sandbox + missions (same world, mission manager on/off) |
| Multiplayer | Up to 4 players per room, join by room code/link |
| Interiors | Fully furnished, explorable rooms |
| Chat | Text only |
| Hosting | Fly.io (server + static client) |
| Assets | None yet – placeholders first, swap in CC0/purchased packs later |

## Stack

- **Client:** Three.js + TypeScript + Vite, Rapier physics (WASM)
- **Server:** Node.js + WebSocket rooms (Colyseus or plain `ws`)
- **Deploy:** Docker image on Fly.io, serving both the built client and the WebSocket server

## Networking model

- Server owns room state: players, door states, mission progress, chat.
- v1 car physics is simulated on each client; position/velocity are sent to the server
  and relayed to others, who interpolate. (Friends-only, so cheating is not a concern.)
- Interactions (doors, enter/exit car, mission triggers) are validated by the server.
- Room: max 4 players, one mode per room, host picks mode.

## Game modes

- **Free-roam:** open town, no objectives. Car picker, respawn, time-of-day control.
- **Missions:** server-side mission manager. Starter types: delivery to a house address,
  timed checkpoint race, fetch an item inside a house. Co-op or competitive scoring.

## Realism constraints (browser)

- Compressed glTF (Draco + KTX2), PBR materials, HDR sky, soft shadows, SSAO, tone mapping.
- Baked lightmaps for interiors; dynamic lighting only outdoors.
- Stream houses/furniture by distance (LOD + culling).
- Target 60 fps on a mid-range laptop; ~20–40 enterable houses, not a huge city.

## Milestones

1. **Scaffold** – Vite + Three.js + Rapier, Node WS server, two tabs see each other as boxes.
2. **Driving** – car physics, chase camera, engine audio, remote cars synced.
3. **Town** – roads, house shells with collision, streaming/LOD.
4. **Enter/exit** – car ⇄ on-foot, walking controller, door interaction, synced door state.
5. **Interiors** – modular room system, 2 furnished house layouts (living room, kitchen, bedroom, bathroom).
6. **Missions** – mission manager, 3 starter mission types, lobby with mode selector, text chat.
7. **Realism pass** – PBR assets, baked lighting, HDR sky, day/night cycle.
8. **Polish & deploy** – HUD, minimap, Fly.io deployment, shareable link.

## Proposed layout

```
client/
  src/
    main.ts          # bootstrap, game loop
    world/           # town, roads, houses, interiors
    vehicles/        # car physics + controls
    player/          # on-foot controller, interaction
    camera/          # chase / first-person rigs
    net/             # client networking, interpolation
    ui/              # HUD, chat, lobby
  public/assets/     # models, textures, audio
server/
  src/
    index.ts         # HTTP + WS entry
    rooms/           # room state, mission manager, chat
Dockerfile
fly.toml
```

## Open items

- Assets: confirm whether the build environment can download CC0 packs
  (Poly Haven, Quaternius, Sketchfab CC0); otherwise use placeholders until the user supplies assets.
- Fly.io: deploying needs the user's Fly account (`flyctl auth login` or an API token);
  Dockerfile/`fly.toml` can be prepared in advance.
