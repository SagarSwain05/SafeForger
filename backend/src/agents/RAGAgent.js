// RAG Agent — Incident Pattern Intelligence.
// Retrieves similar historical incidents + applicable regulations (TF-IDF vector search),
// then asks the LLM for a grounded, cited analysis. Falls back to a deterministic summary.
const llm = require('../services/llm');
const { VectorIndex } = require('../services/vectorIndex');
const incidents = require('../data/incidents.json');
const regulations = require('../data/regulations.json');

const isIncident = (d) => d.casualties !== undefined;
const docText = (d) => isIncident(d)
  ? `${d.type} ${d.gas || ''} ${d.description} ${d.rootCause} ${d.pattern} ${(d.tags || []).join(' ')} ${d.regulation}`
  : `${d.code} ${d.title} ${d.body} ${(d.tags || []).join(' ')} ${(d.tags || []).join(' ')}`;

class RAGAgent {
  constructor() {
    this.corpus = [...incidents, ...regulations];
    this.index = new VectorIndex(this.corpus, docText);
  }

  retrieve(query, k = 6) {
    return this.index.search(query, k);
  }

  /** Regulations most relevant to a hazard description (used to cite alerts). */
  regulationsFor(text, k = 3) {
    return this.index.search(text, 12).filter(r => !isIncident(r.doc)).slice(0, k).map(r => r.doc.code);
  }

  async query(userQuery) {
    const hits = this.retrieve(userQuery);
    if (hits.length === 0) {
      return {
        answer: 'No relevant incidents or regulations found. Try terms such as "hot work gas", "helmet violation", "smoke detection", "confined space oxygen" or "shift handover".',
        sources: [], patterns: [], count: 0, mode: 'retrieval',
      };
    }

    const context = hits.map(({ doc }, i) => isIncident(doc)
      ? `[S${i + 1}] INCIDENT ${doc.date} · ${doc.location} (${doc.kind === 'historical' ? 'historical record' : 'representative scenario'}): ${doc.description} Root cause: ${doc.rootCause}. Regulation: ${doc.regulation}.`
      : `[S${i + 1}] REGULATION ${doc.code} — ${doc.title}: ${doc.body}`).join('\n');

    const prompt = `You are an industrial safety expert supporting a control room in an Indian process plant.
Answer the operator's question using ONLY the numbered sources. Cite sources inline like [S1].

QUESTION: ${userQuery}

SOURCES:
${context}

Respond in four short sections:
1. Pattern — the recurring failure pattern these sources show.
2. Applicable rules — the regulation codes that apply, with one line each.
3. Prevent now — the two highest-impact actions.
4. Early warning signs — what operators and the vision/sensor system should watch for.
Keep it under 220 words. Plain text: no markdown, no asterisks or # headings.`;

    const aiAnswer = await llm.generate(prompt, { tier: 'quality', maxOutputTokens: 900 });
    const docs = hits.map(h => h.doc);
    return {
      answer: aiAnswer || this._fallback(docs),
      mode: aiAnswer ? 'llm' : 'retrieval',
      sources: hits.map(({ doc, score }, i) => ({
        ref: `S${i + 1}`,
        id: doc.id,
        title: isIncident(doc) ? `${doc.type} — ${doc.location}` : doc.title,
        code: doc.code || doc.type,
        kind: isIncident(doc) ? (doc.kind || 'incident') : 'regulation',
        date: doc.date,
        location: doc.location,
        score,
      })),
      patterns: [...new Set(docs.filter(d => d.pattern).map(d => d.pattern))],
      count: hits.length,
    };
  }

  _fallback(docs) {
    const inc = docs.filter(isIncident);
    const regs = docs.filter(d => !isIncident(d));
    const parts = [`Found ${docs.length} relevant records.`];
    if (inc.length) {
      parts.push(`Similar incidents: ${inc.map(d => `${d.type} (${d.location}, ${d.date})`).join('; ')}.`);
      parts.push(`Recurring root causes: ${[...new Set(inc.map(d => d.rootCause))].slice(0, 2).join(' | ')}.`);
    }
    if (regs.length) parts.push(`Applicable regulations: ${regs.map(r => `${r.code} (${r.title})`).join('; ')}.`);
    return parts.join(' ');
  }
}

module.exports = RAGAgent;
