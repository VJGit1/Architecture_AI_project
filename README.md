# Room fit

Describe a room you already have. Room fit fills it with pieces from **Harbor & Co.**, a fictional catalog, that fit the walls, clear the door, face the TV, and stay under budget. A later message can swap one piece. The rest of the room stays put.

Sizes and prices come from the catalog. The product names are made up and are not from a real retailer.

## Start

```bash
npm install
npm start
```

Open http://localhost:3000. You need Node 18 or newer. Neo4j and an API key are optional. If Neo4j is down, the header reads "products in memory" and the studio still works.

```bash
npm run eval
```

Scores 12 shopper briefs and prints pass and fail counts. It forces the in-memory catalog and does not call a model.

## Try these

Click **New room** between unrelated briefs. A second message only swaps a piece if you leave the same room open.

1. Living room, dog, TV, then a cheaper sofa.

   > Living room is 14 by 16 feet, budget 3000, we watch TV and have a dog.

   > Swap the sofa for something under $900.

   The first turn picks a performance-fabric sofa and a media unit, under $3,000. The second turn calls `swap_sku`, puts in the Harbor 84 at $899, and keeps the table and the media unit.

2. A sectional that does not fit.

   > Living room is 10 by 10 feet, budget 2500, we want a sectional and watch TV.

   The Harbor Sectional 108 is refused (it needs 3.15 m; the longest wall is 3.05 m). A rust callout marks the wall, and a smaller sofa takes the seat.

3. A missing budget. Nothing is placed until you answer.

   > Living room is 12 by 14 feet with a TV.

   > Budget is 2800.

4. A bedroom.

   > Bedroom is 12 by 13 feet, budget 2000.

   Expect a bed and a nightstand, and no TV.

5. A swap that cannot be repaired into budget.

   > Living room is 15 by 18 feet, budget 3200, we watch TV.

   > Swap the sofa for the Field Modular Sectional 112.

   The agent tries three budget repairs, then stops with an open issue naming the living room, the budget rule, and `HC-SEC-112`.

## What you see

The room is about 70% of the page, drawn at real size. The rail on the right holds the width, length, and budget, then one cart line per piece (name, dimensions, price, and one reason), a total such as `$2,966 of $3,000`, **Why this set**, any refused piece, the message box, and **Fit the room**. **How this was chosen** is closed by default. Each row is `tool argument → observation`.

## What a turn does

The session stores the brief, candidate SKUs, cart, placement, last critique, and repair count. `src/shopper/policy.js` reads that state and picks one tool:

| Tool | When it runs |
| --- | --- |
| `ask_shopper` | Width, length, or budget is missing. Places nothing. |
| `search_catalog` | Finds SKUs by role, price, required features, and wall length. |
| `propose_bundle` | Picks a set that fits the budget and the walls. |
| `place_in_room` | Places real SKU sizes. A later swap moves only the changed pieces. |
| `critique_fit` | Checks budget, required pieces, the door swing, and sofa-to-TV facing. |
| `swap_sku` | Replaces one piece. |
| `explain` | Writes **Why this set**, or the open issue. |

Fit failures are repaired in this order:

- A piece in the door or past a wall is swapped for a smaller one.
- A cart over budget swaps the most expensive optional piece for a cheaper one.
- A sofa that does not face the TV is placed again with that constraint.
- After 3 repairs the turn stops. The open issue names the room, the rule, and the SKU.

The browser only calls this server: `/api/shopper/turn`, `/api/status`, and `/api/shopper/session/:id`. With `OPENAI_API_KEY` or `GEMINI_API_KEY` in `.env`, a model may rephrase the question and **Why this set**. Text that contains a digit is discarded. With no key, those sentences are written locally.

Copy `.env.example` to `.env` only if you want Neo4j or a model. `ROOM_FIT_OFFLINE=1` keeps the catalog in memory.

## Where to read the code

The page path, from the button to the 3D room:

```
public/index.html          studio
server.js                  Express. Shopper routes are the ones the page uses.
src/shopper/roomAgent.js   one turn: load session, call tools, save
src/shopper/policy.js      which tool runs next
src/shopper/session.js     brief, cart, placement, critique, trace
src/shopper/briefParser.js sentences and the width / length / budget fields
src/shopper/bundlePlanner.js  search a set that fits budget and walls
src/shopper/roomGeometry.js   which wall the seat and the TV use
src/shopper/tools/         ask, search, propose, place, critique, swap, explain
src/catalog/harborCatalog.js  31 Harbor, Field, and Loft SKUs
src/catalog/catalogStore.js   seed and lookup
src/graph/db.js            Neo4j, or the in-memory store
src/ai/interiorEnergySolver.js  place pieces at real size
scripts/eval-shopper.js    npm run eval
src/agent/evaluator.js     the 12 briefs and the pass / fail counts
```

These files are the earlier layout engine. The studio page does not call them:

```
src/agent/agentCore.js     older chat loop
src/agent/tools.js         older room and door tools
src/agent/solver.js        bubble-diagram floor solver
src/ai/llmProvider.js      OpenAI, Gemini, or the local compiler
src/ai/pathfindingAStar.js walk grid
src/ai/precedentRag.js     older prompt memory
```

`/api/agent/*`, `/api/addRoom`, `/api/addDoor`, `/api/clear`, and `/api/benchmark` belong to that older loop.

## Topics

Add these on the GitHub repo page, under the description, so the fork is findable:

`threejs` `neo4j` `express` `nodejs` `agentic-ai` `room-planner` `furniture` `interior-design` `catalog`

Suggested description: **Shopper agent that fits a fictional catalog into a room, on a budget.**

## License

ISC
