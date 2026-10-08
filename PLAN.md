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

1. ✅ **Scaffold** – Vite + Three.js + Rapier, Node WS server, two tabs see each other as boxes.
2. ✅ **Driving** – car physics, chase camera, engine audio, remote cars synced.
3. ✅ **Town** – roads, house shells with collision, streaming/LOD.
4. ✅ **Enter/exit** – car ⇄ on-foot, walking controller, door interaction, synced door state.
5. ✅ **Interiors** – modular room system, 2 furnished house layouts (living room, kitchen, bedroom, bathroom).
6. ✅ **Missions** – mission manager, 3 starter mission types, lobby with mode selector, text chat.
7. ✅ **Realism pass** – day/night cycle with a dynamic sky, bloom and ambient occlusion, normal-mapped materials, a new car model. (Downloadable CC0 asset sites are blocked from the build environment, so models and textures are still procedural; real glTF/texture assets can be dropped in later.)
8. ✅ **Polish & deploy** – heading-up minimap with players, mission target and street/address names; cars and people collide between players (with a crash sound); fullscreen and hide-help keys; lobby works on short screens; the server sends the client precompressed (5.1 MB → 1.4 MB) with long-term caching. Fly.io deploy steps are in the README (they need the owner's Fly account, so the deploy itself is run by the owner).

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

- Fly.io: deploying needs the user's Fly account; Dockerfile and `fly.toml` are ready
  (see README, "Put it online with Fly.io").

## Real assets

Photo-scanned textures (Poly Haven, ambientCG) replace the generated ones on roads,
sidewalks, lawns, walls, roofs, floors, carpets and furniture; real furniture models
(Poly Haven) replace sofas, armchairs, coffee and dining tables, dining chairs and
nightstands. All CC0, fetched and shrunk by `npm run assets` (WebP textures, simplified
meshopt-compressed models, ~9 MB total), and loaded in the background: the generated
versions show until they arrive, and stay if a download fails. Models are only drawn in
houses near the camera. Still generated: the car, beds, wardrobes, bookshelves, kitchens,
bathrooms, plants (Poly Haven's are too heavy) and the sky (photo skies have a fixed sun,
which would fight the day/night cycle).

## Possible next steps

- A real car model, and more real furniture (beds, kitchens, bathrooms) if good CC0 ones turn up.
- Doors inside houses (two-story houses currently have open doorways only).
- More mission types, more car choices, a bigger town.
- Server-side sanity checks on player positions (not needed among friends).
