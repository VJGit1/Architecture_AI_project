// src/shopper/roomGeometry.js
// Plain room geometry shared by the planner and the fit checks. Meters throughout.
// Wall keys match db.createRoom: back (-z, north), front (+z, south), left (-x, west), right (+x, east).

const { COMPASS_WALL } = require('./session');

const WALL_FACE = 0.1;         // half of the 0.2 m wall thickness; interior face of each wall
const WALL_GAP = 0.02;         // gap between a wall-backed piece and the wall face
const SIDE_CLEARANCE = 0.2;    // free wall needed at each end of a wall-backed piece
const SEAT_TABLE_GAP = 0.4;    // sofa front to coffee table edge
const WALKWAY_TV = 0.45;       // coffee table edge to media unit front
const WALKWAY_OPEN = 0.6;      // walkway in front of the table when there is no media unit
const BED_WALKWAY = 0.6;

const WALL_ORDER = ['left', 'back', 'right', 'front'];
const OPPOSITE = { back: 'front', front: 'back', left: 'right', right: 'left' };

const WALL_BACKED_ROLES = new Set(['sofa', 'sectional', 'media', 'bed']);

function wallLengths(brief) {
  return { back: brief.width, front: brief.width, left: brief.length, right: brief.length };
}

// Distance from a wall to the one opposite it.
function crossDepth(brief, wall) {
  return wall === 'left' || wall === 'right' ? brief.width : brief.length;
}

function doorWalls(brief) {
  const wall = COMPASS_WALL[brief.doorWall] || 'front';
  return [wall];
}

function longestWall(brief) {
  const lengths = wallLengths(brief);
  return WALL_ORDER.slice().sort((a, b) => lengths[b] - lengths[a])[0];
}

/**
 * The seat (or bed) goes on the longest wall without a door. The media unit goes on the
 * longest remaining door-free wall, or opposite the seat when a facing constraint is set.
 */
function chooseWalls(brief, { facing = false } = {}) {
  const lengths = wallLengths(brief);
  const doors = new Set(doorWalls(brief));
  const rank = (a, b) => (doors.has(a) - doors.has(b)) || (lengths[b] - lengths[a]) || (WALL_ORDER.indexOf(a) - WALL_ORDER.indexOf(b));
  const seatWall = WALL_ORDER.slice().sort(rank)[0];

  let mediaWall;
  if (facing) {
    mediaWall = OPPOSITE[seatWall];
  } else {
    mediaWall = WALL_ORDER.filter(w => w !== seatWall).sort(rank)[0];
  }

  return { seatWall, mediaWall, lengths, doorWalls: [...doors], cross: crossDepth(brief, seatWall) };
}

function usableAlongWall(length) {
  return length - 2 * SIDE_CLEARANCE;
}

// Wall-backed pieces need their width plus side clearance on the longest wall.
function fitsLongestWall(sku, brief) {
  const lengths = wallLengths(brief);
  const wall = longestWall(brief);
  const longest = lengths[wall];
  if (WALL_BACKED_ROLES.has(sku.role)) {
    return { ok: sku.width <= usableAlongWall(longest), wall, wallLength: longest, needed: sku.width + 2 * SIDE_CLEARANCE };
  }
  if (sku.role === 'rug') {
    const shortSide = Math.min(brief.width, brief.length);
    const ok = sku.width <= longest - 0.3 && sku.depth <= shortSide - 0.3;
    return { ok, wall, wallLength: longest, needed: sku.width + 0.3 };
  }
  const ok = Math.max(sku.width, sku.depth) <= Math.min(brief.width, brief.length) - 2 * WALL_FACE;
  return { ok, wall, wallLength: longest, needed: Math.max(sku.width, sku.depth) };
}

// Space across the room from the seat wall: seat, gap, table, walkway, media.
function depthStack(brief, seatWall, { seat = null, table = null, media = null, bed = null } = {}) {
  const available = crossDepth(brief, seatWall) - 2 * (WALL_FACE + WALL_GAP);
  let need;
  if (brief.roomType === 'bedroom') {
    need = (bed ? bed.depth : 0) + BED_WALKWAY + (media ? media.depth : 0);
  } else {
    need = (seat ? seat.depth : 0) + SEAT_TABLE_GAP + (table ? table.depth : 0)
      + (media ? WALKWAY_TV + media.depth : WALKWAY_OPEN);
  }
  return { ok: need <= available + 1e-6, need: Number(need.toFixed(2)), available: Number(available.toFixed(2)) };
}

module.exports = {
  WALL_FACE,
  WALL_GAP,
  SIDE_CLEARANCE,
  SEAT_TABLE_GAP,
  WALKWAY_TV,
  WALKWAY_OPEN,
  OPPOSITE,
  WALL_BACKED_ROLES,
  usableAlongWall,
  wallLengths,
  crossDepth,
  doorWalls,
  longestWall,
  chooseWalls,
  fitsLongestWall,
  depthStack
};
