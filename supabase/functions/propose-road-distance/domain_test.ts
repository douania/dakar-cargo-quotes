import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { proposeDistance, readOrigin, DEFAULT_PORT_ORIGIN, type Origin } from './domain.ts';
// Synthetic coordinates, never deployment configuration or proof of the DPW gate.
const origin: Origin = { lat: 14.7, lon: -17.4, source: 'fixture only', verified_on: '2026-01-01' };
const candidate = (type = 'Point Address', score = 1) => ({ id: 'test', type, matchConfidence: { score },
  address: { countryCode: 'SN', freeformAddress: 'Destination test' }, position: { lat: 15, lon: -16 } });
const geo = (results = [candidate()]) => ({ results });
const route = (meters: unknown = 300123, country = 'SEN') => ({ routes: [{ summary: { lengthInMeters: meters }, sections: [{ sectionType: 'COUNTRY', countryCode: country }] }] });
function mock(replies: unknown[]) {
  const urls: URL[] = [];
  const fetcher = (async (url: URL | RequestInfo) => { urls.push(new URL(String(url))); return Response.json(replies.shift()); }) as typeof fetch;
  return { fetcher, urls };
}
Deno.test('origin: approved approximate default; invalid explicit configuration never silently replaced', () => {
  assertEquals(readOrigin(undefined), DEFAULT_PORT_ORIGIN);
  assertEquals(DEFAULT_PORT_ORIGIN.source.includes('approximatif'), true);
  for (const raw of ['', '{}', 'bad', JSON.stringify({ ...origin, lat: 0 }), JSON.stringify({ ...origin, verified_on: '2999-01-01' }), JSON.stringify({ ...origin, source: '' })]) assertEquals(readOrigin(raw), null);
  assertEquals(readOrigin(JSON.stringify(origin)), origin);
});
Deno.test('default reference is sent to routing and preserved as approximate provenance', async () => {
  const m = mock([geo(), route()]);
  const result = await proposeDistance('Test', undefined, readOrigin(undefined)!, 'key', m.fetcher);
  assertEquals(m.urls[1].pathname.includes('14.687222,-17.426944:'), true);
  if (result.status !== 'proposed') throw new Error('expected proposal');
  assertEquals(result.distance_source.includes('Repère portuaire approximatif'), true);
  assertEquals(result.distance_source.includes('sortie DP World Dakar'), false);
});
Deno.test('precise unique perfect match proposes km/source/date, never exposes key', async () => {
  const m = mock([geo(), route()]); const result = await proposeDistance('Test', undefined, origin, 'secret-fixture', m.fetcher);
  assertEquals(result.status, 'proposed');
  if (result.status !== 'proposed') throw new Error('expected proposal');
  assertEquals(result.distance_km, 300.2); assertEquals(result.distance_source.includes('fixture only'), true);
  assertEquals(JSON.stringify(result).includes('secret-fixture'), false);
  assertEquals(m.urls[0].searchParams.get('countrySet'), 'SN');
  assertEquals(m.urls[1].searchParams.get('travelMode'), 'truck');
  assertEquals(m.urls[1].searchParams.get('avoid'), 'ferries');
});
for (const results of [[candidate('Geography')], [candidate('Street')], [candidate('Point Address', .9)], [candidate(), { ...candidate(), id: 'other' }], []]) {
  Deno.test(`ambiguity needs choice, no routing: ${JSON.stringify(results.map(r => [r.type, r.matchConfidence.score]))}`, async () => {
    const m = mock([geo(results)]); const result = await proposeDistance('Test', undefined, origin, 'key', m.fetcher);
    assertEquals(result.status, 'choose_destination'); assertEquals(m.urls.length, 1);
  });
}
Deno.test('explicit approximate choice and stale ID handling', async () => {
  const initial = await proposeDistance('Test', undefined, origin, 'key', mock([geo([candidate('Geography')])]).fetcher);
  if (initial.status !== 'choose_destination') throw new Error('expected choice');
  const m = mock([geo([candidate('Geography')]), route()]);
  const result = await proposeDistance('Test', initial.candidates[0].id, origin, 'key', m.fetcher);
  assertEquals(result.status, 'proposed');
  if (result.status === 'proposed') assertEquals(result.distance_source.includes('approximatif confirmé'), true);
  const stale = mock([geo()]); assertEquals((await proposeDistance('Test', 'stale', origin, 'key', stale.fetcher)).status, 'choose_destination');
  assertEquals(stale.urls.length, 1);
  const moved = mock([geo([{ ...candidate('Geography'), position: { lat: 16, lon: -16 } }])]);
  assertEquals((await proposeDistance('Test', initial.candidates[0].id, origin, 'key', moved.fetcher)).status, 'choose_destination');
  assertEquals(moved.urls.length, 1);
});
for (const invalidRoute of [route(0), route(null), route(-1), route(3000000), route(10000, 'GMB'), { routes: [] }, { routes: [{ summary: { lengthInMeters: 100 } }] }]) {
  Deno.test(`invalid/unverified route rejected ${JSON.stringify(invalidRoute)}`, async () => {
    await assertRejects(() => proposeDistance('Test', undefined, origin, 'key', mock([geo(), invalidRoute]).fetcher), Error, 'non vérifiable');
  });
}
Deno.test('provider error never exposes URL/key; invalid query never makes network request', async () => {
  await assertRejects(() => proposeDistance('Test', undefined, origin, 'secret-fixture', (() => { throw new Error('URL?key=secret-fixture'); }) as typeof fetch), Error, 'Service cartographique indisponible');
  for (const q of ['', 'mail@test.com', 'a\nb', 'a'.repeat(201)]) await assertRejects(() => proposeDistance(q, undefined, origin, 'key', (() => { throw new Error('network forbidden'); }) as typeof fetch), Error, 'Destination invalide');
});
