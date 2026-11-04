// src/ai/interiorEnergySolver.js
// Continuous Energy-Based Interior Scene Synthesis & Pose Optimizer
// A declarative scene graph of real catalog SKUs plus a simulated annealing pose search:
//   E(S) = w_wall * E_wall_bounds + w_col * E_footprint_overlap + w_door * E_door_swing + w_rel * E_pairwise_relation

const { getSeedProducts } = require('../catalog/harborCatalog');

const WALL_ROTATION = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };
const OPPOSITE_WALL = { back: 'front', front: 'back', left: 'right', right: 'left' };
const WALL_MARGIN = 0.12; // interior wall face (0.1) plus a 2 cm gap

function forwardOf(rotationY) {
  return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
}

function leftOf(rotationY) {
  return { x: -Math.cos(rotationY), z: Math.sin(rotationY) };
}

function footprint(p) {
  const effW = Math.abs(p.width * Math.cos(p.rotationY)) + Math.abs(p.length * Math.sin(p.rotationY));
  const effL = Math.abs(p.width * Math.sin(p.rotationY)) + Math.abs(p.length * Math.cos(p.rotationY));
  return { minX: p.x - effW / 2, maxX: p.x + effW / 2, minZ: p.z - effL / 2, maxZ: p.z + effL / 2 };
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const z = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
  return x * z;
}

function roomBounds(room) {
  return {
    minX: room.x - room.width / 2,
    maxX: room.x + room.width / 2,
    minZ: room.z - room.length / 2,
    maxZ: room.z + room.length / 2
  };
}

// Which of the room's four walls an opening sits on.
function wallOfOpening(room, o) {
  const b = roomBounds(room);
  const d = { back: Math.abs(o.z - b.minZ), front: Math.abs(o.z - b.maxZ), left: Math.abs(o.x - b.minX), right: Math.abs(o.x - b.maxX) };
  return Object.keys(d).sort((a, c) => d[a] - d[c])[0];
}

// A door swing is a square the width of the door, reaching into the room from the doorway.
function doorSwingZones(room, openings = []) {
  const b = roomBounds(room);
  return openings.filter(o => o.type === 'door').map(d => {
    const w = d.width || 0.9;
    const wall = wallOfOpening(room, d);
    let zone;
    if (wall === 'back') zone = { minX: d.x - w / 2, maxX: d.x + w / 2, minZ: b.minZ, maxZ: b.minZ + w };
    else if (wall === 'front') zone = { minX: d.x - w / 2, maxX: d.x + w / 2, minZ: b.maxZ - w, maxZ: b.maxZ };
    else if (wall === 'left') zone = { minX: b.minX, maxX: b.minX + w, minZ: d.z - w / 2, maxZ: d.z + w / 2 };
    else zone = { minX: b.maxX - w, maxX: b.maxX, minZ: d.z - w / 2, maxZ: d.z + w / 2 };
    return { ...zone, wall, doorId: d.id, x: d.x, z: d.z, width: w };
  });
}

// Largest Harbor & Co. pieces that suit a room, for callers that do not pass SKUs.
function defaultCatalogSet(room) {
  const products = getSeedProducts();
  const longest = Math.max(room.width, room.length);
  const cross = Math.min(room.width, room.length);
  const pick = (role, test) => products.filter(p => p.role === role && test(p)).sort((a, b) => b.width - a.width)[0];
  const rtype = room.type || 'living';

  if (rtype === 'living') {
    const sofa = pick('sofa', p => p.width + 0.4 <= longest && p.depth + 1.6 <= cross);
    const table = pick('coffee_table', p => !sofa || p.width <= sofa.width * 0.7);
    const lines = [];
    if (sofa) lines.push({ slot: 'seat', sku: sofa });
    if (table) lines.push({ slot: 'coffee_table', sku: table });
    if (room.width * room.length >= 22) {
      const chair = pick('chair', () => true);
      if (chair) lines.push({ slot: 'chair', sku: chair });
    }
    return lines;
  }
  if (rtype === 'bedroom') {
    const nightstand = pick('nightstand', () => true);
    const bed = pick('bed', p => p.width + 0.4 + (nightstand ? nightstand.width : 0) <= longest && p.depth + 0.6 <= cross);
    const lines = [];
    if (bed) lines.push({ slot: 'bed', sku: bed });
    if (bed && nightstand) lines.push({ slot: 'nightstand', sku: nightstand });
    return lines;
  }
  return [];
}

