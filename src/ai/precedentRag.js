// src/ai/precedentRag.js
// Hybrid GraphRAG (Vector + Topological Subgraph Retrieval) & Episodic User Design Memory
// Retrieves architectural precedents using 64-D cosine similarity over lifestyle/spatial embeddings,
// and maintains persistent user preference constraints across multi-turn conversations.

const { llmProvider } = require('./llmProvider');

const ARCHITECTURAL_PRECEDENTS = [
  {
    id: 'prec-tokyo-sanctuary',
    title: 'Kyoto Machiya & Tokyo Zen Sanctuary',
    architecturalLineage: 'Japanese Contemporary Minimalist / Ryokan Spatial Flow',
    summary: 'Compact, light-filled urban sanctuary emphasizing a tranquil engawa transition, natural oak joinery, and acoustic separation between sleeping tatami/platform zone and entertaining kitchen.',
    recommendedStyle: 'japandi',
    targetSqMeters: 52,
    tags: ['compact', 'zen', 'japandi', 'kyoto', 'studio', '1-bedroom', 'calm', 'sunlit', 'minimal', 'oak', 'tea'],
    programTemplate: [
      { name: 'Engawa Living Salon', type: 'living', width: 5.6, length: 4.8, height: 2.9, solarPreference: 'south', privacyLevel: 0.15 },
      { name: 'Hinoki & Oak Tea Kitchen', type: 'kitchen', width: 3.8, length: 3.6, height: 2.8, solarPreference: 'east', privacyLevel: 0.30 },
      { name: 'Sanctuary Primary Bedroom', type: 'bedroom', width: 4.4, length: 3.8, height: 2.8, solarPreference: 'east', privacyLevel: 0.95 },
      { name: 'Onsen Soaking Wetroom', type: 'bathroom', width: 2.6, length: 2.8, height: 2.6, solarPreference: 'core', privacyLevel: 0.85 }
    ],
    bubblePriors: {
      attractions: [
        { sourceType: 'living', targetType: 'kitchen', weight: 0.95, reason: 'Seamless tea & hosting flow' },
        { sourceType: 'bedroom', targetType: 'bathroom', weight: 0.90, reason: 'Private onsen suite transition' }
      ],
      repulsions: [
        { sourceType: 'kitchen', targetType: 'bathroom', weight: 0.95, reason: 'Strict Machiya sanitary separation' }
      ]
    }
  },
  {
    id: 'prec-parisian-haussmann',
    title: 'Parisian Left-Bank Entertainer Atelier',
    architecturalLineage: 'Haussmann Enfilade Proportional Geometry',
    summary: 'Grand social entertaining apartment with double-aspect salon, gourmet chef island for dinner parties, private master wing, and sunlit terrace.',
    recommendedStyle: 'warm-minimalist',
    targetSqMeters: 96,
    tags: ['entertain', 'host', 'dinner', 'party', 'chef', 'parisian', 'haussmann', '2-bedroom', 'couple', 'terrace', 'luxury'],
    programTemplate: [
      { name: 'Grand Enfilade Reception Salon', type: 'living', width: 6.8, length: 5.6, height: 3.2, solarPreference: 'south', privacyLevel: 0.10 },
      { name: 'Chef Island & Tasting Kitchen', type: 'kitchen', width: 4.6, length: 4.2, height: 3.0, solarPreference: 'east', privacyLevel: 0.25 },
      { name: 'Primary Courtyard Suite', type: 'bedroom', width: 4.8, length: 4.2, height: 3.0, solarPreference: 'east', privacyLevel: 0.95 },
      { name: 'Guest Salon / Atelier Study', type: 'bedroom', width: 3.8, length: 3.8, height: 3.0, solarPreference: 'west', privacyLevel: 0.70 },
      { name: 'Calacatta Spa Bath', type: 'bathroom', width: 2.8, length: 3.0, height: 2.8, solarPreference: 'core', privacyLevel: 0.85 },
      { name: 'Sunlit Parisian Terrace', type: 'balcony', width: 4.2, length: 2.4, height: 3.0, solarPreference: 'south', privacyLevel: 0.20 }
    ],
    bubblePriors: {
      attractions: [
        { sourceType: 'living', targetType: 'kitchen', weight: 0.98, reason: 'Dinner party social axis' },
        { sourceType: 'living', targetType: 'balcony', weight: 0.90, reason: 'Aperitif indoor-outdoor terrace flow' }
      ],
      repulsions: [
        { sourceType: 'bedroom', targetType: 'living', weight: 0.75, reason: 'Acoustic buffer from late-night hosting' }
      ]
    }
  },
  {
    id: 'prec-case-study-pavilion',
    title: 'Mid-Century Case Study Glass Pavilion',
    architecturalLineage: 'Eames / Neutra California Modernism',
    summary: 'Expansive multi-wing residence with warm walnut paneling, cognac leather conversation zone, dedicated remote-work creative office, and family bedroom zoning.',
    recommendedStyle: 'mid-century',
    targetSqMeters: 138,
    tags: ['family', 'kids', '3-bedroom', 'penthouse', 'mid-century', 'walnut', 'leather', 'villa', 'spacious', 'work', 'remote'],
    programTemplate: [
      { name: 'Double-Height Pavilion Salon', type: 'living', width: 7.4, length: 6.0, height: 3.2, solarPreference: 'south', privacyLevel: 0.10 },
      { name: 'Walnut & Brass Chef Kitchen', type: 'kitchen', width: 5.0, length: 4.4, height: 3.0, solarPreference: 'east', privacyLevel: 0.25 },
      { name: 'Primary Master Sanctuary', type: 'bedroom', width: 5.2, length: 4.6, height: 3.0, solarPreference: 'east', privacyLevel: 0.98 },
      { name: 'Primary Terrazzo Spa Bath', type: 'bathroom', width: 3.2, length: 3.0, height: 2.8, solarPreference: 'core', privacyLevel: 0.90 },
      { name: 'Second Family Bedroom', type: 'bedroom', width: 4.2, length: 3.8, height: 2.9, solarPreference: 'west', privacyLevel: 0.85 },
      { name: 'Acoustically Isolated Study / Bed 3', type: 'office', width: 4.0, length: 3.6, height: 2.9, solarPreference: 'north', privacyLevel: 0.75 },
      { name: 'Guest Powder Room', type: 'bathroom', width: 2.4, length: 2.4, height: 2.7, solarPreference: 'core', privacyLevel: 0.60 }
    ],
    bubblePriors: {
      attractions: [
        { sourceType: 'living', targetType: 'kitchen', weight: 0.95, reason: 'California open-plan living core' },
        { sourceType: 'bedroom', targetType: 'bathroom', weight: 0.92, reason: 'En-suite master wing connectivity' }
      ],
      repulsions: [
        { sourceType: 'office', targetType: 'living', weight: 0.85, reason: 'Deep-work acoustic isolation from family lounge' }
      ]
    }
  },
  {
    id: 'prec-creative-atelier-hq',
    title: 'Biophilic Architecture & AI Design Studio HQ',
    architecturalLineage: 'Nordic Collaborative Atelier',
    summary: 'High-craft creative headquarters featuring client gallery lounge, acoustic boardroom, sunlit collaborative studio, partner suite, and barista pantry.',
    recommendedStyle: 'japandi',
    targetSqMeters: 148,
    tags: ['office', 'work', 'creative', 'studio', 'conference', 'team', 'startup', 'headquarters', 'agency', 'workspace'],
    programTemplate: [
      { name: 'Client Gallery & Welcome Lounge', type: 'living', width: 6.2, length: 5.0, height: 3.2, solarPreference: 'south', privacyLevel: 0.10 },
      { name: 'Open Design & Engineering Atelier', type: 'office', width: 6.8, length: 5.6, height: 3.2, solarPreference: 'east', privacyLevel: 0.45 },
      { name: 'Acoustic Executive Boardroom', type: 'office', width: 5.4, length: 4.4, height: 3.0, solarPreference: 'west', privacyLevel: 0.65 },
      { name: 'Founding Partner Focus Suite', type: 'office', width: 4.2, length: 3.8, height: 3.0, solarPreference: 'north', privacyLevel: 0.85 },
      { name: 'Artisanal Espresso Bar & Pantry', type: 'kitchen', width: 3.8, length: 3.6, height: 2.9, solarPreference: 'east', privacyLevel: 0.25 },
      { name: 'Accessible Wellness Restroom', type: 'bathroom', width: 2.8, length: 2.8, height: 2.8, solarPreference: 'core', privacyLevel: 0.80 }
    ],
    bubblePriors: {
      attractions: [
        { sourceType: 'living', targetType: 'kitchen', weight: 0.90, reason: 'Hospitality espresso bar adjacent to client reception' }
      ],
      repulsions: [
        { sourceType: 'office', targetType: 'kitchen', weight: 0.65, reason: 'Prevent pantry chatter from bleeding into focus suite' }
      ]
    }
  }
];

