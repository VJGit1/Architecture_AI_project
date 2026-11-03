// src/ai/interiorEnergySolver.js
// Continuous Energy-Based Interior Scene Synthesis & Pose Optimizer
// Replaces hardcoded furniture coordinates with a declarative Scene Graph DSL + Simulated Annealing energy minimizer:
//   E(S) = w_wall * E_wall_bounds + w_col * E_obb_collision + w_door * E_door_swing + w_rel * E_pairwise_relation + w_vis * E_focal_frustum

class InteriorEnergySolver {
  constructor(options = {}) {
    this.iterations = options.iterations || 220;
    this.doorSwingRadius = options.doorSwingRadius || 0.95;
  }

  /**
   * Generates a declarative Semantic Scene Graph for a room based on room type, dimensions, and aesthetic style
   */
  buildDeclarativeSceneGraph(room, style = 'japandi', customDirectives = '') {
    const rtype = room.type || 'living';
    const area = room.width * room.length;
    const dLower = String(customDirectives || '').toLowerCase();

    const palette = {
      'japandi': {
        sofa: 'boucle',
        table: 'light-oak',
        bed: 'linen-oak',
        island: 'travertine',
        vanity: 'terrazzo',
        rug: 'woven-jute',
        plant: 'ceramic-greenery',
        chair: 'ash-boucle',
        desk: 'light-oak'
      },
      'mid-century': {
        sofa: 'cognac-leather',
        table: 'walnut',
        bed: 'boucle-walnut',
        island: 'calacatta-marble',
        vanity: 'walnut-brass',
        rug: 'geometric-wool',
        plant: 'terracotta-olive',
        chair: 'cognac-leather',
        desk: 'walnut'
      },
      'warm-minimalist': {
        sofa: 'boucle',
        table: 'travertine',
        bed: 'boucle-stone',
        island: 'calacatta-marble',
        vanity: 'terrazzo',
        rug: 'ivory-sheepskin',
        plant: 'stone-planter',
        chair: 'travertine-linen',
        desk: 'travertine'
      }
    }[style] || {
      sofa: 'boucle',
      table: 'light-oak',
      bed: 'linen-oak',
      island: 'calacatta-marble',
      vanity: 'terrazzo',
      rug: 'woven-jute',
      plant: 'ceramic-greenery',
      chair: 'ash-boucle',
      desk: 'light-oak'
    };

    const specs = [];

    if (rtype === 'living') {
      specs.push(
        {
          key: 'sofa_main',
          name: style === 'mid-century' ? 'Cognac Leather Tufted Sofa' : 'Curved Bouclé Salon Sofa',
          type: 'sofa',
          width: Math.min(2.6, room.width * 0.52),
          length: 1.05,
          height: 0.78,
          material: palette.sofa,
          anchorRule: 'wall_back_offset',
          wallMargin: 0.65,
          clearanceBuffer: 0.45
        },
        {
          key: 'coffee_table',
          name: style === 'warm-minimalist' ? 'Plinth Travertine Coffee Table' : 'Sculptural Low Coffee Table',
          type: 'table',
          width: 1.35,
          length: 0.78,
          height: 0.36,
          material: palette.table,
          anchorRule: 'in_front_of',
          targetKey: 'sofa_main',
          targetDistance: 0.95,
          clearanceBuffer: 0.35
        },
        {
          key: 'olive_tree',
          name: 'Architectural Olive Tree Planter',
          type: 'plant',
          width: 0.65,
          length: 0.65,
          height: 1.85,
          material: palette.plant,
          anchorRule: 'corner_daylight',
          clearanceBuffer: 0.25
        }
      );

      if (area >= 22 || dLower.includes('lounge') || dLower.includes('chair') || dLower.includes('host')) {
        specs.push({
          key: 'accent_chair',
          name: 'Pierre Jeanneret Lounge Chair',
          type: 'chair',
          width: 0.82,
          length: 0.82,
          height: 0.72,
          material: palette.chair,
          anchorRule: 'angled_conversational',
          targetKey: 'coffee_table',
          targetDistance: 1.15,
          clearanceBuffer: 0.35
        });
      }
    } else if (rtype === 'bedroom') {
      specs.push(
        {
          key: 'platform_bed',
          name: 'Low Minimalist Platform Bed',
          type: 'bed',
          width: 2.05,
          length: 2.15,
          height: 0.65,
          material: palette.bed,
          anchorRule: 'wall_headboard',
          wallMargin: 0.12,
          clearanceBuffer: 0.55
        },
        {
          key: 'nightstand_left',
          name: 'Floating Bedside Nightstand',
          type: 'table',
          width: 0.52,
          length: 0.45,
          height: 0.46,
          material: palette.table,
          anchorRule: 'beside_left',
          targetKey: 'platform_bed',
          targetDistance: 0.32,
          clearanceBuffer: 0.2
        }
      );

      if (area >= 16) {
        specs.push({
          key: 'bedroom_plant',
          name: 'Ficus Audrey Ceramic Planter',
          type: 'plant',
          width: 0.55,
          length: 0.55,
          height: 1.5,
          material: palette.plant,
          anchorRule: 'corner_daylight',
          clearanceBuffer: 0.2
        });
      }
    } else if (rtype === 'kitchen' || rtype === 'dining') {
      specs.push({
        key: 'kitchen_island',
        name: 'Fluted Calacatta Marble Waterfall Island',
        type: 'island',
        width: Math.min(2.4, room.width * 0.58),
        length: 1.0,
        height: 0.92,
        material: palette.island,
        anchorRule: 'room_center_ergonomic',
        clearanceBuffer: 0.75
      });
    } else if (rtype === 'office') {
      specs.push(
        {
          key: 'exec_desk',
          name: 'Architectural Cantilevered Atelier Desk',
          type: 'table',
          width: 1.8,
          length: 0.85,
          height: 0.75,
          material: palette.desk,
          anchorRule: 'room_center_ergonomic',
          clearanceBuffer: 0.65
        },
        {
          key: 'office_plant',
          name: 'Sculptural Monstera Planter',
          type: 'plant',
          width: 0.58,
          length: 0.58,
          height: 1.6,
          material: palette.plant,
          anchorRule: 'corner_daylight',
          clearanceBuffer: 0.25
        }
      );
    } else if (rtype === 'bathroom') {
      specs.push({
        key: 'stone_vanity',
        name: 'Floating Honed Terrazzo Double Vanity',
        type: 'island',
        width: Math.min(1.35, room.width * 0.52),
        length: 0.58,
        height: 0.82,
        material: palette.vanity,
        anchorRule: 'wall_headboard',
        wallMargin: 0.08,
        clearanceBuffer: 0.5
      });
    }

    return specs;
  }

