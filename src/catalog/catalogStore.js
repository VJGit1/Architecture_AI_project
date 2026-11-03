// src/catalog/catalogStore.js
// Seeds the Harbor & Co. product graph and reads it back for the planner.

const db = require('../graph/db');
const { COLLECTIONS, CATALOG_HOUSE, getSeedProducts } = require('./harborCatalog');

let seeded = null;

async function seedCatalog() {
  const products = getSeedProducts();
  const result = await db.upsertProducts(products, COLLECTIONS);
  seeded = { count: result.count, persistedTo: result.persistedTo, at: new Date().toISOString() };
  return seeded;
}

async function ensureSeeded() {
  if (!seeded || db.inMemoryStore.products.size === 0) {
    await seedCatalog();
  }
  return seeded;
}

async function listProducts(filter = {}) {
  await ensureSeeded();
  return db.queryProducts(filter);
}

async function getProduct(id) {
  await ensureSeeded();
  return db.getProduct(id);
}

function getSeedStatus() {
  return { house: CATALOG_HOUSE, collections: COLLECTIONS.map(c => c.name), ...(seeded || { count: 0, persistedTo: 'none' }) };
}

module.exports = {
  seedCatalog,
  ensureSeeded,
  listProducts,
  getProduct,
  getSeedStatus
};
