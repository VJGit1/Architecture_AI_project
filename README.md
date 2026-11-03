# Room fit

A shopper describes a room they already have. An agent fills it with pieces from a fictional catalog, Harbor & Co., that fit the walls, keep the door swing clear, face the TV, and stay under budget. On a later turn the shopper can swap one piece ("Swap the sofa for something under $900"), and the agent changes only that piece. The rest of the room stays as it was.

Built with Node, Express, Three.js, and Neo4j (with an in-memory fallback).

The catalog is made up. Its products, names, prices, and copy do not come from any real retailer.

## Run it

```bash
npm install
npm start          # http://localhost:3000
npm run eval       # scores the shopper briefs and prints real pass/fail counts
```

Neo4j is optional. When `NEO4J_URI` is unreachable, or `ROOM_FIT_OFFLINE=1` is set, the catalog, sessions, and rooms live in memory. The catalog seeds on startup, and clearing a room never deletes catalog nodes.

An LLM is optional too. With `OPENAI_API_KEY` or `GEMINI_API_KEY` set, a model may rephrase the clarifying question and the "Why this set" text. Every size, price, and SKU comes from the catalog, and model text that contains digits is discarded. Without a key, both shopper turns run on the local compiler.

## The studio

The left 70% of the page is the room at real size: cut-away walls, door swing arcs, and catalog blocks built from each SKU's width, depth, and height. The right rail holds:

- room width, length, and budget
- cart lines (name, dimensions, price, and one reason)
- a total such as "$2,966 of $3,000"
- "Why this set"
- any refused piece, which also appears in 3D as a callout at the door or wall that refused it
- the message field and the **Fit the room** button
- a closed-by-default "How this was chosen" trace (tool, argument, observation)

## The tool loop

Each turn loads the shopper session, which holds the brief, candidate SKUs, cart, placement, last critique, and repair count. A pure policy (`src/shopper/policy.js`) looks at that state and picks one next tool:

| Tool | Does |
| --- | --- |
| `ask_shopper` | asks one question when width, length, or budget is missing, and places nothing |
| `search_catalog` | pulls SKUs by role, price cap, required features (performance fabric for pets), and wall fit |
| `propose_bundle` | searches for the highest-scoring set within budget, wall length, and depth clearances |
| `place_in_room` | runs the energy solver with real SKU sizes, re-placing only the changed slots |
| `critique_fit` | checks budget, required pieces, door swing and walls, and sofa-to-TV facing |
| `swap_sku` | replaces one slot's SKU under the given constraint |
| `explain` | writes "Why this set" or the open issue |

How each kind of fit failure is repaired:

- A door collision, or a piece that doesn't fit, swaps the blocking SKU for a smaller one.
- Going over budget swaps the most expensive optional piece for a cheaper one.
- A sofa that doesn't face the TV is placed again with a facing constraint.
- After 3 repairs the agent stops and leaves an open issue naming the room, the rule, and the SKU.

## Layout

```
src/catalog/       Harbor & Co. seed data and the catalog store (Neo4j or memory)
src/shopper/       brief parser, session state, policy, bundle planner, room geometry, tools
src/ai/            interior energy solver, LLM provider, A* pathfinding, precedent memory
src/agent/         evaluator (shopper brief suite and the legacy layout suite)
src/graph/db.js    Neo4j repository with the in-memory fallback
scripts/           eval-shopper.js
public/index.html  the studio
```

## License

MIT