class InteriorEnergySolver {
  constructor(options = {}) {
    this.iterations = options.iterations || 220;
  }

  /**
   * Scene graph specs from catalog lines [{ slot, sku }]. Every size is the SKU's own width, depth, and height.
   * layout: { seatWall, mediaWall, facing, fixedPoses: { slot: { x, z, rotationY } } }
   */
  buildSkuSceneGraph(room, lines, layout = {}) {
    const seatWall = layout.seatWall || 'auto';
    const mediaWall = layout.mediaWall || 'auto_opposite';
    const fixed = layout.fixedPoses || {};
    const anchorSlot = lines.some(l => l.slot === 'bed') ? 'bed' : 'seat';
    const tableSlot = lines.some(l => l.slot === 'coffee_table') ? 'coffee_table' : null;

    return lines.map(({ slot, sku }) => {
      const base = {
        key: slot,
        slot,
        skuId: sku.id,
        name: sku.name,
        type: sku.role,
        width: sku.width,
        length: sku.depth,
        height: sku.height,
        collection: sku.collection,
        material: String(sku.collection || 'harbor').toLowerCase(),
        clearanceBuffer: 0.2,
        fixedPose: fixed[slot] || null
      };

      switch (slot) {
        case 'seat':
        case 'bed':
          return { ...base, anchorRule: 'wall', wall: seatWall, clearanceBuffer: 0.25 };
        case 'media':
          return { ...base, anchorRule: 'wall', wall: mediaWall, alignWith: layout.facing ? anchorSlot : null };
        case 'coffee_table':
          return { ...base, anchorRule: 'in_front_of', targetKey: 'seat', targetDistance: 0.4 };
        case 'nightstand':
          return { ...base, anchorRule: 'beside_left', targetKey: 'bed', targetDistance: 0.05, clearanceBuffer: 0.02 };
        case 'rug':
          return { ...base, anchorRule: 'under', targetKey: tableSlot || anchorSlot, flat: true, clearanceBuffer: 0 };
        case 'chair':
          return anchorSlot === 'bed'
            ? { ...base, anchorRule: 'corner_daylight' }
            : { ...base, anchorRule: 'side_of', targetKey: tableSlot || 'seat', targetDistance: 0.35 };
        default:
          return { ...base, anchorRule: 'room_center_ergonomic' };
      }
    });
  }

