# Tengame – Project Plan

A browser-based 3D driving game with enterable, fully furnished houses.
Realistic art style, up to 4 players per room, two modes (free-roam and missions).

## Decisions

| Topic | Decision |
|---|---|
| Platform | Browser (desktop; phones and tablets with on-screen controls) |
| Art style | Realistic (PBR, HDR lighting, baked interior lightmaps) |
| Modes | Free-roam sandbox + missions (same world, mission manager on/off) |
| Multiplayer | Up to 4 players per room, join by room code/link |
| Interiors | Fully furnished, explorable rooms |
| Chat | Text only |
| Hosting | Render free plan (server + static client); Fly.io also set up |
| Assets | None yet – placeholders first, swap in CC0/purchased packs later |

## Stack

- **Client:** Three.js + TypeScript + Vite, Rapier physics (WASM)
- **Server:** Node.js + WebSocket rooms (Colyseus or plain `ws`)
- **Deploy:** Docker image on Render (`render.yaml`) or Fly.io (`fly.toml`), serving both the built client and the WebSocket server

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

- Hosting: the game runs on Render's free plan (`render.yaml`, see README, "Put it online
  with Render"); `fly.toml` still works for Fly.io.

## Real assets

Photo-scanned textures (Poly Haven, ambientCG) replace the generated ones on roads,
sidewalks, lawns, walls, roofs, floors, carpets and furniture; real furniture models
(Poly Haven) replace sofas, armchairs, coffee and dining tables, dining chairs and
nightstands. All CC0, fetched and shrunk by `npm run assets` (WebP textures, simplified
meshopt-compressed models, ~9 MB total), and loaded in the background: the generated
versions show until they arrive, and stay if a download fails. Models are only drawn in
houses near the camera. The car is a detailed sports car (Khronos glTF sample, CC BY 4.0)
with steering, spinning wheels and working lights; people are realistic, clothed Rocketbox
avatars (Microsoft, MIT) refitted to the Quaternius animation skeleton (CC0), with
idle/walk/jog/sprint/jump blended by speed. Still generated: beds, wardrobes, bookshelves, kitchens, bathrooms,
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

- Speed-up pass: shaders are all built while loading (no more freezes the first time
  something comes into view); one shared pool of 8 real lights for every lamp, fire and
  glow (a changing number of lights rebuilt every shader); physics steps no longer re-list
  every collider; name tags and speech bubbles no longer walk the whole scene; hidden
  people and far zones skip their per-frame bookkeeping; the car model and all front doors
  are drawn in a few draws instead of hundreds; small props far away aren't drawn; house
  interiors don't cast sun shadows; Medium draws at most 1.5× the screen's pixels.

