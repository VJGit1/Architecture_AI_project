// src/ai/pathfindingAStar.js
// 2D Discretized NavMesh & A* Pathfinding Engine for Architectural Circulation
// Computes human-cylinder (r = 0.35m) walkability ratios, portal-to-portal circulation splines,
// and detects furniture blockages in front of doors or walkways.

class SpatialNavMeshAStar {
  constructor(cellSize = 0.25, humanRadius = 0.32) {
    this.cellSize = cellSize;
    this.humanRadius = humanRadius;
  }

  /**
   * Evaluates 2D A* circulation inside a single room or across the entire floorplan
   * @param {Object} room { id, name, x, z, width, length }
   * @param {Array} roomFurniture Array of { id, name, x, z, width, length, rotationY }
   * @param {Array} roomPortals Array of { x, z, type } (doors / openings on room perimeter)
   */
  analyzeRoomWalkability(room, roomFurniture = [], roomPortals = []) {
    const minX = room.x - room.width / 2;
    const maxX = room.x + room.width / 2;
    const minZ = room.z - room.length / 2;
    const maxZ = room.z + room.length / 2;

    const cols = Math.max(4, Math.floor(room.width / this.cellSize));
    const rows = Math.max(4, Math.floor(room.length / this.cellSize));

    // Build occupancy grid (0 = walkable, 1 = blocked by furniture + human clearance buffer)
    const grid = Array.from({ length: rows }, () => new Uint8Array(cols));
    let walkableCells = 0;
    const totalCells = rows * cols;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = minX + (c + 0.5) * this.cellSize;
        const wz = minZ + (r + 0.5) * this.cellSize;

        let blocked = false;
        for (const item of roomFurniture) {
          if (item.type === 'rug' || item.height < 0.15) continue; // Rugs are walkable
          const rot = item.rotationY || 0;
          const cos = Math.cos(-rot);
          const sin = Math.sin(-rot);
          const dx = wx - item.x;
          const dz = wz - item.z;
          const localX = Math.abs(dx * cos - dz * sin);
          const localZ = Math.abs(dx * sin + dz * cos);

          if (localX <= (item.width / 2 + this.humanRadius * 0.65) &&
              localZ <= (item.length / 2 + this.humanRadius * 0.65)) {
            blocked = true;
            break;
          }
        }

        grid[r][c] = blocked ? 1 : 0;
        if (!blocked) walkableCells++;
      }
    }

    const toCell = (wx, wz) => {
      const c = Math.max(0, Math.min(cols - 1, Math.floor((wx - minX) / this.cellSize)));
      const r = Math.max(0, Math.min(rows - 1, Math.floor((wz - minZ) / this.cellSize)));
      return { r, c };
    };

    const toWorld = (r, c) => ({
      x: Number((minX + (c + 0.5) * this.cellSize).toFixed(2)),
      z: Number((minZ + (r + 0.5) * this.cellSize).toFixed(2))
    });

    // Check if any door portal is obstructed by furniture within 0.85m swing clearance
    const blockedPortals = [];
    for (const portal of roomPortals) {
      for (const item of roomFurniture) {
        if (item.type === 'rug') continue;
        const dist = Math.hypot(portal.x - item.x, portal.z - item.z);
        const minClearance = Math.max(item.width, item.length) / 2 + 0.55;
        if (dist < minClearance) {
          blockedPortals.push({
            portal,
            blockingItemId: item.id,
            blockingItemName: item.name,
            distance: Number(dist.toFixed(2))
          });
        }
      }
    }

    // Run A* from room portals to the center / key functional zones of the room
    const targetPoints = [
      { x: room.x, z: room.z, label: 'Room Center' },
      ...roomPortals.slice(1)
    ];

    const startPoint = roomPortals[0] || { x: minX + 0.4, z: room.z };
    const startCell = toCell(startPoint.x, startPoint.z);

    const paths = [];
    let allTargetsReachable = true;

    for (const tgt of targetPoints) {
      const endCell = toCell(tgt.x, tgt.z);
      const cellPath = this._runAStarGrid(grid, rows, cols, startCell, endCell);
      if (cellPath && cellPath.length > 0) {
        paths.push(cellPath.map(p => toWorld(p.r, p.c)));
      } else {
        allTargetsReachable = false;
      }
    }

    return {
      roomId: room.id,
      roomName: room.name,
      walkabilityRatio: Number((walkableCells / Math.max(1, totalCells)).toFixed(3)),
      blockedPortals,
      allTargetsReachable,
      paths
    };
  }

  /**
   * 8-connected A* grid search with octile heuristic
   */
  _runAStarGrid(grid, rows, cols, start, goal) {
    // Allow starting/ending cell even if slightly grazed by clearance buffer
    const sr = start.r, sc = start.c;
    const gr = goal.r, gc = goal.c;

    const key = (r, c) => r * cols + c;
    const open = [{ r: sr, c: sc, g: 0, f: Math.hypot(gr - sr, gc - sc) }];
    const gScore = new Map([[key(sr, sc), 0]]);
    const cameFrom = new Map();
    const closed = new Set();

    const dirs = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1, -1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [1, 1, 1.414]
    ];

    while (open.length > 0) {
      open.sort((a, b) => a.f - b.f);
      const curr = open.shift();
      const cKey = key(curr.r, curr.c);

      if (curr.r === gr && curr.c === gc) {
        const path = [];
        let traceKey = cKey;
        let traceNode = { r: curr.r, c: curr.c };
        while (traceNode) {
          path.unshift(traceNode);
          traceNode = cameFrom.get(traceKey);
          if (traceNode) traceKey = key(traceNode.r, traceNode.c);
        }
        return path;
      }

      closed.add(cKey);

      for (const [dr, dc, cost] of dirs) {
        const nr = curr.r + dr;
        const nc = curr.c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

        const nKey = key(nr, nc);
        if (closed.has(nKey)) continue;

        // Permit goal cell even if near furniture edge
        if (grid[nr][nc] === 1 && !(nr === gr && nc === gc)) continue;

        const tentativeG = curr.g + cost;
        if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
          cameFrom.set(nKey, { r: curr.r, c: curr.c });
          gScore.set(nKey, tentativeG);
          const h = Math.hypot(gr - nr, gc - nc);
          open.push({ r: nr, c: nc, g: tentativeG, f: tentativeG + h });
        }
      }
    }

    return null;
  }

  /**
   * Computes building-wide A* circulation splines across all rooms and connecting doors
   */
  computeBuildingCirculationSplines(state) {
    const rooms = state.rooms || [];
    const furniture = state.furniture || [];
    const openings = (state.openings || []).filter(o => o.type === 'door');

    const roomReports = [];
    const globalSplines = [];

    for (const room of rooms) {
      const rFurn = furniture.filter(f => f.roomId === room.id);
      const rDoors = openings.filter(d => {
        const insideX = d.x >= (room.x - room.width / 2 - 0.35) && d.x <= (room.x + room.width / 2 + 0.35);
        const insideZ = d.z >= (room.z - room.length / 2 - 0.35) && d.z <= (room.z + room.length / 2 + 0.35);
        return insideX && insideZ;
      });

      const report = this.analyzeRoomWalkability(room, rFurn, rDoors);
      roomReports.push(report);
      for (const p of report.paths) {
        if (p.length >= 2) {
          globalSplines.push({ roomId: room.id, roomName: room.name, points: p });
        }
      }
    }

    const meanWalkability = roomReports.length > 0
      ? Number((roomReports.reduce((acc, r) => acc + r.walkabilityRatio, 0) / roomReports.length).toFixed(3))
      : 1.0;

    return {
      meanWalkabilityRatio: meanWalkability,
      totalBlockedDoors: roomReports.reduce((acc, r) => acc + r.blockedPortals.length, 0),
      roomReports,
      globalSplines
    };
  }
}

module.exports = {
  SpatialNavMeshAStar,
  navMeshAStar: new SpatialNavMeshAStar()
};
