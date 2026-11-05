import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { prepareCommercialQuote, reviseCommercialPreparation, type CommercialAction } from './commercial-preparation.ts';
import { composeCommercialSnapshot } from './commercial-snapshot.ts';

const source = { meta: {}, totals: { currency: 'XOF', subtotal_before_sodatra_vat: 1000, honoraires_ht: 1000, honoraires_tva: 180 },
  raw_lines: [{ label: 'Agence synthétique', amount: 1000, bloc: 'honoraires', currency: 'XOF' }] };
const initial = () => prepareCommercialQuote('case-synthetic', 'version-synthetic', source);
const review = { schema_version: 1, source_reference: 'Fournisseur synthétique, référence test', scope: 'Lot fictif A, prestation distincte', applicable: true, not_already_included: true };
const added = (extra = {}): CommercialAction => ({ type: 'add', line_id: 'operator:synthetic', label: 'Prestation synthétique complémentaire', kind: 'additional', amount: 200,
  basis: 'taxes_included', reason: 'Décision synthétique avec source et périmètre', ...extra } as CommercialAction);
const context = { expected_revision: 0, operation_id: 'synthetic-op', actor_id: 'synthetic-actor', occurred_at: '2026-11-05T16:00:00Z' };

Deno.test('commercial additions: complete internal attestation retained; no source modification or client disclosure', () => {
  const original = initial(), before = JSON.stringify(original);
  const action = added({ addition_review: review });
  const revised = reviseCommercialPreparation(original, action, context);
  assertEquals((revised.lines[1] as unknown as Record<string, unknown>).addition_review, review);
  assertEquals(revised.events[0].action, action);
  const snapshot = composeCommercialSnapshot(revised, 'revision-synthetic');
  assertEquals(snapshot.totals.total_payable, 1380);
  assert(!JSON.stringify(snapshot).includes(review.source_reference));
  assert(!JSON.stringify(snapshot).includes(review.scope));
  assertEquals(JSON.stringify(original), before);
  assertEquals(original.source_snapshot, source);
});

for (const [label, patch] of Object.entries({ version: { schema_version: 2 }, missingSource: { source_reference: '' }, invalidSource: { source_reference: 123 },
  longSource: { source_reference: 'a'.repeat(501) }, missingScope: { scope: '' }, longScope: { scope: 'a'.repeat(501) },
  applicability: { applicable: false }, uncheckedOverlap: { not_already_included: false }, forgedAmount: { amount: 999 } })) {
  Deno.test(`commercial additions: supplied incomplete or forged review rejected (${label}) before revision`, () => {
    const original = initial(), before = JSON.stringify(original);
    assertThrows(() => reviseCommercialPreparation(original, added({ addition_review: { ...review, ...patch } }), context));
    assertEquals(JSON.stringify(original), before);
  });
}

Deno.test('commercial additions: legacy actions unchanged; reviewed metadata changes no amounts/VAT; zero and null distinct', () => {
  for (const value of [null, 0, 200]) {
    for (const basis of ['taxes_included', 'before_sodatra_vat'] as const) {
      const legacy = reviseCommercialPreparation(initial(), added({ amount: value, basis }), context);
      const reviewed = reviseCommercialPreparation(initial(), added({ amount: value, basis, addition_review: review }), context);
      assertEquals(reviewed.lines.map(l => ({ amount: l.client_amount_xof, status: l.status })), legacy.lines.map(l => ({ amount: l.client_amount_xof, status: l.status })));
      assertEquals(composeCommercialSnapshot(reviewed, 'revision'), composeCommercialSnapshot(legacy, 'revision'));
    }
  }
});

Deno.test('commercial additions: idempotence includes attestation; edit/remove/restore preserve audit without repricing source', () => {
  const action = added({ addition_review: review });
  const revised = reviseCommercialPreparation(initial(), action, context);
  assertEquals(reviseCommercialPreparation(revised, action, context), revised);
  assertThrows(() => reviseCommercialPreparation(revised, added({ addition_review: { ...review, scope: 'Autre périmètre synthétique' } }), context));
  let next = revised;
  for (const type of ['remove', 'restore'] as const) next = reviseCommercialPreparation(next, { type, line_id: 'operator:synthetic', reason: 'Décision synthétique réversible' },
    { ...context, expected_revision: next.revision, operation_id: `synthetic-${type}` });
  assertEquals((next.lines[1] as unknown as Record<string, unknown>).addition_review, review);
  assertEquals(next.source_snapshot, source);
});

Deno.test('commercial additions: scenario snapshots remain refused by commercial composition', () => {
  const prepared = initial(); prepared.source_snapshot.meta = { scenario_id: 'scenario-synthetic' };
  assertThrows(() => composeCommercialSnapshot(prepared, 'revision-synthetic'), Error, 'Version canonique mono-lot requise');
});
