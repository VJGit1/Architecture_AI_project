// src/shopper/policy.js
// Tool-routing policy. Looks only at session state and returns the single next tool to call.
// There is no fixed script: the same function drives a first fit, a repair, and a later swap.

const {
  MAX_REPAIRS,
  WALL_COMPASS,
  SLOT_LABELS,
  missingBriefFields,
  requiredSlots,
  optionalSlots,
  slotRoles,
  briefKey,
  roomLabel
} = require('./session');

const STOP = { tool: null, why: 'turn complete' };

// Repairs are tried in this order when several checks fail at once.
const RULE_PRIORITY = ['fit', 'door', 'budget', 'roles', 'facing'];

function candidatesCover(session, slot, roles) {
  const list = session.candidates && session.candidates.bySlot && session.candidates.bySlot[slot];
  if (!list) return false;
  return roles.every(role => (session.candidates.searchedRoles[slot] || []).includes(role));
}

function primaryFailure(critique) {
  const failures = (critique && critique.failures) || [];
  for (const rule of RULE_PRIORITY) {
    const hit = failures.find(f => f.rule === rule);
    if (hit) return hit;
  }
  return failures[0] || null;
}

function mostExpensiveOptional(session) {
  const optional = new Set(['chair', 'rug']);
  const lines = session.cart.filter(l => optional.has(l.slot));
  const pool = lines.length > 0 ? lines : session.cart;
  return pool.slice().sort((a, b) => b.sku.price - a.sku.price)[0] || null;
}

function repairFor(session) {
  const failure = primaryFailure(session.lastCritique);
  if (!failure) return { tool: 'explain', args: { reason: 'no failure detail' }, why: 'critique failed without detail' };

  if (failure.rule === 'fit' || failure.rule === 'door') {
    return {
      tool: 'swap_sku',
      args: { slot: failure.slot, direction: 'smaller', reason: failure.rule, allowDrop: !requiredSlots(session.brief).includes(failure.slot) },
      repair: true,
      why: `${failure.skuName} breaks the ${failure.rule} rule, so swap that one SKU`
    };
  }

  if (failure.rule === 'budget') {
    const line = mostExpensiveOptional(session);
    return {
      tool: 'swap_sku',
      args: { slot: line ? line.slot : 'seat', direction: 'cheaper', reason: 'budget', allowDrop: line ? !requiredSlots(session.brief).includes(line.slot) : false },
      repair: true,
      why: 'over budget, so swap the most expensive optional piece'
    };
  }

  if (failure.rule === 'facing') {
    if (!session.placement || !session.placement.facingConstraint) {
      return {
        tool: 'place_in_room',
        args: { slots: ['media'], facing: true },
        repair: true,
        why: 'sofa does not face the TV, so place again with a facing constraint'
      };
    }
    return {
      tool: 'swap_sku',
      args: { slot: 'media', direction: 'smaller', reason: 'facing', allowDrop: false },
      repair: true,
      why: 'facing constraint was not enough, so try a narrower media piece'
    };
  }

  if (failure.rule === 'roles') {
    return {
      tool: 'swap_sku',
      args: { slot: failure.slot, direction: 'next', reason: 'roles', allowDrop: false },
      repair: true,
      why: `the cart is missing a ${SLOT_LABELS[failure.slot] || failure.slot}`
    };
  }

  return { tool: 'explain', args: {}, why: `no repair for rule ${failure.rule}` };
}

/**
 * Picks the next tool from session state.
 * Returns { tool, args, why, repair? } or STOP.
 */
function nextTool(session) {
  const { brief, turnState } = session;
  if (turnState.asked || turnState.explained) return STOP;

  const missing = missingBriefFields(brief);
  if (missing.length > 0) {
    return { tool: 'ask_shopper', args: { missing }, why: `missing ${missing.join(', ')}` };
  }

  if (session.openIssue) {
    return { tool: 'explain', args: { openIssue: true }, why: 'an open issue blocks the fit' };
  }

  const searchSlots = [...requiredSlots(brief), ...optionalSlots(brief)];
  if (!session.candidates || session.candidates.briefKey !== briefKey(brief)) {
    return { tool: 'search_catalog', args: { slots: searchSlots }, why: 'no candidates for this brief yet' };
  }

  if (session.pendingRequest) {
    const req = session.pendingRequest;
    const roles = req.preferRole ? [req.preferRole] : slotRoles(req.slot, brief);
    if (!candidatesCover(session, req.slot, roles)) {
      return { tool: 'search_catalog', args: { slots: [req.slot], roles, merge: true }, why: `no ${roles.join('/')} candidates loaded for the swap` };
    }
    return {
      tool: 'swap_sku',
      args: { slot: req.slot, maxPrice: req.maxPrice, preferRole: req.preferRole, direction: req.direction, collection: req.collection, reason: 'shopper' },
      why: 'the shopper asked to change one item'
    };
  }

  if (session.cart.length === 0) {
    return { tool: 'propose_bundle', args: { budget: brief.budget }, why: 'cart is empty' };
  }

  if (!session.placement || session.placement.cartVersion !== session.cartVersion) {
    const slots = session.placement && session.dirtySlots.length > 0 ? session.dirtySlots : 'all';
    return { tool: 'place_in_room', args: { slots, facing: Boolean(session.placement && session.placement.facingConstraint) }, why: 'cart changed since the last placement' };
  }

  if (!session.lastCritique || session.lastCritique.placementId !== session.placement.id) {
    return { tool: 'critique_fit', args: {}, why: 'placement has not been checked' };
  }

  if (session.lastCritique.pass) {
    return { tool: 'explain', args: {}, why: 'critique passed' };
  }

  if (session.repairCount >= MAX_REPAIRS) {
    return { tool: 'explain', args: { openIssue: true }, why: `${MAX_REPAIRS} repairs used` };
  }

  return repairFor(session);
}

// One plain sentence for the studio status line.
function statusSentence(decision, session) {
  const brief = session.brief;
  const wall = session.placement && session.placement.doors && session.placement.doors[0]
    ? WALL_COMPASS[session.placement.doors[0].wall]
    : brief.doorWall;
  switch (decision.tool) {
    case 'ask_shopper': return 'Asking for the missing room details.';
    case 'search_catalog': return `Searching ${'Harbor & Co.'} for pieces that fit the ${roomLabel(brief)}.`;
    case 'propose_bundle': return `Pricing a set under $${Number(brief.budget).toLocaleString('en-US')}.`;
    case 'place_in_room': return decision.args && decision.args.facing ? 'Turning the media unit to face the sofa.' : 'Placing each piece at its catalog size.';
    case 'critique_fit': return `Checking the ${wall} door.`;
    case 'swap_sku': return `Swapping the ${SLOT_LABELS[decision.args.slot] || decision.args.slot}.`;
    case 'explain': return 'Writing up the set.';
    default: return 'Working.';
  }
}

module.exports = {
  nextTool,
  statusSentence,
  primaryFailure,
  STOP
};
