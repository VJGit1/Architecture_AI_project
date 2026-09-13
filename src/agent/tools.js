// src/agent/tools.js
// Spatial & Architectural Agent Tool Registry

const db = require('../graph/db');

/**
 * Solves and generates an architectural floor plan layout based on user program
 */
async function generateSpatialLayout({
  program = '2-bedroom-apartment', // 'studio' | '1-bedroom' | '2-bedroom' | 'office' | 'custom'
  style = 'modern-open-concept',
  targetSqMeters = 80
}) {
  // Clear any previous scratch layout
  await db.clearAll();

  const createdRooms = [];
  const createdOpenings = [];

  // Architectural program templates with realistic proportions and adjacency
  let roomSpecs = [];

  if (program.includes('studio') || targetSqMeters <= 45) {
    roomSpecs = [
      { name: 'Living & Sleeping Studio', type: 'living', width: 6.5, length: 5.5, height: 2.8, x: 0, z: 0 },
      { name: 'Kitchenette & Dining', type: 'kitchen', width: 4.0, length: 3.5, height: 2.8, x: 5.25, z: 1.0 },
      { name: 'Full Bathroom', type: 'bathroom', width: 2.5, length: 2.5, height: 2.6, x: -4.5, z: 1.5 }
    ];
  } else if (program.includes('1-bedroom') || targetSqMeters <= 65) {
    roomSpecs = [
      { name: 'Living Room', type: 'living', width: 5.5, length: 5.0, height: 2.8, x: 0, z: 0 },
      { name: 'Open Kitchen', type: 'kitchen', width: 3.5, length: 4.0, height: 2.8, x: 4.5, z: 0.5 },
      { name: 'Master Bedroom', type: 'bedroom', width: 4.2, length: 3.8, height: 2.8, x: -4.85, z: -0.6 },
      { name: 'En-Suite Bathroom', type: 'bathroom', width: 2.5, length: 2.8, height: 2.6, x: -4.85, z: 2.7 }
    ];
  } else {
    // Default: 2-bedroom modern apartment
    roomSpecs = [
      { name: 'Living & Dining Area', type: 'living', width: 6.5, length: 5.5, height: 3.0, x: 0, z: 0 },
      { name: 'Gourmet Kitchen', type: 'kitchen', width: 4.0, length: 4.5, height: 3.0, x: 5.25, z: 0.5 },
      { name: 'Primary Bedroom', type: 'bedroom', width: 4.5, length: 4.2, height: 2.8, x: -5.5, z: -1.0 },
      { name: 'Primary Bathroom', type: 'bathroom', width: 2.4, length: 3.0, height: 2.6, x: -5.5, z: 2.6 },
      { name: 'Guest Bedroom / Office', type: 'bedroom', width: 3.8, length: 3.6, height: 2.8, x: 0, z: -4.55 }
    ];
  }

  // Create rooms in database
  for (const spec of roomSpecs) {
    const res = await db.createRoom({
      name: spec.name,
      type: spec.type,
      width: spec.width,
      length: spec.length,
      height: spec.height,
      position: { x: spec.x, y: 0, z: spec.z }
    });
    createdRooms.push(res);

    // Automatically add interior entryway door to main room
    const frontWall = res.walls.find(w => w.position === 'front');
    if (frontWall) {
      try {
        const opening = await db.createOpening({
          wallId: frontWall.id,
          type: spec.type === 'bedroom' ? 'door' : 'door',
          width: 0.9,
          height: 2.1,
          material: 'wood'
        });
        createdOpenings.push(opening);
      } catch (err) {
        // Continue if opening placement encounters edge condition
      }
    }
  }

  const totalCalculatedArea = roomSpecs.reduce((acc, r) => acc + (r.width * r.length), 0).toFixed(1);

  return {
    success: true,
    program,
    style,
    totalRooms: createdRooms.length,
    totalAreaSqM: `${totalCalculatedArea} m² (~${(totalCalculatedArea * 10.764).toFixed(0)} sq ft)`,
    rooms: createdRooms.map(r => ({
      id: r.room.id,
      name: r.room.name,
      type: r.room.type,
      dimensions: `${r.room.width}m x ${r.room.length}m x ${r.room.height}m`,
      area: `${r.room.area} m²`,
      position: `(${r.room.x}, ${r.room.z})`
    })),
    openingsCount: createdOpenings.length
  };
}

