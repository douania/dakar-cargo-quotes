import { describe, it, expect } from 'vitest';
import { mergeDeclaredIntakeWeight } from './intakeTextWeight';
import { buildIntakeFactBatch } from './intakeFactBatch';
import { parseTextOverrides } from './intakeTextOverrides';

describe('text intake declared total weight', () => {
  it.each([
    ['5 000 kg au total.', 5000],
    ['Poids brut total : 5\u00a0000 kg.', 5000],
    ['Poids total : 5\u202f000 kg.', 5000],
    ['Poids total : 5 tonnes.', 5000],
    ['Total gross weight: 5.25 t.', 5250],
    ['Poids total : 5,25 tonnes.', 5250],
    ['Poids total : 1250.50 kg.', 1250.5],
    ['Poids total : 5000 kg. Total weight: 5 t.', 5000],
  ])('keeps the explicit unit and value in %s', (text, kg) => {
    const result = mergeDeclaredIntakeWeight(text, { weight_kg: 9000, cargo_description: 'synthetic' });
    expect(result.ambiguous).toBe(false);
    expect(result.analysis).toEqual({ weight_kg: kg, cargo_description: 'synthetic' });
  });
  it.each([
    'Poids total : 5000 kg. Poids total : 6 t.',
    'Poids total : 5.000 kg.',
    'Poids total : 5,000 kg.',
    'Poids total : 0 kg.',
    'Poids total : -5 tonnes.',
    'Poids total : 100000001 kg.',
    'Poids total : 5000 lb.',
    'Poids total : 5000 kg à confirmer.',
    'Poids total : 5 t, 6000 lb.',
    'Poids total : environ 5000 kg.',
    'Poids total : 5000 kg par conteneur.',
    'Poids total : 4 à 5 tonnes.',
    'Poids total : 4-5 tonnes.',
    'Poids total : 5000 kg ou 6 tonnes.',
    'Poids total : 5 t, 6 t.',
    'Poids total : 5 t / 6 t.',
    "Ce n'est pas 5000 kg au total.",
    'Not 5000 kg in total.',
    'Moins de 5000 kg au total.',
    'Poids total : 5000 kg. Poids total à confirmer.',
    'Poids total à confirmer. Colis de 200 kg.',
    'Poids net total : 5 t. Poids brut total : 4 t.',
  ])('does not choose a total or fall back to document weight in %s', text => {
    const original = { weight_kg: 9000, cargo_description: 'synthetic' };
    const result = mergeDeclaredIntakeWeight(text, original);
    expect(result.ambiguous).toBe(true);
    expect(result.analysis).toEqual({ cargo_description: 'synthetic' });
    expect(original.weight_kg).toBe(9000);
  });
  it.each([
    '1 pallet, 200 kgs / 80x60x75 cm.',
    '50 tonnes de sel en sacs de 25 kg.',
    'Tare : 2000 kg. Capacité : 30 t.',
    'Prix total : 5000 XOF ; colis 20 kg.',
  ])('does not invent a total from %s', text => {
    expect(mergeDeclaredIntakeWeight(text, null)).toEqual({ analysis: null, ambiguous: false });
  });
  it('publishes only the admitted weight fact with honest text provenance', () => {
    const text = '1 conteneur 20 pieds. Poids total : 5000 kg.';
    const result = mergeDeclaredIntakeWeight(text, null);
    const batch = buildIntakeFactBatch({ caseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text,
      analysis: result.analysis, textOverrides: parseTextOverrides(text), hasExtractedDocument: false });
    expect(batch.source_type).toBe('email_body');
    expect(batch.facts).toContainEqual({ fact_key: 'cargo.weight_kg', value_number: 5000 });
    expect(batch.source_excerpt).toBe(text);
    expect(JSON.stringify(batch)).not.toContain('confidence');
    expect(JSON.stringify(batch)).not.toContain('manual_input');
  });
});
