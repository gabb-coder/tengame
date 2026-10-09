// The shared wall clock that timed things run on (rides, eruptions, rocket launches), so
// they're in the same place on everyone's screen even if their computers' clocks disagree.

/** Server time minus ours, in ms; 0 until we've joined a room. */
let offset = 0;

/** Lines our clock up with the server's, from the time it sent in its welcome. */
export function syncClock(serverNow: number): void {
  offset = serverNow - Date.now();
}

/** Seconds on the shared clock. */
export function worldSeconds(): number {
  return (Date.now() + offset) / 1000;
}