/**
 * Validates building codes (IBC / ADA accessibility / egress) against current graph
 */
async function validateBuildingCodes() {
  const state = await db.getProjectState();
  const violations = [];
  const compliantChecks = [];

  if (!state.rooms || state.rooms.length === 0) {
    return {
      status: 'EMPTY_SCENE',
      message: 'No architectural elements found in the scene to evaluate.'
    };
  }

  // 1. Check IBC 1208.3: Habitable room minimum area (>= 70 sq ft = 6.5 sq meters)
  state.rooms.forEach(r => {
    const area = r.area || (r.width * r.length);
    if (area < 6.5 && r.type !== 'bathroom') {
      violations.push({
        code: 'IBC 1208.3',
        severity: 'WARNING',
        entityId: r.id,
        entityName: r.name,
        description: `Room area is ${area.toFixed(1)} m² (${(area * 10.764).toFixed(0)} sq ft). Code requires minimum 6.5 m² (70 sq ft) for habitable rooms.`
      });
    } else {
      compliantChecks.push(`IBC 1208.3: '${r.name}' area (${area.toFixed(1)} m²) satisfies minimum space requirements.`);
    }
  });

  // 2. Check IBC 1208.2: Minimum ceiling height (>= 7.0 ft = 2.13 meters)
  state.rooms.forEach(r => {
    if (r.height < 2.13) {
      violations.push({
        code: 'IBC 1208.2',
        severity: 'CRITICAL',
        entityId: r.id,
        entityName: r.name,
        description: `Ceiling height is ${r.height}m. Code mandates minimum ceiling height of 2.13m (7ft).`
      });
    } else {
      compliantChecks.push(`IBC 1208.2: '${r.name}' ceiling height (${r.height}m) complies with standard.`);
    }
  });

  // 3. Check ADA / IBC 1005.1: Door egress clearances (>= 32 in / 0.81m clear opening)
  state.openings.forEach(o => {
    if (o.type === 'door' && o.width < 0.81) {
      violations.push({
        code: 'ADA 404.2.3 / IBC 1005.1',
        severity: 'CRITICAL',
        entityId: o.id,
        entityName: `Door on Wall ${o.wallId}`,
        description: `Door width is ${o.width}m. Minimum ADA clear opening width is 0.81m (32 in).`
      });
    } else if (o.type === 'door') {
      compliantChecks.push(`ADA 404.2.3: Door (${o.width}m width) satisfies clear width.`);
    }
  });

  return {
    status: violations.length === 0 ? 'COMPLIANT' : 'VIOLATIONS_FOUND',
    totalChecks: compliantChecks.length + violations.length,
    violationCount: violations.length,
    violations,
    passedAuditNotes: compliantChecks.slice(0, 5) // Sample of passed checks
  };
}

/**
 * Adds an architectural door or window opening to a wall
 */
async function addOpeningToWall({ wallId, type = 'door', width = 0.9, height = 2.1, material = 'wood' }) {
  if (!wallId) {
    // If no specific wallId provided, find the first available wall
    const state = await db.getProjectState();
    if (state.walls && state.walls.length > 0) {
      wallId = state.walls[0].id;
    } else {
      throw new Error('No wall available to place an opening.');
    }
  }

  const opening = await db.createOpening({
    wallId,
    type,
    width,
    height,
    material
  });

  return {
    success: true,
    message: `Added ${type} (${width}m x ${height}m) to wall.`,
    opening
  };
}

/**
 * Queries current topology and metrics
 */
async function inspectProjectTopology() {
  const state = await db.getProjectState();
  const totalArea = (state.rooms || []).reduce((acc, r) => acc + (r.area || (r.width * r.length)), 0);
  
  return {
    connectedToDatabase: state.isConnected,
    dataSource: state.source,
    roomCount: state.rooms ? state.rooms.length : 0,
    wallCount: state.walls ? state.walls.length : 0,
    openingCount: state.openings ? state.openings.length : 0,
    totalAreaSqMeters: totalArea.toFixed(1),
    totalAreaSqFeet: (totalArea * 10.764).toFixed(0),
    rooms: (state.rooms || []).map(r => ({ name: r.name, dimensions: `${r.width}x${r.length}m`, type: r.type }))
  };
}

