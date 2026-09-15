// src/graph/db.js
// Enterprise-grade, resilient Neo4j Graph Connection & Spatial Service
// Supports connected architectural topology, room adjacencies, and circulation pathways

require('dotenv').config();
const neo4j = require('neo4j-driver');
const { v4: uuidv4 } = require('uuid');

const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'qwerty123';

let driver = null;
let isConnected = false;
let connectionAttempted = false;

// Resilient In-Memory Graph Store (used when Neo4j is offline or during testing)
const inMemoryStore = {
  rooms: new Map(),
  walls: new Map(),
  floors: new Map(),
  openings: new Map(),
  furniture: new Map(),
  adjacencies: [],
  connections: []
};

function initDriver() {
  if (driver) return driver;
  try {
    driver = neo4j.driver(
      uri,
      neo4j.auth.basic(user, password),
      {
        maxConnectionPoolSize: 50,
        connectionTimeout: 3000,
        maxTransactionRetryTime: 5000
      }
    );
    return driver;
  } catch (err) {
    console.warn('⚠️ Neo4j Driver initialization warning:', err.message);
    return null;
  }
}

async function checkConnection() {
  const d = initDriver();
  if (!d) {
    isConnected = false;
    connectionAttempted = true;
    return false;
  }
  const session = d.session();
  try {
    await session.run('RETURN 1 AS ping');
    isConnected = true;
    console.log(`✅ Connected successfully to Neo4j at ${uri}`);
    return true;
  } catch (err) {
    isConnected = false;
    console.log(`ℹ️ Neo4j is offline (${err.code || err.message}). Operating in resilient In-Memory Graph Mode.`);
    return false;
  } finally {
    await session.close();
    connectionAttempted = true;
  }
}

// Safe execution helper: Always closes session and handles errors
async function withSession(workFn) {
  if (!connectionAttempted) {
    await checkConnection();
  }

  if (isConnected && driver) {
    const session = driver.session();
    try {
      return await workFn(session);
    } catch (error) {
      console.error('Neo4j query execution error:', error.message);
      throw error;
    } finally {
      await session.close();
    }
  }
  return null;
}

