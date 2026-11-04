// src/shopper/tools/catalogTools.js
// search_catalog and propose_bundle.

const catalogStore = require('../../catalog/catalogStore');
const { renderReason } = require('../../catalog/harborCatalog');
const {
  SLOT_LABELS,
  WALL_COMPASS,
  requiredSlots,
  slotRoles,
  requiredFeatures,
  briefKey,
  roomLabel,
  recordRefusal
} = require('../session');
const { chooseWalls, fitsLongestWall, depthStack } = require('../roomGeometry');
const { scoreItem, optimizeBundle, anchorSlot } = require('../bundlePlanner');

const usd = n => `$${Math.round(n).toLocaleString('en-US')}`;

function stripScore(sku) {
  const { score, ...rest } = sku;
  return rest;
}

function wallForSlot(slot, walls) {
  if (slot === 'seat' || slot === 'bed' || slot === 'nightstand') return walls.seatWall;
  if (slot === 'media') return walls.mediaWall;
  return walls.seatWall;
}

function cartLine(slot, sku, brief, walls) {
  const wall = wallForSlot(slot, walls);
  return {
    slot,
    role: sku.role,
    sku: stripScore(sku),
    reason: renderReason(sku, { wallLength: walls.lengths[wall], roomLabel: roomLabel(brief) })
  };
}

/**
 * search_catalog: filter by role, by what the budget leaves after the cheapest other required
 * pieces, and by whether the piece can stand on the longest wall.
 */
async function search_catalog(session, args = {}) {
  const brief = session.brief;
  const slots = args.slots || [];
  const walls = chooseWalls(brief);
  const required = requiredSlots(brief);

  const minPriceBySlot = {};
  for (const slot of required) {
    const all = await catalogStore.listProducts({ roles: slotRoles(slot, brief) });
    minPriceBySlot[slot] = all.length ? Math.min(...all.map(p => p.price)) : 0;
  }

  const fresh = !args.merge || !session.candidates;
  const candidates = fresh
    ? { briefKey: briefKey(brief), bySlot: {}, searchedRoles: {}, longestWall: null }
    : session.candidates;

  let fitCount = 0;
  let refusedCount = 0;
  let featureMisses = 0;
  let longestWallLength = 0;

  for (const slot of slots) {
    const roles = args.roles && args.merge ? args.roles : slotRoles(slot, brief);
    const reserve = required.filter(s => s !== slot).reduce((sum, s) => sum + (minPriceBySlot[s] || 0), 0);
    const maxPrice = brief.budget - reserve;
    const products = await catalogStore.listProducts({ roles, maxPrice });
    const needFeatures = requiredFeatures(slot, brief);

    const kept = [];
    for (const sku of products) {
      if (needFeatures.some(f => !(sku.features || []).includes(f))) {
        featureMisses++;
        continue;
      }
      const fit = fitsLongestWall(sku, brief);
      longestWallLength = fit.wallLength;
      if (!fit.ok) {
        refusedCount++;
        recordRefusal(session, {
          skuId: sku.id,
          name: sku.name,
          role: sku.role,
          slot,
          rule: 'wall',
          width: sku.width,
          depth: sku.depth,
          height: sku.height,
          price: sku.price,
          message: `${sku.name} needs ${fit.needed.toFixed(2)} m of wall; the longest wall is ${fit.wallLength.toFixed(2)} m.`,
          anchor: { type: 'wall', wall: fit.wall, compass: WALL_COMPASS[fit.wall] },
          highlight: slot === 'seat' && (sku.role === 'sectional' ? brief.preferSectional : true)
        });
        continue;
      }
      kept.push({ ...sku, score: scoreItem(slot, sku, brief, walls) });
    }

    kept.sort((a, b) => b.score - a.score || a.price - b.price);
    const existing = fresh ? [] : (candidates.bySlot[slot] || []);
    const merged = [...existing];
    kept.forEach(sku => { if (!merged.some(e => e.id === sku.id)) merged.push(sku); });
    candidates.bySlot[slot] = merged;
    candidates.searchedRoles[slot] = Array.from(new Set([...(fresh ? [] : (candidates.searchedRoles[slot] || [])), ...roles]));
    fitCount += kept.length;
  }

  candidates.longestWall = longestWallLength || candidates.longestWall;
  session.candidates = candidates;

  // Keep only the most relevant refusal highlighted for the rail.
  const highlighted = session.refused.filter(r => r.highlight);
  if (highlighted.length > 1) {
    highlighted.sort((a, b) => b.width - a.width).slice(1).forEach(r => { r.highlight = false; });
  }

  const argRoles = slots.map(s => (args.roles && args.merge ? args.roles.join('/') : SLOT_LABELS[s] || s).replace(/ /g, '_')).join(',');
  const extra = featureMisses > 0 ? `, ${featureMisses} lacked required features` : '';
  return {
    ok: true,
    arg: `${argRoles} wall=${(candidates.longestWall || 0).toFixed(2)}m`,
    observation: `${fitCount} fit, ${refusedCount} refused at the wall${extra}`
  };
}

/**
 * propose_bundle: one seat or bed, one table, one media piece when the brief needs a TV,
 * optional chair and rug. Picks the highest scoring set under budget.
 */
async function propose_bundle(session) {
  const brief = session.brief;
  const result = optimizeBundle(brief, session.candidates.bySlot);
  const walls = result.walls;

  if (!result.ok) {
    if (result.missing && result.missing.length > 0) {
      const slot = result.missing[0];
      session.openIssue = {
        room: roomLabel(brief),
        rule: 'search',
        ruleLabel: 'catalog search',
        skuId: null,
        skuName: null,
        message: `No Harbor & Co. ${SLOT_LABELS[slot]} fits this ${roomLabel(brief)} and budget.`
      };
      return { ok: false, arg: `budget=${brief.budget}`, observation: `no ${SLOT_LABELS[slot]} candidate` };
    }
    const aSlot = anchorSlot(brief);
    const smallest = (session.candidates.bySlot[aSlot] || []).slice().sort((a, b) => a.depth - b.depth)[0];
    const stack = depthStack(brief, walls.seatWall, { seat: smallest, bed: smallest });
    session.openIssue = {
      room: roomLabel(brief),
      rule: 'fit',
      ruleLabel: 'fit inside the walls',
      skuId: smallest ? smallest.id : null,
      skuName: smallest ? smallest.name : null,
      message: `The ${WALL_COMPASS[walls.seatWall]} wall is ${walls.cross.toFixed(2)} m from the opposite wall; even the shallowest set needs more than ${stack.available.toFixed(2)} m.`
    };
    return { ok: false, arg: `budget=${brief.budget}`, observation: `no set fits across ${walls.cross.toFixed(2)} m` };
  }

  session.cart = Object.entries(result.chosen)
    .filter(([, sku]) => sku)
    .map(([slot, sku]) => cartLine(slot, sku, brief, walls));
  session.cartVersion++;
  session.dirtySlots = [];
  session.plannedWalls = { seatWall: walls.seatWall, mediaWall: walls.mediaWall };

  const pieces = session.cart.length;
  const over = result.overBudget ? ', over budget' : '';
  return {
    ok: true,
    arg: `budget=${brief.budget}`,
    observation: `${pieces} pieces, ${usd(result.total)}, best of ${result.evaluated.toLocaleString('en-US')} sets${over}`
  };
}

module.exports = {
  search_catalog,
  propose_bundle,
  cartLine,
  wallForSlot
};