  /**
   * Generates a declarative scene graph for a room. With `skuLines`, specs come from those SKUs.
   * Without them, living rooms and bedrooms draw their pieces from the Harbor & Co. catalog.
   */
  buildDeclarativeSceneGraph(room, style = 'japandi', customDirectives = '', skuLines = null, layout = {}) {
    if (Array.isArray(skuLines) && skuLines.length > 0) {
      return this.buildSkuSceneGraph(room, skuLines, layout);
    }

    const rtype = room.type || 'living';
    const area = room.width * room.length;

    if (rtype === 'living' || rtype === 'bedroom') {
      const specs = this.buildSkuSceneGraph(room, defaultCatalogSet(room), layout);
      if (area >= 16) {
        specs.push({
          key: 'plant', name: 'Floor Planter', type: 'plant', width: 0.55, length: 0.55, height: 1.5,
          material: 'ceramic', anchorRule: 'corner_daylight', clearanceBuffer: 0.2
        });
      }
      return specs;
    }

    if (rtype === 'kitchen' || rtype === 'dining') {
      return [{
        key: 'kitchen_island', name: 'Kitchen Island', type: 'island',
        width: Math.min(2.4, room.width * 0.58), length: 1.0, height: 0.92,
        material: 'stone', anchorRule: 'room_center_ergonomic', clearanceBuffer: 0.75
      }];
    }

    if (rtype === 'office') {
      return [
        { key: 'desk', name: 'Desk', type: 'table', width: 1.6, length: 0.8, height: 0.75, material: 'oak', anchorRule: 'room_center_ergonomic', clearanceBuffer: 0.65 },
        { key: 'office_plant', name: 'Floor Planter', type: 'plant', width: 0.55, length: 0.55, height: 1.5, material: 'ceramic', anchorRule: 'corner_daylight', clearanceBuffer: 0.25 }
      ];
    }

    if (rtype === 'bathroom') {
      return [{
        key: 'vanity', name: 'Vanity', type: 'island',
        width: Math.min(1.35, room.width * 0.52), length: 0.58, height: 0.82,
        material: 'stone', anchorRule: 'wall', wall: 'auto', clearanceBuffer: 0.5
      }];
    }

    return [];
  }

