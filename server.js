// server.js
// Enterprise Architectural BIM & Agentic AI Server

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./src/graph/db');
const agent = require('./src/agent/agentCore');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- HEALTH & STATUS ---
app.get('/api/status', async (req, res) => {
  const isConnected = await db.checkConnection();
  res.json({
    success: true,
    database: {
      ...db.getStatus(),
      isConnected
    },
    version: '2.0.0-agentic'
  });
});

// --- SCENE HYDRATION: GET COMPLETE 3D GRAPH ---
app.get('/api/project/state', async (req, res) => {
  try {
    const state = await db.getProjectState();
    res.json({ success: true, ...state });
  } catch (error) {
    console.error('Error fetching project state:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- AGENTIC AI ENDPOINTS ---

// Standard Agent Chat Endpoint
app.post('/api/agent/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required.' });
    }

    const agentResult = await agent.runAgentLoop(message);
    const updatedState = await db.getProjectState();

    res.json({
      success: true,
      ...agentResult,
      updatedState
    });
  } catch (error) {
    console.error('Agent loop execution error:', error);
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
    sendEvent('state_update', state);
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
    res.json({ success: true, result, updatedState });
  } catch (error) {
    console.error('Direct tool error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- DIRECT MANIPULATION & LEGACY ENDPOINTS (Upgraded with 3D persistence) ---

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
    res.status(200).json({ success: true, room: updated });
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
  console.log(`🚀 Architecture AI Platform running at http://localhost:${port}`);
  await db.checkConnection();
});
