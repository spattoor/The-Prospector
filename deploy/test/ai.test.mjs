import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvidence, selectEvidence, AIError } from '../ai.mjs';
test('AI evidence validator accepts supported and unsupported answers', () => {
  assert.equal(validateEvidence({ supported: true, ids: ['source-1'] }, new Set(['source-1'])).supported, true);
  assert.equal(validateEvidence({ supported: false, ids: [] }, new Set(['source-1'])).supported, false);
});
test('AI evidence validator rejects invented IDs, extra claims and inconsistent answers', () => {
  for (const value of [{ supported: true, ids: ['invented'] }, { supported: false, ids: ['source-1'] },
    { supported: true, ids: ['source-1'], unsupportedClaim: 'invented' }]) {
    assert.throws(() => validateEvidence(value, new Set(['source-1'])), AIError);
  }
});
test('AI provider failure stays visibly unavailable', async () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'unit-test-only';
  try { await assert.rejects(selectEvidence('test', [{ id: 's', text: 'fixture' }], async () => new Response('{}', { status: 503 })), /HTTP 503/); }
  finally { if (saved === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved; }
});
