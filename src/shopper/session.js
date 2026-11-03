// src/shopper/session.js
// Shopper session state: brief, candidate SKUs, cart, last critique, and repair count.
// Every tool reads and writes this object; the policy picks the next tool from it.

const { v4: uuidv4 } = require('uuid');
const db = require('../graph/db');
const { parseShopperMessage } = require('./briefParser');

const MAX_REPAIRS = 3;

// Compass names for the four walls created by db.createRoom (back wall is -z).
const WALL_COMPASS = { back: 'north', front: 'south', left: 'west', right: 'east' };
const COMPASS_WALL = { north: 'back', south: 'front', west: 'left', east: 'right' };

const SLOT_LABELS = {
  seat: 'sofa',
  coffee_table: 'coffee table',
  media: 'media unit',
  chair: 'chair',
  rug: 'rug',
  bed: 'bed',
  nightstand: 'nightstand'
};

function defaultBrief() {
  return {
    roomType: 'living',
    width: null,
    length: null,
    unit: 'ft',
    display: null,
    budget: null,
    needsTv: false,
    pets: false,
    kids: false,
    preferSectional: false,
    wantsChair: null,
    wantsRug: true,
    doorWall: 'south',
    collection: null
  };
}

function createSession(id = null) {
  const now = new Date().toISOString();
  return {
    id: id || uuidv4(),
    createdAt: now,
    updatedAt: now,
    turn: 0,
    brief: defaultBrief(),
    candidates: null,
    cart: [],
    cartVersion: 0,
    dirtySlots: [],
    placement: null,
    placementSeq: 0,
    lastCritique: null,
    repairCount: 0,
    refused: [],
    rejected: {},
    openIssue: null,
    pendingRequest: null,
    question: null,
    explanation: null,
    status: 'empty',
    turnState: { asked: false, explained: false, steps: 0 },
    trace: []
  };
}

function roomLabel(brief) {
  return brief.roomType === 'bedroom' ? 'bedroom' : 'living room';
}

function missingBriefFields(brief) {
  const missing = [];
  if (!brief.width) missing.push('width');
  if (!brief.length) missing.push('length');
  if (!brief.budget) missing.push('budget');
  return missing;
}

function requiredSlots(brief) {
  const base = brief.roomType === 'bedroom' ? ['bed', 'nightstand'] : ['seat', 'coffee_table'];
  if (brief.needsTv) base.push('media');
  return base;
}

function optionalSlots(brief) {
  const slots = [];
  if (brief.wantsRug !== false) slots.push('rug');
  if (brief.wantsChair !== false) slots.push('chair');
  return slots;
}

function slotRoles(slot, brief) {
  switch (slot) {
    case 'seat': return brief.preferSectional ? ['sectional', 'sofa'] : ['sofa'];
    default: return [slot];
  }
}

// Seats and chairs must carry these features; other slots only prefer them.
function requiredFeatures(slot, brief) {
  if ((slot === 'seat') && brief.pets) return ['performance_fabric'];
  return [];
}

function preferredFeatures(slot, brief) {
  const prefs = [];
  if (brief.pets || brief.kids) {
    if (slot === 'chair' || slot === 'seat' || slot === 'bed') prefs.push('performance_fabric');
    if (slot === 'rug') prefs.push('washable', 'pet_friendly');
    if (slot === 'coffee_table') prefs.push('rounded_edges');
  }
  return prefs;
}

// Fields that change which SKUs are eligible. If any change, candidates and cart are rebuilt.
function briefKey(brief) {
  return JSON.stringify([
    brief.roomType, brief.width, brief.length, brief.budget, brief.needsTv, brief.pets,
    brief.kids, brief.preferSectional, brief.wantsChair, brief.wantsRug, brief.doorWall, brief.collection
  ]);
}

// Fields that change the physical room shell.
function shellKey(brief) {
  return JSON.stringify([brief.roomType, brief.width, brief.length, brief.doorWall]);
}

function normalizeSlot(slot, brief) {
  if (brief.roomType === 'bedroom' && slot === 'coffee_table') return 'nightstand';
  if (brief.roomType !== 'bedroom' && slot === 'nightstand') return 'coffee_table';
  return slot;
}

function cartTotal(session) {
  return session.cart.reduce((sum, line) => sum + line.sku.price, 0);
}

