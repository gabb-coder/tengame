# Tengame

A browser-based 3D multiplayer driving game (up to 4 players per room).
See [PLAN.md](PLAN.md) for the roadmap.

**Current status: all 8 milestones done, plus a racing mode on ten real circuits.** Drive a car with suspension, steering, tire grip, an
automatic gearbox and engine sound around a small town of 48 houses. Get out to walk around,
open front doors and explore furnished rooms (two-story houses have stairs). Cars and people
are solid, so you can bump into your friends.

Around the town are **eight themed zones** (the town is the middle of a 3 × 3 grid, about
1.2 km across), joined by highways. Each has its own ground, weather and sky, and you see
its name as you drive in:

| Zone | Where | What's there |
|---|---|---|
| **Frostfang Tundra** (Arctic) | north-west | Snowy spruce forest, a frozen lake (slippery!), an igloo camp, a log-cabin outpost, an observatory, glaciers, reindeer and penguins, snowfall, and the northern lights at night. On foot you get cold: warm up by a campfire, indoors, in an igloo or in your car. |
| **Kingdom of Eldermoor** (Medieval) | north | A moated castle with a drawbridge, towers and a great hall with a throne; knights on guard; a timber-framed market village, a smithy, a windmill, tournament grounds, and a dragon circling the keep. |
| **Outpost Nova** (Deep Space) | north-east | An alien world with **low gravity**, craters, glowing crystals and plants, a domed base with astronauts, a starship, radio dishes, a ringed planet and an asteroid belt in the sky, and a rocket that launches every 4 minutes. |
| **Emerald Jungle** | west | Dense rainforest, a waterfall from a cliff, a river with a rope bridge, a lagoon, and an overgrown temple with a hidden chamber; parrots, butterflies and fireflies. |
| **Neon Spire** (Cyberpunk) | east | Skyscrapers with neon signs and giant screens, rain, a monorail, flying traffic, a night market, and the **Helix Tower**: drive up its spiral ramp to a deck 36 m up. |
| **Primeval Valley** (Prehistoric) | south-west | A volcano that erupts every 3 minutes, lava flows, a cave you can drive into (with cave paintings), hot springs, a giant fossil, and sauropods, a T. rex, raptors, triceratops, mammoths and pterosaurs. |
| **Valley of Empires** (Ancient) | south | The Colosseum (drive in through its gates), an aqueduct, a triumphal arch, a Greek temple, a Mayan step pyramid you can climb, the pyramids and the Sphinx, an oasis, legionaries and camels. |
| **Coral Bay** (Ocean) | south-east | A harbor with a pier, boats, a galleon and a lighthouse; under the sea, coral reefs, kelp, a shipwreck, a sunken city, sharks, rays, turtles, a whale and glowing jellyfish, and a glass tunnel road down to a domed station on the sea floor. You can drive or swim under water. |

Some zones have houses you can go into, like the town's (log cabins, half-timbered cottages,
seaside cottages, Roman villas), and campfires or braziers you can light with **E**.

### Things to do

Walk up to things and press **E**. What's there to do:

| Where | Do this |
|---|---|
| Everywhere | **Talk** to anyone you meet (knights, astronauts, the mayor...): they stop, turn to you, and give tips. **Sit** on benches, thrones, feast tables, stands, swings and logs by the fire. **Dance** with **G**. |
| Tengame Town | Light the **fireworks** in Town Park (everyone sees the show), play on the swings, wait at the bus stop, and find the penny in the fountain. |
| Kingdom of Eldermoor | Ring the **bell** on the market square. Climb into the **trebuchet** and get thrown over the castle walls. Sit on the throne. Watch the dragon breathe fire. Fish in the moat. |
| Frostfang Tundra | Ride a **dog sled** round the frozen lake. Fire the **signal flare** at the outpost (it lights up the night). Go ice fishing by the red hut. |
| Outpost Nova | Borrow a **jetpack** from the rack by the habitat and fly (hold **Space**; it refuels when you land). |
| Emerald Jungle | Strike the **gong** on top of the temple, then ride the **zipline** from there down to the lagoon. Fish in the lagoon. |
| Neon Spire | Take a **lift** up to a monorail station and ride the **monorail** round the city. Step on the neon **bounce pad** to land on the Skypark roof. Light **fireworks** on top of the Helix. |
| Primeval Valley | **Climb onto a Brachiosaurus** and ride it. Stand on a **geyser** when it blows. Don't get too close to the **T. rex**: it chases you! |
| Valley of Empires | Ride in the **chariot race** in the Colosseum (board at the west end), or **ride a camel** with the caravan. Fish at the oasis. |
| Coral Bay | Ride the **glass-bottom boat** from the end of the pier (jump overboard any time). Fire yourself from the **harbor cannon** over the reef. Sound the lighthouse **foghorn**. Watch for the whale leaping. |

