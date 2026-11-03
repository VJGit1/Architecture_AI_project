// server.js
// Enterprise Architectural BIM & Neuro-Symbolic Multi-Agent AI Server

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./src/graph/db');
const agent = require('./src/agent/agentCore');
const tools = require('./src/agent/tools');
const { ArchitecturalBenchmarkSuite } = require('./src/agent/evaluator');
const { navMeshAStar } = require('./src/ai/pathfindingAStar');
const { llmProvider } = require('./src/ai/llmProvider');
const { precedentRag } = require('./src/ai/precedentRag');
const catalogStore = require('./src/catalog/catalogStore');
const roomAgent = require('./src/shopper/roomAgent');

const app = express();
const port = process.env.PORT || 3000;
const benchmarkSuite = new ArchitecturalBenchmarkSuite();

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static('public'));

// --- HEALTH & AI ENGINE STATUS ---
app.get('/api/status', async (req, res) => {
  const isConnected = await db.checkConnection();
  res.json({
    success: true,
    database: {
      ...db.getStatus(),
      isConnected
    },
    catalog: catalogStore.getSeedStatus(),
    aiEngine: {
      provider: llmProvider.getActiveProviderName(),
      cloudLLMConfigured: llmProvider.isCloudLLMConfigured(),
      metrics: llmProvider.callMetrics,
      userMemory: precedentRag.userMemory
    },
    version: '3.0.0-neuro-symbolic'
  });
});

