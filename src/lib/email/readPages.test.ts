import { describe, expect, it } from 'vitest';
import { literalEmailSearch, readAllPages, readPage } from './readPages';
import { allVisibleSelected, selectVisible } from './adminListReads';

describe('lectures paginées complètes ou erreur visible', () => {
  it('continues with actual row count when the server cap is smaller than the requested page', async () => {
    const data = Array.from({ length: 1001 }, (_, id) => ({ id })), offsets: number[] = [];
    const rows = await readAllPages(async offset => { offsets.push(offset); return { data: data.slice(offset, offset + 200), count: data.length, error: null }; });
    expect(rows).toEqual(data); expect(offsets).toEqual([0, 200, 400, 600, 800, 1000]);
  });
  it('does not convert missing totals, premature empty pages or denied reads into success', async () => {
    for (const response of [{ data: [], count: null, error: null }, { data: [], count: 1, error: null }, { data: [], count: 0, error: new Error('refused') }]) {
      await expect(readPage(Promise.resolve(response), 0)).rejects.toBeTruthy();
    }
    expect(await readPage(Promise.resolve({ data: [], count: 0, error: null }), 0)).toEqual({ rows: [], total: 0, nextOffset: null });
  });
  it('keeps comma/quote/regex/LIKE special characters inside a literal search value', () => {
    const query = 'ref),is_quotation_request.eq.false,(subject.eq."x" 50%_ * [a] \\';
    const expression = literalEmailSearch(['subject', 'from_address'], query);
    const prefix = 'subject.imatch.';
    const quoted = expression.slice(prefix.length, expression.indexOf(',from_address.imatch.'));
    const pattern = JSON.parse(quoted);
    expect(new RegExp(pattern, 'i').test(query)).toBe(true);
    expect(new RegExp(pattern, 'i').test('other unrelated message')).toBe(false);
    expect(expression).toBe(`subject.imatch.${quoted},from_address.imatch.${quoted}`);
  });
});

describe('sélection limitée aux IDs visibles', () => {
  it('does not confuse equal cardinalities with identical selected emails', () => {
    const selected = new Set(['old-a', 'old-b']);
    expect(allVisibleSelected(selected, ['new-a', 'new-b'])).toBe(false);
    expect([...selectVisible(selected, ['new-a', 'new-b'])]).toEqual(['new-a', 'new-b']);
    expect([...selectVisible(new Set(['new-a', 'new-b']), ['new-a', 'new-b'])]).toEqual([]);
    expect(allVisibleSelected(new Set(), [])).toBe(false);
  });
});
