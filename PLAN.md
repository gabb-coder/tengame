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
houses near the camera. The car is a detailed sports car (Khronos glTF sample, CC BY 4.0)
with steering, spinning wheels and working lights; people are rigged, animated characters
(Quaternius, CC0) with idle/walk/jog/sprint/jump blended by speed and painted-on clothes in
the player's color. Still generated: beds, wardrobes, bookshelves, kitchens, bathrooms,
plants (Poly Haven's are too heavy) and the sky (photo skies have a fixed sun, which would
fight the day/night cycle).

## After the plan

- Furniture you can use: sit on sofas, armchairs, chairs and beds (with a sitting animation),
  turn TVs (animated channels), floor lamps (light the room) and stoves on and off; a TV
  remote from the sofa. Switches are server-checked and shared; sitting is synced.
- Esc menu with settings (volume, mouse, invert, graphics, FOV, units, HUD toggles, FPS)
  and "Leave room" back to the title screen.

- Eight themed zones around the town (Arctic, Medieval, Deep Space, Jungle, Cyberpunk,
  Prehistoric, Ancient Empires, Ocean), joined by highways: shaped terrain (one Rapier
  heightfield for the whole world), roads that level the ground under them, water, lava and
  ice, per-zone haze, sky and weather, low gravity, swimming, Arctic warmth, animated animals
  and people, timed events (rocket launches, eruptions) in sync for everyone, zone houses and
  lightable fires (server-checked), a world minimap and zone names on arrival.

- Things to do in every zone: rides on a shared timetable (monorail with stations and
  lifts, glass-bottom boats, dog sleds, chariots, camels, a Brachiosaurus, a zipline),
  launchers (trebuchet, cannon, geysers, a bounce pad), a jetpack; shared server-checked
  buttons (bell, gong, foghorn, fireworks, flare); 43 relics, fishing and a journal; NPCs
  with names and lines; a T. rex that chases you; dancing, swimming and other animations
  synced to friends; seats everywhere; background sounds per zone; wind-blown grass; and
  more detail in the town (yards, playground, bus stops) and every zone.

## Possible next steps

- More real furniture (beds, kitchens, bathrooms) if good CC0 ones turn up.
- Show the driver sitting in the car (the animation library has a driving pose; it's
  now loaded).
- Boats and horses you steer yourself, not just ride.
- Doors inside houses (two-story houses currently have open doorways only).
- More mission types (e.g. a cross-zone rally), more car choices.
- Real CC0 models for some zone props (ships, rocks, statues) instead of shapes.
- Server-side sanity checks on player positions (not needed among friends).
