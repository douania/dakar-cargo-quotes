import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE', '1');
const { parseContainersFromText, extractFactsBasic } = await import('../build-case-puzzle/index.ts');

const basic = (body_text: string) => extractFactsBasic([{ id: 'mail', from_address: 'sender@fixture.invalid', subject: 'Service request', body_text }], [])
  .find(f => f.key === 'cargo.containers')?.value ?? [];
const requested = [{ type: '40HC', quantity: 2 }];
const noisy = 'Please quote 2 x 40HC.\nPhone: +99 (0) 1111 420555.\nMobile: +99 (0) 1111 420555.\nCompany reference: 4012345. Date: 2026-04-09.';

Deno.test('container evidence: signature numbers do not add equipment to an explicit request', () => {
  assertEquals(parseContainersFromText(noisy), requested);
  assertEquals(basic(noisy), requested);
});
for (const text of [
  'Phone: +99 (0) 1111 420555',
  'Phone: +44 20 12345678',
  'Invoice 2026/0401; company 4012345; reference A2040B',
  'Date: 2026-04-09; year 2020',
  'Declared amount: 420000 XOF',
  'Dimensions: 40 x 20 x 45 cm',
]) Deno.test('container evidence: unrelated numeric text stays unknown: ' + text, () => {
  assertEquals(parseContainersFromText(text), []);
  assertEquals(basic(text), []);
});
Deno.test('container evidence: explicit legacy quantities and equipment remain recognized', () => {
  for (const [text, expected] of [
    ['2x40HC', requested],
    ["3 x 20'", [{ type: '20GP', quantity: 3 }]],
    ['2 40HC', requested],
    ['15 x 40 flat rack', [{ type: '40FR', quantity: 15 }]],
    ['1x40 reefer', [{ type: '40RF', quantity: 1 }]],
    ['2 PCS 45HQ', [{ type: '45HQ', quantity: 2 }]],
    ['1x20 + 1x40', [{ type: '20GP', quantity: 1 }, { type: '40GP', quantity: 1 }]],
    ['39 20HQ', [{ type: '20HQ', quantity: 39 }]],
    ['2 40FT', requested.map(c => ({ ...c, type: '40GP' }))],
    ['2 * 40GP', requested.map(c => ({ ...c, type: '40GP' }))],
    ["Container 40'", [{ type: '40GP', quantity: 1 }]],
    ['Container 20FT', [{ type: '20GP', quantity: 1 }]],
    ['Equipment 40 OPEN TOP', [{ type: '40OT', quantity: 1 }]],
  ] as const) assertEquals(parseContainersFromText(text), expected, text);
  assertEquals(basic('2x40HC and 3x20GP'), [{ quantity: 2, type: '40HC' }, { quantity: 3, type: '20GP' }]);
  assertEquals(basic('1x20 + 1x40'), [{ quantity: 1, type: '20GP' }, { quantity: 1, type: '40GP' }]);
  for (const text of ['2 40FT', '2 40 FT', '2x40FT', '2 40 feet', '2 40 foot']) {
    assertEquals(parseContainersFromText(text), [{ quantity: 2, type: '40GP' }], text);
    assertEquals(basic(text), [{ quantity: 2, type: '40GP' }], text);
  }
  assertEquals(parseContainersFromText('2x40HC and 3x40HC'), [{ quantity: 5, type: '40HC' }]);
  assertEquals(basic('2x40HC and 3x40HC'), [{ quantity: 2, type: '40HC' }, { quantity: 3, type: '40HC' }]);
});
Deno.test('container evidence: bare standalone container size retains its existing typed-field meaning', () => {
  for (const size of ['20', '40', '45']) assertEquals(parseContainersFromText(size), [{ type: size + 'GP', quantity: 1 }]);
});
Deno.test('container evidence: explicit HQ declarations remain separate and are never truncated to GP', () => {
  const text='39 x 20HQ SOC; 13 x 20HQ SOC; 3 x 40HQ COC';
  assertEquals(basic(text), [{quantity:39,type:'20HQ'},{quantity:13,type:'20HQ'},{quantity:3,type:'40HQ'}]);
  assertEquals(parseContainersFromText('3x40HQsuffix'), []);
  assertEquals(basic('3x40HQsuffix'), []);
});