// Helper: Compile interactive 2D/3D Graph Network payload
function buildGraphTopology({ rooms, floors, walls, openings, furniture, adjacencies = [], connections = [] }) {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();

  // Add Rooms (Hub nodes)
  rooms.forEach(r => {
    if (!seenNodes.has(r.id)) {
      seenNodes.add(r.id);
      nodes.push({
        id: r.id,
        label: r.name || 'Room',
        sublabel: `${r.area || (r.width * r.length).toFixed(1)} m²`,
        group: 'room',
        type: r.type || 'living',
        size: 26,
        color: '#e8b4b8', // Rose Gold
        strokeColor: '#f7d6d0',
        x: r.x,
        y: r.y || 0,
        z: r.z,
        data: { ...r }
      });
    }
  });

  // Add Floors
  floors.forEach(f => {
    if (!seenNodes.has(f.id)) {
      seenNodes.add(f.id);
      nodes.push({
        id: f.id,
        label: f.name || 'Floor',
        group: 'floor',
        size: 14,
        color: '#c86d51', // Terracotta
        strokeColor: '#e07a5f',
        x: f.x,
        z: f.z,
        data: { ...f }
      });
    }
  });

  // Add Walls
  walls.forEach(w => {
    if (!seenNodes.has(w.id)) {
      seenNodes.add(w.id);
      nodes.push({
        id: w.id,
        label: w.name || 'Wall',
        group: 'wall',
        size: 12,
        color: '#8e7a96', // Slate Amethyst
        strokeColor: '#b4a0bc',
        x: w.x,
        z: w.z,
        data: { ...w }
      });
    }
  });

  // Add Openings (Doors/Windows)
  openings.forEach(o => {
    if (!seenNodes.has(o.id)) {
      seenNodes.add(o.id);
      nodes.push({
        id: o.id,
        label: `${o.type === 'door' ? '🚪' : '🪟'} ${o.type || 'Opening'}`,
        group: 'opening',
        size: 13,
        color: '#f7d6d0', // Blush
        strokeColor: '#eed9c4',
        x: o.x,
        z: o.z,
        data: { ...o }
      });
    }
  });

  // Add Furniture
  furniture.forEach(fu => {
    if (!seenNodes.has(fu.id)) {
      seenNodes.add(fu.id);
      nodes.push({
        id: fu.id,
        label: fu.name || 'Furniture',
        sublabel: fu.style || 'japandi',
        group: 'furniture',
        size: 16,
        color: '#d4a373', // Champagne Sand
        strokeColor: '#eed9c4',
        x: fu.x,
        z: fu.z,
        data: { ...fu }
      });
    }
  });

  // Structural Edges (Room -> Floor, Room -> Wall, Wall -> Opening, Room -> Furniture)
  rooms.forEach(r => {
    if (r.floor && r.floor.id) {
      edges.push({ id: `e_${r.id}_${r.floor.id}`, source: r.id, target: r.floor.id, type: 'HAS_FLOOR', color: 'rgba(200, 109, 81, 0.45)' });
    }
    if (r.walls && Array.isArray(r.walls)) {
      r.walls.forEach(w => {
        edges.push({ id: `e_${r.id}_${w.id}`, source: r.id, target: w.id, type: 'HAS_WALL', color: 'rgba(142, 122, 150, 0.45)' });
      });
    }
  });

  openings.forEach(o => {
    if (o.wallId) {
      edges.push({ id: `e_${o.wallId}_${o.id}`, source: o.wallId, target: o.id, type: 'HAS_OPENING', color: 'rgba(247, 214, 208, 0.6)' });
    }
  });

  furniture.forEach(fu => {
    if (fu.roomId) {
      edges.push({ id: `e_${fu.roomId}_${fu.id}`, source: fu.roomId, target: fu.id, type: 'CONTAINS_FURNITURE', color: 'rgba(212, 163, 115, 0.55)' });
    }
  });

  // Topological Adjacency Edges (Room <--> Room)
  const seenAdj = new Set();
  adjacencies.forEach(adj => {
    const key = [adj.source || adj.roomAId, adj.target || adj.roomBId].sort().join('__');
    if (!seenAdj.has(key)) {
      seenAdj.add(key);
      edges.push({
        id: `adj_${key}`,
        source: adj.source || adj.roomAId,
        target: adj.target || adj.roomBId,
        type: 'ADJACENT_TO',
        label: `${adj.sharedLength || 0}m`,
        color: '#eed9c4', // Champagne glow
        width: 2.5,
        dashed: true
      });
    }
  });

  // Circulation Edges (Doorway paths)
  connections.forEach((conn, idx) => {
    edges.push({
      id: `conn_${idx}_${conn.source}_${conn.target}`,
      source: conn.source,
      target: conn.target,
      type: 'CONNECTS_TO',
      label: 'walkway',
      color: '#52b788', // Emerald mint glow
      width: 3.0,
      dashed: false
    });
  });

  return { nodes, edges };
}

// --- PROJECT GRAPH REPOSITORY METHODS ---

