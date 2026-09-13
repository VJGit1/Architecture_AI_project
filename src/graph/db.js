// src/graph/db.js
// Enterprise-grade, resilient Neo4j Graph Connection & Spatial Service

require('dotenv').config();
const neo4j = require('neo4j-driver');
const { v4: uuidv4 } = require('uuid');

const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'qwerty123';

let driver = null;
let isConnected = false;
let connectionAttempted = false;

// Resilient In-Memory Graph Store (used when Neo4j is offline or during local testing)
const inMemoryStore = {
  rooms: new Map(),
  walls: new Map(),
  floors: new Map(),
  openings: new Map(),
  furniture: new Map()
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

// Safe execution helper: Always closes session and falls back to memory store if Neo4j is offline
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

// --- PROJECT GRAPH REPOSITORY METHODS ---

// Get entire building graph for 3D hydration
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

      return {
        isConnected: true,
        source: 'neo4j',
        rooms,
        floors,
        walls,
        openings,
        furniture
      };
    });
  }

  // In-Memory state
  return {
    isConnected: false,
    source: 'in-memory',
    rooms: Array.from(inMemoryStore.rooms.values()),
    floors: Array.from(inMemoryStore.floors.values()),
    walls: Array.from(inMemoryStore.walls.values()),
    openings: Array.from(inMemoryStore.openings.values()),
    furniture: Array.from(inMemoryStore.furniture.values())
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

// Add an Opening (Door or Window) to a Wall
async function createOpening({
  wallId,
  type = 'door', // 'door' | 'window'
  width = 0.9,
  height = 2.1,
  depth = 0.15,
  offsetRatio = 0.5, // 0.0 to 1.0 along wall width
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
  type = 'sofa', // 'sofa' | 'bed' | 'table' | 'chair' | 'island' | 'plant' | 'rug'
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
      furniture: inMemoryStore.furniture.size
    }
  })
};
