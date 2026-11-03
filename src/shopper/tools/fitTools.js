// src/shopper/tools/fitTools.js
// place_in_room, critique_fit, and swap_sku.

const db = require('../../graph/db');
const {
  interiorEnergySolver,
  doorSwingZones,
  footprint,
  overlapArea,
  roomBounds,
  forwardOf
} = require('../../ai/interiorEnergySolver');
const {
  SLOT_LABELS,
  WALL_COMPASS,
  COMPASS_WALL,
  requiredSlots,
  slotRoles,
  requiredFeatures,
  shellKey,
  cartTotal,
  roomLabel,
  recordRefusal
} = require('../session');
const { chooseWalls, OPPOSITE, WALL_FACE } = require('../roomGeometry');
const { cartLine } = require('./catalogTools');

const usd = n => `$${Math.round(n).toLocaleString('en-US')}`;
const FACING_TOLERANCE_DEG = 25;
const DOOR_OVERLAP_EPS = 0.01;   // m², ignore grazing contact
const ITEM_OVERLAP_EPS = 0.02;   // m², ignore grazing contact
const WALL_TOLERANCE = 0.01;     // m past the interior wall face

const DEPENDENTS = {
  seat: ['coffee_table', 'rug', 'chair'],
  coffee_table: ['rug', 'chair'],
  bed: ['nightstand', 'rug', 'chair'],
  media: [],
  rug: [],
  chair: [],
  nightstand: []
};

// When two pieces collide, the more expendable one is blamed.
const EXPENDABLE = { chair: 0, rug: 1, nightstand: 2, coffee_table: 2, media: 3, seat: 4, bed: 4 };

function expandSlots(slots) {
  const out = new Set();
  const visit = s => {
    if (out.has(s)) return;
    out.add(s);
    (DEPENDENTS[s] || []).forEach(visit);
  };
  slots.forEach(visit);
  return [...out];
}

async function findRoom(roomId) {
  if (!roomId) return null;
  const state = await db.getProjectState();
  const room = (state.rooms || []).find(r => r.id === roomId);
  if (!room) return null;
  const wallIds = new Set((room.walls || []).map(w => w.id));
  const openings = (state.openings || []).filter(o => wallIds.has(o.wallId));
  return { room, openings };
}

async function buildShell(brief) {
  await db.clearAll();
  const created = await db.createRoom({
    name: brief.roomType === 'bedroom' ? 'Bedroom' : 'Living room',
    type: brief.roomType,
    width: brief.width,
    length: brief.length,
    height: 2.6,
    position: { x: 0, y: 0, z: 0 }
  });
  const doorWallKey = COMPASS_WALL[brief.doorWall] || 'front';
  const wall = created.walls.find(w => w.position === doorWallKey);
  const door = await db.createOpening({ wallId: wall.id, type: 'door', width: 0.9, height: 2.1, offsetRatio: 0.2, material: 'wood' });
  return { room: { ...created.room, walls: created.walls }, openings: [door] };
}

function describeDoors(room, openings) {
  return doorSwingZones(room, openings).map(z => ({
    id: z.doorId, x: z.x, z: z.z, width: z.width, wall: z.wall, compass: WALL_COMPASS[z.wall],
    zone: { minX: z.minX, maxX: z.maxX, minZ: z.minZ, maxZ: z.maxZ }
  }));
}

/**
 * place_in_room: run the energy solver with each SKU's catalog width, depth, and height.
 * Builds the room shell only when there is none for this brief; otherwise re-places the named slots.
 */