// Get entire building graph for 3D hydration & 2D Knowledge Graph
async function getProjectState() {
  if (isConnected) {
    return await withSession(async (session) => {
      const roomRes = await session.run(`
        MATCH (r:Room)
        OPTIONAL MATCH (r)-[:HAS_FLOOR]->(f:Floor)
        OPTIONAL MATCH (r)-[:HAS_WALL]->(w:Wall)
        RETURN r, f, collect(DISTINCT w) as walls
      `);

      const rooms = roomRes.records.map(record => {
        const r = record.get('r').properties;
        const f = record.get('f') ? record.get('f').properties : null;
        const walls = record.get('walls').map(w => w.properties);
        return { ...r, floor: f, walls };
      });

      const floorRes = await session.run(`MATCH (f:Floor) RETURN f`);
      const floors = floorRes.records.map(r => r.get('f').properties);

      const wallRes = await session.run(`MATCH (w:Wall) RETURN w`);
      const walls = wallRes.records.map(r => r.get('w').properties);

      const openingRes = await session.run(`
        MATCH (o:Opening)
        OPTIONAL MATCH (w:Wall)-[:HAS_OPENING]->(o)
        RETURN o, w.id AS wallId
      `);
      const openings = openingRes.records.map(r => ({
        ...r.get('o').properties,
        wallId: r.get('wallId')
      }));

      const furnitureRes = await session.run(`MATCH (fu:Furniture) RETURN fu`);
      const furniture = furnitureRes.records.map(r => r.get('fu').properties);

      // Query connected topological relationships
      let adjacencies = [];
      try {
        const adjRes = await session.run(`
          MATCH (r1:Room)-[a:ADJACENT_TO]->(r2:Room)
          RETURN r1.id AS source, r2.id AS target, a.sharedLength AS sharedLength, a.axis AS axis
        `);
        adjacencies = adjRes.records.map(r => ({
          source: r.get('source'),
          target: r.get('target'),
          sharedLength: r.get('sharedLength'),
          axis: r.get('axis')
        }));
      } catch (err) {
        adjacencies = inMemoryStore.adjacencies;
      }

      let connections = [];
      try {
        const connRes = await session.run(`
          MATCH (r1:Room)-[c:CONNECTS_TO]->(r2:Room)
          RETURN r1.id AS source, r2.id AS target, c.viaDoor AS viaDoor, c.distance AS distance
        `);
        connections = connRes.records.map(r => ({
          source: r.get('source'),
          target: r.get('target'),
          viaDoor: r.get('viaDoor'),
          distance: r.get('distance')
        }));
      } catch (err) {
        connections = inMemoryStore.connections;
      }

      const graph = buildGraphTopology({ rooms, floors, walls, openings, furniture, adjacencies, connections });

      return {
        isConnected: true,
        source: 'neo4j',
        rooms,
        floors,
        walls,
        openings,
        furniture,
        adjacencies,
        connections,
        graph
      };
    });
  }

  // In-Memory state
  const rooms = Array.from(inMemoryStore.rooms.values());
  const floors = Array.from(inMemoryStore.floors.values());
  const walls = Array.from(inMemoryStore.walls.values());
  const openings = Array.from(inMemoryStore.openings.values());
  const furniture = Array.from(inMemoryStore.furniture.values());
  const adjacencies = inMemoryStore.adjacencies || [];
  const connections = inMemoryStore.connections || [];

  const graph = buildGraphTopology({ rooms, floors, walls, openings, furniture, adjacencies, connections });

  return {
    isConnected: false,
    source: 'in-memory',
    rooms,
    floors,
    walls,
    openings,
    furniture,
    adjacencies,
    connections,
    graph
  };
}

// Create or Save a Room with 4 walls and floor
async function createRoom({
  name = 'Room',
  type = 'living',
  width = 6,
  length = 6,
  height = 3,
  position = { x: 0, y: 0, z: 0 },
  material = 'drywall'
}) {
  const roomId = uuidv4();
  const floorId = uuidv4();
  const wallThickness = 0.2;

  // Bounding walls centered relative to room position
  const wallsData = [
    {
      id: uuidv4(),
      name: `${name} Front Wall`,
      position: 'front',
      width: width,
      height: height,
      thickness: wallThickness,
      material: material,
      x: position.x,
      y: position.y + height / 2,
      z: position.z + length / 2,
      rotationY: 0,
      isLoadBearing: true
    },
    {
      id: uuidv4(),
      name: `${name} Back Wall`,
      position: 'back',
      width: width,
      height: height,
      thickness: wallThickness,
      material: material,
      x: position.x,
      y: position.y + height / 2,
      z: position.z - length / 2,
      rotationY: 0,
      isLoadBearing: true
    },
    {
      id: uuidv4(),
      name: `${name} Left Wall`,
      position: 'left',
      width: length,
      height: height,
      thickness: wallThickness,
      material: material,
      x: position.x - width / 2,
      y: position.y + height / 2,
      z: position.z,
      rotationY: Math.PI / 2,
      isLoadBearing: false
    },
    {
      id: uuidv4(),
      name: `${name} Right Wall`,
      position: 'right',
      width: length,
      height: height,
      thickness: wallThickness,
      material: material,
      x: position.x + width / 2,
      y: position.y + height / 2,
      z: position.z,
      rotationY: Math.PI / 2,
      isLoadBearing: false
    }
  ];

  const floorData = {
    id: floorId,
    name: `${name} Floor`,
    width: width,
    length: length,
    material: 'hardwood',
    floorNumber: 1,
    x: position.x,
    y: position.y,
    z: position.z
  };

  const roomData = {
    id: roomId,
    name,
    type,
    width,
    length,
    height,
    area: Number((width * length).toFixed(2)),
    x: position.x,
    y: position.y,
    z: position.z
  };

  // Persist to Neo4j if online
  if (isConnected) {
    await withSession(async (session) => {
      await session.run(
        `
        CREATE (r:Room {
          id: $room.id, name: $room.name, type: $room.type,
          width: $room.width, length: $room.length, height: $room.height,
          area: $room.area, x: $room.x, y: $room.y, z: $room.z
        })
        CREATE (f:Floor {
          id: $floor.id, name: $floor.name, width: $floor.width, length: $floor.length,
          material: $floor.material, floorNumber: $floor.floorNumber,
          x: $floor.x, y: $floor.y, z: $floor.z
        })
        CREATE (r)-[:HAS_FLOOR]->(f)
        CREATE (f)-[:PART_OF_ROOM]->(r)
        WITH r
        UNWIND $walls AS wData
        CREATE (w:Wall {
          id: wData.id, name: wData.name, position: wData.position,
          width: wData.width, height: wData.height, thickness: wData.thickness,
          material: wData.material, isLoadBearing: wData.isLoadBearing,
          x: wData.x, y: wData.y, z: wData.z, rotationY: wData.rotationY
        })
        CREATE (r)-[:HAS_WALL]->(w)
        CREATE (w)-[:PART_OF_ROOM]->(r)
        `,
        { room: roomData, floor: floorData, walls: wallsData }
      );
    });
  }

  // Always update in-memory cache
  inMemoryStore.rooms.set(roomId, { ...roomData, floor: floorData, walls: wallsData });
  inMemoryStore.floors.set(floorId, floorData);
  wallsData.forEach(w => inMemoryStore.walls.set(w.id, w));

  return { room: roomData, floor: floorData, walls: wallsData };
}

