import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('MAIL_FUNCTION_DISABLE_SERVE', '1');
const { storeExtractedKnowledge } = await import('./index.ts');

type Evidence = { approval?: string; description_status?: string; fields: Record<string, Record<string, unknown>> };
type Row = Record<string, unknown> & { data?: Record<string, unknown> & { extraction_evidence?: Evidence } };
function fixture(existing: Row | null = null, validateDuringUpdate = false, lookupError = false) {
  const inserted: Row[] = [], updates: Row[] = [];
  const row = existing ? structuredClone(existing) : null;
  const client = { from(table: string) {
    assertEquals(table, 'learned_knowledge', 'No dossier facts/pricing writes');
    const filters: Array<[string, unknown]> = [];
    let payload: Row | null = null;
    return {
      select() { return this; },
      eq(key: string, value: unknown) { filters.push([key, value]); return this; },
      maybeSingle() { return Promise.resolve({ data: row ? structuredClone(row) : null, error: lookupError ? { message: "synthetic lookup failure" } : null }); },
      insert(value: Row) { inserted.push(value); return Promise.resolve({ error: null }); },
      update(value: Row) { payload = value; return this; },
      then(resolve: (value: unknown) => unknown) {
        if (validateDuringUpdate && row) row.is_validated = true;
        if (row && filters.every(([key, value]) => row[key] === value)) {
          Object.assign(row, payload); updates.push(payload!);
        }
        return Promise.resolve(resolve({ error: null }));
      },
    };
  }};
  return { client, inserted, updates, row };
}
const source = { id: 'synthetic-email', body_text: 'AOD DSS. DAP. General cargo. 2 pcs | 60 x 80 x 65 cm | 104 kg' };
const extraction = {
  category: 'marchandise', name: 'Synthetic freight', confidence: 0.95,
  description: 'Two cartons, total 104 kg',
  data: { description: 'General cargo', poids: '104 kg', conditionnement: 'cartons' },
};
Deno.test('learning: confidence cannot approve ambiguous or invented cargo knowledge', async () => {
  const f = fixture();
  await storeExtractedKnowledge({ extractions: [extraction] }, 'synthetic-thread', [source.id], f.client);
  assertEquals(f.inserted.length, 1);
  assertEquals(f.inserted[0].is_validated, false);
  assertEquals(f.inserted[0].data!.poids, '104 kg', 'Useful extraction is retained, not deleted');
});
Deno.test('learning: a higher model confidence cannot overwrite approved knowledge', async () => {
  const old = { id: 'approved', confidence: 0.8, is_validated: true, description: 'Approved source', data: { poids: '80 kg' } };
  const f = fixture(old);
  await storeExtractedKnowledge({ extractions: [extraction] }, 'synthetic-thread', [source.id], f.client);
  assertEquals(f.row, old);
  assertEquals(f.updates.length, 0);
});
Deno.test('learning: validation during candidate update prevents the write', async () => {
  const f = fixture({ id: 'pending', confidence: 0.8, is_validated: false, data: { poids: '80 kg' } }, true);
  await storeExtractedKnowledge({ extractions: [extraction] }, 'synthetic-thread', [source.id], f.client);
  assertEquals(f.row?.is_validated, true);
  assertEquals(f.row?.data!.poids, '80 kg');
  assertEquals(f.updates.length, 0);
});

