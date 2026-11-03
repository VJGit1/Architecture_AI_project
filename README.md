# 🏛️ Architecture AI // Autonomous BIM Co-Pilot

An autonomous, neuro-symbolic Building Information Modeling (BIM) co-pilot that pairs an AI Architect with human designers. It translates natural language design intent into topologically sound, code-compliant, and interactive 3D spatial models.

Built with **Three.js**, **Neo4j**, and **Agentic AI**.

---

## ✨ Features

- **🧠 Neuro-Symbolic Multi-Agent Orchestrator (`src/agent/agentCore.js`)**:
  - Coordinates 4 specialized AI agents: **GraphRAG & Memory Agent**, **Lifestyle Architect Agent**, **Neuro-Symbolic Solver & Interior Energy Agent**, and **Closed-Loop Visual/Geometric Critic Agent**.
  - Supports **OpenAI (GPT-4o)**, **Google Gemini (2.0 Flash)**, and an offline **Neuro-Symbolic Semantic Compiler** (`src/ai/llmProvider.js`).
  - **Hybrid GraphRAG & Episodic Memory (`src/ai/precedentRag.js`)**: Embeds natural language prompts into a 64-dimensional semantic vector space to retrieve architectural precedents (*Kyoto Machiya*, *Parisian Haussmann*, *Case Study Glass Pavilion*, *Nordic Creative Atelier*) and remembers user lifestyle constraints across turns.

- **🔬 Simulated Annealing Topological Floor Solver (`src/agent/solver.js`)**:
  - Optimizes room placement over **Architectural Bubble Graphs** (Attraction edges, Acoustic Repulsion edges, and Solar Azimuth orientation preferences).
  - Guarantees **0.0000 m² overlap**, 100% exterior perimeter window exposure for habitable rooms (IBC 1205.1), and extracts exact 1D shared wall portal segments.

- **🛋️ Continuous Energy-Based Interior Scene Optimizer (`src/ai/interiorEnergySolver.js`)**:
  - Replaces static coordinate offsets with a declarative **Scene Graph DSL** and continuous pose optimizer that minimizes:
    $$E(\mathbf{S}) = w_{\text{wall}} E_{\text{bounds}} + w_{\text{col}} E_{\text{OBB}} + w_{\text{door}} E_{\text{swing}} + w_{\text{rel}} E_{\text{prior}}$$
  - Preserves $0.95\text{m}$ door-swing clearances and ergonomic walk-around buffers across **Japandi**, **Mid-Century Modern**, and **Warm Minimalist** aesthetics.

- **🚶 2D NavMesh A\* Pathfinding & X-Ray Spatial Lenses (`src/ai/pathfindingAStar.js`)**:
  - Discretizes floorplans into a 2D occupancy grid ($0.25\text{m}$ cells) and runs **8-connected A\* search** to compute human-cylinder walkability ratios and animated 3D circulation splines with an autonomous AI resident avatar.
  - Interactive **☀️ Solar Daylight Lens**, **🚶 A\* Flow Lens**, **📷 Multimodal Moodboard/Sketch VLM Upload**, and **👁️ Closed-Loop VLM Viewport Critic**.

- **🌅 Architectural Digest Lighting & Sun Simulation**:
  - Realistic sun angle simulation with soft contact shadows: **Golden Hour (3000K warm tone)**, **High Noon (daylight)**, and **Cozy Dusk (2700K recessed interior spotlights)**.
  - ACES Filmic Tone Mapping and PBR procedural materials (French herringbone oak parquet, Roman clay limewash plaster, Calacatta marble).

- **🚶 First-Person "Architectural Tour" Walk Mode**:
  - Drops the camera to 1.7m (5'7" human eye level).
  - Walk smoothly through your generated apartment using <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> keys and look around in 360°!

- **🏛️ Building Code & Accessibility Audit**:
  - Automated compliance checks against **International Building Code (IBC)** and **ADA Standards**:
    - **IBC 1208.3**: Habitable room minimum area ($\ge 70\text{ sq ft} / 6.5\text{ m}^2$).
    - **IBC 1208.2**: Minimum ceiling clearances ($\ge 7.0\text{ ft} / 2.13\text{m}$).
    - **ADA 404.2.3 / IBC 1005.1**: Door egress clearances ($\ge 32\text{ in} / 0.81\text{m}$).

- **🌐 Semantic Knowledge Graph (Neo4j)**:
  - Rooms, walls, floors, and openings modeled as a topological graph.
  - Safe per-query session lifecycle.
  - Built-in resilient in-memory fallback for offline/development environments.

- **🎮 High-Performance 3D Viewport**:
  - Real-time Three.js renderer with shadows, lighting, and metric grid.
  - 3D floating room badges showing live square footage ($m^2$).
  - Full transform manipulation (<kbd>T</kbd> Move, <kbd>R</kbd> Rotate, <kbd>S</kbd> Scale) synced bi-directionally with the graph database.
  - Scene hydration on reload: designs are saved and automatically restored.

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js (v18+)
- Neo4j Desktop or Neo4j Aura (optional, in-memory mode active by default if offline)

### 2. Installation
```bash
git clone https://github.com/VJGit1/Architecture_AI_project.git
cd Architecture_AI_project
npm install
```

### 3. Configuration
Copy the environment template:
```bash
cp .env.example .env
```
Edit `.env` if your local Neo4j has custom credentials (default is `neo4j` / `qwerty123`).

### 4. Run the Studio
```bash
npm start
```
Open your browser at: **`http://localhost:3000`**

---

## 🛠️ Architecture Overview

```
Architecture_AI_project/
├── src/
│   ├── graph/
│   │   └── db.js            # Resilient Neo4j & In-Memory Spatial Repository
│   └── agent/
│       ├── tools.js         # Spatial layout generator, IBC code auditor, openings
│       └── agentCore.js     # Autonomous ReAct agent reasoning engine
├── public/
│   └── index.html           # Modern Three.js 3D Studio & AI Co-Pilot UI
├── server.js                # Express & SSE streaming server
├── package.json
└── README.md
```

---

## 📜 License
MIT
