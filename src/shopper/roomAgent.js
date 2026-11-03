// src/shopper/roomAgent.js
// Runs one shopper turn: apply the message, then let the policy pick tools until it stops.

const sessions = require('./session');
const { nextTool, statusSentence } = require('./policy');
const { toolbox } = require('./toolbox');

const MAX_STEPS_PER_TURN = 18;

async function runShopperTurn({ sessionId = null, message = '', fields = null } = {}, onStep = () => {}) {
  let session = sessionId ? await sessions.loadSession(sessionId) : null;
  const resumed = Boolean(session);
  if (!session) session = sessions.createSession(sessionId);

  sessions.beginTurn(session);
  const { parsed, briefChanged } = sessions.applyShopperTurn(session, message, fields);
  const turnTools = [];

  for (let step = 0; step < MAX_STEPS_PER_TURN; step++) {
    const decision = nextTool(session);
    if (!decision.tool) break;

    const status = statusSentence(decision, session);
    onStep({ type: 'step', tool: decision.tool, status });

    const tool = toolbox[decision.tool];
    if (!tool) {
      sessions.addTrace(session, { tool: decision.tool, arg: '-', observation: 'tool not available', ok: false, why: decision.why });
      session.status = 'blocked';
      break;
    }

    if (decision.repair) session.repairCount++;
    session.turnState.steps++;

    let result;
    try {
      result = await tool(session, decision.args || {}, { onStep });
    } catch (err) {
      result = { ok: false, arg: '-', observation: `error: ${err.message}` };
    }

    const row = {
      tool: decision.tool,
      arg: result.arg || '-',
      observation: result.observation || '',
      ok: result.ok !== false,
      repair: Boolean(decision.repair),
      why: decision.why,
      ...(result.traceExtra || {})
    };
    sessions.addTrace(session, row);
    turnTools.push(decision.tool);
    onStep({ type: 'trace', row: { turn: session.turn, ...row }, status });

    if (result.ok === false && result.fatal) {
      session.status = 'blocked';
      break;
    }
  }

  await sessions.saveSession(session);

  return {
    resumed,
    briefChanged,
    parsed,
    toolsCalled: turnTools,
    session: sessions.toView(session)
  };
}

async function getShopperSession(id) {
  const session = await sessions.loadSession(id);
  return session ? sessions.toView(session) : null;
}

module.exports = {
  runShopperTurn,
  getShopperSession
};
