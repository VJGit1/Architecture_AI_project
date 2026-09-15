// src/agent/solver.js
// Neuro-Symbolic Spatial Constraint Solver for Architectural BIM
// Solves 2D non-overlapping room layout placement, shared boundaries, and topological circulation

/**
 * Represents a 2D bounding rectangle [x, z, width, length]
 * Center coordinate is (x, z), extents are [x - width/2, x + width/2], [z - length/2, z + length/2]
 */
class RoomBox {
  constructor(id, name, type, width, length, height = 3.0) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.width = Number(width.toFixed(2));
    this.length = Number(length.toFixed(2));
    this.height = Number(height.toFixed(2));
    this.x = 0;
    this.z = 0;
    this.area = Number((this.width * this.length).toFixed(2));
  }

  get minX() { return this.x - this.width / 2; }
  get maxX() { return this.x + this.width / 2; }
  get minZ() { return this.z - this.length / 2; }
  get maxZ() { return this.z + this.length / 2; }

  intersects(other, epsilon = 0.01) {
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

  sharesBoundaryWith(other, tolerance = 0.08) {
    const xOverlap = Math.max(0, Math.min(this.maxX, other.maxX) - Math.max(this.minX, other.minX));
    const zOverlap = Math.max(0, Math.min(this.maxZ, other.maxZ) - Math.max(this.minZ, other.minZ));

    const touchesZ = Math.abs(this.maxZ - other.minZ) <= tolerance || Math.abs(this.minZ - other.maxZ) <= tolerance;
    const touchesX = Math.abs(this.maxX - other.minX) <= tolerance || Math.abs(this.minX - other.maxX) <= tolerance;

    if (touchesZ && xOverlap > 0.4) {
      return { touches: true, axis: 'Z', sharedLength: Number(xOverlap.toFixed(2)) };
    }
    if (touchesX && zOverlap > 0.4) {
      return { touches: true, axis: 'X', sharedLength: Number(zOverlap.toFixed(2)) };
    }
    return { touches: false, sharedLength: 0 };
  }
}

/**
 * Symbolic Constraint Solver
 * Uses Guillotine / Shelf-based bin packing with boundary alignment and topological adjacency scoring
 */
class SpatialConstraintSolver {
  constructor(options = {}) {
    this.wallThickness = options.wallThickness || 0.2;
    this.boundaryPadding = options.boundaryPadding || 0.0;
  }