  /**
   * Solves (x, z, rotationY) for every spec by minimizing E(S).
   * options: { wallPad, iterations }
   */
  optimizeRoomFurniture(room, sceneSpecs, roomOpenings = [], style = 'japandi', options = {}) {
    if (!sceneSpecs || sceneSpecs.length === 0) {
      return { items: [], telemetry: { initialEnergy: 0, finalEnergy: 0, iterations: 0 } };
    }

    const startMs = Date.now();
    const iterations = options.iterations || this.iterations;
    const wallPad = options.wallPad !== undefined ? options.wallPad : 0.16;
    const doors = roomOpenings.filter(o => o.type === 'door');
    const windows = roomOpenings.filter(o => o.type === 'window');
    const zones = doorSwingZones(room, doors);
    const { minX, maxX, minZ, maxZ } = roomBounds(room);

    // Primary wall for 'auto': first wall without a door, preferring back, left, right, front.
    const wallHasDoor = { front: false, back: false, left: false, right: false };
    zones.forEach(z => { wallHasDoor[z.wall] = true; });
    const primaryAnchorWall = ['back', 'left', 'right', 'front'].find(w => !wallHasDoor[w]) || 'back';

    const resolveWall = (spec) => {
      if (spec.wall === 'auto' || !spec.wall) return primaryAnchorWall;
      if (spec.wall === 'auto_opposite') return OPPOSITE_WALL[primaryAnchorWall];
      return spec.wall;
    };

    const tangentAxis = wall => (wall === 'back' || wall === 'front') ? 'x' : 'z';

    const placeOnWall = (spec, wall, tangent) => {
      const margin = WALL_MARGIN + spec.length / 2;
      const rot = WALL_ROTATION[wall];
      if (wall === 'back') return { x: tangent, z: minZ + margin, rot };
      if (wall === 'front') return { x: tangent, z: maxZ - margin, rot };
      if (wall === 'left') return { x: minX + margin, z: tangent, rot };
      return { x: maxX - margin, z: tangent, rot };
    };

    const zoneOverlap = (pose) => zones.reduce((sum, z) => sum + overlapArea(footprint(pose), z), 0);

    const initializePoses = () => {
      const poses = [];
      const byKey = new Map();

      for (const spec of sceneSpecs) {
        let x = room.x;
        let z = room.z;
        let rot = 0;
        let wall = null;

        if (spec.fixedPose) {
          x = spec.fixedPose.x;
          z = spec.fixedPose.z;
          rot = spec.fixedPose.rotationY;
          if (spec.anchorRule === 'wall') wall = resolveWall(spec);
        } else if (spec.anchorRule === 'wall' || spec.anchorRule === 'wall_headboard' || spec.anchorRule === 'wall_back_offset') {
          wall = resolveWall(spec);
          let tangent = tangentAxis(wall) === 'x' ? room.x : room.z;
          const target = spec.alignWith && byKey.get(spec.alignWith);
          if (target && tangentAxis(resolveWall(target)) === tangentAxis(wall)) {
            tangent = tangentAxis(wall) === 'x' ? target.x : target.z;
          }
          const p = placeOnWall(spec, wall, tangent);
          x = p.x; z = p.z; rot = p.rot;
        } else if (spec.anchorRule === 'in_front_of' && byKey.has(spec.targetKey)) {
          const parent = byKey.get(spec.targetKey);
          const f = forwardOf(parent.rotationY);
          const dist = (parent.length / 2) + (spec.length / 2) + (spec.targetDistance || 0.75);
          x = parent.x + f.x * dist;
          z = parent.z + f.z * dist;
          rot = parent.rotationY;
        } else if (spec.anchorRule === 'beside_left' && byKey.has(spec.targetKey)) {
          const parent = byKey.get(spec.targetKey);
          const l = leftOf(parent.rotationY);
          const f = forwardOf(parent.rotationY);
          const sideDist = (parent.width / 2) + (spec.width / 2) + (spec.targetDistance || 0.25);
          const back = -(parent.length / 2) + (spec.length / 2);
          x = parent.x + l.x * sideDist + f.x * back;
          z = parent.z + l.z * sideDist + f.z * back;
          rot = parent.rotationY;
        } else if (spec.anchorRule === 'under' && byKey.has(spec.targetKey)) {
          const parent = byKey.get(spec.targetKey);
          x = parent.x;
          z = parent.z;
          rot = parent.rotationY;
        } else if (spec.anchorRule === 'side_of' && byKey.has(spec.targetKey)) {
          // Beside the table, turned to face it. Take the side that stays clear of doors and walls.
          const parent = byKey.get(spec.targetKey);
          const l = leftOf(parent.rotationY);
          const dist = (parent.width / 2) + (spec.length / 2) + (spec.targetDistance || 0.35);
          const options2 = [1, -1].map(s => {
            const px = parent.x + s * l.x * dist;
            const pz = parent.z + s * l.z * dist;
            const prot = Math.atan2(-s * l.x, -s * l.z);
            const pose = { x: px, z: pz, rotationY: prot, width: spec.width, length: spec.length };
            const fp = footprint(pose);
            const outside = Math.max(0, minX + wallPad - fp.minX) + Math.max(0, fp.maxX - (maxX - wallPad))
              + Math.max(0, minZ + wallPad - fp.minZ) + Math.max(0, fp.maxZ - (maxZ - wallPad));
            return { px, pz, prot, cost: zoneOverlap(pose) * 10 + outside };
          }).sort((a, b) => a.cost - b.cost);
          x = options2[0].px; z = options2[0].pz; rot = options2[0].prot;
        } else if (spec.anchorRule === 'angled_conversational' && byKey.has(spec.targetKey)) {
          const parent = byKey.get(spec.targetKey);
          x = parent.x + 1.25;
          z = parent.z + 0.15;
          rot = -Math.PI / 4;
        } else if (spec.anchorRule === 'corner_daylight') {
          const inset = Math.max(spec.width, spec.length) / 2 + wallPad + 0.05;
          const corners = [
            { x: minX + inset, z: minZ + inset },
            { x: maxX - inset, z: minZ + inset },
            { x: minX + inset, z: maxZ - inset },
            { x: maxX - inset, z: maxZ - inset }
          ];
          let bestCorner = corners[0];
          let bestScore = -Infinity;
          for (const c of corners) {
            const minDoorDist = doors.length > 0 ? Math.min(...doors.map(d => Math.hypot(c.x - d.x, c.z - d.z))) : 3.0;
            const winBonus = windows.length > 0 ? -Math.min(...windows.map(w => Math.hypot(c.x - w.x, c.z - w.z))) * 0.4 : 0;
            const crowd = poses.reduce((acc, p) => acc + overlapArea(footprint({ ...c, rotationY: 0, width: spec.width, length: spec.length }), footprint(p)), 0);
            const score = minDoorDist + winBonus - crowd * 10;
            if (score > bestScore) { bestScore = score; bestCorner = c; }
          }
          x = bestCorner.x;
          z = bestCorner.z;
          rot = 0;
        }

        const pose = {
          ...spec,
          wallKey: wall,
          x: Number(x.toFixed(3)),
          y: Number((spec.height / 2).toFixed(3)),
          z: Number(z.toFixed(3)),
          rotationY: Number(rot.toFixed(4)),
          style
        };
        poses.push(pose);
        byKey.set(spec.key, pose);
      }
      return poses;
    };

    const evaluateEnergy = (poses) => {
      let wallPenalty = 0;
      let collisionPenalty = 0;
      let doorSwingPenalty = 0;
      let relationPenalty = 0;

      const byKey = new Map();
      poses.forEach(p => byKey.set(p.key, p));

      for (let i = 0; i < poses.length; i++) {
        const p = poses[i];
        const fp = footprint(p);

        if (fp.minX < minX + wallPad) wallPenalty += Math.pow((minX + wallPad) - fp.minX, 2) * 120;
        if (fp.maxX > maxX - wallPad) wallPenalty += Math.pow(fp.maxX - (maxX - wallPad), 2) * 120;
        if (fp.minZ < minZ + wallPad) wallPenalty += Math.pow((minZ + wallPad) - fp.minZ, 2) * 120;
        if (fp.maxZ > maxZ - wallPad) wallPenalty += Math.pow(fp.maxZ - (maxZ - wallPad), 2) * 120;

        if (!p.flat) {
          doorSwingPenalty += zoneOverlap(p) * 400;
        }

        for (let j = i + 1; j < poses.length; j++) {
          const q = poses[j];
          if (p.flat || q.flat) continue;
          const buf = Math.min(p.clearanceBuffer ?? 0.3, q.clearanceBuffer ?? 0.3) / 2;
          const qfp = footprint(q);
          const grown = a => ({ minX: a.minX - buf, maxX: a.maxX + buf, minZ: a.minZ - buf, maxZ: a.maxZ + buf });
          collisionPenalty += overlapArea(grown(fp), grown(qfp)) * 110;
        }

        const parent = p.targetKey ? byKey.get(p.targetKey) : null;
        if (p.anchorRule === 'in_front_of' && parent) {
          const f = forwardOf(parent.rotationY);
          const d = (parent.length / 2) + (p.length / 2) + (p.targetDistance || 0.75);
          relationPenalty += (Math.pow(p.x - (parent.x + f.x * d), 2) + Math.pow(p.z - (parent.z + f.z * d), 2)) * 28;
        } else if (p.anchorRule === 'beside_left' && parent) {
          const l = leftOf(parent.rotationY);
          const f = forwardOf(parent.rotationY);
          const sd = (parent.width / 2) + (p.width / 2) + (p.targetDistance || 0.25);
          const back = -(parent.length / 2) + (p.length / 2);
          relationPenalty += (Math.pow(p.x - (parent.x + l.x * sd + f.x * back), 2) + Math.pow(p.z - (parent.z + l.z * sd + f.z * back), 2)) * 35;
        } else if (p.anchorRule === 'under' && parent) {
          relationPenalty += (Math.pow(p.x - parent.x, 2) + Math.pow(p.z - parent.z, 2)) * 30;
        } else if (p.anchorRule === 'side_of' && parent) {
          const dist = Math.hypot(p.x - parent.x, p.z - parent.z);
          const ideal = (parent.width / 2) + (p.length / 2) + (p.targetDistance || 0.35);
          relationPenalty += Math.pow(dist - ideal, 2) * 20;
        }

        if (p.alignWith && byKey.has(p.alignWith) && p.wallKey) {
          const target = byKey.get(p.alignWith);
          const axis = tangentAxis(p.wallKey);
          relationPenalty += Math.pow(axis === 'x' ? p.x - target.x : p.z - target.z, 2) * 6;
        }
      }

      const total = wallPenalty + collisionPenalty + doorSwingPenalty + relationPenalty;
      return {
        total: Number(total.toFixed(4)),
        wallPenalty: Number(wallPenalty.toFixed(3)),
        collisionPenalty: Number(collisionPenalty.toFixed(3)),
        doorSwingPenalty: Number(doorSwingPenalty.toFixed(3)),
        relationPenalty: Number(relationPenalty.toFixed(3))
      };
    };

    let currentPoses = initializePoses();
    let currentEnergy = evaluateEnergy(currentPoses);
    let bestPoses = currentPoses.map(p => ({ ...p }));
    let bestEnergy = { ...currentEnergy };
    const initialEnergyVal = currentEnergy.total;
    const movable = currentPoses.map((p, i) => (p.fixedPose ? -1 : i)).filter(i => i >= 0);

    let temp = 4.0;
    const cooling = Math.pow(0.02 / 4.0, 1 / Math.max(1, iterations));
    let seed = Math.round((room.width + room.length) * 997) + sceneSpecs.length * 31;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let step = 0; step < iterations && movable.length > 0; step++) {
      if (bestEnergy.total < 0.05 && step > 25) break;

      const candidate = currentPoses.map(p => ({ ...p }));
      const idx = movable[Math.floor(nextRand() * movable.length)];
      const item = candidate[idx];

      const stepScale = Math.max(0.03, temp * 0.15);
      const dx = (nextRand() - 0.5) * 2 * stepScale;
      const dz = (nextRand() - 0.5) * 2 * stepScale;

      if (item.wallKey) {
        // Wall-backed pieces only slide along their wall.
        if (tangentAxis(item.wallKey) === 'x') item.x = Number((item.x + dx).toFixed(3));
        else item.z = Number((item.z + dz).toFixed(3));
      } else {
        item.x = Number((item.x + dx).toFixed(3));
        item.z = Number((item.z + dz).toFixed(3));
      }

      if ((item.anchorRule === 'angled_conversational' || item.anchorRule === 'side_of') && nextRand() < 0.3) {
        item.rotationY = Number((item.rotationY + (nextRand() - 0.5) * 0.35).toFixed(4));
      }

      const candEnergy = evaluateEnergy(candidate);
      const dE = candEnergy.total - currentEnergy.total;

      if (dE < 0 || Math.exp(-dE / Math.max(0.02, temp)) > nextRand()) {
        currentPoses = candidate;
        currentEnergy = candEnergy;
        if (candEnergy.total < bestEnergy.total) {
          bestPoses = candidate.map(p => ({ ...p }));
          bestEnergy = { ...candEnergy };
        }
      }
      temp *= cooling;
    }

    return {
      items: bestPoses.map(p => ({ ...p, x: Number(p.x.toFixed(2)), z: Number(p.z.toFixed(2)) })),
      telemetry: {
        roomId: room.id,
        roomName: room.name,
        primaryAnchorWall,
        initialEnergy: initialEnergyVal,
        finalEnergy: bestEnergy.total,
        energyComponents: bestEnergy,
        iterationsRun: iterations,
        latencyMs: Date.now() - startMs
      }
    };
  }
}

module.exports = {
  InteriorEnergySolver,
  interiorEnergySolver: new InteriorEnergySolver(),
  doorSwingZones,
  footprint,
  overlapArea,
  roomBounds,
  forwardOf,
  wallOfOpening,
  defaultCatalogSet
};
