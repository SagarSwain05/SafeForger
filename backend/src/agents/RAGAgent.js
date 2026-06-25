// RAG Agent — Incident Pattern Intelligence with Gemini
const { generateWithFallback } = require('./geminiService');
const incidents = require('../data/incidents.json');
const regulations = require('../data/regulations.json');

class RAGAgent {
  constructor() {
    this.corpus = [...incidents, ...regulations];
  }

  // Simple TF-IDF-like keyword similarity (no vector DB needed for hackathon)
  _search(query, topK = 5) {
    const queryWords = new Set(
      query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
    );

    const scored = this.corpus.map(doc => {
      const docText = JSON.stringify(doc).toLowerCase();
      let score = 0;
      queryWords.forEach(word => {
        const regex = new RegExp(word, 'g');
        const matches = (docText.match(regex) || []).length;
        score += matches;
      });
      // Boost by tag matches
      const tags = doc.tags || [];
      tags.forEach(tag => {
        if (queryWords.has(tag.toLowerCase())) score += 5;
      });
      return { doc, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.doc);
  }

  async query(userQuery) {
    const relevant = this._search(userQuery);

    if (relevant.length === 0) {
      return {
        answer: 'No relevant incidents or regulations found for this query. Try searching for specific gas types, permit types, or incident categories.',
        sources: [],
        patterns: []
      };
    }

    const contextText = relevant.map((doc, i) => {
      if (doc.type && doc.casualties !== undefined) {
        return `[INCIDENT ${i+1}] ${doc.date} - ${doc.location}: ${doc.description} Root cause: ${doc.rootCause}. Regulation: ${doc.regulation}.`;
      } else {
        return `[REGULATION] ${doc.code} - ${doc.title}: ${doc.body}`;
      }
    }).join('\n\n');

    const prompt = `You are an industrial safety expert AI for Indian petrochemical plants. Using the following historical incident data and regulatory context, answer the user's safety query with specific, actionable insights.

USER QUERY: "${userQuery}"

RELEVANT CONTEXT:
${contextText}

Provide:
1. Pattern Analysis: What recurring safety pattern does this reveal?
2. Regulatory Violation: Which specific regulation(s) apply?
3. Prevention Priority: Top 2 immediate actions to prevent recurrence.
4. Risk Indicator: What early warning signs should operators watch for?

Be specific, cite regulation codes, and keep response under 200 words.`;

    const aiAnswer = await generateWithFallback(prompt);

    // Extract patterns
    const patterns = relevant
      .filter(doc => doc.pattern)
      .map(doc => doc.pattern)
      .filter((v, i, a) => a.indexOf(v) === i);

    return {
      answer: aiAnswer || this._generateFallbackAnswer(relevant, userQuery),
      sources: relevant.slice(0, 3).map(doc => ({
        id: doc.id,
        title: doc.title || `Incident: ${doc.location}`,
        code: doc.code || doc.type,
        date: doc.date,
        location: doc.location
      })),
      patterns,
      count: relevant.length
    };
  }

  _generateFallbackAnswer(relevant, query) {
    const incidents_found = relevant.filter(d => d.casualties !== undefined);
    const regs_found = relevant.filter(d => d.code);
    
    let answer = `Found ${relevant.length} relevant records. `;
    if (incidents_found.length > 0) {
      const totalCasualties = incidents_found.reduce((s, d) => s + d.casualties, 0);
      answer += `${incidents_found.length} historical incidents with ${totalCasualties} total casualties. Common root causes: ${[...new Set(incidents_found.map(d => d.rootCause.split('.')[0]))].slice(0,2).join('; ')}. `;
    }
    if (regs_found.length > 0) {
      answer += `Applicable regulations: ${regs_found.map(r => r.code).join(', ')}.`;
    }
    return answer;
  }

  getSimilarIncidents(pattern) {
    return incidents.filter(inc => {
      const patterns = inc.pattern ? inc.pattern.split('+').map(p => p.trim()) : [];
      return patterns.some(p => pattern.includes(p) || p.includes(pattern));
    });
  }

  getApplicableRegulations(keywords) {
    return regulations.filter(reg => {
      const regText = JSON.stringify(reg).toLowerCase();
      return keywords.some(kw => regText.includes(kw.toLowerCase()));
    });
  }
}

module.exports = RAGAgent;
