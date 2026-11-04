// src/shopper/toolbox.js
// Registry of shopper tools. Each tool is (session, args, ctx) => { ok, arg, observation, ... }.

const conversation = require('./tools/conversation');
const catalogTools = require('./tools/catalogTools');
const fitTools = require('./tools/fitTools');

const toolbox = {
  ask_shopper: conversation.ask_shopper,
  search_catalog: catalogTools.search_catalog,
  propose_bundle: catalogTools.propose_bundle,
  place_in_room: fitTools.place_in_room,
  critique_fit: fitTools.critique_fit,
  swap_sku: fitTools.swap_sku,
  explain: conversation.explain
};

module.exports = { toolbox };
