// src/agent/solver.js
// Neuro-Symbolic Spatial Constraint & Simulated Annealing Optimization Solver
// Optimizes non-overlapping 2D floorplan topology against LLM-synthesized Bubble Graphs:
//   - Attraction edges (e.g. Kitchen <-> Dining, Primary Bed <-> En-Suite)
//   - Acoustic Repulsion edges (e.g. Nursery <-/-> Living TV, Bathroom <-/-> Kitchen)
//   - Solar Azimuth orientation preferences (East morning sun, South/West afternoon light)
//   - Exterior perimeter exposure guarantees for habitable rooms (IBC 1205.1 natural light)
//   - Exact 1D shared wall segment & exterior perimeter segment extraction for doorways and windows

/**
 * Represents a 2D bounding rectangle [x, z, width, length]
 * Center coordinate is (x, z), extents are [x - width/2, x + width/2], [z - length/2, z + length/2]
 */
class RoomBox {
  constructor(id, name, type, width, length, height = 3.0, meta = {}) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.width = Number(width.toFixed(2));
    this.length = Number(length.toFixed(2));
    this.height = Number(height.toFixed(2));
    this.x = 0;
    this.z = 0;
    this.area = Number((this.width * this.length).toFixed(2));
    this.solarPreference = meta.solarPreference || this._defaultSolar(type); // 'east' | 'south' | 'west' | 'north' | 'core'
    this.privacyLevel = meta.privacyLevel !== undefined ? meta.privacyLevel : this._defaultPrivacy(type); // 0.0 (public) -> 1.0 (private)
    this.requiresWindow = meta.requiresWindow !== undefined ? meta.requiresWindow : (type !== 'bathroom' && type !== 'corridor');
  }

  _defaultSolar(type) {
    const map = {
      living: 'south',
      kitchen: 'east',
      dining: 'south',
      bedroom: 'east',
      office: 'north',
      bathroom: 'core',
      balcony: 'south'
    };
    return map[type] || 'south';
  }

  _defaultPrivacy(type) {
    const map = {
      living: 0.1,
      balcony: 0.2,
      dining: 0.25,
      kitchen: 0.3,
      office: 0.65,
      bathroom: 0.75,
      bedroom: 0.95
    };
    return map[type] !== undefined ? map[type] : 0.5;
  }

  clone() {
    const copy = new RoomBox(this.id, this.name, this.type, this.width, this.length, this.height, {
      solarPreference: this.solarPreference,
      privacyLevel: this.privacyLevel,
      requiresWindow: this.requiresWindow
    });
    copy.x = this.x;
    copy.z = this.z;
    return copy;
  }

  get minX() { return this.x - this.width / 2; }
  get maxX() { return this.x + this.width / 2; }
  get minZ() { return this.z - this.length / 2; }
  get maxZ() { return this.z + this.length / 2; }

  intersects(other, epsilon = 1e-4) {
    return !(
      this.maxX <= other.minX + epsilon ||
      this.minX >= other.maxX - epsilon ||
      this.maxZ <= other.minZ + epsilon ||
      this.minZ >= other.maxZ - epsilon
    );
  }

  intersectionArea(other) {
    const xOverlap = Math.max(0, Math.min(this.maxX, other.maxX) - Math.max(this.minX, other.minX));
    const zOverlap = Math.max(0, Math.min(this.maxZ, other.maxZ) - Math.max(this.minZ, other.minZ));
    return Number((xOverlap * zOverlap).toFixed(4));
  }

  /**
   * Computes exact shared boundary segment between this room and `other`,
   * including which wall of `this` and `other` touch, and the exact midpoint (portalX, portalZ).
   */
  sharesBoundaryWith(other, tolerance = 0.08) {
    const xStart = Math.max(this.minX, other.minX);
    const xEnd = Math.min(this.maxX, other.maxX);
    const xOverlap = Math.max(0, xEnd - xStart);

    const zStart = Math.max(this.minZ, other.minZ);
    const zEnd = Math.min(this.maxZ, other.maxZ);
    const zOverlap = Math.max(0, zEnd - zStart);

    // Check Z boundaries (North/Front = +Z, South/Back = -Z)
    const thisFrontTouchesOtherBack = Math.abs(this.maxZ - other.minZ) <= tolerance;
    const thisBackTouchesOtherFront = Math.abs(this.minZ - other.maxZ) <= tolerance;

    if ((thisFrontTouchesOtherBack || thisBackTouchesOtherFront) && xOverlap > 0.4) {
      const sharedMidX = Number(((xStart + xEnd) / 2).toFixed(2));
      const sharedZ = Number((thisFrontTouchesOtherBack ? this.maxZ : this.minZ).toFixed(2));
      return {
        touches: true,
        axis: 'Z',
        sharedLength: Number(xOverlap.toFixed(2)),
        segmentStart: Number(xStart.toFixed(2)),
        segmentEnd: Number(xEnd.toFixed(2)),
        portalX: sharedMidX,
        portalZ: sharedZ,
        roomAWallPosition: thisFrontTouchesOtherBack ? 'front' : 'back',
        roomBWallPosition: thisFrontTouchesOtherBack ? 'back' : 'front',
        roomAOffsetRatio: Number(Math.max(0.2, Math.min(0.8, (sharedMidX - this.minX) / this.width)).toFixed(2)),
        roomBOffsetRatio: Number(Math.max(0.2, Math.min(0.8, (sharedMidX - other.minX) / other.width)).toFixed(2))
      };
    }

    // Check X boundaries (East/Right = +X, West/Left = -X)
    const thisRightTouchesOtherLeft = Math.abs(this.maxX - other.minX) <= tolerance;
    const thisLeftTouchesOtherRight = Math.abs(this.minX - other.maxX) <= tolerance;

    if ((thisRightTouchesOtherLeft || thisLeftTouchesOtherRight) && zOverlap > 0.4) {
      const sharedMidZ = Number(((zStart + zEnd) / 2).toFixed(2));
      const sharedX = Number((thisRightTouchesOtherLeft ? this.maxX : this.minX).toFixed(2));
      return {
        touches: true,
        axis: 'X',
        sharedLength: Number(zOverlap.toFixed(2)),
        segmentStart: Number(zStart.toFixed(2)),
        segmentEnd: Number(zEnd.toFixed(2)),
        portalX: sharedX,
        portalZ: sharedMidZ,
        roomAWallPosition: thisRightTouchesOtherLeft ? 'right' : 'left',
        roomBWallPosition: thisRightTouchesOtherLeft ? 'left' : 'right',
        roomAOffsetRatio: Number(Math.max(0.2, Math.min(0.8, (sharedMidZ - this.minZ) / this.length)).toFixed(2)),
        roomBOffsetRatio: Number(Math.max(0.2, Math.min(0.8, (sharedMidZ - other.minZ) / other.length)).toFixed(2))
      };
    }

    return { touches: false, sharedLength: 0 };
  }

  /**
   * Computes which of the 4 walls ('front', 'back', 'left', 'right') have unobstructed exterior exposure
   */
  getExteriorWallExposures(allBoxes, tolerance = 0.12) {
    const exposures = [];
    const sides = [
      { position: 'front', axis: 'X', coord: this.maxZ, min: this.minX, max: this.maxX, length: this.width, azimuth: 'south' },
      { position: 'back', axis: 'X', coord: this.minZ, min: this.minX, max: this.maxX, length: this.width, azimuth: 'north' },
      { position: 'right', axis: 'Z', coord: this.maxX, min: this.minZ, max: this.maxZ, length: this.length, azimuth: 'east' },
      { position: 'left', axis: 'Z', coord: this.minX, min: this.minZ, max: this.maxZ, length: this.length, azimuth: 'west' }
    ];

    for (const side of sides) {
      let coveredLength = 0;
      for (const other of allBoxes) {
        if (other.id === this.id) continue;
        if (side.position === 'front' && Math.abs(other.minZ - side.coord) <= tolerance) {
          coveredLength += Math.max(0, Math.min(side.max, other.maxX) - Math.max(side.min, other.minX));
        } else if (side.position === 'back' && Math.abs(other.maxZ - side.coord) <= tolerance) {
          coveredLength += Math.max(0, Math.min(side.max, other.maxX) - Math.max(side.min, other.minX));
        } else if (side.position === 'right' && Math.abs(other.minX - side.coord) <= tolerance) {
          coveredLength += Math.max(0, Math.min(side.max, other.maxZ) - Math.max(side.min, other.minZ));
        } else if (side.position === 'left' && Math.abs(other.maxX - side.coord) <= tolerance) {
          coveredLength += Math.max(0, Math.min(side.max, other.maxZ) - Math.max(side.min, other.minZ));
        }
      }
      const freeLength = Math.max(0, side.length - coveredLength);
      if (freeLength >= 1.2) {
        exposures.push({
          position: side.position,
          azimuth: side.azimuth,
          exposedLength: Number(freeLength.toFixed(2)),
          exposureRatio: Number((freeLength / side.length).toFixed(2))
        });
      }
    }
    return exposures;
  }
}