async function place_in_room(session, args = {}) {
  const brief = session.brief;
  const prev = session.placement;
  const facing = Boolean(args.facing || (prev && prev.facingConstraint));

  let shell = null;
  let builtShell = false;
  if (prev && prev.shellKey === shellKey(brief)) shell = await findRoom(prev.roomId);
  if (!shell) {
    shell = await buildShell(brief);
    builtShell = true;
  }
  const { room, openings } = shell;

  const planned = chooseWalls(brief, { facing });
  const seatWall = !builtShell && prev ? prev.seatWall : planned.seatWall;
  const mediaWall = facing ? OPPOSITE[seatWall] : (!builtShell && prev ? prev.mediaWall : planned.mediaWall);

  const requested = args.slots === 'all' || !args.slots || builtShell || !prev ? 'all' : expandSlots(args.slots);
  const cartSlots = session.cart.map(l => l.slot);
  const replaceSlots = requested === 'all' ? cartSlots : cartSlots.filter(s => requested.includes(s));
  const prevItems = builtShell || !prev ? [] : prev.items;

  const fixedPoses = {};
  prevItems.forEach(it => {
    if (!replaceSlots.includes(it.slot) && cartSlots.includes(it.slot)) {
      fixedPoses[it.slot] = { x: it.x, z: it.z, rotationY: it.rotationY };
    }
  });

  const specs = interiorEnergySolver.buildDeclarativeSceneGraph(room, 'catalog', '', session.cart, {
    seatWall, mediaWall, facing, fixedPoses
  });
  const optimized = interiorEnergySolver.optimizeRoomFurniture(room, specs, openings, 'catalog', { wallPad: WALL_FACE, iterations: 600 });

  // Persist: drop replaced or removed pieces, create the new ones, keep fixed ones untouched.
  const keep = new Map(prevItems.filter(it => fixedPoses[it.slot]).map(it => [it.slot, it]));
  for (const it of prevItems) {
    if (!keep.has(it.slot) && it.furnitureId) await db.deleteFurniture(it.furnitureId);
  }

  const items = [];
  for (const pose of optimized.items) {
    const line = session.cart.find(l => l.slot === pose.slot);
    if (keep.has(pose.slot)) {
      items.push(keep.get(pose.slot));
      continue;
    }
    const created = await db.createFurniture({
      roomId: room.id,
      name: line.sku.name,
      type: line.sku.role,
      width: line.sku.width,
      length: line.sku.depth,
      height: line.sku.height,
      x: pose.x,
      y: pose.y,
      z: pose.z,
      rotationY: pose.rotationY,
      material: pose.material,
      style: line.sku.style,
      skuId: line.sku.id,
      slot: pose.slot,
      collection: line.sku.collection
    });
    items.push({
      slot: pose.slot,
      skuId: line.sku.id,
      name: line.sku.name,
      role: line.sku.role,
      collection: line.sku.collection,
      width: line.sku.width,
      depth: line.sku.depth,
      height: line.sku.height,
      x: pose.x,
      z: pose.z,
      rotationY: pose.rotationY,
      furnitureId: created.id
    });
  }

  session.placementSeq = (session.placementSeq || 0) + 1;
  session.placement = {
    id: session.placementSeq,
    roomId: room.id,
    shellKey: shellKey(brief),
    cartVersion: session.cartVersion,
    seatWall,
    mediaWall: session.cart.some(l => l.slot === 'media') ? mediaWall : null,
    facingConstraint: facing,
    walls: { back: brief.width, front: brief.width, left: brief.length, right: brief.length },
    doors: describeDoors(room, openings),
    items,
    energy: { initial: optimized.telemetry.initialEnergy, final: optimized.telemetry.finalEnergy }
  };
  session.dirtySlots = [];

  const energy = `E ${optimized.telemetry.initialEnergy.toFixed(1)}→${optimized.telemetry.finalEnergy.toFixed(1)}`;
  const label = s => (SLOT_LABELS[s] || s).replace(/ /g, '_');
  const arg = (requested === 'all' ? 'all' : replaceSlots.map(label).join(',')) + (args.facing ? ' facing=media→seat' : '');
  const observation = builtShell
    ? `built ${brief.width.toFixed(2)}×${brief.length.toFixed(2)} m room, placed ${items.length}, ${energy}`
    : `re-placed ${replaceSlots.length}, kept ${Object.keys(fixedPoses).length} fixed, ${energy}`;

  return { ok: true, arg, observation, traceExtra: { builtShell } };
}

function anchorLine(session) {
  return session.cart.find(l => l.slot === 'seat') || session.cart.find(l => l.slot === 'bed') || null;
}

function angleBetweenDeg(a, b) {
  const dot = a.x * b.x + a.z * b.z;
  const mag = Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
}

