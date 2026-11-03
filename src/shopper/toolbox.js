// src/shopper/toolbox.js
// Registry of shopper tools. Each tool is (session, args, ctx) => { ok, arg, observation, ... }.

const conversation = require('./tools/conversation');

const toolbox = {
  ask_shopper: conversation.ask_shopper,
  explain: conversation.explain
};

module.exports = { toolbox };