Rides run on a timetable shared by the whole room, so friends can ride the same train,
boat or sled. Bells, gongs, cannons, fireworks and the flare are heard and seen by everyone.

**Relics**: 43 treasures are hidden around the world (three in town, five in every zone):
glowing things you pick up by walking or driving into them. **Fishing**: five fishing spots,
each with its own fish, from common to legendary; strike when the float bobs. Press **J** to
open your **journal**: the relics you've found, riddles for the rest, and the fish you've
caught. Both are remembered in your browser.

**Crashes**: the car is a real physical body, and so is what it hits.
- **Things**: it knocks flying the street lamps (they topple and go dark), fire hydrants
  (they gush water), mailboxes, wheelie bins, picket fences and hedges. Slow down and lamps
  and hydrants stop you instead. What's smashed stays smashed for everyone in the room, and
  is put back a few minutes later.
- **People**: anyone walking about, friends included, goes limp when hit, like a real
  body ("ragdoll" physics): legs swept away, thrown onto the bonnet or over the roof,
  tumbling along the road and landing in a heap wherever they stop. After a moment they push
  themselves up onto one knee, stand, and limp off, favoring one leg. The townsfolk
  complain; friends lose health (a bar appears) and limp until it comes back. Too big a hit
  knocks them out for a few seconds. Everyone in the room sees the same person fly.
- **Animals**: small ones (penguins, reindeer, horses, camels, raptors, crabs) go limp the
  same way: legs, necks and tails flop as they're thrown and tumble, and they lie where
  they land before rolling back up onto their feet and rejoining the herd. The big
  dinosaurs and mammoths don't budge: you bounce off.
- **Your car** dents on the side that hit, and the "Car" bar under the speed goes down. A
  damaged engine smokes and loses power, smashed lights go out, and a wrecked car catches
  fire and stops. Press **T** for a new one, right where you are. Friends see your dents and
  smoke too.

Each place also sounds like itself: wind on the tundra, rain and sirens in the city, waves
and gulls at the bay, birds by day and crickets at night, insects in the jungle, the rumbling
volcano, the roar of the waterfall. (The volume is in Settings, as "Background sounds".)
Grass sways in the wind on the meadows and lawns (Medium and High graphics).

The minimap in the top-right corner turns with your view and shows streets, houses, your
friends (arrows in their colors) and your next mission target (yellow diamond). Below it is
the name of the street or house you're at. Click or tap it (or press **Tab**) to open the
big map: the whole world, north up, with every land, place and street named and everyone
on it. Drag to move around, scroll or pinch to zoom, **Find me** to jump back to yourself;
**Tab**, **Esc** or **Close** to go back to the game.

Three modes, chosen when you create a room:

- **Free roam**: explore at your own pace.
- **Missions**: the server runs one mission after another for everyone in the room, and
  keeps score:
  - *Special delivery*: pick up a package and walk it to another house's front door.
  - *Street race*: everyone lines up on a grid and races through checkpoints.
  - *Lost and found*: find an item left on a table, bed or counter inside a house.