- Crashes: cars knock over street lamps, hydrants (gushing), mailboxes, bins, fences and
  hedges as loose physics pieces (server-synced, repaired after 3 minutes); people and small
  animals are knocked flying, lie there and get up limping (players lose health, synced
  through the server); big animals are solid; cars dent per side, smoke, lose power and
  wreck (dents shown on friends' cars too).

- Realistic people in crashes: someone hit goes limp as a ragdoll (twelve jointed pieces
  of their own skeleton, with human joint limits and a little muscle tone), is thrown by
  the car's true shape (bonnet, windshield, roof) and comes to rest wherever physics leaves
  them; they get up from that pose onto one knee, then stand. Players knocked over are
  thrown in everyone's game, not just their own. A hurt leg now shows as a real limp
  (less time on the sore leg, a stiff knee, leaning over it) instead of the whole body
  rocking.
- Animals knocked over go limp too: each one's body, neck, head, legs and tail become
  jointed pieces (antlers, manes and beaks ride along), thrown by physics, then blended
  back up onto their feet. People and animals share one limp-body core (game/limp.ts).

## Phones and tablets

- On a phone or tablet (a finger is the main pointer; computers with touch screens don't
  count), the game shows controls for thumbs (ui/touchControls.ts): a stick that comes to
  the left thumb (drive: up gas, down brake/reverse, sideways steer; on foot: walk as fast
  as it's pushed, run at the edge), dragging anywhere else to look, round buttons by the
  right thumb (jump/handbrake, use, dance; get out, new car, flip), tools under the menu
  button (chat, journal, sound, full screen) and a +2 h button by the clock. Prompts like
  "Open door" can be tapped. All of it presses the same keys the keyboard does (Input), so
  everything works the same. Words that name keys ("Press J") name the buttons instead,
  and these devices start on Low graphics.

## Realistic people, the big map, a new car where you are

- People are 24 realistic, clothed Rocketbox avatars (Microsoft, MIT): twelve in everyday
  clothes for players and passers-by, and named ones for the characters (a suit for the
  mayor, work overalls for the smith, a safari vest for Dr. Jones, riot gear under the
  knights' armor, white suits under the astronauts' helmets). `scripts/people.mjs` refits
  each one to the animation library's skeleton: the skeleton is posed on the person (each
  bone turned along the same limb and moved to the same joint), bound there, and the
  person's own bones hand their skin weights to the matching ones. The clips' bone lengths
  are dropped, so each person keeps their own proportions and height. Each person loads
  the first time someone in view is them.
- The minimap opens into a big map (click or tap it, or Tab): the whole world north up,
  lands, places and town streets named, players and the mission target on it; drag, scroll
  or pinch, Find me, Close.
- T gives a new car right where you are (upright, same heading) instead of back at the start.

## Racing mode

- The Grand Prix screen (race/gpScreen.ts): a racing room opens with its host choosing the
  Grand Prix (an animated map of each circuit with its facts) and then its settings, which
  everyone in the room watches live (the server's 'setup' phase and race_setup drafts);
  then five red lights, and the screen stays up with the map while the circuit loads.
  Change Grand Prix (the host, on the results or in the menu on the grid) takes the room
  back to it: each game puts its circuit away (raceGame's build/teardown; the room's HUD,
  chat and controls stay) and builds the next.
- A third mode: Grand Prix racing on ten real circuits (shared/circuits.ts): Sepang, Marina
  Bay (night, streets), Silverstone, Monza, Spa, Monaco (streets), Suzuka (figure of eight
  with a bridge), Interlagos, Sakhir (night, desert) and Spielberg.
- Circuits (scripts/circuits.mjs → media/circuits/*.json): each real shape (bacinger/
  f1-circuits, MIT) through a smooth spline every 4 m, the ground's heights along it and
  around it from NASA SRTM (via OpenTopoData), smoothed and with gentle crests (a survey's
  ripples throw a car in the air at 300 km/h), a bridge where Suzuka crosses itself.
- From the shape (race/track.ts, racingLine.ts, layout.ts): projection onto the lap, the
  minimum-curvature racing line and the speed a car can carry round it (grip with
  downforce, measured acceleration, braking), the DRS zones on the longest flat-out
  straights, the grid, the pit straight, kerbs where the line touches the edge, run-off
  (wide on the outside of fast corners, never into another part of the track) and the
  grandstands.
- Built in code (race/circuit/): the track rubbered in along the line, lines, kerbs, grass,
  gravel, asphalt run-off and sand; walls with catch fencing, armco and tyre walls; pits
  with every team's garage; the start gantry and its lights; grandstands with crowds;
  marshal posts, boards, floodlights for night races; the land levelled round the track
  and blended into the real hills; woods, palms or city blocks; the sea by Monaco and
  Marina Bay. One trimesh per surface kind tells the cars what they're on.
- The car (race/f1.ts, f1Model.ts): CarPhysics with a spec per car; the F1 one has
  downforce, grip-limited brakes and traction control, a speed-dependent steering lock,
  eight gears, wider rear tires, DRS and slipstream (race/racer.ts, drs.ts), and a V6
  voice. The model is lofted in code and painted per team in the shader.
- Computer drivers (race/ai.ts): pure pursuit on the racing line, speed control to their
  skill's profile, passing on the side with room, yielding side by side into corners,
  following without rear-ending, DRS, rescue when stuck. Headless tests lap all ten
  circuits within 1% of the plan and race twelve cars (and get past a much slower one).
- The server referees (server/src/race.ts): grid (its countdown waits for the host's game, the lights for everyone's),
  five lights and a random hold, lap reports checked (the right lap, a possible time, the
  right moment), the chequered flag, results, and the next race. One player's game drives
  the computer cars and relays them; another takes over if that player leaves.
- The race screens (race/raceHud.ts): timing tower, position, laps and lap times, gaps from
  timing points every 100 m, start lights, DRS light, banners, results; a circuit
  minimap; chase and onboard cameras; watching when joining mid-race.

## Possible next steps

- More real furniture (beds, kitchens, bathrooms) if good CC0 ones turn up.
- Show the driver sitting in the car (the animation library has a driving pose; it's
  now loaded).
- Boats and horses you steer yourself, not just ride.
- Doors inside houses (two-story houses currently have open doorways only).
- More mission types (e.g. a cross-zone rally), more car choices.
- Racing: qualifying, pit stops and tyre wear, rain, a choice of the next circuit between
  races, the pit lane open to drive in.
- Real CC0 models for some zone props (ships, rocks, statues) instead of shapes.
- Server-side sanity checks on player positions (not needed among friends).
