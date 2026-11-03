// src/shopper/briefParser.js
// Local compiler from a shopper's sentence to brief fields and swap requests.
// Deterministic on purpose: sizes and budgets never come from a model.

const { getSeedProducts } = require('../catalog/harborCatalog');

const FT_TO_M = 0.3048;
const ROLE_SLOT = { sofa: 'seat', sectional: 'seat', coffee_table: 'coffee_table', media: 'media', chair: 'chair', rug: 'rug', bed: 'bed', nightstand: 'nightstand' };

// "the Harbor Sectional 108", "Harbor 84", or "HC-SOF-084" all name one SKU.
function findNamedProduct(text) {
  const lower = text.toLowerCase();
  const products = getSeedProducts();
  const aliases = p => {
    const full = p.name.toLowerCase();
    const short = full.replace(/ (performance |grand |apartment |slipcover )?(sofa|chair|bed|nightstand|rug.*|coffee table|media console|media stand|media wall)$/, '');
    return [p.id.toLowerCase(), full, short].filter(a => a.split(' ').length >= 2 || a.includes('-'));
  };
  return products
    .map(p => ({ p, hit: aliases(p).filter(a => lower.includes(a)).sort((a, b) => b.length - a.length)[0] }))
    .filter(x => x.hit)
    .sort((a, b) => b.hit.length - a.hit.length)
    .map(x => x.p)[0] || null;
}
const UNIT = '(ft|feet|foot|\'|m|meters?|metres?)';
const COMPASS = '(north|south|east|west)';

function toNumber(raw, kSuffix) {
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return kSuffix ? n * 1000 : n;
}

