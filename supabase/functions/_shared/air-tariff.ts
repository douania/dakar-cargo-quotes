import { resolveAirHandling, type AirState, type AirResolution, type AirRates } from './air-handling.ts';
export const airUnits = ['XOF','XOF/kg','XOF/kg/jour','%','XOF/heure','XOF/heure commencée/agent','XOF/heure commencée','XOF/m²/mois','XOF/palette','XOF/jour','% achat facture','XOF/mètre','XOF/aller-retour','information'] as const;
export type AirTariffEntry = {
  key: string; section: string; label: string; code: string | null; value: number | null; unit: typeof airUnits[number];
  minimum: number | null; weight_from_kg: number | null; weight_to_kg: number | null; day_from: number | null; day_to: number | null;
  free_hours: number | null; threshold: number | null; condition: string; qualification: 'documented' | 'ambiguous' | 'missing';
  source: { sheet: string; parsed_row: number; raw_cells: string[]; calculation_condition: string };
};
export type AirCataloguePayload = { schema_version: 2; supplier: '2AS'; airport: 'DSS'; source_file: string; library_file_id: string; entries: AirTariffEntry[] };
export type AirCatalogue = { id: string; parent_id: string | null; revision: number; effective_from: string; effective_to: string | null; source_reference: string; payload: AirCataloguePayload };
export type AirStorageBasis = { enabled: boolean; tariff_key: string; weight_fact_id: string | null; billable_days: number | null; days_status: 'confirmed' | 'assumed' | 'unknown'; source_reference: string };
export type AirTariffBasis = { general_cargo_confirmed: boolean; warehouse_bracket_confirmed: boolean; ordinary_storage: AirStorageBasis };
export type AirTariffState = AirState & { catalogue?: AirCatalogue | null; basis?: AirTariffBasis | null };
const amountFields = ['value','minimum','weight_from_kg','weight_to_kg','day_from','day_to','free_hours','threshold'] as const;
export function validAirCatalogue(value: unknown): value is AirCataloguePayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as AirCataloguePayload;
  return p.schema_version === 2 && p.supplier === '2AS' && p.airport === 'DSS' && Array.isArray(p.entries) && p.entries.length > 0 && p.entries.length <= 500
    && new Set(p.entries.map(e => e.key)).size === p.entries.length && p.entries.every(e => e && typeof e.key === 'string' && typeof e.label === 'string'
      && typeof e.condition === 'string' && typeof e.section === 'string' && (e.code === null || typeof e.code === 'string') && !!e.source && typeof e.source === 'object'
      && ['documented','ambiguous','missing'].includes(e.qualification) && airUnits.includes(e.unit)
      && amountFields.every(k => e[k] === null || (typeof e[k] === 'number' && Number.isFinite(e[k]) && e[k]! >= 0 && e[k]! < 1e9)));
}
export function resolveAirTariff(state: AirTariffState, date: string): AirResolution | null {
  if (!state.catalogue) return resolveAirHandling(state, date);
  const c = state.catalogue, b = state.basis, s = state.selection;
  if (!s || !b) throw new Error('AIR_TARIFF_BASIS_MISSING');
  const entries = c.payload.entries;
  const rate = (key: string, unit: string) => {
    const e = entries.find(e => e.key === key);
    return e && e.unit === unit && e.qualification === 'documented' && e.value !== null
      && e.condition === e.source.calculation_condition
      && ['minimum','weight_from_kg','weight_to_kg','day_from','day_to','free_hours','threshold'].every(k => e[k as keyof typeof e] === null) ? e.value : NaN;
  };
  const rates: AirRates = { collection_per_kg: rate('collection_0','XOF/kg'), security_per_kg: rate('security_0','XOF/kg'),
    documents: rate('doc_DME_0','XOF'), warehouse_passage: rate('dms_0','XOF'), it: rate('it_0','XOF') };
  const profile = { id: c.id, revision: c.revision, supplier: c.payload.supplier, airport: c.payload.airport, direction: 'IMPORT', cargo_class: 'GENERAL_CARGO',
    effective_from: c.effective_from, effective_to: c.effective_to, rates, source_reference: c.source_reference, evidence: { catalogue_id: c.id } };
  const valid = validAirCatalogue(c.payload) && b.general_cargo_confirmed === true;
  const result = resolveAirHandling({ ...state, profile, selection: { ...s, profile_id: c.id, warehouse_bracket_confirmed: b.warehouse_bracket_confirmed },
    request_type: valid ? state.request_type : 'INVALID' }, date)!;
  result.components = result.components.map(e => e.code === 'warehouse_passage' ? { ...e, label: 'Taxe fixe magasin — DMS',
    reason: e.reason?.replace(/passage magasin/g,'taxe fixe magasin') ?? null } : e);
  const storage = b.ordinary_storage, tariff = entries.find(e => e.key === storage.tariff_key && /^storage_[0-3]$/.test(e.key));
  const f = state.facts.filter(f => f.id === storage.weight_fact_id);
  const weight = f.length === 1 && ['cargo.weight_kg','cargo.weight_net_kg','cargo.chargeable_weight_kg'].includes(f[0].fact_key)
    && (f[0].is_validated === true || ['operator','operator_correction','manual_input','lta'].includes(f[0].source_type ?? ''))
    && typeof f[0].value_number === 'number' && Number.isFinite(f[0].value_number) && f[0].value_number > 0 ? f[0].value_number : null;
  const days = storage.billable_days;
  let storageReason: string | null = null;
  if (!valid || s.context_hash !== state.context_hash || !/^AIR_IMPORT(?:_|$)/.test(state.request_type) || state.lot_count >= 2
    || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < c.effective_from || (c.effective_to !== null && date > c.effective_to)) storageReason = 'Catalogue ou sélection à reconfirmer';
  else if (!tariff || tariff.unit !== 'XOF/kg/jour' || tariff.value === null || tariff.qualification === 'missing') storageReason = 'Tarif de magasinage non renseigné en XOF/kg/jour';
  else if (tariff.condition !== tariff.source.calculation_condition) storageReason = 'Conditions de magasinage modifiées : application à valider';
  else if (['minimum','weight_from_kg','weight_to_kg','day_from','day_to','free_hours','threshold'].some(k => tariff[k as keyof typeof tariff] !== null)) storageReason = 'Conditions numériques particulières du magasinage à valider ; aucune application automatique';
  else if (weight === null) storageReason = 'Base de poids du magasinage à choisir parmi les faits justifiés du dossier';
  else if (typeof days !== 'number' || !Number.isFinite(days) || days < 0 || days >= 1e6 || storage.days_status === 'unknown' || storage.source_reference.trim().length < 10) storageReason = 'Jours facturables et justification à renseigner';
  const rawAmount = storageReason === null ? tariff!.value! * weight! * days! : null;
  if (rawAmount !== null && !Number.isFinite(rawAmount)) storageReason = 'Montant de magasinage hors capacité numérique : vérification requise';
  const calculated = storageReason === null ? rawAmount : null;
  const confirmed = storage.days_status === 'confirmed';
  if (storage.enabled) result.components.push({ code: 'ordinary_storage', label: 'Magasinage ordinaire — DSR', quantity: weight !== null && days !== null ? weight * days : null,
    unit_rate: tariff?.value ?? null, supplier_ht_xof: confirmed ? calculated : null, reason: storageReason ?? (!confirmed ? 'Durée hypothétique : estimation exclue du sous-total connu' : null),
    estimated_supplier_ht_xof: !confirmed ? calculated : null });
  const known = result.components.filter(e => e.supplier_ht_xof !== null);
  const total = known.length ? known.reduce((n,e) => n + e.supplier_ht_xof!,0) : null;
  result.schema_version = 2; result.catalogue = c; result.basis = b;
  result.supplier_known_ht_xof = total;
  result.supplier_complete_ht_xof = known.length === result.components.length ? total : null;
  result.supplier_estimated_ht_xof = storage.enabled && !confirmed ? calculated : null;
  result.reserves = [...new Set([...result.components.flatMap(e => e.reason ? [e.reason] : []),
    'Aucune franchise ordinaire, assiette fiscale ni règle d’arrondi présumée ; jours facturables fournis explicitement',
    ...(storage.enabled ? [] : ['Magasinage non renseigné : aucune absence de frais présumée']),
    'Autres natures, tranches et services du catalogue : application à confirmer',
    'TVA, ANACIM, timbre, TTC fournisseur et vente SODATRA : bases et politique à confirmer'])];
  result.explanation = result.components.map(e => `${e.label} : ${e.supplier_ht_xof === null ? 'à confirmer' : `${e.supplier_ht_xof} XOF HT fournisseur`}${e.estimated_supplier_ht_xof != null ? ` (hypothèse ${e.estimated_supplier_ht_xof} XOF HT fournisseur)` : ''}`).join(' ; ')
    + '. Achat fournisseur distinct de la vente ; taxes et vente à confirmer, exclus du total payable.';
  return result;
}