// Persist shared boundary relationship between two rooms
async function createAdjacency({ roomAId, roomBId, sharedLength = 0, axis = 'X' }) {
  if (isConnected) {
    await withSession(async (session) => {
      await session.run(`
        MATCH (a:Room {id: $roomAId}), (b:Room {id: $roomBId})
        MERGE (a)-[r:ADJACENT_TO]->(b)
        SET r.sharedLength = $sharedLength, r.axis = $axis
        MERGE (b)-[r2:ADJACENT_TO]->(a)
        SET r2.sharedLength = $sharedLength, r2.axis = $axis
      `, { roomAId, roomBId, sharedLength, axis });
    });
  }

  inMemoryStore.adjacencies.push({
    source: roomAId,
    target: roomBId,
    sharedLength,
    axis
  });
  return { success: true };
}

// Persist doorway circulation connection between two rooms
async function createConnection({ roomAId, roomBId, viaDoor = '', distance = 1.0 }) {
  if (isConnected) {
    await withSession(async (session) => {
      await session.run(`
        MATCH (a:Room {id: $roomAId}), (b:Room {id: $roomBId})
        MERGE (a)-[c:CONNECTS_TO]->(b)
        SET c.viaDoor = $viaDoor, c.distance = $distance
        MERGE (b)-[c2:CONNECTS_TO]->(a)
        SET c2.viaDoor = $viaDoor, c2.distance = $distance
      `, { roomAId, roomBId, viaDoor, distance });
    });
  }

  inMemoryStore.connections.push({
    source: roomAId,
    target: roomBId,
    viaDoor,
    distance
  });
  return { success: true };
}

// Add an Opening (Door or Window) to a Wall
async function createOpening({
  wallId,
  type = 'door', // 'door' | 'window'
  width = 0.9,
  height = 2.1,
  depth = 0.15,
  offsetRatio = 0.5,
  material = 'wood'
}) {
  const openingId = uuidv4();
  
  // Find wall
  let wall = inMemoryStore.walls.get(wallId);

  if (isConnected) {
    const wallRes = await withSession(async (session) => {
      const res = await session.run('MATCH (w:Wall {id: $wallId}) RETURN w', { wallId });
      return res.records[0] ? res.records[0].get('w').properties : null;
    });
    if (wallRes) wall = wallRes;
  }

  if (!wall) {
    throw new Error(`Wall with ID ${wallId} not found.`);
  }

  const openingData = {
    id: openingId,
    wallId,
    type,
    width,
    height,
    depth,
    offsetRatio,
    material,
    x: wall.x,
    y: (wall.y - (wall.height / 2)) + (height / 2),
    z: wall.z,
    rotationY: wall.rotationY || 0
  };

  if (isConnected) {
    await withSession(async (session) => {
      await session.run(
        `
        MATCH (w:Wall {id: $wallId})
        CREATE (o:Opening {
          id: $opening.id, type: $opening.type, width: $opening.width,
          height: $opening.height, depth: $opening.depth, offsetRatio: $opening.offsetRatio,
          material: $opening.material, x: $opening.x, y: $opening.y, z: $opening.z,
          rotationY: $opening.rotationY
        })
        CREATE (w)-[:HAS_OPENING]->(o)
        CREATE (o)-[:PART_OF_WALL]->(w)
        `,
        { wallId, opening: openingData }
      );
    });
  }

  inMemoryStore.openings.set(openingId, openingData);
  return openingData;
}

