# 🏛️ Architecture AI // Autonomous BIM Co-Pilot

An autonomous, neuro-symbolic Building Information Modeling (BIM) co-pilot that pairs an AI Architect with human designers. It translates natural language design intent into topologically sound, code-compliant, and interactive 3D spatial models.

Built with **Three.js**, **Neo4j**, and **Agentic AI**.

---

## ✨ Features

- **🧠 Neuro-Symbolic Agentic Core**:
  - Translates natural language requirements into architectural programs (studios, multi-bedroom residences, offices).
  - Employs a ReAct reasoning loop ($\text{Perceive} \rightarrow \text{Plan} \rightarrow \text{Tool Action} \rightarrow \text{Verify} \rightarrow \text{Synthesize}$).
  - Live streaming thought trace bubbles in the UI.

- **🛋️ Interior Design & Bespoke Furnishing Engine**:
  - Automatically places curated Architectural Digest furniture (curved bouclé sofas, platform beds, fluted marble kitchen islands, indoor olive trees).
  - Preserves ergonomic human circulation clearances.
  - Supports curated design aesthetics: **Japandi**, **Mid-Century Modern**, and **Warm Minimalist**.

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
