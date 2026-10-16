/** AIR_HANDLING supplier evidence. No tax, volumetric rounding or selling policy is inferred. */
export type AirRates = { collection_per_kg: number; security_per_kg: number; documents: number; warehouse_passage: number; it: number };
export type AirProfile = { id: string; revision: number; supplier: string; airport: string; direction: string; cargo_class: string;
  effective_from: string; effective_to: string | null; rates: AirRates; source_reference: string; evidence: unknown };
export type AirSelection = { id: string; profile_id: string | null; context_hash: string; source_reference: string; warehouse_bracket_confirmed: boolean };
export type AirFact = { fact_key: string; value_number?: number | null; value_json?: unknown; source_type?: string | null; is_validated?: boolean };
export type AirState = { selection: AirSelection | null; profile: AirProfile | null; context_hash: string; request_type: string; lot_count: number; facts: AirFact[] };
export type AirComponent = { code: string; label: string; quantity: number | null; unit_rate: number | null; supplier_ht_xof: number | null; reason: string | null };
export type AirResolution = { schema_version: 1; selection_id: string; context_hash: string; profile: AirProfile | null;
  components: AirComponent[]; supplier_known_ht_xof: number | null; supplier_complete_ht_xof: number | null;
  supplier_tax_xof: null; supplier_ttc_xof: null; selling_amount_xof: null; reserves: string[]; explanation: string };
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const labels: Record<string, string> = { collection_per_kg: 'Collecte', security_per_kg: 'Sécurité', documents: 'Remise documentaire', warehouse_passage: 'Passage magasin', it: 'Informatique' };
const unresolved = ['Magasinage : franchise, durée et base à confirmer', 'TVA fournisseur : assiette et arrondi à confirmer',
  'ANACIM : assiette et application à confirmer', 'Timbre : règlement et assiette à confirmer', 'Vente SODATRA et traitement comptable à confirmer'];

export function validAirRates(value: unknown): value is AirRates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>, keys = Object.keys(labels);
  return Object.keys(r).length === keys.length && keys.every(k => typeof r[k] === 'number' && Number.isFinite(r[k]) && Number(r[k]) >= 0 && Number(r[k]) < 1e9);
}

/** The explicit LTA/operator taxable fact is used as-is; gross is never substituted. */
export function resolveAirHandling(state: AirState, date: string): AirResolution | null {
  const s = state.selection;
  if (!s?.profile_id) return null; // No opt-in: existing unrelated pricing paths are unchanged.
  const p = state.profile;
  let refusal: string | null = null;
  if (!p || p.id !== s.profile_id || p.supplier !== '2AS' || p.airport !== 'DSS' || p.direction !== 'IMPORT' || p.cargo_class !== 'GENERAL_CARGO' || !validAirRates(p.rates)) refusal = 'Profil fournisseur invalide';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < p.effective_from || (p.effective_to !== null && date > p.effective_to)) refusal = 'Profil hors période de validité';
  else if (!/^AIR_IMPORT(?:_|$)/.test(state.request_type) || state.lot_count >= 2) refusal = 'Profil réservé à un dossier import aérien mono-lot';
  else if (s.context_hash !== state.context_hash) refusal = 'Données modifiées depuis la sélection : reconfirmation nécessaire';
  const weights = state.facts.filter(f => f.fact_key === 'cargo.chargeable_weight_kg');
  const f = weights.length === 1 ? weights[0] : null;
  const explicit = f?.is_validated === true || ['operator', 'operator_correction', 'manual_input', 'lta'].includes(f?.source_type ?? '');
  const kg = f && explicit && positive(f.value_number) ? f.value_number : null;
  // Only the unambiguous low-weight branch is enabled. Higher brackets are evidence, not active formulas.
  const weightReason = kg === null ? 'Poids taxable LTA validé requis' : kg >= 1000 ? 'Tranches à partir de 1 tonne à confirmer' : null;
  const components: AirComponent[] = Object.keys(labels).map(code => {
    const weighted = code === 'collection_per_kg' || code === 'security_per_kg';
    const reason = refusal ?? (weighted ? weightReason : code === 'warehouse_passage' && kg !== null && kg >= 1000 ? 'Poids incompatible avec le passage magasin moins de 1 tonne' : code === 'warehouse_passage' && !s.warehouse_bracket_confirmed
      ? 'Éligibilité passage magasin moins de 1 tonne à attester séparément' : null);
    const rate = p && validAirRates(p.rates) ? p.rates[code as keyof AirRates] : null;
    const quantity = weighted ? kg : 1;
    return { code, label: labels[code], quantity, unit_rate: rate,
      supplier_ht_xof: !reason && rate !== null && quantity !== null ? rate * quantity : null, reason };
  });
  const known = components.filter(c => c.supplier_ht_xof !== null);
  const knownHt = known.length ? known.reduce((sum, c) => sum + c.supplier_ht_xof!, 0) : null;
  const reserves = [...new Set([...components.flatMap(c => c.reason ? [c.reason] : []), ...unresolved])];
  const detail = components.map(c => `${c.label} : ${c.supplier_ht_xof === null ? 'à confirmer' : `${c.supplier_ht_xof} XOF HT fournisseur`}`).join(' ; ');
  return { schema_version: 1, selection_id: s.id, context_hash: state.context_hash, profile: p,
    components, supplier_known_ht_xof: knownHt, supplier_complete_ht_xof: known.length === components.length ? knownHt : null,
    supplier_tax_xof: null, supplier_ttc_xof: null, selling_amount_xof: null, reserves,
    explanation: `${detail}. Coût achat distinct de la vente ; taxes, magasinage et vente à confirmer, exclus du total payable.` };
}

export function airHandlingSource(resolution: AirResolution) {
  return { type: 'TO_CONFIRM', reference: `air_handling_profiles/${resolution.profile?.id ?? 'missing'}`, confidence: 0,
    firm_eligible: false, air_handling: resolution };
}