- **Racing**: Grand Prix cars on real circuits (see [Racing](#racing) below).

In missions, a yellow arrow at the top of the screen points to your next target, and beams
of light mark targets around town. Press **Enter** to chat in any mode.

Time of day is shared by everyone in a room: a full day takes 24 minutes, with sunrise,
sunset and night (street lamps, lit windows, headlights, stars). In free roam, press **N**
to skip ahead 2 hours. The **Graphics** setting (Esc → Settings) trades looks for speed:
Low (no post-processing, no grass), Medium (glow, grass), High (glow plus ambient
occlusion, more grass). On sharp (Retina) screens, Low draws at normal resolution,
Medium at up to 1.5× and High at up to 2×. If the game stutters, try Low, and turn on
"Show frame rate (FPS)" to see how it runs.

Surfaces (asphalt, brick, siding, roof slates, grass, floors, carpet, and in the zones snow,
sand, rock, cobblestones, castle stone, thatch, marble, metal and more) use real photo-scanned
textures, and living rooms, dining rooms and bedrooms have real furniture models. They come
from [Poly Haven](https://polyhaven.com) and [ambientCG](https://ambientcg.com), are CC0
(free to use for anything, no credit needed) and live in `client/public/media`. To change
or re-download them, edit the lists at the top of `scripts/fetch-assets.mjs` and run
`npm run assets`.

The car is a concept car from the [Khronos glTF samples](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept)
by Eric Chadwick (Darmstadt Graphics Group), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), based on a CC0 model by Unity Fan.
The Khronos logos were removed from it.

The people are 24 realistic, clothed men and women from Microsoft's
[Rocketbox avatar library](https://github.com/microsoft/Microsoft-Rocketbox) (MIT license):
everyday clothes for players and passers-by, and uniforms or costumes for the townsfolk,
knights, astronauts and explorers. They move with Quaternius's
[Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html)
(CC0): `scripts/people.mjs` refits each person to that library's skeleton, so every
animation, the ragdoll and getting up work on all of them. Each person is downloaded the
first time someone in view is them (about 0.35 MB each). `npm run assets -- people` rebuilds
just them; it fetches the people itself, but itch.io doesn't allow scripted downloads, so
first download the free "[Standard]" animation zip from itch.io into `.asset-cache/humans/`
as `ual.zip`.

## Racing

Pick **Racing** in the lobby and create a room. The **Grand Prix screen** opens:
1. **Choose the Grand Prix**: each circuit's map draws itself, with a glowing car lapping
   it, beside its name, flag colours and facts (lap length, corners, how much it climbs,
   longest straight, first Grand Prix). Flick through all ten with the arrows (← →), a
   swipe, or the strip of tracks along the bottom.
2. **Race settings**: the number of laps (3, 5, 10 or 20), how many computer cars (none,
   5, 9 or 19; the grid fills up as you choose) and how good they are (Easy, Normal, Hard).
3. **Start the Grand Prix**: five red lights come on and go out, and the circuit loads.

Only the room's creator chooses; friends who join (copy the invite link from the screen)
watch the choice being made, live. They take places on the grid; computer drivers fill the
rest (up to 20 cars). The choice is remembered for next time.

Races then follow one another on that Grand Prix. To race somewhere else, the room's
creator presses **Change Grand Prix** on the results screen (or in the menu, **Esc**, while
the cars are on the grid): everyone goes back to the Grand Prix screen together, and the
new circuit loads for all.

**The circuits** are ten real Grand Prix tracks, built from their real shapes and the real
rise and fall of the ground:

| Circuit | What it's like |
|---|---|
| **Sepang**, Malaysia | Two long straights for overtaking, slow hairpins and fast sweepers, palms all round. |
| **Marina Bay**, Singapore | A night race through the city's streets under floodlights, walls close on both sides, the bay beside it. |
| **Silverstone**, Great Britain | Very fast and flowing, through the famous S-bends; open English countryside. |
| **Monza**, Italy | The "temple of speed": long straights, tight chicanes, in a park of tall trees. |
| **Spa-Francorchamps**, Belgium | Seven kilometers through the Ardennes forest, 100 m of climb, and the Eau Rouge compression at the bottom of the hill. |
| **Monaco** | The tightest and slowest: streets between apartment blocks, up the hill and down to the harbor. |
| **Suzuka**, Japan | A figure of eight: the track crosses over itself on a bridge. |
| **Interlagos**, Brazil | Anticlockwise, in a bowl: downhill into the first corner, a long climb back up. |
| **Sakhir**, Bahrain | A night race in the desert, with wide asphalt run-off and sand beyond. |
| **Spielberg**, Austria | A short lap up and down a hillside, with mountains and pine forest round it. |

Each has kerbs on the corners, gravel traps and grass (they slow you down and cost grip),
tyre walls, armco and concrete walls with catch fencing, grandstands full of spectators, a
pit building with every team's garage, the start gantry with its five red lights, the grid
boxes and the chequered line, marshal posts, advertising boards and the country round it.

**The car** is a modern Grand Prix car: 800 kg with its driver, close to 1000 hp, eight
gears, and wings that press it onto the road harder the faster it goes (nearly three times
its weight at 300 km/h). So it brakes from 300 km/h at over 5 g and corners at over 5 g in
the fast corners, but slow corners need much more care. It does 0–100 km/h in about 3 s
and tops out at about 340 km/h. Traction control and anti-lock brakes help (no wheelspin
or locked wheels), and full steering is the most the tires can take at that speed, so a
keyboard can drive it. Ten made-up teams paint the cars (no real teams or sponsors).

**A race**: everyone lines up on the grid (the host can start early with **Space**; the
lights wait for any friend still loading the circuit, up to half a minute), the five red
lights come on one a second, and when they all go out, it's on. Positions, lap
times and gaps update live in the timing tower on the left. Like real races:
- **Slipstream**: right behind another car its wake cuts your drag, so you're faster on
  the straights (a little less grip in the corners, though).
- **DRS**: from the second lap, cross a detection line within a second of the car ahead
  and you may open your rear wing (press **Q**) on the straight after it: less drag, more
  speed. It closes when you brake. The light by the speedometer shows when you can.
- When the winner takes the chequered flag, everyone else finishes as they next cross the
  line. Then the results, the fastest lap, and the next race lines up.

The computer drivers follow the fastest line round each circuit, brake for each corner,
use the slipstream and DRS, pass on whichever side has room, and leave room side by side.
One player's game drives them (it moves on to someone else's if that player leaves). If
you join mid-race, you watch until the next start.

**Racing controls**

| Key | Action |
|---|---|
| W / ↑ | Throttle |
| S / ↓, Space | Brake (hold when stopped to reverse) |
| A D / ← → | Steer |
| Q | Open the rear wing (DRS) where allowed |
| C | Chase camera / onboard camera (while watching: the next car) |
| T | Back onto the track, if you go off or spin |
| Space (on the grid) | Start the race now (the player running the race) |
| M, F, H, Enter, Esc | Mute, fullscreen, key help, chat, menu |

On a phone or tablet: the stick drives, and the buttons are Brake, DRS, Camera and Back
on track.

The circuits' shapes come from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)
(MIT license) and the heights of the ground from NASA's SRTM survey (public domain),
through [OpenTopoData](https://www.opentopodata.org). `npm run circuits` rebuilds
`client/public/media/circuits` from them (the list of circuits is in `shared/circuits.ts`).
The cars, the tracks and everything around them are made in code.

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
| T | A new car (good as new) right where you are |
| Tab | Open the big map (or click the minimap) |
| M | Mute sound |
| N | Skip 2 hours (free roam) |
| F | Fullscreen |
| H | Hide/show the key help |
| Enter | Chat |
| Esc | Menu: resume, settings, leave the room |

**On foot**

| Key | Action |
|---|---|
| W A S D | Walk |
| Shift | Run |
| Space | Jump (under water: swim up) |
| Mouse / arrows | Look around (click the game to capture the mouse; Esc releases it) |
| E | Whatever you're looking at: get in the car, open/close a door, sit on a sofa, chair or bed, turn a TV, floor lamp or stove on/off, light or put out a campfire |
| E or move | Stand up |
| R (sitting) | TV remote: turn the nearest TV on/off |

M, N, F, H, Enter and Esc work on foot too. Switched-on TVs, lamps, stoves and fires, and
who's sitting where, are shared with everyone in the room.

**On a phone or tablet** the game shows on-screen controls instead (computers never do):

| Control | Action |
|---|---|
| Stick (left thumb, anywhere on the left) | Drive: up is the gas, down brakes and reverses, sideways steers. On foot: walk as fast as you push it; all the way out runs |
| Drag anywhere else | Look around |
| Brake / Jump (big button, right) | Handbrake; jump (hold it with a jetpack to fly) |
| Get out, New car, Flip | E, T and R from the keyboard |
| Use, Dance | E (shows when something's in reach) and G |
| The prompt, e.g. **Open door** | Tap it to do it |
| Chat, Journal, Sound, Full screen, +2 h | Under the menu button and by the clock |

Phones and tablets start on the Low graphics setting; turn it up in Menu → Settings if
yours is fast. The game plays best with the phone sideways.

**Settings** (Esc → Settings, remembered in your browser): volume, mouse sensitivity (look
sensitivity on a phone), invert mouse, graphics quality, field of view, km/h or mph, and showing the minimap, key help,
player names and frame rate. **Leave room** in the same menu goes back to the title screen.

`npm run dev` starts the game server on port 8080 and the Vite dev server on 5173
(which proxies `/ws` to the game server).

## Other commands

```sh
npm test          # car handling, walking, touch controls, town/zone/floor-plan, relics, missions, racing
                  # (computer drivers lapping real circuits, a 12-car race) and server tests
npm run typecheck # client + server
npm run build     # build client into client/dist (plus compressed copies)
npm start         # serve client/dist + WebSocket server on $PORT (default 8080)
```

## Project layout

```
client/   Three.js + Rapier game (Vite); client/src/race/ is the racing mode
server/   Node WebSocket room server; also serves the built client and referees races
shared/   Message types, the town and zone layouts, the shape of the ground, house floor
          plans, the circuits and the racing rules, shared by client and server
          (shared/zones/ has one file per zone)
```

## Put it online with Render

This gives you a link like `https://tengame.onrender.com` that friends can open from
anywhere, on Render's free plan. `render.yaml` holds the settings.

1. **Make a Render account** at https://render.com (sign in with GitHub).
2. **New → Blueprint**, pick this repository and click **Apply**. Render builds the game
   from the `Dockerfile` as one free web service in Singapore, from the branch named in
   `render.yaml`.
3. **Play:** when the build finishes (a few minutes), open the link Render shows, create a
   room and click **Copy invite link** to send it to friends.

**Updating later:** nothing to do: every new commit on that branch goes up by itself.
Deploying restarts the server, which ends any games in progress.

**Good to know:** a free service falls asleep after 15 minutes with nobody playing; the
next person to open the link waits about a minute while it wakes up. Rooms live in the
server's memory, so keep it to one instance. The service's **Logs** tab in the Render
dashboard shows the server's output if something goes wrong.

## Or with Fly.io

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