Deno.test('learning: ambiguous measurements remain useful candidates with unknown scope', async () => {
  const f = fixture();
  await storeExtractedKnowledge({ extractions: [extraction] }, 'synthetic-thread', [source.id], f.client, [source]);
  const data = f.inserted[0].data!;
  assertEquals(data.poids, '104 kg');
  assertEquals(data.extraction_evidence!.approval, 'not_reviewed');
  assertEquals(data.extraction_evidence!.description_status, 'ai_generated_unreviewed');
  assertEquals(data.extraction_evidence!.fields.weight_scope.status, 'unknown');
  assertEquals(data.extraction_evidence!.fields.dimensions_scope.status, 'unknown');
  assertEquals(data.extraction_evidence!.fields.conditionnement.status, 'unknown');
  assertEquals(data.source_email_ids, [source.id]);
});
Deno.test('learning: exact source proof keeps explicit values without treating them as approval', async () => {
  const f = fixture();
  const proposal = { ...extraction, data: { poids: '104 kg', description: 'General cargo' }, evidence: {
    poids: { status: 'explicit', source_email_id: source.id, source_excerpt: '104 kg' },
    description: { status: 'explicit', source_email_id: source.id, source_excerpt: 'General cargo' },
  }};
  await storeExtractedKnowledge({ extractions: [proposal] }, 'synthetic-thread', [source.id], f.client, [source]);
  assertEquals(f.inserted[0].data!.extraction_evidence!.fields.poids.status, 'explicit');
  assertEquals(f.inserted[0].data!.extraction_evidence!.fields.description.source_excerpt, 'General cargo');
  assertEquals(f.inserted[0].data!.extraction_evidence!.fields.weight_scope.status, 'unknown');
  assertEquals(f.inserted[0].is_validated, false);
});
for (const [name, value, proof, body] of [
  ['invented source', '104 kg', { status: 'explicit', source_email_id: 'other-email', source_excerpt: '104 kg' }, source.body_text],
  ['invented excerpt', 'cartons', { status: 'explicit', source_email_id: source.id, source_excerpt: 'cartons' }, source.body_text],
  ['changed value', '208 kg', { status: 'explicit', source_email_id: source.id, source_excerpt: '104 kg' }, source.body_text],
  ['numeric substring', 104, { status: 'explicit', source_email_id: source.id, source_excerpt: '1040 kg' }, '1040 kg'],
  ['missing evidence', '104 kg', {}, source.body_text],
  ['null value', null, { status: 'explicit', source_email_id: source.id, source_excerpt: '104 kg' }, source.body_text],
] as const) Deno.test(`learning: ${name} cannot become documentary proof`, async () => {
  const f = fixture();
  await storeExtractedKnowledge({ extractions: [{ ...extraction, data: { poids: value }, evidence: { poids: proof } }] },
    'synthetic-thread', [source.id], f.client, [{ ...source, body_text: body }]);
  assertEquals(f.inserted[0].data!.extraction_evidence!.fields.poids.status, 'unknown');
  assertEquals(f.inserted[0].is_validated, false);
});
Deno.test('learning: model inference stays inferred, even when the value also occurs literally', async () => {
  const f = fixture();
  await storeExtractedKnowledge({ extractions: [{ ...extraction, data: { poids: '104 kg' }, evidence: {
    poids: { status: 'inferred', source_email_id: source.id, source_excerpt: '104 kg' },
  } }] }, 'synthetic-thread', [source.id], f.client, [source]);
  assertEquals(f.inserted[0].data!.extraction_evidence!.fields.poids.status, 'inferred');
});
Deno.test('learning: pending update preserves prior attribution and guards approval/confidence', async () => {
  const f = fixture({ id: 'pending', confidence: 0.5, is_validated: false, source_id: 'old-email',
    data: { source_thread_id: 'old-thread', source_email_ids: ['old-email'], poids: '80 kg' } });
  await storeExtractedKnowledge({ extractions: [extraction] }, 'synthetic-thread', [source.id], f.client, [source]);
  assertEquals(f.updates.length, 1);
  assertEquals(f.row?.is_validated, false);
  assertEquals(f.row?.source_id, source.id);
  assertEquals(f.row?.data!.source_email_ids, [source.id]);
  assertEquals(f.row?.data!.source_thread_id, 'synthetic-thread');
  assertEquals(f.row?.data!.prior_source_history, [{ source_id: 'old-email', source_thread_id: 'old-thread', source_email_ids: ['old-email'] }]);
});
Deno.test('learning: tariff and template observations cannot enter validated reference consumers', async () => {
  for (const category of ['tarif', 'template']) {
    const f = fixture();
    await storeExtractedKnowledge({ extractions: [{ ...extraction, category, confidence: 1, data: { montant: 500 } }] },
      'synthetic-thread', [source.id], f.client, [source]);
    assertEquals(f.inserted[0].is_validated, false);
  }
});
Deno.test('learning: incomplete lookup never falls through to a duplicate insert', async () => {
  const f = fixture(null, false, true);
  await storeExtractedKnowledge({ extractions: [extraction] }, 'synthetic-thread', [source.id], f.client, [source]);
  assertEquals(f.inserted.length, 0);
});
for (const confidence of [NaN, Infinity, -1, 1.1, undefined]) Deno.test(`learning: invalid confidence ${String(confidence)} is not stored`, async () => {
  const f = fixture();
  await storeExtractedKnowledge({ extractions: [{ ...extraction, confidence }] }, 'synthetic-thread', [source.id], f.client, [source]);
  assertEquals(f.inserted.length, 0);
});

Deno.test('learning: model cannot forge reserved source history or approval evidence', async () => {
  const f = fixture();
  await storeExtractedKnowledge({ extractions: [{ ...extraction, data: { poids: '104 kg',
    source_thread_id: 'forged-thread', source_email_ids: ['forged-email'], prior_source_history: [{ source_id: 'forged' }],
    extraction_evidence: { approval: 'approved' },
  } }] }, 'synthetic-thread', [source.id], f.client, [source]);
  const data = f.inserted[0].data!;
  assertEquals(data.prior_source_history, undefined);
  assertEquals(data.source_email_ids, [source.id]);
  assertEquals(data.source_thread_id, 'synthetic-thread');
  assertEquals(data.extraction_evidence!.approval, 'not_reviewed');
});
Deno.test('learning: documentary proof accepts Unicode/whitespace without making a business decision', async () => {
  const f = fixture();
  await storeExtractedKnowledge({ extractions: [{ ...extraction, data: { description: 'Café spécial' }, evidence: {
    description: { status: 'explicit', source_email_id: source.id, source_excerpt: 'Café spécial' },
  } }] }, 'synthetic-thread', [source.id], f.client, [{ ...source, body_text: 'Marchandise: Cafe\u0301\n  spécial.' }]);
  assertEquals(f.inserted[0].data!.extraction_evidence!.fields.description.status, 'explicit');
  assertEquals(f.inserted[0].data!.extraction_evidence!.fields.description.verification, 'literal_match_only');
  assertEquals(f.inserted[0].is_validated, false);
});

for (const body of ['104.5 kg', '104,5 kg', '-104 kg', '1,104 kg', '1 104 kg']) {
  for (const value of [104, '104', '104 kg']) Deno.test(`learning: ${JSON.stringify(value)} cannot certify part of ${body}`, async () => {
    const f = fixture();
    await storeExtractedKnowledge({ extractions: [{ ...extraction, data: { poids: value }, evidence: {
      poids: { status: 'explicit', source_email_id: source.id, source_excerpt: body.includes('104 kg') ? '104 kg' : body },
    } }] }, 'synthetic-thread', [source.id], f.client, [{ ...source, body_text: body }]);
    assertEquals(f.inserted[0].data!.extraction_evidence!.fields.poids.status, 'unknown');
  });
}