// --- HARBOR & CO. CATALOG ---
app.get('/api/catalog', async (req, res) => {
  try {
    const roles = req.query.role ? String(req.query.role).split(',') : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    const products = await catalogStore.listProducts({ roles, maxPrice });
    res.json({ success: true, catalog: catalogStore.getSeedStatus(), products });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- ROOM FIT SHOPPER AGENT ---

// One shopper turn. With { stream: true } the response is NDJSON: one line per tool step, then a final "done" line.
app.post('/api/shopper/turn', async (req, res) => {
  const { sessionId = null, message = '', fields = null, stream = false } = req.body || {};
  if (!String(message).trim() && !(fields && (fields.width || fields.budget))) {
    return res.status(400).json({ success: false, error: 'Describe the room or fill in its size and budget.' });
  }

  const writeLine = (obj) => res.write(`${JSON.stringify(obj)}\n`);
  if (stream) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
  }

  try {
    const result = await roomAgent.runShopperTurn({ sessionId, message, fields }, (evt) => {
      if (stream) writeLine(evt);
    });
    const state = await db.getProjectState();
    const payload = { success: true, ...result, state };
    if (stream) {
      writeLine({ type: 'done', ...payload });
      res.end();
    } else {
      res.json(payload);
    }
  } catch (error) {
    console.error('Shopper turn error:', error);
    if (stream) {
      writeLine({ type: 'error', error: error.message });
      res.end();
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

app.get('/api/shopper/session/:id', async (req, res) => {
  try {
    const session = await roomAgent.getShopperSession(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found.' });
    const state = await db.getProjectState();
    res.json({ success: true, session, state });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- QUANTITATIVE BENCHMARK HARNESS ---
app.get('/api/benchmark', async (req, res) => {
  try {
    const report = await benchmarkSuite.runFullBenchmark();
    res.json({ success: true, ...report });
  } catch (error) {
    console.error('Benchmark error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- SCENE HYDRATION: GET COMPLETE 3D GRAPH + A* CIRCULATION SPLINES ---
app.get('/api/project/state', async (req, res) => {
  try {
    const state = await db.getProjectState();
    const aStarCirculation = navMeshAStar.computeBuildingCirculationSplines(state);
    res.json({ success: true, ...state, aStarCirculation });
  } catch (error) {
    console.error('Error fetching project state:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- AGENTIC AI ENDPOINTS ---

// Standard Multi-Agent Chat Endpoint
app.post('/api/agent/chat', async (req, res) => {
  try {
    const { message, viewportSnapshotBase64 } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required.' });
    }

    const agentResult = await agent.runAgentLoop(message, () => {}, { viewportSnapshotBase64 });
    const updatedState = await db.getProjectState();
    const aStarCirculation = navMeshAStar.computeBuildingCirculationSplines(updatedState);

    res.json({
      success: true,
      ...agentResult,
      updatedState: {
        ...updatedState,
        aStarCirculation
      }
    });
  } catch (error) {
    console.error('Agent loop execution error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Multimodal Vision-Language Moodboard & Sketch-to-3D Endpoint
app.post('/api/agent/vision', async (req, res) => {
  try {
    const { promptText = '', imageBase64 = null, mode = 'moodboard' } = req.body;
    const visionExtraction = await agent.analyzeMultimodalDesignInput({ promptText, imageBase64, mode });
    const extracted = visionExtraction.data;

    // Synthesize 3D layout & energy-optimized furniture from VLM extraction
    const layoutRes = await tools.generateSpatialLayout({
      program: extracted.title || 'Vision-Grounded Residence',
      style: extracted.style || 'japandi',
      customRooms: extracted.rooms
    });
    const furnishRes = await tools.furnishInteriorSpaces({
      style: extracted.style || 'japandi',
      customDirectives: promptText
    });
    const criticRes = await agent.runVisualAndGeometricCritic({});
    const updatedState = await db.getProjectState();
    const aStarCirculation = navMeshAStar.computeBuildingCirculationSplines(updatedState);

    res.json({
      success: true,
      visionExtraction: extracted,
      provider: visionExtraction.provider,
      layout: layoutRes,
      furnishing: furnishRes,
      criticAudit: criticRes.criticAudit,
      updatedState: {
        ...updatedState,
        aStarCirculation
      }
    });
  } catch (error) {
    console.error('Multimodal vision error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Closed-Loop Visual Critic Snapshot Audit Endpoint
app.post('/api/agent/critic', async (req, res) => {
  try {
    const { viewportSnapshotBase64 } = req.body;
    const criticRes = await agent.runVisualAndGeometricCritic({ viewportSnapshotBase64 });
    const updatedState = await db.getProjectState();
    const aStarCirculation = navMeshAStar.computeBuildingCirculationSplines(updatedState);

    res.json({
      success: true,
      ...criticRes,
      updatedState: {
        ...updatedState,
        aStarCirculation
      }
    });
  } catch (error) {
    console.error('Visual critic error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Streaming Agent Chat Endpoint (Server-Sent Events)
app.get('/api/agent/stream', async (req, res) => {
  const message = req.query.message;
  if (!message) {
    return res.status(400).send('Query parameter "message" is required.');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await agent.runAgentLoop(message, (type, payload) => {
      sendEvent(type, payload);
    });

    const state = await db.getProjectState();
    const aStarCirculation = navMeshAStar.computeBuildingCirculationSplines(state);
    sendEvent('state_update', { ...state, aStarCirculation });
    sendEvent('done', result);
  } catch (err) {
    sendEvent('error', { message: err.message });
  } finally {
    res.end();
  }
});

// Direct Tool Execution Endpoint
app.post('/api/agent/tool', async (req, res) => {
  try {
    const { tool, args } = req.body;
    const result = await agent.executeTool(tool, args || {});
    const updatedState = await db.getProjectState();
    const aStarCirculation = navMeshAStar.computeBuildingCirculationSplines(updatedState);
    res.json({ success: true, result, updatedState: { ...updatedState, aStarCirculation } });
  } catch (error) {
    console.error('Direct tool error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- DIRECT MANIPULATION & PERSISTENCE ENDPOINTS ---

app.post('/api/addRoom', async (req, res) => {
  try {
    const { name = 'Custom Room', width = 6, length = 6, height = 3, position = { x: 0, y: 0, z: 0 } } = req.body;
    const roomResult = await db.createRoom({ name, width, length, height, position });
    res.status(200).json({ success: true, ...roomResult });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/updateRoom/:id', async (req, res) => {
  try {
    const roomId = req.params.id;
    const { width, length, height, x, y, z } = req.body;
    const updated = await db.updateRoomTransform(roomId, { width, length, height, x, y, z });
    const updatedState = await db.getProjectState();
    const aStarCirculation = navMeshAStar.computeBuildingCirculationSplines(updatedState);
    res.status(200).json({ success: true, room: updated, updatedState: { ...updatedState, aStarCirculation } });
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/addDoor', async (req, res) => {
  try {
    const { wallId, width = 0.9, height = 2.1, material = 'wood' } = req.body;
    const opening = await db.createOpening({ wallId, type: 'door', width, height, material });
    res.status(200).json({ success: true, door: opening });
  } catch (error) {
    console.error('Error creating door:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/clear', async (req, res) => {
  try {
    const result = await db.clearAll();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Server & Probe Neo4j
app.listen(port, async () => {
  console.log(`🚀 Architecture AI Platform (v3.0 Neuro-Symbolic) running at http://localhost:${port}`);
  await db.checkConnection();
  try {
    const seed = await catalogStore.seedCatalog();
    console.log(`Seeded ${seed.count} Harbor & Co. products (${seed.persistedTo}).`);
  } catch (err) {
    console.warn(`Catalog seed fell back to memory only: ${err.message}`);
  }
});