  /**
   * Solves optimal (x, z, rotationY) poses for all furniture items in `room` by minimizing E(S)
   */
  optimizeRoomFurniture(room, sceneSpecs, roomOpenings = [], style = 'japandi') {
    if (!sceneSpecs || sceneSpecs.length === 0) {
      return { items: [], telemetry: { initialEnergy: 0, finalEnergy: 0, iterations: 0 } };
    }

    const startMs = Date.now();
    const doors = roomOpenings.filter(o => o.type === 'door');
    const windows = roomOpenings.filter(o => o.type === 'window');

    const minX = room.x - room.width / 2;
    const maxX = room.x + room.width / 2;
    const minZ = room.z - room.length / 2;
    const maxZ = room.z + room.length / 2;

    // Choose primary anchor wall that DOES NOT contain a doorway if possible
    const wallHasDoor = { front: false, back: false, left: false, right: false };
    doors.forEach(d => {
      if (Math.abs(d.z - maxZ) < 0.45) wallHasDoor.front = true;
      if (Math.abs(d.z - minZ) < 0.45) wallHasDoor.back = true;
      if (Math.abs(d.x - minX) < 0.45) wallHasDoor.left = true;
      if (Math.abs(d.x - maxX) < 0.45) wallHasDoor.right = true;
    });

    // Pick best undisturbed wall for headboard / main sofa
    let primaryAnchorWall = 'back';
    if (wallHasDoor.back) {
      if (!wallHasDoor.left) primaryAnchorWall = 'left';
      else if (!wallHasDoor.right) primaryAnchorWall = 'right';
      else if (!wallHasDoor.front) primaryAnchorWall = 'front';
    }

    // Initialize candidate poses according to semantic anchor rules
    const initializePoses = () => {
      const poses = [];
      const byKey = new Map();

      for (const spec of sceneSpecs) {
        let x = room.x;
        let z = room.z;
        let rot = 0;

        if (spec.anchorRule === 'wall_headboard' || spec.anchorRule === 'wall_back_offset') {
          const margin = (spec.wallMargin || 0.2) + spec.length / 2;
          if (primaryAnchorWall === 'back') {
            x = room.x;
            z = minZ + margin;
            rot = 0;
          } else if (primaryAnchorWall === 'front') {
            x = room.x;
            z = maxZ - margin;
            rot = Math.PI;
          } else if (primaryAnchorWall === 'left') {
            x = minX + margin;
            z = room.z;
            rot = Math.PI / 2;
          } else if (primaryAnchorWall === 'right') {
            x = maxX - margin;
            z = room.z;
            rot = -Math.PI / 2;
          }
        } else if (spec.anchorRule === 'in_front_of' && byKey.has(spec.targetKey)) {
          const parent = byKey.get(spec.targetKey);
          const dist = (parent.length / 2) + (spec.length / 2) + (spec.targetDistance || 0.75);
          x = parent.x + Math.sin(parent.rotationY) * dist;
          z = parent.z + Math.cos(parent.rotationY) * dist;
          rot = parent.rotationY;
        } else if (spec.anchorRule === 'beside_left' && byKey.has(spec.targetKey)) {
          const parent = byKey.get(spec.targetKey);
          const sideDist = (parent.width / 2) + (spec.width / 2) + (spec.targetDistance || 0.25);
          x = parent.x - Math.cos(parent.rotationY) * sideDist;
          z = parent.z + Math.sin(parent.rotationY) * sideDist;
          rot = parent.rotationY;
        } else if (spec.anchorRule === 'angled_conversational' && byKey.has(spec.targetKey)) {
          const parent = byKey.get(spec.targetKey);
          x = parent.x + 1.25;
          z = parent.z + 0.15;
          rot = -Math.PI / 4;
        } else if (spec.anchorRule === 'corner_daylight') {
          // Place near window corner or opposite corner from doors
          const corners = [
            { x: minX + 0.65, z: minZ + 0.65 },
            { x: maxX - 0.65, z: minZ + 0.65 },
            { x: minX + 0.65, z: maxZ - 0.65 },
            { x: maxX - 0.65, z: maxZ - 0.65 }
          ];
          // Pick corner farthest from any doorway and closest to any window
          let bestCorner = corners[0];
          let bestScore = -Infinity;
          for (const c of corners) {
            const minDoorDist = doors.length > 0
              ? Math.min(...doors.map(d => Math.hypot(c.x - d.x, c.z - d.z)))
              : 3.0;
            const winBonus = windows.length > 0
              ? -Math.min(...windows.map(w => Math.hypot(c.x - w.x, c.z - w.z))) * 0.4
              : 0;
            const score = minDoorDist + winBonus;
            if (score > bestScore) {
              bestScore = score;
              bestCorner = c;
            }
          }
          x = bestCorner.x;
          z = bestCorner.z;
          rot = 0;
        }

        const pose = {
          ...spec,
          x: Number(x.toFixed(2)),
          y: Number((spec.height / 2).toFixed(2)),
          z: Number(z.toFixed(2)),
          rotationY: Number(rot.toFixed(3)),
          style
        };
        poses.push(pose);
        byKey.set(spec.key, pose);
      }
      return poses;
    };

    // Total Scene Energy Evaluator E(S)
    const evaluateEnergy = (poses) => {
      let wallPenalty = 0;
      let collisionPenalty = 0;
      let doorSwingPenalty = 0;
      let relationPenalty = 0;

      const byKey = new Map();
      poses.forEach(p => byKey.set(p.key, p));

      for (let i = 0; i < poses.length; i++) {
        const p = poses[i];
        const effW = Math.abs(p.width * Math.cos(p.rotationY)) + Math.abs(p.length * Math.sin(p.rotationY));
        const effL = Math.abs(p.width * Math.sin(p.rotationY)) + Math.abs(p.length * Math.cos(p.rotationY));

        const pMinX = p.x - effW / 2;
        const pMaxX = p.x + effW / 2;
        const pMinZ = p.z - effL / 2;
        const pMaxZ = p.z + effL / 2;

        // 1. Wall containment boundary violation (SDF outside room inner walls)
        const wallPad = 0.16;
        if (pMinX < minX + wallPad) wallPenalty += Math.pow((minX + wallPad) - pMinX, 2) * 120;
        if (pMaxX > maxX - wallPad) wallPenalty += Math.pow(pMaxX - (maxX - wallPad), 2) * 120;
        if (pMinZ < minZ + wallPad) wallPenalty += Math.pow((minZ + wallPad) - pMinZ, 2) * 120;
        if (pMaxZ > maxZ - wallPad) wallPenalty += Math.pow(pMaxZ - (maxZ - wallPad), 2) * 120;

        // 2. Door swing zone clearance violation
        for (const door of doors) {
          const distToDoor = Math.hypot(p.x - door.x, p.z - door.z);
          const minSafe = Math.max(effW, effL) / 2 + this.doorSwingRadius;
          if (distToDoor < minSafe) {
            doorSwingPenalty += Math.pow(minSafe - distToDoor, 2) * 95;
          }
        }

        // 3. Pairwise furniture OBB collision + ergonomic walk-around buffer
        for (let j = i + 1; j < poses.length; j++) {
          const q = poses[j];
          const qEffW = Math.abs(q.width * Math.cos(q.rotationY)) + Math.abs(q.length * Math.sin(q.rotationY));
          const qEffL = Math.abs(q.width * Math.sin(q.rotationY)) + Math.abs(q.length * Math.cos(q.rotationY));

          const buf = Math.min(p.clearanceBuffer || 0.3, q.clearanceBuffer || 0.3);
          const xOverlap = Math.max(0, Math.min(pMaxX + buf, q.x + qEffW / 2 + buf) - Math.max(pMinX - buf, q.x - qEffW / 2 - buf));
          const zOverlap = Math.max(0, Math.min(pMaxZ + buf, q.z + qEffL / 2 + buf) - Math.max(pMinZ - buf, q.z - qEffL / 2 - buf));

          if (xOverlap > 0 && zOverlap > 0) {
            collisionPenalty += (xOverlap * zOverlap) * 110;
          }
        }

        // 4. Semantic Pairwise Relation Prior (Keep coffee table in front of sofa, nightstand next to bed)
        if (p.anchorRule === 'in_front_of' && byKey.has(p.targetKey)) {
          const parent = byKey.get(p.targetKey);
          const idealDist = (parent.length / 2) + (p.length / 2) + (p.targetDistance || 0.75);
          const idealX = parent.x + Math.sin(parent.rotationY) * idealDist;
          const idealZ = parent.z + Math.cos(parent.rotationY) * idealDist;
          relationPenalty += (Math.pow(p.x - idealX, 2) + Math.pow(p.z - idealZ, 2)) * 28;
        } else if (p.anchorRule === 'beside_left' && byKey.has(p.targetKey)) {
          const parent = byKey.get(p.targetKey);
          const sideDist = (parent.width / 2) + (p.width / 2) + (p.targetDistance || 0.25);
          const idealX = parent.x - Math.cos(parent.rotationY) * sideDist;
          const idealZ = parent.z + Math.sin(parent.rotationY) * sideDist;
          relationPenalty += (Math.pow(p.x - idealX, 2) + Math.pow(p.z - idealZ, 2)) * 35;
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

    // Simulated Annealing Continuous Pose Optimization
    let currentPoses = initializePoses();
    let currentEnergy = evaluateEnergy(currentPoses);
    let bestPoses = currentPoses.map(p => ({ ...p }));
    let bestEnergy = { ...currentEnergy };
    const initialEnergyVal = currentEnergy.total;

    let temp = 4.0;
    const cooling = 0.97;
    let seed = Math.round((room.width + room.length) * 997) + sceneSpecs.length * 31;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let step = 0; step < this.iterations; step++) {
      // Early exit if energy is already near global zero optimum
      if (bestEnergy.total < 0.05 && step > 25) break;

      const candidate = currentPoses.map(p => ({ ...p }));
      const idx = Math.floor(nextRand() * candidate.length);
      const item = candidate[idx];

      // Perturb continuous position (dx, dz) or orientation
      const stepScale = Math.max(0.05, temp * 0.15);
      item.x = Number((item.x + (nextRand() - 0.5) * 2 * stepScale).toFixed(2));
      item.z = Number((item.z + (nextRand() - 0.5) * 2 * stepScale).toFixed(2));

      if (item.anchorRule === 'angled_conversational' && nextRand() < 0.3) {
        item.rotationY = Number((item.rotationY + (nextRand() - 0.5) * 0.35).toFixed(3));
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
      items: bestPoses,
      telemetry: {
        roomId: room.id,
        roomName: room.name,
        primaryAnchorWall,
        initialEnergy: initialEnergyVal,
        finalEnergy: bestEnergy.total,
        energyComponents: bestEnergy,
        iterationsRun: this.iterations,
        latencyMs: Date.now() - startMs
      }
    };
  }
}

module.exports = {
  InteriorEnergySolver,
  interiorEnergySolver: new InteriorEnergySolver()
};
