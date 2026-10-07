const { test } = require('node:test');
const assert = require('node:assert/strict');
const { forecastSensor } = require('../src/services/forecast');
const { VectorIndex } = require('../src/services/vectorIndex');
const { KnowledgeGraph } = require('../src/services/KnowledgeGraph');
const layout = require('../src/data/plant-layout.json');

const series = (f, n = 12) => Array.from({ length: n }, (_, i) => ({ t: i * 2000, v: f(i) }));

test('forecast: steady rise yields ETA to warning', () => {
  const hist = series(i => 2 + i * 0.3);
  const f = forecastSensor({ id: 'S', type: 'CH4', value: hist.at(-1).v, baseline: 2, warningThreshold: 10, criticalThreshold: 20, history: hist });
  assert.equal(f.trend, 'WORSENING');
  assert.ok(f.etaWarningMin > 0 && f.etaWarningMin < 2, `eta ${f.etaWarningMin}`);
});

test('forecast: flat noise is STABLE', () => {
  const hist = series(i => 2 + (i % 2 ? 0.05 : -0.05));
  const f = forecastSensor({ id: 'S', type: 'CH4', value: 2, baseline: 2, warningThreshold: 10, criticalThreshold: 20, history: hist });
  assert.equal(f.trend, 'STABLE');
  assert.equal(f.etaWarningMin, null);
});

test('forecast: falling O2 is worsening', () => {
  const hist = series(i => 20.9 - i * 0.12);
  const f = forecastSensor({ id: 'O', type: 'O2', value: hist.at(-1).v, baseline: 20.9, warningThreshold: 19.5, criticalThreshold: 16, history: hist });
  assert.equal(f.trend, 'WORSENING');
});

test('vector index ranks the relevant document first', () => {
  const docs = [{ id: 'a', t: 'hot work welding permit gas test' }, { id: 'b', t: 'safety helmet head protection hard hat' }, { id: 'c', t: 'fire alarm evacuation smoke' }];
  const idx = new VectorIndex(docs, d => d.t);
  assert.equal(idx.search('worker missing hardhat')[0].doc.id, 'b');
  assert.equal(idx.search('flames and smoke')[0].doc.id, 'c');
});

test('knowledge graph adjacency is spatial', () => {
  const kg = new KnowledgeGraph(layout);
  assert.ok(kg.areAdjacent('Z-01', 'Z-02'));
  assert.ok(!kg.areAdjacent('Z-01', 'Z-15'));
  assert.ok(kg.areAdjacent('Z-03', 'Z-03'));
});
