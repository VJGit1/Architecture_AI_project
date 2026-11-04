// src/shopper/tools/conversation.js
// ask_shopper and explain. A model may phrase the question and the explanation; nothing else.

const { llmProvider } = require('../../ai/llmProvider');
const {
  SLOT_LABELS,
  WALL_COMPASS,
  cartTotal,
  roomLabel
} = require('../session');
const { primaryFailure } = require('../policy');

const usd = n => `$${Math.round(n).toLocaleString('en-US')}`;

const RULE_LABELS = {
  budget: 'budget',
  roles: 'required pieces',
  door: 'door swing',
  fit: 'fit inside the walls',
  facing: 'sofa facing the TV',
  request: 'shopper request',
  search: 'catalog search'
};

function cleanModelText(text, maxLen) {
  if (typeof text !== 'string') return null;
  const stripped = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
  if (!stripped || stripped.length > maxLen) return null;
  return stripped;
}

function localQuestion(missing) {
  const needsSize = missing.includes('width') || missing.includes('length');
  const needsBudget = missing.includes('budget');
  if (needsSize && needsBudget) return 'How wide and long is the room, and what should the set cost at most?';
  if (needsSize) return 'How wide and long is the room, in feet or meters?';
  return 'What should the whole set cost at most?';
}

async function ask_shopper(session, args = {}) {
  const missing = args.missing || [];
  const local = localQuestion(missing);
  let question = local;
  let provider = 'local';

  if (llmProvider.isCloudLLMConfigured()) {
    try {
      const res = await llmProvider.generateStructuredJSON({
        systemPrompt: 'You help a furniture shopper. Write exactly one short, plain question asking for the missing details. No emoji, no preamble. Return JSON {"question": string}.',
        userPrompt: JSON.stringify({ room: roomLabel(session.brief), missing }),
        schemaName: 'ShopperQuestion',
        localCompilerFn: async () => ({ question: local })
      });
      const q = cleanModelText(res.data && res.data.question, 160);
      if (q && q.endsWith('?') && q.split('?').length === 2) {
        question = q;
        provider = res.provider;
      }
    } catch (_) {
      // keep the local question
    }
  }

  session.question = question;
  session.status = 'needs_input';
  session.turnState.asked = true;
  return { ok: true, arg: `missing=${missing.join(',')}`, observation: `asked "${question}"`, provider };
}

function buildOpenIssue(session) {
  const failure = primaryFailure(session.lastCritique);
  if (!failure) return null;
  return {
    room: roomLabel(session.brief),
    rule: failure.rule,
    ruleLabel: RULE_LABELS[failure.rule] || failure.rule,
    skuId: failure.skuId || null,
    skuName: failure.skuName || null,
    message: failure.message
  };
}

function openIssueSentence(issue) {
  if (!issue) return null;
  const sku = issue.skuName ? `${issue.skuName}${issue.skuId ? ` (${issue.skuId})` : ''}` : 'no SKU';
  return `Open issue in the ${issue.room}: ${issue.ruleLabel} rule, ${sku}. ${issue.message}`;
}

function localWhy(session) {
  const brief = session.brief;
  const placement = session.placement;
  const total = cartTotal(session);
  const seatSlot = brief.roomType === 'bedroom' ? 'bed' : 'seat';
  const seat = session.cart.find(l => l.slot === seatSlot);
  const media = session.cart.find(l => l.slot === 'media');
  const parts = [];

  const swaps = session.trace.filter(t => t.turn === session.turn && t.tool === 'swap_sku' && t.ok && t.reason === 'shopper');
  if (swaps.length > 0) {
    const kept = session.cart.filter(l => !swaps.some(s => s.slot === l.slot)).map(l => SLOT_LABELS[l.slot] || l.slot);
    const swapped = swaps.map(s => s.newName).filter(Boolean).join(', ');
    const keptText = kept.length > 2
      ? `${kept.slice(0, -1).join(', ')}, and ${kept[kept.length - 1]}`
      : kept.join(' and ');
    parts.push(`Swapped in the ${swapped} and kept the ${keptText || 'rest of the set'}.`);
  }

  if (seat && placement) {
    const wallName = WALL_COMPASS[placement.seatWall] || 'long';
    const wallLen = placement.walls && placement.walls[placement.seatWall] ? placement.walls[placement.seatWall].toFixed(2) : null;
    let sentence = `The ${seat.sku.name} takes the ${wallName} wall${wallLen ? ` (${wallLen} m)` : ''}`;
    if (media && placement.mediaWall) sentence += ` and faces the ${media.sku.name} on the ${WALL_COMPASS[placement.mediaWall]} wall`;
    parts.push(`${sentence}.`);
  }

  if (brief.pets && seat && (seat.sku.features || []).includes('performance_fabric')) {
    parts.push('The seating is performance fabric for the pet.');
  }

  if (brief.budget) {
    const left = brief.budget - total;
    parts.push(left >= 0
      ? `The set comes to ${usd(total)}, ${usd(left)} under the ${usd(brief.budget)} budget.`
      : `The set comes to ${usd(total)}, ${usd(-left)} over the ${usd(brief.budget)} budget.`);
  }

  return parts.join(' ');
}

async function explain(session, args = {}) {
  if (!session.openIssue && session.lastCritique && !session.lastCritique.pass) {
    session.openIssue = buildOpenIssue(session);
  }
  const issueSentence = openIssueSentence(session.openIssue);
  const local = session.cart.length > 0 ? localWhy(session) : 'Nothing could be placed yet.';
  let why = local;
  let provider = 'local';

  if (llmProvider.isCloudLLMConfigured() && session.cart.length > 0) {
    try {
      const facts = {
        room: roomLabel(session.brief),
        pets: session.brief.pets,
        tv: session.brief.needsTv,
        cart: session.cart.map(l => ({ piece: SLOT_LABELS[l.slot], name: l.sku.name, reason: l.reason })),
        summary: local
      };
      const res = await llmProvider.generateStructuredJSON({
        systemPrompt: 'You write the "Why this set" note for a furniture cart. Two short plain sentences. Use only the facts given; do not state sizes, prices, or totals. No emoji. Return JSON {"why": string}.',
        userPrompt: JSON.stringify(facts),
        schemaName: 'CartExplanation',
        localCompilerFn: async () => ({ why: local })
      });
      const text = cleanModelText(res.data && res.data.why, 360);
      if (text && !/\d/.test(text)) {
        why = text;
        provider = res.provider;
      }
    } catch (_) {
      // keep the local explanation
    }
  }

  session.explanation = { why, openIssue: issueSentence, provider };
  session.status = session.openIssue ? 'open_issue' : 'fitted';
  session.turnState.explained = true;

  const lines = session.cart.length;
  return {
    ok: true,
    arg: args.openIssue || session.openIssue ? 'open_issue' : 'cart',
    observation: session.openIssue
      ? `${lines} pieces, open issue: ${session.openIssue.ruleLabel} on ${session.openIssue.skuName || 'no SKU'}`
      : `${lines} pieces, ${usd(cartTotal(session))} of ${usd(session.brief.budget)}`,
    provider
  };
}

module.exports = {
  ask_shopper,
  explain,
  RULE_LABELS,
  openIssueSentence
};
