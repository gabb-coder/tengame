/**
 * Collision groups (Rapier packs them as memberships << 16 | filter): two colliders touch
 * only if each one's memberships are in the other's filter. Most things are in every group.
 */
export const REMOTE = 0x0002;
/** The parts of someone knocked limp (see player/ragdoll.ts). */
export const RAGDOLL = 0x0004;
/** Other players' walking stand-ins (see net/remotePlayers.ts). */
export const WALKER = 0x0008;
/** A car's true shape, bonnet and windshield and roof, which only limp bodies feel. */
export const CAR_SHAPE = 0x0010;

const ALL = 0xffff;
const groups = (memberships: number, filter: number) => ((memberships & ALL) << 16) | (filter & ALL);

/**
 * Limp bodies hit everything but each other (a body's own parts would fight their joints)
 * and walking players' stand-ins (they're drawn where that player's own body lies).
 */
export const RAGDOLL_GROUPS = groups(RAGDOLL, ALL & ~(RAGDOLL | WALKER));
/** Car boxes: limp bodies feel the car's true shape instead (CAR_SHAPE_GROUPS). */
export const CAR_BOX_GROUPS = groups(ALL, ALL & ~RAGDOLL);
export const REMOTE_CAR_GROUPS = groups(REMOTE, ALL & ~RAGDOLL);
export const CAR_SHAPE_GROUPS = groups(CAR_SHAPE, RAGDOLL);
export const WALKER_GROUPS = groups(WALKER, ALL);
/** For looking about through limp bodies (wheels roll over them rather than up onto them). */
export const SKIP_RAGDOLLS = groups(ALL, ALL & ~RAGDOLL);