/**
 * Neuro-Symbolic Topological Constraint & Simulated Annealing Solver
 */
class SpatialConstraintSolver {
  constructor(options = {}) {
    this.wallThickness = options.wallThickness || 0.2;
    this.boundaryPadding = options.boundaryPadding || 0.0;
    this.saIterations = options.saIterations || 180;
  }

  /**
   * Builds default architectural Bubble Graph (attraction & repulsion weights) if not supplied by LLM
   */
  _buildDefaultBubbleGraph(boxes) {
    const attractions = [];
    const repulsions = [];

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const pair = [a.type, b.type].sort().join(':');

        if (pair === 'kitchen:living' || pair === 'dining:kitchen' || pair === 'dining:living') {
          attractions.push({ sourceId: a.id, targetId: b.id, weight: 0.95, reason: 'Social dining & open-concept flow' });
        } else if (pair === 'bathroom:bedroom') {
          attractions.push({ sourceId: a.id, targetId: b.id, weight: 0.85, reason: 'En-suite bedroom convenience' });
        } else if (pair === 'balcony:living' || pair === 'balcony:bedroom') {
          attractions.push({ sourceId: a.id, targetId: b.id, weight: 0.80, reason: 'Indoor-outdoor terrace access' });
        } else if (pair === 'bathroom:kitchen') {
          repulsions.push({ sourceId: a.id, targetId: b.id, weight: 0.90, reason: 'Sanitary & acoustic separation between bath and kitchen' });
        } else if (pair === 'bedroom:living' && boxes.length >= 4) {
          repulsions.push({ sourceId: a.id, targetId: b.id, weight: 0.45, reason: 'Acoustic privacy buffer from living salon' });
        }
      }
    }
    return { attractions, repulsions };
  }

  /**
   * Deterministic candidate placement for a single permutation & aspect-ratio genome
   */
  _packCandidateGenome(orderedBoxes, aspectMutations, bubbleGraph) {
    const placedBoxes = [];
    const boxes = orderedBoxes.map((b, idx) => {
      const clone = b.clone();
      const mult = aspectMutations[idx] || 1.0;
      if (mult !== 1.0) {
        const area = clone.area;
        // Round to even hundredths (0.02m increments) so width/2 and length/2 are exact decimals
        const rawW = Math.max(2.4, Math.min(11.0, clone.width * mult));
        clone.width = Number((Math.round(rawW * 50) / 50).toFixed(2));
        const rawL = Math.max(2.4, Math.min(11.0, area / clone.width));
        clone.length = Number((Math.round(rawL * 50) / 50).toFixed(2));
        clone.area = Number((clone.width * clone.length).toFixed(2));
      }
      return clone;
    });

    const hub = boxes[0];
    hub.x = 0;
    hub.z = 0;
    placedBoxes.push(hub);

    for (let i = 1; i < boxes.length; i++) {
      const current = boxes[i];
      let bestCandidate = null;
      let minEnergy = Infinity;

      for (const placed of placedBoxes) {
        const candidates = [
          // Cardinal flush centers
          { x: placed.x, z: placed.maxZ + current.length / 2 },
          { x: placed.x, z: placed.minZ - current.length / 2 },
          { x: placed.maxX + current.width / 2, z: placed.z },
          { x: placed.minX - current.width / 2, z: placed.z },
          // Aligned corner variations (flush architectural walls)
          { x: placed.minX + current.width / 2, z: placed.maxZ + current.length / 2 },
          { x: placed.maxX - current.width / 2, z: placed.maxZ + current.length / 2 },
          { x: placed.minX + current.width / 2, z: placed.minZ - current.length / 2 },
          { x: placed.maxX - current.width / 2, z: placed.minZ - current.length / 2 },
          { x: placed.maxX + current.width / 2, z: placed.minZ + current.length / 2 },
          { x: placed.maxX + current.width / 2, z: placed.maxZ - current.length / 2 },
          { x: placed.minX - current.width / 2, z: placed.minZ + current.length / 2 },
          { x: placed.minX - current.width / 2, z: placed.maxZ - current.length / 2 }
        ];

        for (const pos of candidates) {
          current.x = Number(pos.x.toFixed(2));
          current.z = Number(pos.z.toFixed(2));

          // Hard Constraint: Strictly 0.00% Overlap
          let overlaps = false;
          for (const other of placedBoxes) {
            if (current.intersects(other)) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) continue;

          // Evaluate local placement energy
          const distToCenter = Math.hypot(current.x, current.z);
          let sharedEdgeTotal = 0;
          let bubbleBonus = 0;

          for (const other of placedBoxes) {
            const b = current.sharesBoundaryWith(other);
            if (b.touches) {
              sharedEdgeTotal += b.sharedLength;

              // Check Bubble Graph attraction/repulsion
              for (const attr of bubbleGraph.attractions) {
                if ((attr.sourceId === current.id && attr.targetId === other.id) ||
                    (attr.sourceId === other.id && attr.targetId === current.id)) {
                  bubbleBonus += attr.weight * 5.0;
                }
              }
              for (const rep of bubbleGraph.repulsions) {
                if ((rep.sourceId === current.id && rep.targetId === other.id) ||
                    (rep.sourceId === other.id && rep.targetId === current.id)) {
                  bubbleBonus -= rep.weight * 6.0;
                }
              }
            }
          }

          // Solar orientation alignment reward
          let solarBonus = 0;
          if (current.solarPreference === 'east' && current.x > 0) solarBonus += 1.8;
          if (current.solarPreference === 'south' && current.z > 0) solarBonus += 1.8;
          if (current.solarPreference === 'west' && current.x < 0) solarBonus += 1.8;
          if (current.solarPreference === 'north' && current.z < 0) solarBonus += 1.8;

          const localEnergy = distToCenter * 1.35 - sharedEdgeTotal * 2.4 - bubbleBonus - solarBonus;
          if (localEnergy < minEnergy) {
            minEnergy = localEnergy;
            bestCandidate = { x: current.x, z: current.z };
          }
        }
      }

      if (bestCandidate) {
        current.x = bestCandidate.x;
        current.z = bestCandidate.z;
        placedBoxes.push(current);
      } else {
        const maxCurrentX = Math.max(...placedBoxes.map(b => b.maxX));
        current.x = Number((maxCurrentX + current.width / 2).toFixed(2));
        current.z = 0;
        placedBoxes.push(current);
      }
    }

    return placedBoxes;
  }

  /**
   * Computes global Neuro-Symbolic Multi-Objective Energy for a full floorplan candidate
   * Lower energy = better architectural layout
   */
  _evaluateGlobalObjective(placedBoxes, bubbleGraph) {
    const minX = Math.min(...placedBoxes.map(b => b.minX));
    const maxX = Math.max(...placedBoxes.map(b => b.maxX));
    const minZ = Math.min(...placedBoxes.map(b => b.minZ));
    const maxZ = Math.max(...placedBoxes.map(b => b.maxZ));

    const totalNetArea = placedBoxes.reduce((acc, b) => acc + b.area, 0);
    const grossArea = Math.max(1, (maxX - minX) * (maxZ - minZ));
    const compactnessRatio = totalNetArea / grossArea;

    // 1. Compactness Energy
    const compactnessEnergy = (1.0 - compactnessRatio) * 25.0;

    // 2. Adjacency & Bubble Graph Satisfaction
    const touchMap = new Set();
    let sharedWallPerimeter = 0;
    for (let i = 0; i < placedBoxes.length; i++) {
      for (let j = i + 1; j < placedBoxes.length; j++) {
        const b = placedBoxes[i].sharesBoundaryWith(placedBoxes[j]);
        if (b.touches && b.sharedLength >= 0.9) {
          const key = [placedBoxes[i].id, placedBoxes[j].id].sort().join('__');
          touchMap.add(key);
          sharedWallPerimeter += b.sharedLength;
        }
      }
    }

    let attractionPenalty = 0;
    let satisfiedAttractions = 0;
    for (const attr of bubbleGraph.attractions) {
      const key = [attr.sourceId, attr.targetId].sort().join('__');
      if (touchMap.has(key)) {
        satisfiedAttractions++;
      } else {
        attractionPenalty += attr.weight * 8.0;
      }
    }

    let repulsionPenalty = 0;
    for (const rep of bubbleGraph.repulsions) {
      const key = [rep.sourceId, rep.targetId].sort().join('__');
      if (touchMap.has(key)) {
        repulsionPenalty += rep.weight * 12.0;
      }
    }

    // 3. Daylight / Exterior Window Exposure Penalty (IBC 1205.1)
    let daylightPenalty = 0;
    let daylightRoomsSatisfied = 0;
    let daylightRoomsTotal = 0;
    for (const box of placedBoxes) {
      const exposures = box.getExteriorWallExposures(placedBoxes);
      if (box.requiresWindow) {
        daylightRoomsTotal++;
        if (exposures.length === 0) {
          daylightPenalty += 20.0; // Critical penalty for windowless habitable room
        } else {
          daylightRoomsSatisfied++;
        }
      }
    }

    const totalEnergy = compactnessEnergy + attractionPenalty + repulsionPenalty + daylightPenalty - (sharedWallPerimeter * 0.6);

    return {
      totalEnergy: Number(totalEnergy.toFixed(3)),
      compactnessRatio: Number(compactnessRatio.toFixed(3)),
      satisfiedAttractions,
      totalAttractions: bubbleGraph.attractions.length,
      daylightSatisfactionRate: daylightRoomsTotal > 0 ? Number((daylightRoomsSatisfied / daylightRoomsTotal).toFixed(3)) : 1.0
    };
  }

  /**
   * Solve room positions using Simulated Annealing over Topological Slicing Permutations
   * @param {Array} roomRequests Array of { name, type, targetArea | (width, length), solarPreference, privacyLevel }
   * @param {Object} options { bubbleGraph, saIterations }
   */
  solve(roomRequests, options = {}) {
    if (!roomRequests || roomRequests.length === 0) {
      return { rooms: [], adjacencies: [], metrics: { overlapRate: 0, totalArea: 0 } };
    }

    const startSolveMs = Date.now();

    // 1. Normalize and dimension room requests
    const initialBoxes = roomRequests.map((req, idx) => {
      const id = req.id || `room_${idx}_${req.type}`;
      let w = req.width;
      let l = req.length;

      if (!w || !l) {
        const targetArea = req.targetArea || this._getDefaultArea(req.type);
        const aspect = req.aspectRatio || this._getDefaultAspectRatio(req.type);
        w = Math.sqrt(targetArea * aspect);
        l = targetArea / w;
      }

      w = Math.max(2.4, Math.min(12.0, w));
      l = Math.max(2.4, Math.min(12.0, l));

      return new RoomBox(id, req.name || `Room ${idx + 1}`, req.type, w, l, req.height || 3.0, {
        solarPreference: req.solarPreference,
        privacyLevel: req.privacyLevel,
        requiresWindow: req.requiresWindow
      });
    });

    // 2. Sort initial baseline by architectural priority (Living hub anchored at index 0)
    const typePriority = { living: 1, kitchen: 2, dining: 3, bedroom: 4, office: 5, bathroom: 6, balcony: 7 };
    initialBoxes.sort((a, b) => (typePriority[a.type] || 99) - (typePriority[b.type] || 99) || (b.area - a.area));

    const bubbleGraph = options.bubbleGraph || this._buildDefaultBubbleGraph(initialBoxes);
    const iterations = options.saIterations !== undefined ? options.saIterations : this.saIterations;

    // 3. Simulated Annealing Optimization Loop over (Ordering Genome, Aspect Ratio Genome)
    let currentOrder = [...initialBoxes];
    let currentAspects = new Array(initialBoxes.length).fill(1.0);
    let currentBoxes = this._packCandidateGenome(currentOrder, currentAspects, bubbleGraph);
    let currentEval = this._evaluateGlobalObjective(currentBoxes, bubbleGraph);

    let bestBoxes = currentBoxes.map(b => b.clone());
    let bestEval = { ...currentEval };
    const initialEnergy = currentEval.totalEnergy;
    const energyTrace = [initialEnergy];

    let temp = 12.0;
    const coolingRate = 0.965;
    let acceptedTransitions = 0;

    // Deterministic pseudo-random generator for reproducible benchmarks
    let seed = initialBoxes.length * 1337 + Math.round(initialBoxes[0].area * 100);
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    if (initialBoxes.length > 1) {
      for (let step = 0; step < iterations; step++) {
        const candidateOrder = [...currentOrder];
        const candidateAspects = [...currentAspects];

        // Mutation operator 1: Swap two non-hub rooms in packing sequence
        if (candidateOrder.length > 2 && nextRand() < 0.65) {
          const idxA = 1 + Math.floor(nextRand() * (candidateOrder.length - 1));
          const idxB = 1 + Math.floor(nextRand() * (candidateOrder.length - 1));
          const tmp = candidateOrder[idxA];
          candidateOrder[idxA] = candidateOrder[idxB];
          candidateOrder[idxB] = tmp;
        } else {
          // Mutation operator 2: Perturb room aspect ratio within architectural limits [0.88, 1.14]
          const mIdx = Math.floor(nextRand() * candidateAspects.length);
          const choices = [0.88, 0.94, 1.0, 1.06, 1.12];
          candidateAspects[mIdx] = choices[Math.floor(nextRand() * choices.length)];
        }

        const candidateBoxes = this._packCandidateGenome(candidateOrder, candidateAspects, bubbleGraph);
        const candidateEval = this._evaluateGlobalObjective(candidateBoxes, bubbleGraph);

        const deltaE = candidateEval.totalEnergy - currentEval.totalEnergy;
        if (deltaE < 0 || Math.exp(-deltaE / Math.max(0.05, temp)) > nextRand()) {
          currentOrder = candidateOrder;
          currentAspects = candidateAspects;
          currentBoxes = candidateBoxes;
          currentEval = candidateEval;
          acceptedTransitions++;

          if (candidateEval.totalEnergy < bestEval.totalEnergy) {
            bestBoxes = candidateBoxes.map(b => b.clone());
            bestEval = { ...candidateEval };
          }
        }

        if (step % 20 === 0) {
          energyTrace.push(bestEval.totalEnergy);
        }
        temp *= coolingRate;
      }
    }

    const placedBoxes = bestBoxes;

    // 4. Center the entire plan so the geometric centroid is at (0, 0)
    const minX = Math.min(...placedBoxes.map(b => b.minX));
    const maxX = Math.max(...placedBoxes.map(b => b.maxX));
    const minZ = Math.min(...placedBoxes.map(b => b.minZ));
    const maxZ = Math.max(...placedBoxes.map(b => b.maxZ));

    const offsetX = Number(((minX + maxX) / 2).toFixed(2));
    const offsetZ = Number(((minZ + maxZ) / 2).toFixed(2));

    placedBoxes.forEach(b => {
      b.x = Number((b.x - offsetX).toFixed(2));
      b.z = Number((b.z - offsetZ).toFixed(2));
    });

    // 5. Extract exact shared boundary wall segments, door portals, and exterior window exposures
    const adjacencies = [];
    let totalIntersectionArea = 0;

    for (let i = 0; i < placedBoxes.length; i++) {
      for (let j = i + 1; j < placedBoxes.length; j++) {
        const b1 = placedBoxes[i];
        const b2 = placedBoxes[j];

        const overlap = b1.intersectionArea(b2);
        totalIntersectionArea += overlap;

        const boundary = b1.sharesBoundaryWith(b2);
        if (boundary.touches) {
          adjacencies.push({
            roomAId: b1.id,
            roomAName: b1.name,
            roomBId: b2.id,
            roomBName: b2.name,
            sharedLength: boundary.sharedLength,
            axis: boundary.axis,
            portalX: boundary.portalX,
            portalZ: boundary.portalZ,
            roomAWallPosition: boundary.roomAWallPosition,
            roomBWallPosition: boundary.roomBWallPosition,
            roomAOffsetRatio: boundary.roomAOffsetRatio,
            roomBOffsetRatio: boundary.roomBOffsetRatio
          });
        }
      }
    }

    const totalNetArea = placedBoxes.reduce((acc, b) => acc + b.area, 0);
    const boundingBoxGrossArea = (maxX - minX) * (maxZ - minZ);
    const compactnessRatio = Number((totalNetArea / Math.max(1, boundingBoxGrossArea)).toFixed(3));
    const solveLatencyMs = Date.now() - startSolveMs;

    return {
      success: true,
      rooms: placedBoxes.map(b => {
        const exteriorExposures = b.getExteriorWallExposures(placedBoxes);
        return {
          id: b.id,
          name: b.name,
          type: b.type,
          width: b.width,
          length: b.length,
          height: b.height,
          area: b.area,
          x: b.x,
          z: b.z,
          solarPreference: b.solarPreference,
          privacyLevel: b.privacyLevel,
          exteriorExposures,
          bounds: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }
        };
      }),
      adjacencies,
      bubbleGraph,
      metrics: {
        totalRooms: placedBoxes.length,
        totalNetAreaSqM: Number(totalNetArea.toFixed(2)),
        grossEnvelopeSqM: Number(boundingBoxGrossArea.toFixed(2)),
        compactnessRatio,
        overlapRate: Number(totalIntersectionArea.toFixed(4)),
        adjacencyCount: adjacencies.length,
        daylightSatisfactionRate: bestEval.daylightSatisfactionRate,
        optimization: {
          algorithm: 'Simulated Annealing over Slicing Permutations',
          iterations: initialBoxes.length > 1 ? iterations : 1,
          acceptedMoves: acceptedTransitions,
          initialEnergy: Number(initialEnergy.toFixed(2)),
          finalEnergy: Number(bestEval.totalEnergy.toFixed(2)),
          energyImprovementPct: initialEnergy !== 0
            ? `${Number((Math.max(0, (initialEnergy - bestEval.totalEnergy) / Math.abs(initialEnergy)) * 100).toFixed(1))}%`
            : '0.0%',
          energyTrace,
          solveLatencyMs
        }
      }
    };
  }

  _getDefaultArea(type) {
    const areas = {
      living: 28.0,
      kitchen: 14.0,
      bedroom: 18.0,
      bathroom: 6.5,
      dining: 12.0,
      office: 13.5,
      balcony: 7.0
    };
    return areas[type] || 15.0;
  }

  _getDefaultAspectRatio(type) {
    const aspects = {
      living: 1.2,
      kitchen: 1.1,
      bedroom: 1.15,
      bathroom: 1.05,
      dining: 1.1,
      office: 1.1
    };
    return aspects[type] || 1.15;
  }
}

module.exports = {
  RoomBox,
  SpatialConstraintSolver
};