function isFeetUnit(unit) {
  return /^(ft|feet|foot|')$/i.test(unit || '');
}

function isMeterUnit(unit) {
  return /^(m|meters?|metres?)$/i.test(unit || '');
}

function parseDimensions(text) {
  const pair = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*(?:by|x|×|\\*)\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}?`, 'i'));
  let a = null;
  let b = null;
  let unit = null;

  if (pair) {
    a = Number(pair[1]);
    b = Number(pair[3]);
    unit = pair[4] || pair[2] || null;
  } else {
    const square = text.match(/(\d+(?:\.\d+)?)\s*(ft|feet|foot|m|meters?|metres?)\s+(?:square\s+)?(?:living\s+|bed)?room/i)
      || text.match(/(\d+(?:\.\d+)?)\s*(ft|feet|foot|m|meters?|metres?)\s+square/i);
    if (!square) return null;
    a = Number(square[1]);
    b = a;
    unit = square[2];
  }

  let feet;
  if (isFeetUnit(unit)) feet = true;
  else if (isMeterUnit(unit)) feet = false;
  else feet = /\b(ft|feet|foot)\b/i.test(text) || Math.max(a, b) >= 7;

  const toM = v => Number((feet ? v * FT_TO_M : v).toFixed(2));
  return {
    width: toM(a),
    length: toM(b),
    unit: feet ? 'ft' : 'm',
    display: { width: a, length: b }
  };
}

function parseBudget(text, allowBareDollar) {
  const patterns = [
    /budget\D{0,16}?\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?\b/i,
    /\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s+budget/i,
    /spend\D{0,12}?\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?\b/i
  ];
  if (allowBareDollar) {
    patterns.push(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?\b/i);
    patterns.push(/([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:dollars|usd)\b/i);
  }
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const value = toNumber(m[1], m[2]);
      if (value && value >= 100) return Math.round(value);
    }
  }
  return null;
}

const SLOT_WORDS = [
  { slot: 'seat', re: /\b(sofa|couch|settee|loveseat|sectional)\b/i },
  { slot: 'media', re: /\b(media|tv stand|tv console|tv unit|console|media unit)\b/i },
  { slot: 'coffee_table', re: /\b(coffee table|table)\b/i },
  { slot: 'nightstand', re: /\b(nightstand|night stand|bedside table|bedside)\b/i },
  { slot: 'chair', re: /\b(armchair|chair)\b/i },
  { slot: 'rug', re: /\brug\b/i },
  { slot: 'bed', re: /\bbed\b(?!room)/i }
];

function parseSwap(text) {
  if (!/\b(swap|replace|change|switch|trade|exchange|different|instead)\b/i.test(text)) return null;

  const splitAt = text.search(/\b(for|with|to|into)\b/i);
  const source = splitAt > 0 ? text.slice(0, splitAt) : text;
  const target = splitAt > 0 ? text.slice(splitAt) : '';

  let slot = null;
  for (const { slot: s, re } of SLOT_WORDS) {
    if (re.test(source)) { slot = s; break; }
  }
  if (!slot) {
    for (const { slot: s, re } of SLOT_WORDS) {
      if (re.test(text)) { slot = s; break; }
    }
  }
  if (!slot) return null;

  const priceMatch = text.match(/(?:under|below|less than|max(?:imum)?|at most|up to|no more than|<)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i);
  const maxPrice = priceMatch ? toNumber(priceMatch[1], priceMatch[2]) : null;
  const maxPriceInclusive = /\b(at most|up to|no more than|max(imum)?)\b/i.test(text);

  let preferRole = null;
  if (slot === 'seat') {
    if (/\bsectional\b/i.test(target)) preferRole = 'sectional';
    else if (/\b(sofa|couch)\b/i.test(target)) preferRole = 'sofa';
  }

  let direction = 'next';
  if (/\b(cheaper|less expensive|lower price)\b/i.test(text) || maxPrice) direction = 'cheaper';
  if (/\b(smaller|narrower|shorter|compact)\b/i.test(text)) direction = 'smaller';
  if (/\b(bigger|larger|longer|wider)\b/i.test(text)) direction = 'larger';

  const named = target ? findNamedProduct(target) : null;
  if (named && ROLE_SLOT[named.role] === slot) {
    preferRole = named.role;
  }

  const collection = named ? null : ((target.match(/\b(harbor|field|loft)\b/i) || [])[1] || null);

  return {
    type: 'swap',
    slot,
    skuId: named && ROLE_SLOT[named.role] === slot ? named.id : null,
    maxPrice: maxPrice ? Math.round(maxPrice) : null,
    maxPriceInclusive,
    preferRole,
    direction,
    collection: collection ? collection[0].toUpperCase() + collection.slice(1).toLowerCase() : null,
    text: text.trim()
  };
}

function parseDoorWall(text) {
  const m = text.match(new RegExp(`door\\s+(?:is\\s+)?(?:on|in|at)\\s+the\\s+${COMPASS}`, 'i'))
    || text.match(new RegExp(`${COMPASS}(?:ern)?\\s+(?:wall\\s+)?door`, 'i'));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Returns { brief: partial brief fields found in the text, swap: swap request or null }.
 */
function parseShopperMessage(message) {
  const text = String(message || '');
  const lower = text.toLowerCase();
  const swap = parseSwap(text);
  const brief = {};

  const dims = parseDimensions(text);
  if (dims) {
    brief.width = dims.width;
    brief.length = dims.length;
    brief.unit = dims.unit;
    brief.display = dims.display;
  }

  const budget = parseBudget(text, !swap);
  if (budget) brief.budget = budget;

  if (/\bbed ?room\b/.test(lower)) brief.roomType = 'bedroom';
  else if (/\b(living room|family room|den|lounge|great room)\b/.test(lower)) brief.roomType = 'living';

  if (/\bno (tv|television)\b/.test(lower)) brief.needsTv = false;
  else if (/\b(tv|tvs|television|movies?|films?|netflix|streaming|stream|gaming|video games?|watch)\b/.test(lower)) brief.needsTv = true;

  if (/\b(dogs?|pupp(y|ies)|cats?|kittens?|pets?)\b/.test(lower)) brief.pets = true;
  if (/\b(kids?|children|toddlers?)\b/.test(lower)) brief.kids = true;
  if (!swap && /\bsectional\b/.test(lower)) brief.preferSectional = true;

  if (/\bno (accent )?chair\b/.test(lower)) brief.wantsChair = false;
  else if (!swap && /\b(armchair|chair|reading|extra seat|guests?)\b/.test(lower)) brief.wantsChair = true;
  if (/\bno rug\b/.test(lower)) brief.wantsRug = false;

  const doorWall = parseDoorWall(text);
  if (doorWall) brief.doorWall = doorWall;

  const collection = lower.match(/\b(harbor|field|loft)\s+(collection|pieces|style|look)\b/);
  if (collection) brief.collection = collection[1][0].toUpperCase() + collection[1].slice(1);

  return { brief, swap };
}

module.exports = {
  parseShopperMessage,
  parseDimensions,
  parseBudget,
  parseSwap,
  FT_TO_M
};