class PrecedentGraphRAG {
  constructor() {
    this.precedents = ARCHITECTURAL_PRECEDENTS;
    this.embeddedPrecedents = null;
    // Episodic user memory store (persists learned user constraints across turns)
    this.userMemory = {
      preferredStyle: null,
      accessibilityRequired: false,
      hasPets: false,
      worksFromHome: false,
      lovesHosting: false,
      budgetTier: 'luxury', // 'essential' | 'curated' | 'luxury'
      explicitNotes: []
    };
  }

  async _ensureEmbeddings() {
    if (this.embeddedPrecedents) return;
    this.embeddedPrecedents = [];
    for (const p of this.precedents) {
      const corpus = `${p.title} ${p.architecturalLineage} ${p.summary} ${p.tags.join(' ')}`;
      const vec = await llmProvider.embedText(corpus);
      this.embeddedPrecedents.push({ ...p, embedding: vec });
    }
  }

  /**
   * Updates episodic user preference memory from natural language prompt
   */
  extractAndStoreUserPreferences(promptText) {
    const p = String(promptText || '').toLowerCase();
    const learned = [];

    if (p.includes('japandi') || p.includes('zen') || p.includes('kyoto') || p.includes('oak')) {
      this.userMemory.preferredStyle = 'japandi';
      learned.push('Style preference: Japandi');
    } else if (p.includes('mid-century') || p.includes('walnut') || p.includes('leather') || p.includes('retro')) {
      this.userMemory.preferredStyle = 'mid-century';
      learned.push('Style preference: Mid-Century Modern');
    } else if (p.includes('minimalist') || p.includes('travertine') || p.includes('monochrome') || p.includes('limewash')) {
      this.userMemory.preferredStyle = 'warm-minimalist';
      learned.push('Style preference: Warm Minimalist');
    }

    if (p.includes('wheelchair') || p.includes('ada') || p.includes('accessible') || p.includes('elderly') || p.includes('barrier-free')) {
      this.userMemory.accessibilityRequired = true;
      learned.push('Constraint: ADA Universal Accessibility (>=0.95m doors)');
    }
    if (p.includes('dog') || p.includes('cat') || p.includes('pet') || p.includes('retriever')) {
      this.userMemory.hasPets = true;
      learned.push('Lifestyle: Pet-friendly indoor-outdoor circulation');
    }
    if (p.includes('remote') || p.includes('work from home') || p.includes('wfh') || p.includes('study') || p.includes('office')) {
      this.userMemory.worksFromHome = true;
      learned.push('Lifestyle: Acoustic remote-work study required');
    }
    if (p.includes('host') || p.includes('dinner') || p.includes('party') || p.includes('entertain') || p.includes('guests')) {
      this.userMemory.lovesHosting = true;
      learned.push('Lifestyle: High-capacity social entertaining flow');
    }

    if (learned.length > 0) {
      this.userMemory.explicitNotes = Array.from(new Set([...this.userMemory.explicitNotes, ...learned])).slice(-6);
    }

    return {
      currentMemory: { ...this.userMemory },
      newlyLearned: learned
    };
  }

  /**
   * Retrieves top-k architectural precedents via 64-D Vector Cosine Similarity
   */
  async retrievePrecedents(queryText, topK = 2) {
    await this._ensureEmbeddings();
    const queryVec = await llmProvider.embedText(queryText);

    const scored = this.embeddedPrecedents.map(prec => {
      const sim = llmProvider.cosineSimilarity(queryVec, prec.embedding);
      return {
        id: prec.id,
        title: prec.title,
        architecturalLineage: prec.architecturalLineage,
        summary: prec.summary,
        recommendedStyle: prec.recommendedStyle,
        targetSqMeters: prec.targetSqMeters,
        similarityScore: sim,
        programTemplate: prec.programTemplate,
        bubblePriors: prec.bubblePriors
      };
    });

    scored.sort((a, b) => b.similarityScore - a.similarityScore);
    return {
      topMatches: scored.slice(0, topK),
      embeddingDimension: queryVec.length,
      provider: llmProvider.getActiveProviderName()
    };
  }
}

module.exports = {
  PrecedentGraphRAG,
  precedentRag: new PrecedentGraphRAG()
};
