// src/catalog/harborCatalog.js
// Harbor & Co. is a fictional sample catalog. Every name, size, and price here is invented.
// Sizes are meters (width along the wall, depth into the room, height). Prices are USD.

const COLLECTIONS = [
  { id: 'harbor', name: 'Harbor', style: 'coastal', note: 'Light oak, oat linen-look weaves, slipcovers.' },
  { id: 'field', name: 'Field', style: 'relaxed', note: 'Deep seats, warm taupe textiles, rounded wood.' },
  { id: 'loft', name: 'Loft', style: 'modern', note: 'Compact footprints, powder-coated steel, low profiles.' }
];

const ROLES = ['sofa', 'sectional', 'chair', 'coffee_table', 'media', 'rug', 'bed', 'nightstand'];

const PRODUCTS = [
  // Sofas
  { id: 'HC-SOF-084', name: 'Harbor 84 Sofa', role: 'sofa', width: 2.13, depth: 0.94, height: 0.84, price: 899, collection: 'Harbor', style: 'coastal', features: ['performance_fabric', 'removable_covers'], reason: 'Performance weave on a {width} m frame leaves {spare} m of open wall.' },
  { id: 'HC-SOF-090', name: 'Field 90 Performance Sofa', role: 'sofa', width: 2.29, depth: 0.99, height: 0.86, price: 1290, collection: 'Field', style: 'relaxed', features: ['performance_fabric', 'deep_seat'], reason: 'Stain-resistant performance fabric and a deep seat, {width} m on a {wall} m wall.' },
  { id: 'HC-SOF-096', name: 'Harbor 96 Grand Sofa', role: 'sofa', width: 2.44, depth: 1.02, height: 0.86, price: 1490, collection: 'Harbor', style: 'coastal', features: ['down_blend'], reason: 'The longest Harbor sofa; {width} m still clears {spare} m of the wall.' },
  { id: 'HC-SOF-078', name: 'Loft 78 Sofa', role: 'sofa', width: 1.98, depth: 0.89, height: 0.81, price: 749, collection: 'Loft', style: 'modern', features: ['kiln_dried_frame'], reason: 'A {width} m sofa that keeps the walkway open in the {room}.' },
  { id: 'HC-SOF-072', name: 'Loft 72 Apartment Sofa', role: 'sofa', width: 1.83, depth: 0.86, height: 0.79, price: 629, collection: 'Loft', style: 'modern', features: ['compact'], reason: 'Apartment depth of {depth} m for rooms where every step counts.' },
  { id: 'HC-SOF-080', name: 'Field 80 Slipcover Sofa', role: 'sofa', width: 2.03, depth: 0.97, height: 0.84, price: 999, collection: 'Field', style: 'relaxed', features: ['performance_fabric', 'washable_slipcover'], reason: 'Washable performance slipcover on a {width} m frame.' },

  // Sectionals
  { id: 'HC-SEC-108', name: 'Harbor Sectional 108', role: 'sectional', width: 2.75, depth: 1.70, height: 0.86, price: 1849, collection: 'Harbor', style: 'coastal', features: ['performance_fabric', 'reversible_chaise'], reason: 'Seats five with a reversible chaise; needs {width} m of wall.' },
  { id: 'HC-SEC-112', name: 'Field Modular Sectional 112', role: 'sectional', width: 2.84, depth: 1.78, height: 0.84, price: 2190, collection: 'Field', style: 'relaxed', features: ['modular', 'performance_fabric'], reason: 'Modular pieces you can rearrange later; {width} m across.' },
  { id: 'HC-SEC-098', name: 'Loft Compact Sectional 98', role: 'sectional', width: 2.49, depth: 1.55, height: 0.81, price: 1390, collection: 'Loft', style: 'modern', features: ['compact'], reason: 'An L-shape scaled for smaller rooms at {width} m wide.' },

  // Chairs
  { id: 'HC-CHR-031', name: 'Harbor Slipcover Chair', role: 'chair', width: 0.84, depth: 0.89, height: 0.84, price: 449, collection: 'Harbor', style: 'coastal', features: ['performance_fabric'], reason: 'A second seat by the table in performance fabric.' },
  { id: 'HC-CHR-028', name: 'Field Swivel Chair', role: 'chair', width: 0.79, depth: 0.84, height: 0.81, price: 529, collection: 'Field', style: 'relaxed', features: ['swivel'], reason: 'Swivels between the conversation and the screen.' },
  { id: 'HC-CHR-026', name: 'Loft Sling Chair', role: 'chair', width: 0.71, depth: 0.79, height: 0.76, price: 319, collection: 'Loft', style: 'modern', features: ['compact'], reason: 'A light {width} m chair that does not crowd the table.' },
  { id: 'HC-CHR-034', name: 'Field Oversized Chair', role: 'chair', width: 1.02, depth: 0.97, height: 0.86, price: 689, collection: 'Field', style: 'relaxed', features: ['performance_fabric', 'deep_seat'], reason: 'Room for two at {width} m wide, for a larger room.' },

  // Coffee tables
  { id: 'HC-TBL-048', name: 'Harbor Oak Coffee Table', role: 'coffee_table', width: 1.22, depth: 0.61, height: 0.43, price: 349, collection: 'Harbor', style: 'coastal', features: ['solid_oak'], reason: 'About two thirds of the sofa length, the usual proportion.' },
  { id: 'HC-TBL-054', name: 'Harbor Plank Coffee Table', role: 'coffee_table', width: 1.37, depth: 0.71, height: 0.43, price: 429, collection: 'Harbor', style: 'coastal', features: ['solid_oak'], reason: 'A longer {width} m top that suits a long sofa.' },
  { id: 'HC-TBL-042', name: 'Field Round Coffee Table', role: 'coffee_table', width: 1.07, depth: 1.07, height: 0.41, price: 299, collection: 'Field', style: 'relaxed', features: ['rounded_edges'], reason: 'Rounded edges for a busy walkway.' },
  { id: 'HC-TBL-036', name: 'Loft Lift-Top Coffee Table', role: 'coffee_table', width: 1.12, depth: 0.56, height: 0.46, price: 259, collection: 'Loft', style: 'modern', features: ['lift_top', 'storage'], reason: 'The top lifts for laptops and hides remotes underneath.' },
  { id: 'HC-TBL-030', name: 'Loft Nesting Tables', role: 'coffee_table', width: 0.76, depth: 0.76, height: 0.43, price: 199, collection: 'Loft', style: 'modern', features: ['nesting', 'compact'], reason: 'Two tables that tuck together when the room needs floor.' },

  // Media
  { id: 'HC-MED-072', name: 'Harbor 72 Media Console', role: 'media', width: 1.83, depth: 0.46, height: 0.61, price: 599, collection: 'Harbor', style: 'coastal', features: ['cable_management', 'fits_75in_tv'], reason: 'Holds up to a 75 in TV with cable routing at the back.' },
  { id: 'HC-MED-060', name: 'Field 60 Media Console', role: 'media', width: 1.52, depth: 0.43, height: 0.61, price: 479, collection: 'Field', style: 'relaxed', features: ['fits_65in_tv'], reason: 'A {width} m console sized for a 65 in TV.' },
  { id: 'HC-MED-048', name: 'Loft 48 Media Stand', role: 'media', width: 1.22, depth: 0.41, height: 0.56, price: 249, collection: 'Loft', style: 'modern', features: ['fits_55in_tv', 'compact'], reason: 'A {width} m stand that fits beside a door.' },
  { id: 'HC-MED-084', name: 'Loft 84 Media Wall', role: 'media', width: 2.13, depth: 0.46, height: 0.66, price: 849, collection: 'Loft', style: 'modern', features: ['fits_85in_tv', 'storage'], reason: 'Closed storage across {width} m of wall.' },

  // Rugs (depth runs toward the sofa)
  { id: 'HC-RUG-058', name: 'Harbor Flatweave Rug 5x8', role: 'rug', width: 2.44, depth: 1.52, height: 0.01, price: 219, collection: 'Harbor', style: 'coastal', features: ['washable'], reason: 'A machine-washable flatweave, {width} m by {depth} m.' },
  { id: 'HC-RUG-069', name: 'Loft Low-Pile Rug 6x9', role: 'rug', width: 2.74, depth: 1.83, height: 0.01, price: 329, collection: 'Loft', style: 'modern', features: ['washable', 'pet_friendly'], reason: 'Low pile that vacuums easily and goes in the wash.' },
  { id: 'HC-RUG-810', name: 'Field Wool Rug 8x10', role: 'rug', width: 3.05, depth: 2.44, height: 0.01, price: 549, collection: 'Field', style: 'relaxed', features: ['wool'], reason: 'Large enough for the front legs of every seat.' },

  // Beds
  { id: 'HC-BED-QN', name: 'Harbor Queen Platform Bed', role: 'bed', width: 1.63, depth: 2.13, height: 1.12, price: 899, collection: 'Harbor', style: 'coastal', features: ['solid_oak'], reason: 'A queen at {width} m leaves room for nightstands on a {wall} m wall.' },
  { id: 'HC-BED-KG', name: 'Field King Upholstered Bed', role: 'bed', width: 2.03, depth: 2.18, height: 1.22, price: 1290, collection: 'Field', style: 'relaxed', features: ['performance_fabric'], reason: 'King size in performance fabric, {width} m on a {wall} m wall.' },
  { id: 'HC-BED-FL', name: 'Loft Full Metal Bed', role: 'bed', width: 1.42, depth: 1.98, height: 1.02, price: 499, collection: 'Loft', style: 'modern', features: ['compact'], reason: 'A full bed that keeps {spare} m of wall free.' },

  // Nightstands
  { id: 'HC-NST-024', name: 'Harbor Two-Drawer Nightstand', role: 'nightstand', width: 0.61, depth: 0.41, height: 0.61, price: 229, collection: 'Harbor', style: 'coastal', features: ['storage'], reason: 'Two drawers at mattress height.' },
  { id: 'HC-NST-020', name: 'Field Open Nightstand', role: 'nightstand', width: 0.51, depth: 0.38, height: 0.58, price: 169, collection: 'Field', style: 'relaxed', features: ['open_shelf'], reason: 'An open shelf that keeps the side of the bed light.' },
  { id: 'HC-NST-018', name: 'Loft Wall Nightstand', role: 'nightstand', width: 0.46, depth: 0.36, height: 0.56, price: 139, collection: 'Loft', style: 'modern', features: ['compact'], reason: 'A {width} m nightstand for a tight bedside.' }
];

function getSeedProducts() {
  return PRODUCTS.map(p => ({ ...p, features: [...p.features] }));
}

// Fills a reason template with real numbers from the SKU and the room.
function renderReason(product, context = {}) {
  const wall = context.wallLength || 0;
  const values = {
    width: product.width.toFixed(2),
    depth: product.depth.toFixed(2),
    wall: wall ? wall.toFixed(2) : '?',
    spare: wall ? Math.max(0, wall - product.width).toFixed(2) : '?',
    price: `$${product.price.toLocaleString('en-US')}`,
    room: context.roomLabel || 'this'
  };
  return String(product.reason || '').replace(/\{(\w+)\}/g, (_, key) => (values[key] !== undefined ? values[key] : ''));
}

module.exports = {
  CATALOG_HOUSE: 'Harbor & Co.',
  COLLECTIONS,
  ROLES,
  getSeedProducts,
  renderReason
};
