// TomTom Maps Geocoding v2 / Routing v1. Proposal only, never road-load approval.
export type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const coordinate = (v: unknown, bound: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= bound;
export interface Origin { lat: number; lon: number; source: string; verified_on: string }
// User-approved conventional port reference, NOT a surveyed truck gate.
// verified_on records the source consultation, not a field verification.
export const DEFAULT_PORT_ORIGIN: Readonly<Origin> = Object.freeze({
  lat: 14.687222, lon: -17.426944,
  source: 'Repère portuaire approximatif DPWSN ; GeoPostcodes https://www.geopostcodes.com/container-terminals-code-list/ ; ni sortie vérifiée ni zéro officiel',
  verified_on: '2026-09-16',
});
export function readOrigin(raw: string | undefined): Origin | null {
  if (raw === undefined) return { ...DEFAULT_PORT_ORIGIN };
  try {
    const o = obj(JSON.parse(raw ?? 'null'));
    // This is a geographic sanity check, NOT proof of the gate location.
    if (!coordinate(o.lat, 90) || !coordinate(o.lon, 180) || o.lat < 14.6 || o.lat > 14.9 || o.lon < -17.6 || o.lon > -17.3 ||
      !text(o.source, 250) || !text(o.verified_on) || !/^\d{4}-\d{2}-\d{2}$/.test(o.verified_on) ||
      !Number.isFinite(Date.parse(o.verified_on)) || new Date(o.verified_on).toISOString().slice(0, 10) !== o.verified_on || Date.parse(o.verified_on) > Date.now()) return null;
    return o as unknown as Origin;
  } catch { return null; }
}
export interface Candidate { id: string; label: string; lat: number; lon: number; precise: boolean }
export async function proposeDistance(destination: string, selected: string | undefined, origin: Origin, key: string,
  fetcher: typeof fetch = fetch) {
  if (!text(destination) || /[\r\n@]/.test(destination)) throw new Error('Destination invalide : indiquer uniquement le lieu de livraison.');
  async function get(path: string, params: Record<string, string>) {
    const url = new URL(`https://api.tomtom.com/${path}`);
    Object.entries({ ...params, key }).forEach(([k, v]) => url.searchParams.set(k, v));
    try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!res.ok) throw new Error('upstream');
      return obj(await res.json());
    } catch { throw new Error('Service cartographique indisponible. La saisie manuelle reste possible.'); }
  }
  const geo = await get(`search/2/geocode/${encodeURIComponent(destination.trim())}.json`, { countrySet: 'SN', limit: '5', language: 'fr-FR' });
  const raw = Array.isArray(geo.results) ? geo.results : [];
  const candidates: Candidate[] = raw.flatMap(v => {
    const r = obj(v), a = obj(r.address), p = obj(r.position);
    if (a.countryCode !== 'SN' || !text(r.id) || !text(a.freeformAddress) || !coordinate(p.lat, 90) || !coordinate(p.lon, 180)) return [];
    return [{ id: r.id, label: a.freeformAddress, lat: p.lat, lon: p.lon,
      precise: r.type === 'Point Address' && obj(r.matchConfidence).score === 1 }];
  });
  // Bind the choice to the label AND coordinates, not TomTom's non-stable result ID.
  for (const c of candidates) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([c.id, c.label, c.lat, c.lon, c.precise])));
    c.id = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  // A chosen fingerprint is resolved again; arbitrary caller coordinates are never accepted.
  const target = selected ? candidates.find(c => c.id === selected) : candidates.length === 1 && candidates[0].precise ? candidates[0] : undefined;
  if (!target) return { status: 'choose_destination' as const, destination, candidates,
    message: selected ? 'Résultat modifié : choisissez à nouveau la destination.' : 'Confirmez le lieu proposé ; une ville seule ne précise pas le site de livraison.' };
  const route = await get(`routing/1/calculateRoute/${origin.lat},${origin.lon}:${target.lat},${target.lon}/json`,
    { travelMode: 'truck', routeType: 'fastest', traffic: 'false', avoid: 'ferries', sectionType: 'country', maxAlternatives: '0' });
  const first = obj(Array.isArray(route.routes) ? route.routes[0] : null);
  const meters = obj(first.summary).lengthInMeters;
  const countries = (Array.isArray(first.sections) ? first.sections : []).map(obj).filter(s => s.sectionType === 'COUNTRY');
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0 || meters > 2000000 ||
    !countries.length || countries.some(s => s.countryCode !== 'SEN')) throw new Error('Itinéraire Sénégal non vérifiable ou transfrontalier : distance manuelle à justifier.');
  const date = new Date().toISOString().slice(0, 10);
  return { status: 'proposed' as const, destination, distance_km: Math.ceil(meters / 100) / 10, verified_on: date,
    distance_source: `TomTom Maps Routing v1, ${date} ; départ port de Dakar (${origin.lat},${origin.lon}), référence départ : ${origin.source} (${origin.verified_on}) → ${target.label} (${target.lat},${target.lon}) ; truck/fastest, sans trafic ni ferry ; ${target.precise ? 'adresse précise' : 'point approximatif confirmé par opérateur'} ; admissibilité véhicule non vérifiée.`,
    message: 'Distance indicative uniquement : gabarit, charge et autorisations de circulation non validés.' };
}
