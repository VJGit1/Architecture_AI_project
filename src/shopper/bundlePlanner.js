// src/shopper/bundlePlanner.js
// Scores catalog SKUs for a room and searches every combination for the best set under budget.

const { requiredSlots, optionalSlots, preferredFeatures } = require('./session');
const { chooseWalls, depthStack, usableAlongWall } = require('./roomGeometry');

const TOP_K = 6;
const BUDGET_USE_WEIGHT = 0.6;
const COLLECTION_MATCH = 0.05;
const ANCHOR_WEIGHT = 2;

function featureBonus(sku, slot, brief) {
  const prefs = preferredFeatures(slot, brief);
  return prefs.filter(f => (sku.features || []).includes(f)).length * 0.15;
}

// Score of one SKU in its slot. `anchor` is the seat or bed already chosen, when known.
function scoreItem(slot, sku, brief, walls, anchor = null) {
  let s = 0;
  const seatWallLen = walls.lengths[walls.seatWall];

  switch (slot) {
    case 'seat': {
      const fill = sku.width / seatWallLen;
      s = 1 - Math.abs(fill - 0.55) * 2;
      if (brief.preferSectional && sku.role === 'sectional') s += 0.35;
      break;
    }
    case 'bed': {
      const fill = sku.width / seatWallLen;
      s = 1 - Math.abs(fill - 0.45) * 2;
      break;
    }
    case 'coffee_table': {
      const ref = anchor ? anchor.width : seatWallLen * 0.5;
      s = 1 - Math.abs(sku.width / ref - 0.62) * 2;
      break;
    }
    case 'media': {
      const ref = anchor ? anchor.width : seatWallLen * 0.5;
      s = 1 - Math.abs(sku.width / ref - 0.8);
      break;
    }
    case 'rug': {
      const ref = anchor ? anchor.width : seatWallLen * 0.5;
      s = 0.4 - Math.abs(sku.width / ref - 1.1) * 0.5;
      break;
    }
    case 'chair':
      s = 0.35;
      break;
    case 'nightstand':
      s = 0.5 + ((sku.features || []).includes('storage') ? 0.1 : 0);
      break;
    default:
      s = 0.2;
  }

  s += featureBonus(sku, slot, brief);
  if (brief.collection && sku.collection === brief.collection) s += 0.3;
  return Number(s.toFixed(4));
}

function anchorSlot(brief) {
  return brief.roomType === 'bedroom' ? 'bed' : 'seat';
}

function chairAllowed(brief) {
  if (brief.wantsChair === false) return false;
  if (brief.wantsChair === true) return true;
  return brief.width * brief.length >= 15;
}

/**
 * Exhaustive search over the top candidates per slot.
 * Hard constraints: one SKU per required slot, total <= budget, and the depth stack fits across the room.
 * If nothing fits the budget, returns the cheapest physically feasible set and marks it overBudget.
 */
function optimizeBundle(brief, bySlot) {
  const walls = chooseWalls(brief);
  const required = requiredSlots(brief);
  const optional = optionalSlots(brief).filter(s => s !== 'chair' || chairAllowed(brief));
  const aSlot = anchorSlot(brief);

  const lists = {};
  for (const slot of [...required, ...optional]) {
    lists[slot] = (bySlot[slot] || []).slice(0, TOP_K);
  }

  const missing = required.filter(slot => lists[slot].length === 0);
  if (missing.length > 0) return { ok: false, missing, walls };

  const slots = [...required, ...optional];
  let best = null;
  let cheapestFeasible = null;
  let evaluated = 0;

  const anchorFits = (anchor) => anchor.width <= usableAlongWall(walls.lengths[walls.seatWall]);

  const visit = (idx, chosen) => {
    if (idx === slots.length) {
      evaluated++;
      const anchor = chosen[aSlot];
      if (!anchor || !anchorFits(anchor)) return;
      const stack = depthStack(brief, walls.seatWall, {
        seat: chosen.seat || null,
        table: chosen.coffee_table || null,
        media: chosen.media || null,
        bed: chosen.bed || null
      });
      if (!stack.ok) return;

      const items = Object.entries(chosen).filter(([, sku]) => sku);
      const total = items.reduce((sum, [, sku]) => sum + sku.price, 0);
      let score = 0;
      for (const [slot, sku] of items) {
        score += slot === aSlot
          ? ANCHOR_WEIGHT * scoreItem(slot, sku, brief, walls)
          : scoreItem(slot, sku, brief, walls, anchor);
        if (slot !== aSlot && sku.collection === anchor.collection) score += COLLECTION_MATCH;
      }
      score += BUDGET_USE_WEIGHT * Math.min(1, total / brief.budget);

      const candidate = { chosen: { ...chosen }, total, score: Number(score.toFixed(4)), stack };
      if (total <= brief.budget && (!best || candidate.score > best.score)) best = candidate;
      const requiredOnly = optional.every(s => !chosen[s]);
      if (requiredOnly && (!cheapestFeasible || total < cheapestFeasible.total)) cheapestFeasible = candidate;
      return;
    }

    const slot = slots[idx];
    const options = optional.includes(slot) ? [null, ...lists[slot]] : lists[slot];
    for (const sku of options) {
      chosen[slot] = sku;
      visit(idx + 1, chosen);
    }
    delete chosen[slot];
  };

  visit(0, {});

  if (best) return { ok: true, overBudget: false, ...best, walls, evaluated };
  if (cheapestFeasible) return { ok: true, overBudget: true, ...cheapestFeasible, walls, evaluated };
  return { ok: false, missing: [], infeasible: true, walls, evaluated };
}

module.exports = {
  scoreItem,
  optimizeBundle,
  anchorSlot,
  chairAllowed
};