// Update Room Transform and Dimensions
async function updateRoomTransform(id, { width, length, height, x, y, z }) {
  const room = inMemoryStore.rooms.get(id);
  if (room) {
    if (width !== undefined) room.width = width;
    if (length !== undefined) room.length = length;
    if (height !== undefined) room.height = height;
    if (x !== undefined) room.x = x;
    if (y !== undefined) room.y = y;
    if (z !== undefined) room.z = z;
    room.area = Number(((room.width || 6) * (room.length || 6)).toFixed(2));
  }

  if (isConnected) {
    await withSession(async (session) => {
      await session.run(
        `
        MATCH (r:Room {id: $id})
        SET r.width = COALESCE($width, r.width),
            r.length = COALESCE($length, r.length),
            r.height = COALESCE($height, r.height),
            r.x = COALESCE($x, r.x),
            r.y = COALESCE($y, r.y),
            r.z = COALESCE($z, r.z),
            r.area = toFloat(COALESCE($width, r.width)) * toFloat(COALESCE($length, r.length))
        `,
        { id, width, length, height, x, y, z }
      );
    });
  }
  return room;
}

// Add Furniture to Room
async function createFurniture({
  roomId,
  name = 'Furniture',
  type = 'sofa',
  width = 2.0,
  length = 1.0,
  height = 0.8,
  x = 0,
  y = 0,
  z = 0,
  rotationY = 0,
  material = 'boucle',
  style = 'japandi'
}) {
  const furnitureId = uuidv4();
  const fData = {
    id: furnitureId,
    roomId,
    name,
    type,
    width,
    length,
    height,
    x,
    y,
    z,
    rotationY,
    material,
    style
  };

  if (isConnected) {
    await withSession(async (session) => {
      await session.run(`
        MATCH (r:Room {id: $roomId})
        CREATE (fu:Furniture {
          id: $f.id, name: $f.name, type: $f.type, width: $f.width,
          length: $f.length, height: $f.height, x: $f.x, y: $f.y, z: $f.z,
          rotationY: $f.rotationY, material: $f.material, style: $f.style
        })
        CREATE (r)-[:CONTAINS_FURNITURE]->(fu)
      `, { roomId, f: fData });
    });
  }

  inMemoryStore.furniture.set(furnitureId, fData);
  return fData;
}

// Clear all nodes in project
async function clearAll() {
  inMemoryStore.rooms.clear();
  inMemoryStore.walls.clear();
  inMemoryStore.floors.clear();
  inMemoryStore.openings.clear();
  inMemoryStore.furniture.clear();
  inMemoryStore.adjacencies = [];
  inMemoryStore.connections = [];

  if (isConnected) {
    await withSession(async (session) => {
      await session.run('MATCH (n) DETACH DELETE n');
    });
  }
  return { success: true, message: 'All spatial nodes and relationships cleared.' };
}

module.exports = {
  checkConnection,
  getProjectState,
  createRoom,
  createOpening,
  createFurniture,
  createAdjacency,
  createConnection,
  updateRoomTransform,
  clearAll,
  inMemoryStore,
  getStatus: () => ({
    isConnected,
    uri,
    nodeCounts: {
      rooms: inMemoryStore.rooms.size,
      walls: inMemoryStore.walls.size,
      floors: inMemoryStore.floors.size,
      openings: inMemoryStore.openings.size,
      furniture: inMemoryStore.furniture.size,
      adjacencies: inMemoryStore.adjacencies.length,
      connections: inMemoryStore.connections.length
    }
  })
};