/**
 * Furnishes existing rooms with high-end Architectural Digest interior furniture
 */
async function furnishInteriorSpaces({ style = 'japandi' }) {
  let state = await db.getProjectState();
  if (!state.rooms || state.rooms.length === 0) {
    // Autonomously synthesize a residence first if scene is empty
    await generateSpatialLayout({ program: '2-bedroom-apartment', style });
    state = await db.getProjectState();
  }

  // Clear previous furniture
  db.inMemoryStore.furniture.clear();

  const placedFurniture = [];

  for (const room of state.rooms) {
    const rx = room.x || 0;
    const rz = room.z || 0;
    const rtype = room.type || 'living';

    if (rtype === 'living') {
      const sofa = await db.createFurniture({
        roomId: room.id,
        name: 'Curved Bouclé Sofa',
        type: 'sofa',
        width: 2.6,
        length: 1.1,
        height: 0.75,
        x: rx,
        y: 0.38,
        z: rz - 0.5,
        rotationY: 0,
        material: style === 'mid-century' ? 'cognac-leather' : 'boucle',
        style
      });

      const table = await db.createFurniture({
        roomId: room.id,
        name: 'Low Sculptural Coffee Table',
        type: 'table',
        width: 1.4,
        length: 0.8,
        height: 0.35,
        x: rx,
        y: 0.18,
        z: rz + 0.8,
        rotationY: 0,
        material: style === 'japandi' ? 'light-oak' : (style === 'mid-century' ? 'walnut' : 'travertine'),
        style
      });

      const plant = await db.createFurniture({
        roomId: room.id,
        name: 'Indoor Olive Tree Planter',
        type: 'plant',
        width: 0.6,
        length: 0.6,
        height: 1.8,
        x: rx - (room.width / 2) + 0.8,
        y: 0.9,
        z: rz - (room.length / 2) + 0.8,
        rotationY: 0,
        material: 'ceramic-greenery',
        style
      });
      placedFurniture.push(sofa, table, plant);
    } else if (rtype === 'bedroom') {
      const bed = await db.createFurniture({
        roomId: room.id,
        name: 'Low Minimalist Platform Bed',
        type: 'bed',
        width: 2.1,
        length: 2.2,
        height: 0.65,
        x: rx,
        y: 0.33,
        z: rz - 0.4,
        rotationY: 0,
        material: style === 'japandi' ? 'linen-oak' : 'boucle-walnut',
        style
      });

      const nightstandL = await db.createFurniture({
        roomId: room.id,
        name: 'Floating Bedside Nightstand',
        type: 'table',
        width: 0.5,
        length: 0.45,
        height: 0.45,
        x: rx - 1.4,
        y: 0.23,
        z: rz - 0.4,
        rotationY: 0,
        material: 'oak',
        style
      });
      placedFurniture.push(bed, nightstandL);
    } else if (rtype === 'kitchen') {
      const island = await db.createFurniture({
        roomId: room.id,
        name: 'Fluted Marble Kitchen Island',
        type: 'island',
        width: 2.4,
        length: 1.0,
        height: 0.9,
        x: rx,
        y: 0.45,
        z: rz,
        rotationY: 0,
        material: 'calacatta-marble',
        style
      });
      placedFurniture.push(island);
    } else if (rtype === 'bathroom') {
      const vanity = await db.createFurniture({
        roomId: room.id,
        name: 'Floating Stone Vanity',
        type: 'island',
        width: 1.2,
        length: 0.6,
        height: 0.8,
        x: rx,
        y: 0.4,
        z: rz - 0.5,
        rotationY: 0,
        material: 'terrazzo',
        style
      });
      placedFurniture.push(vanity);
    }
  }

  return {
    success: true,
    style,
    furnitureCount: placedFurniture.length,
    items: placedFurniture.map(f => ({ name: f.name, type: f.type, material: f.material })),
    message: `Furnished spaces with ${placedFurniture.length} bespoke Architectural Digest pieces (${style} aesthetic).`
  };
}

module.exports = {
  generateSpatialLayout,
  validateBuildingCodes,
  addOpeningToWall,
  inspectProjectTopology,
  furnishInteriorSpaces,
  clearProject: db.clearAll
};
