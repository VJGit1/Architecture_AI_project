// server.js 
// This is the server file for the project.
// It is responsible for handling the API requests and responses.
// It is also responsible for connecting to the Neo4j database.
// It is also responsible for serving the static files for the frontend.

const express = require('express');
const neo4j = require('neo4j-driver');

const app = express();
const port = 3000;

// --- Database Connection ---
const uri = 'neo4j://localhost'; // Or your Neo4j Aura URI
const user = 'neo4j'; // Default user
const password = 'qwerty123'; // The password you set!

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
const session = driver.session();

console.log('Connected to Neo4j!');


app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});


// This line allows your server to understand JSON data from the frontend
app.use(express.json());

// This line serves the static files from the public directory
app.use(express.static('public'));

// --- API Endpoint to Add a Floor ---
app.post('/api/addFloor', async (req, res) => {
  try {
    const { width = 20, length = 20, material = 'concrete', floorNumber = 1 } = req.body;
    
    // Cypher query to create a Floor node in Neo4j
    const result = await session.run(
      'CREATE (f:Floor {id: randomUUID(), width: $width, length: $length, material: $material, floorNumber: $floorNumber}) RETURN f',
      { width, length, material, floorNumber }
    );
    const newFloor = result.records[0].get('f').properties;
    console.log('Created floor:', newFloor);
    res.status(200).json({ success: true, floor: newFloor });
  } catch (error) {
    console.error('Error creating floor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to Add a Wall ---
app.post('/api/addWall', async (req, res) => {
  try {
    // Cypher query to create a Wall node in Neo4j
    const result = await session.run(
      'CREATE (w:Wall {id: randomUUID(), height: 3, width: 5}) RETURN w'
    );
    const newWall = result.records[0].get('w').properties;
    console.log('Created wall:', newWall);
    res.status(200).json({ success: true, wall: newWall });
  } catch (error) {
    console.error('Error creating wall:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to Add a Door ---
app.post('/api/addDoor', async (req, res) => {
  try {
    const { wallId, width = 0.9, height = 2.1, thickness = 0.05, material = 'wood', type = 'interior', openingDirection = 'left', position = 'center' } = req.body;
    
    if (!wallId) {
      return res.status(400).json({ success: false, error: 'Wall ID is required to place a door.' });
    }

    // First verify the wall exists and get its dimensions
    const wallCheck = await session.run(
      'MATCH (w:Wall {id: $wallId}) RETURN w',
      { wallId }
    );

    if (wallCheck.records.length === 0) {
      return res.status(404).json({ success: false, error: 'Wall not found.' });
    }

    const wall = wallCheck.records[0].get('w').properties;
    
    // Validate door dimensions against wall dimensions
    if (width > wall.width) {
      return res.status(400).json({ success: false, error: 'Door width cannot exceed wall width.' });
    }
    if (height > wall.height) {
      return res.status(400).json({ success: false, error: 'Door height cannot exceed wall height.' });
    }

    // Create door and establish relationship with wall
    const result = await session.run(
      `MATCH (w:Wall {id: $wallId})
       CREATE (d:Door {id: randomUUID(), width: $width, height: $height, thickness: $thickness, material: $material, type: $type, openingDirection: $openingDirection, position: $position})
       CREATE (w)-[:HAS_DOOR]->(d)
       CREATE (d)-[:PART_OF_WALL]->(w)
       RETURN d, w`,
      { wallId, width, height, thickness, material, type, openingDirection, position }
    );

    const newDoor = result.records[0].get('d').properties;
    const wallData = result.records[0].get('w').properties;
    
    console.log('Created door on wall:', { door: newDoor, wall: wallData });
    res.status(200).json({ success: true, door: newDoor, wall: wallData });
  } catch (error) {
    console.error('Error creating door:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to UPDATE a Door ---
app.put('/api/updateDoor/:id', async (req, res) => {
  const doorId = req.params.id;
  const { width, height, thickness, material, type, openingDirection, position } = req.body;

  try {
    const session = driver.session();
    
    // First get the door and its wall to validate dimensions
    const doorCheck = await session.run(
      `MATCH (d:Door {id: $doorId})-[:PART_OF_WALL]->(w:Wall)
       RETURN d, w`,
      { doorId }
    );

    if (doorCheck.records.length === 0) {
      return res.status(404).json({ success: false, error: 'Door not found.' });
    }

    const currentDoor = doorCheck.records[0].get('d').properties;
    const wall = doorCheck.records[0].get('w').properties;

    // Validate new dimensions against wall dimensions
    const newWidth = width || currentDoor.width;
    const newHeight = height || currentDoor.height;
    
    if (newWidth > wall.width) {
      return res.status(400).json({ success: false, error: 'Door width cannot exceed wall width.' });
    }
    if (newHeight > wall.height) {
      return res.status(400).json({ success: false, error: 'Door height cannot exceed wall height.' });
    }

    // Update door properties
    const result = await session.run(
      `MATCH (d:Door {id: $id})
       SET d.width = COALESCE($width, d.width), 
           d.height = COALESCE($height, d.height), 
           d.thickness = COALESCE($thickness, d.thickness),
           d.material = COALESCE($material, d.material),
           d.type = COALESCE($type, d.type),
           d.openingDirection = COALESCE($openingDirection, d.openingDirection),
           d.position = COALESCE($position, d.position)
       RETURN d`,
      {
        id: doorId,
        width,
        height,
        thickness,
        material,
        type,
        openingDirection,
        position,
      }
    );
    await session.close();

    console.log(`Updated door ${doorId}.`);
    res.status(200).json({ success: true, message: 'Door updated.' });
  } catch (error) {
    console.error('Error updating door:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to DELETE a Door ---
app.delete('/api/deleteDoor/:id', async (req, res) => {
  const doorId = req.params.id;

  try {
    const session = driver.session();
    const result = await session.run(
      `MATCH (d:Door {id: $id})
       OPTIONAL MATCH (d)-[r]-()
       DELETE r, d
       RETURN count(d) as deletedCount`,
      { id: doorId }
    );
    await session.close();

    const deletedCount = result.records[0].get('deletedCount').toNumber();
    
    if (deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Door not found.' });
    }

    console.log(`Deleted door ${doorId}.`);
    res.status(200).json({ success: true, message: 'Door deleted.' });
  } catch (error) {
    console.error('Error deleting door:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to GET all Doors ---
app.get('/api/doors', async (req, res) => {
  try {
    const session = driver.session();
    const result = await session.run(
      `MATCH (d:Door)
       OPTIONAL MATCH (d)-[:PART_OF_WALL]->(w:Wall)
       RETURN d, w`
    );
    await session.close();

    const doors = result.records.map(record => ({
      door: record.get('d').properties,
      wall: record.get('w') ? record.get('w').properties : null
    }));

    console.log(`Retrieved ${doors.length} doors.`);
    res.status(200).json({ success: true, doors: doors });
  } catch (error) {
    console.error('Error retrieving doors:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to GET doors on a specific wall ---
app.get('/api/walls/:id/doors', async (req, res) => {
  const wallId = req.params.id;

  try {
    const session = driver.session();
    const result = await session.run(
      `MATCH (w:Wall {id: $wallId})-[:HAS_DOOR]->(d:Door)
       RETURN d`,
      { wallId }
    );
    await session.close();

    const doors = result.records.map(record => record.get('d').properties);

    console.log(`Retrieved ${doors.length} doors for wall ${wallId}.`);
    res.status(200).json({ success: true, doors: doors });
  } catch (error) {
    console.error('Error retrieving doors for wall:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to Add a Room ---
app.post('/api/addRoom', async (req, res) => {
  try {
    const { width = 10, length = 10, height = 3 } = req.body;
    
    // Cypher query to create a Room with Floor and 4 Walls as separate nodes
    const result = await session.run(
      `CREATE (r:Room {id: randomUUID(), width: $width, length: $length, height: $height})
       CREATE (f:Floor {id: randomUUID(), width: $width, length: $length, material: 'concrete'})
       CREATE (w1:Wall {id: randomUUID(), width: $width, height: $height, thickness: 0.2, position: 'front', material: 'drywall'})
       CREATE (w2:Wall {id: randomUUID(), width: $width, height: $height, thickness: 0.2, position: 'back', material: 'drywall'})
       CREATE (w3:Wall {id: randomUUID(), width: $length, height: $height, thickness: 0.2, position: 'left', material: 'drywall'})
       CREATE (w4:Wall {id: randomUUID(), width: $length, height: $height, thickness: 0.2, position: 'right', material: 'drywall'})
       CREATE (r)-[:HAS_FLOOR]->(f)
       CREATE (r)-[:HAS_WALL]->(w1)
       CREATE (r)-[:HAS_WALL]->(w2)
       CREATE (r)-[:HAS_WALL]->(w3)
       CREATE (r)-[:HAS_WALL]->(w4)
       CREATE (w1)-[:PART_OF_ROOM]->(r)
       CREATE (w2)-[:PART_OF_ROOM]->(r)
       CREATE (w3)-[:PART_OF_ROOM]->(r)
       CREATE (w4)-[:PART_OF_ROOM]->(r)
       CREATE (f)-[:PART_OF_ROOM]->(r)
       RETURN r, f, w1, w2, w3, w4`,
      { width, length, height }
    );
    
    const record = result.records[0];
    const newRoom = record.get('r').properties;
    const floor = record.get('f').properties;
    const wall1 = record.get('w1').properties;
    const wall2 = record.get('w2').properties;
    const wall3 = record.get('w3').properties;
    const wall4 = record.get('w4').properties;
    
    console.log('Created room with floor and walls:', {
      room: newRoom,
      floor: floor,
      walls: [wall1, wall2, wall3, wall4]
    });
    
    res.status(200).json({ 
      success: true, 
      room: newRoom,
      floor: floor,
      walls: [wall1, wall2, wall3, wall4]
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to UPDATE a Room ---
app.put('/api/updateRoom/:id', async (req, res) => {
    const roomId = req.params.id;
    const { width, length, height } = req.body;
  
    if (!width || !length || !height) {
      return res.status(400).json({ success: false, error: 'Room dimensions are missing.' });
    }
  
    try {
      const session = driver.session();
      // Cypher query to find a room by its ID and update its properties, plus update associated floor and walls
      const result = await session.run(
        `MATCH (r:Room {id: $id})
         MATCH (r)-[:HAS_FLOOR]->(f:Floor)
         MATCH (r)-[:HAS_WALL]->(w:Wall)
         SET r.width = $width, r.length = $length, r.height = $height
         SET f.width = $width, f.length = $length
         SET w.width = CASE 
           WHEN w.position IN ['front', 'back'] THEN $width 
           ELSE $length 
         END
         SET w.height = $height
         RETURN r, f, w`,
        {
          id: roomId,
          width,
          length,
          height,
        }
      );
      await session.close();
  
      if (result.records.length === 0) {
        return res.status(404).json({ success: false, error: 'Room not found.' });
      }
  
      console.log(`Updated room ${roomId} with new dimensions, including floor and walls.`);
      res.status(200).json({ success: true, message: 'Room, floor, and walls updated.' });
    } catch (error) {
      console.error('Error updating room:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

// --- API Endpoint to UPDATE a Floor ---
app.put('/api/updateFloor/:id', async (req, res) => {
    const floorId = req.params.id;
    const { width, length, material, floorNumber } = req.body;
  
    try {
      const session = driver.session();
      // Cypher query to find a floor by its ID and update its properties
      const result = await session.run(
        `MATCH (f:Floor {id: $id})
         SET f.width = COALESCE($width, f.width), 
             f.length = COALESCE($length, f.length), 
             f.material = COALESCE($material, f.material),
             f.floorNumber = COALESCE($floorNumber, f.floorNumber)
         RETURN f`,
        {
          id: floorId,
          width,
          length,
          material,
          floorNumber,
        }
      );
      await session.close();
  
      if (result.records.length === 0) {
        return res.status(404).json({ success: false, error: 'Floor not found.' });
      }
  
      console.log(`Updated floor ${floorId}.`);
      res.status(200).json({ success: true, message: 'Floor updated.' });
    } catch (error) {
      console.error('Error updating floor:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

// --- API Endpoint to UPDATE a Wall ---
app.put('/api/updateWall/:id', async (req, res) => {
    const wallId = req.params.id;
    const { width, height, thickness, material, position } = req.body;
  
    try {
      const session = driver.session();
      // Cypher query to find a wall by its ID and update its properties
      const result = await session.run(
        `MATCH (w:Wall {id: $id})
         SET w.width = COALESCE($width, w.width), 
             w.height = COALESCE($height, w.height), 
             w.thickness = COALESCE($thickness, w.thickness),
             w.material = COALESCE($material, w.material),
             w.position = COALESCE($position, w.position)
         RETURN w`,
        {
          id: wallId,
          width,
          height,
          thickness,
          material,
          position,
        }
      );
      await session.close();
  
      if (result.records.length === 0) {
        return res.status(404).json({ success: false, error: 'Wall not found.' });
      }
  
      console.log(`Updated wall ${wallId}.`);
      res.status(200).json({ success: true, message: 'Wall updated.' });
    } catch (error) {
      console.error('Error updating wall:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

// --- API Endpoint to GET all Rooms with their Floors and Walls ---
app.get('/api/rooms', async (req, res) => {
  try {
    const session = driver.session();
    // Cypher query to get all rooms with their associated floors and walls
    const result = await session.run(
      `MATCH (r:Room)
       OPTIONAL MATCH (r)-[:HAS_FLOOR]->(f:Floor)
       OPTIONAL MATCH (r)-[:HAS_WALL]->(w:Wall)
       RETURN r, f, collect(w) as walls`
    );
    await session.close();

    const rooms = result.records.map(record => ({
      room: record.get('r').properties,
      floor: record.get('f') ? record.get('f').properties : null,
      walls: record.get('walls').map(wall => wall.properties)
    }));

    console.log(`Retrieved ${rooms.length} rooms with their components.`);
    res.status(200).json({ success: true, rooms: rooms });
  } catch (error) {
    console.error('Error retrieving rooms:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to GET all Floors ---
app.get('/api/floors', async (req, res) => {
  try {
    const session = driver.session();
    // Cypher query to get all floors
    const result = await session.run(
      `MATCH (f:Floor) RETURN f`
    );
    await session.close();

    const floors = result.records.map(record => record.get('f').properties);

    console.log(`Retrieved ${floors.length} floors.`);
    res.status(200).json({ success: true, floors: floors });
  } catch (error) {
    console.error('Error retrieving floors:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Endpoint to GET all Walls ---
app.get('/api/walls', async (req, res) => {
  try {
    const session = driver.session();
    // Cypher query to get all walls
    const result = await session.run(
      `MATCH (w:Wall) RETURN w`
    );
    await session.close();

    const walls = result.records.map(record => record.get('w').properties);

    console.log(`Retrieved ${walls.length} walls.`);
    res.status(200).json({ success: true, walls: walls });
  } catch (error) {
    console.error('Error retrieving walls:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