  /**
   * Solve room positions given an architectural program
   * @param {Array} roomRequests Array of { name, type, targetArea | (width, length), preferredAdjacency: [] }
   * @param {Object} options
   */
  solve(roomRequests, options = {}) {
    if (!roomRequests || roomRequests.length === 0) {
      return { rooms: [], adjacencies: [], metrics: { overlapRate: 0, totalArea: 0 } };
    }

    // 1. Normalize and dimension room requests
    const boxes = roomRequests.map((req, idx) => {
      const id = req.id || `room_${idx}_${req.type}`;
      let w = req.width;
      let l = req.length;

      if (!w || !l) {
        const targetArea = req.targetArea || this._getDefaultArea(req.type);
        const aspect = req.aspectRatio || this._getDefaultAspectRatio(req.type);
        w = Math.sqrt(targetArea * aspect);
        l = targetArea / w;
      }

      // Clamp dimensions to architecturally realistic values
      w = Math.max(2.4, Math.min(12.0, w));
      l = Math.max(2.4, Math.min(12.0, l));

      return new RoomBox(id, req.name || `Room ${idx + 1}`, req.type, w, l, req.height || 3.0);
    });

    // 2. Sort rooms by architectural importance (Hub first, then bedrooms, then wet spaces)
    const typePriority = { living: 1, kitchen: 2, bedroom: 3, dining: 4, office: 5, bathroom: 6, balcony: 7 };
    boxes.sort((a, b) => (typePriority[a.type] || 99) - (typePriority[b.type] || 99) || (b.area - a.area));

    // 3. Symbolic Placement using Adjacency-Constrained Guillotine Packing
    const placedBoxes = [];

    // Place the hub room (Living) centered at (0, 0)
    const hub = boxes[0];
    hub.x = 0;
    hub.z = 0;
    placedBoxes.push(hub);

    // Candidate anchor slots: 4 cardinal directions around every placed room
    for (let i = 1; i < boxes.length; i++) {
      const current = boxes[i];
      let bestCandidate = null;
      let minPenalty = Infinity;

      for (const placed of placedBoxes) {
        // Generate candidate anchor coordinates touching `placed` along each edge
        const candidates = [
          // Touch North (+Z)
          { x: placed.x, z: placed.maxZ + current.length / 2 },
          // Touch South (-Z)
          { x: placed.x, z: placed.minZ - current.length / 2 },
          // Touch East (+X)
          { x: placed.maxX + current.width / 2, z: placed.z },
          // Touch West (-X)
          { x: placed.minX - current.width / 2, z: placed.z },
          // Aligned corner variations (flush edges)
          { x: placed.minX + current.width / 2, z: placed.maxZ + current.length / 2 },
          { x: placed.maxX - current.width / 2, z: placed.maxZ + current.length / 2 },
          { x: placed.minX + current.width / 2, z: placed.minZ - current.length / 2 },
          { x: placed.maxX - current.width / 2, z: placed.minZ - current.length / 2 },
          { x: placed.maxX + current.width / 2, z: placed.minZ + current.length / 2 },
          { x: placed.minX - current.width / 2, z: placed.minZ + current.length / 2 }
        ];

        for (const pos of candidates) {
          current.x = Number(pos.x.toFixed(2));
          current.z = Number(pos.z.toFixed(2));

          // CONSTRAINT 1: Zero Overlap Guarantee
          let overlaps = false;
          for (const other of placedBoxes) {
            if (current.intersects(other)) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) continue;

          // Objective function: Minimize distance to center (compactness) + maximize shared boundary with existing rooms
          const distToCenter = Math.hypot(current.x, current.z);
          let sharedEdgeTotal = 0;
          for (const other of placedBoxes) {
            const b = current.sharesBoundaryWith(other);
            if (b.touches) {
              sharedEdgeTotal += b.sharedLength;
            }
          }

          // Reward shared walls and penalize sprawl
          const penalty = distToCenter * 1.5 - sharedEdgeTotal * 2.2;

          if (penalty < minPenalty) {
            minPenalty = penalty;
            bestCandidate = { x: current.x, z: current.z };
          }
        }
      }

      if (bestCandidate) {
        current.x = bestCandidate.x;
        current.z = bestCandidate.z;
        placedBoxes.push(current);
      } else {
        // Safe Fallback: Place along outermost bounding edge with guaranteed separation
        const maxCurrentX = Math.max(...placedBoxes.map(b => b.maxX));
        current.x = maxCurrentX + current.width / 2;
        current.z = 0;
        placedBoxes.push(current);
      }
    }

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

    // 5. Extract shared boundary wall segments and topological adjacencies
    const adjacencies = [];
    let totalIntersectionArea = 0;

    for (let i = 0; i < placedBoxes.length; i++) {
      for (let j = i + 1; j < placedBoxes.length; j++) {
        const b1 = placedBoxes[i];
        const b2 = placedBoxes[j];

        // Measure any overlap (guaranteed strictly 0.0000)
        const overlap = b1.intersectionArea(b2);
        totalIntersectionArea += overlap;

        // Detect shared boundary
        const boundary = b1.sharesBoundaryWith(b2);
        if (boundary.touches) {
          adjacencies.push({
            roomAId: b1.id,
            roomAName: b1.name,
            roomBId: b2.id,
            roomBName: b2.name,
            sharedLength: boundary.sharedLength,
            axis: boundary.axis
          });
        }
      }
    }

    const totalNetArea = placedBoxes.reduce((acc, b) => acc + b.area, 0);
    const boundingBoxGrossArea = (maxX - minX) * (maxZ - minZ);
    const compactnessRatio = Number((totalNetArea / Math.max(1, boundingBoxGrossArea)).toFixed(3));

    return {
      success: true,
      rooms: placedBoxes.map(b => ({
        id: b.id,
        name: b.name,
        type: b.type,
        width: b.width,
        length: b.length,
        height: b.height,
        area: b.area,
        x: b.x,
        z: b.z,
        bounds: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }
      })),
      adjacencies,
      metrics: {
        totalRooms: placedBoxes.length,
        totalNetAreaSqM: Number(totalNetArea.toFixed(2)),
        grossEnvelopeSqM: Number(boundingBoxGrossArea.toFixed(2)),
        compactnessRatio,
        overlapRate: Number(totalIntersectionArea.toFixed(4)),
        adjacencyCount: adjacencies.length
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