/**
 * critique_fit: price <= budget, required roles present, no piece in a door swing (and every
 * piece inside the walls without overlap), and the sofa facing the media unit when there is a TV.
 */
async function critique_fit(session) {
  const brief = session.brief;
  const placement = session.placement;
  const label = roomLabel(brief);
  const failures = [];
  const checks = {};

  const total = cartTotal(session);
  checks.budget = { pass: total <= brief.budget, detail: `${usd(total)} of ${usd(brief.budget)}` };
  if (!checks.budget.pass) {
    const priciest = session.cart.slice().sort((a, b) => b.sku.price - a.sku.price)[0];
    failures.push({
      rule: 'budget', slot: priciest ? priciest.slot : null,
      skuId: priciest ? priciest.sku.id : null, skuName: priciest ? priciest.sku.name : null,
      message: `The set is ${usd(total - brief.budget)} over the ${usd(brief.budget)} budget.`
    });
  }

  const missingRoles = [];
  for (const slot of requiredSlots(brief)) {
    const line = session.cart.find(l => l.slot === slot);
    if (!line) {
      missingRoles.push(slot);
      failures.push({ rule: 'roles', slot, message: `The cart has no ${SLOT_LABELS[slot]}.` });
      continue;
    }
    const lacking = requiredFeatures(slot, brief).filter(f => !(line.sku.features || []).includes(f));
    if (lacking.length > 0) {
      missingRoles.push(slot);
      failures.push({ rule: 'roles', slot, skuId: line.sku.id, skuName: line.sku.name, message: `${line.sku.name} is not ${lacking.join(', ').replace(/_/g, ' ')}.` });
    }
  }
  checks.roles = { pass: missingRoles.length === 0, detail: requiredSlots(brief).map(s => SLOT_LABELS[s]).join(', ') };

  const found = await findRoom(placement.roomId);
  const room = found ? found.room : { x: 0, z: 0, width: brief.width, length: brief.length };
  const zones = doorSwingZones(room, found ? found.openings : []);
  const bounds = roomBounds(room);
  const poses = placement.items.map(it => ({ ...it, length: it.depth, flat: it.role === 'rug' }));

  let doorHits = 0;
  for (const p of poses) {
    if (p.flat) continue;
    for (const z of zones) {
      if (overlapArea(footprint(p), z) > DOOR_OVERLAP_EPS) {
        doorHits++;
        failures.push({
          rule: 'door', slot: p.slot, skuId: p.skuId, skuName: p.name,
          message: `${p.name} sits in the swing of the ${WALL_COMPASS[z.wall]} door.`,
          anchor: { type: 'door', x: z.x, z: z.z, wall: z.wall, compass: WALL_COMPASS[z.wall] }
        });
      }
    }
  }

  let fitHits = 0;
  const face = WALL_FACE - WALL_TOLERANCE;
  for (const p of poses) {
    const fp = footprint(p);
    const past = [
      ['left', bounds.minX + face - fp.minX],
      ['right', fp.maxX - (bounds.maxX - face)],
      ['back', bounds.minZ + face - fp.minZ],
      ['front', fp.maxZ - (bounds.maxZ - face)]
    ].filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1])[0];
    if (past) {
      fitHits++;
      failures.push({
        rule: 'fit', slot: p.slot, skuId: p.skuId, skuName: p.name,
        message: `${p.name} runs ${past[1].toFixed(2)} m past the ${WALL_COMPASS[past[0]]} wall.`,
        anchor: { type: 'wall', wall: past[0], compass: WALL_COMPASS[past[0]] }
      });
    }
  }
  for (let i = 0; i < poses.length; i++) {
    for (let j = i + 1; j < poses.length; j++) {
      const a = poses[i];
      const b = poses[j];
      if (a.flat || b.flat) continue;
      if (overlapArea(footprint(a), footprint(b)) > ITEM_OVERLAP_EPS) {
        fitHits++;
        const blamed = (EXPENDABLE[a.slot] ?? 5) <= (EXPENDABLE[b.slot] ?? 5) ? a : b;
        const other = blamed === a ? b : a;
        failures.push({
          rule: 'fit', slot: blamed.slot, skuId: blamed.skuId, skuName: blamed.name,
          message: `${blamed.name} overlaps the ${other.name}.`,
          anchor: { type: 'wall', wall: placement.seatWall, compass: WALL_COMPASS[placement.seatWall] }
        });
      }
    }
  }
  const doorNames = zones.map(z => WALL_COMPASS[z.wall]).join(', ') || 'no';
  checks.door = { pass: doorHits === 0 && fitHits === 0, detail: `${doorNames} door, walls, overlaps` };

  const anchor = anchorLine(session);
  const media = session.cart.find(l => l.slot === 'media');
  if (brief.needsTv && anchor && media) {
    const a = poses.find(p => p.slot === anchor.slot);
    const m = poses.find(p => p.slot === 'media');
    const toMedia = { x: m.x - a.x, z: m.z - a.z };
    const seatAngle = angleBetweenDeg(forwardOf(a.rotationY), toMedia);
    const mediaAngle = angleBetweenDeg(forwardOf(m.rotationY), { x: -toMedia.x, z: -toMedia.z });
    const pass = seatAngle <= FACING_TOLERANCE_DEG && mediaAngle <= FACING_TOLERANCE_DEG;
    checks.facing = { pass, detail: `${Math.round(seatAngle)}° off axis` };
    if (!pass) {
      failures.push({
        rule: 'facing', slot: 'media', skuId: media.sku.id, skuName: media.sku.name,
        message: `The ${anchor.sku.name} is turned ${Math.round(seatAngle)}° away from the ${media.sku.name}.`,
        anchor: { type: 'wall', wall: placement.mediaWall, compass: WALL_COMPASS[placement.mediaWall] }
      });
    }
  } else {
    checks.facing = { pass: null, detail: brief.needsTv ? 'missing pieces' : 'no TV in the brief' };
  }

  failures.filter(f => (f.rule === 'door' || f.rule === 'fit') && f.skuId).forEach(f => {
    const line = session.cart.find(l => l.slot === f.slot);
    recordRefusal(session, {
      skuId: f.skuId, name: f.skuName, role: line ? line.sku.role : null, slot: f.slot, rule: f.rule,
      width: line ? line.sku.width : null, depth: line ? line.sku.depth : null, height: line ? line.sku.height : null,
      price: line ? line.sku.price : null, message: f.message, anchor: f.anchor
    });
  });

  const pass = failures.length === 0;
  session.lastCritique = { placementId: placement.id, pass, checks, failures, room: label };

  const passed = Object.entries(checks).filter(([, c]) => c.pass !== null).map(([k]) => k);
  const first = failures[0];
  return {
    ok: true,
    arg: `${passed.length} checks`,
    observation: pass ? `pass (${passed.join(', ')})` : `fail ${first.rule}: ${first.skuName || first.message}`
  };
}