/**
 * Applies a shopper message (and optional structured fields from the rail) to the session.
 * Returns what changed so the runner can log it.
 */
function applyShopperTurn(session, message, fields = {}) {
  const parsed = parseShopperMessage(message);
  const before = briefKey(session.brief);
  const next = { ...session.brief };

  Object.entries(parsed.brief).forEach(([k, v]) => {
    if (v !== undefined && v !== null) next[k] = v;
  });

  if (fields && (fields.width || fields.length || fields.budget)) {
    const unit = fields.unit === 'm' ? 'm' : 'ft';
    const toM = v => Number((unit === 'ft' ? Number(v) * 0.3048 : Number(v)).toFixed(2));
    if (fields.width && fields.length) {
      const w = toM(fields.width);
      const l = toM(fields.length);
      if (!parsed.brief.width && (w !== next.width || l !== next.length)) {
        next.width = w;
        next.length = l;
        next.unit = unit;
        next.display = { width: Number(fields.width), length: Number(fields.length) };
      }
    }
    if (fields.budget && !parsed.brief.budget && Number(fields.budget) !== next.budget) {
      next.budget = Math.round(Number(fields.budget));
    }
  }

  session.brief = next;
  const briefChanged = briefKey(next) !== before;

  if (briefChanged) {
    session.candidates = null;
    session.cart = [];
    session.cartVersion++;
    session.dirtySlots = [];
    session.lastCritique = null;
    session.refused = [];
    session.rejected = {};
    session.pendingRequest = null;
  }

  if (parsed.swap && session.cart.length > 0 && !briefChanged) {
    session.pendingRequest = { ...parsed.swap, slot: normalizeSlot(parsed.swap.slot, session.brief) };
  }

  return { parsed, briefChanged };
}

function beginTurn(session) {
  session.turn++;
  session.repairCount = 0;
  session.openIssue = null;
  session.question = null;
  session.turnState = { asked: false, explained: false, steps: 0 };
  session.updatedAt = new Date().toISOString();
}

function addTrace(session, row) {
  session.trace.push({ turn: session.turn, ...row });
}

function recordRefusal(session, refusal) {
  const exists = session.refused.find(r => r.skuId === refusal.skuId && r.rule === refusal.rule);
  if (!exists) session.refused.push({ turn: session.turn, ...refusal });
}

async function loadSession(id) {
  return db.loadShopperSession(id);
}

async function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  return db.saveShopperSession(session);
}

// Shape sent to the studio. Sizes and prices are copied from catalog SKUs, never generated.
function toView(session) {
  const total = cartTotal(session);
  const latestRefusal = session.refused.length > 0 ? session.refused[session.refused.length - 1] : null;
  const highlight = session.refused.find(r => r.highlight) || latestRefusal;
  return {
    id: session.id,
    turn: session.turn,
    status: session.status,
    brief: session.brief,
    roomLabel: roomLabel(session.brief),
    cart: session.cart.map(line => ({
      slot: line.slot,
      slotLabel: SLOT_LABELS[line.slot] || line.slot,
      sku: line.sku,
      reason: line.reason
    })),
    total,
    budget: session.brief.budget,
    critique: session.lastCritique,
    repairCount: session.repairCount,
    refused: highlight,
    refusedAll: session.refused,
    openIssue: session.openIssue,
    question: session.question,
    explanation: session.explanation,
    room: session.placement ? {
      id: session.placement.roomId,
      width: session.brief.width,
      length: session.brief.length,
      doors: session.placement.doors,
      walls: session.placement.walls,
      seatWall: session.placement.seatWall,
      mediaWall: session.placement.mediaWall
    } : null,
    placedItems: session.placement ? session.placement.items : [],
    trace: session.trace
  };
}

module.exports = {
  MAX_REPAIRS,
  WALL_COMPASS,
  COMPASS_WALL,
  SLOT_LABELS,
  createSession,
  loadSession,
  saveSession,
  applyShopperTurn,
  beginTurn,
  addTrace,
  recordRefusal,
  missingBriefFields,
  requiredSlots,
  optionalSlots,
  slotRoles,
  requiredFeatures,
  preferredFeatures,
  briefKey,
  shellKey,
  normalizeSlot,
  cartTotal,
  roomLabel,
  toView
};