/**
 * swap_sku: replace one slot with the next candidate that meets the request.
 * Used by repairs (door, fit, budget, facing) and by shopper requests on a later turn.
 */
async function swap_sku(session, args = {}) {
  const brief = session.brief;
  const slot = args.slot;
  const line = session.cart.find(l => l.slot === slot);
  const current = line ? line.sku : null;
  const reason = args.reason || 'shopper';
  const labelText = SLOT_LABELS[slot] || slot;

  const rejected = new Set((session.rejected && session.rejected[slot]) || []);
  const roles = args.preferRole ? [args.preferRole] : slotRoles(slot, brief);
  const needFeatures = requiredFeatures(slot, brief);
  const others = cartTotal(session) - (current ? current.price : 0);

  let pool = ((session.candidates && session.candidates.bySlot[slot]) || [])
    .filter(s => !current || s.id !== current.id)
    .filter(s => !rejected.has(s.id))
    .filter(s => roles.includes(s.role))
    .filter(s => needFeatures.every(f => (s.features || []).includes(f)));

  if (args.skuId) {
    pool = pool.filter(s => s.id === args.skuId);
  } else if (args.maxPrice) {
    pool = pool.filter(s => (args.maxPriceInclusive ? s.price <= args.maxPrice : s.price < args.maxPrice));
  }
  if (current && !args.skuId) {
    if (args.direction === 'smaller') pool = pool.filter(s => s.width < current.width - 0.005 || (reason === 'fit' && s.depth < current.depth - 0.005));
    if (args.direction === 'cheaper') pool = pool.filter(s => s.price < current.price);
    if (args.direction === 'larger') pool = pool.filter(s => s.width > current.width + 0.005);
  }

  // Candidates are already in planner-score order; keep the set inside budget when possible.
  pool = pool.slice().sort((a, b) => {
    const aIn = others + a.price <= brief.budget ? 0 : 1;
    const bIn = others + b.price <= brief.budget ? 0 : 1;
    const aCol = args.collection && a.collection === args.collection ? 0 : 1;
    const bCol = args.collection && b.collection === args.collection ? 0 : 1;
    return (aCol - bCol) || (aIn - bIn) || (b.score - a.score);
  });

  const argText = `${labelText.replace(/ /g, '_')}${args.skuId ? ` sku=${args.skuId}` : ''}${args.maxPrice ? ` max=${args.maxPrice}` : ''}${args.preferRole && args.preferRole !== 'sofa' ? ` role=${args.preferRole}` : ''}${!args.maxPrice && args.direction && args.direction !== 'next' ? ` ${args.direction}` : ''}`;

  if (reason === 'shopper') session.pendingRequest = null;

  const pick = pool[0];
  if (!pick) {
    if (args.allowDrop && line) {
      session.cart = session.cart.filter(l => l.slot !== slot);
      session.cartVersion++;
      session.dirtySlots = Array.from(new Set([...(session.dirtySlots || []), slot]));
      return {
        ok: true,
        arg: argText,
        observation: `no ${args.direction || 'other'} ${labelText}; removed ${current.name}`,
        traceExtra: { reason, slot, newName: null }
      };
    }
    const constraint = args.maxPrice ? ` ${args.maxPriceInclusive ? 'at or under' : 'under'} ${usd(args.maxPrice)}` : '';
    session.openIssue = {
      room: roomLabel(brief),
      rule: reason === 'shopper' ? 'request' : reason,
      ruleLabel: reason === 'shopper' ? 'shopper request' : ({ door: 'door swing', fit: 'fit inside the walls', budget: 'budget', facing: 'sofa facing the TV', roles: 'required pieces' }[reason] || reason),
      skuId: current ? current.id : null,
      skuName: current ? current.name : null,
      message: `No other Harbor & Co. ${labelText}${constraint} fits this ${roomLabel(brief)}${needFeatures.length ? ' with ' + needFeatures.join(', ').replace(/_/g, ' ') : ''}.`
    };
    return { ok: false, arg: argText, observation: `no candidate${constraint}`, traceExtra: { reason, slot, newName: null } };
  }

  if (current && (reason === 'door' || reason === 'fit' || reason === 'facing')) {
    session.rejected = session.rejected || {};
    session.rejected[slot] = Array.from(new Set([...(session.rejected[slot] || []), current.id]));
  }

  const walls = {
    seatWall: session.placement ? session.placement.seatWall : chooseWalls(brief).seatWall,
    mediaWall: session.placement && session.placement.mediaWall ? session.placement.mediaWall : chooseWalls(brief).mediaWall,
    lengths: { back: brief.width, front: brief.width, left: brief.length, right: brief.length }
  };
  const newLine = cartLine(slot, pick, brief, walls);
  session.cart = line ? session.cart.map(l => (l.slot === slot ? newLine : l)) : [...session.cart, newLine];
  session.cartVersion++;
  session.dirtySlots = Array.from(new Set([...(session.dirtySlots || []), slot]));

  const shortName = pick.name.replace(/ (Sofa|Performance Sofa|Grand Sofa|Apartment Sofa|Slipcover Sofa)$/, '');
  return {
    ok: true,
    arg: argText,
    observation: `${shortName}, ${usd(pick.price)}`,
    traceExtra: { reason, slot, newName: pick.name, oldName: current ? current.name : null }
  };
}

module.exports = {
  place_in_room,
  critique_fit,
  swap_sku
};
