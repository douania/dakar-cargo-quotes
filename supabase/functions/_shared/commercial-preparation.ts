/** Pure model shared by the server and editor; no source or tariff writes. */
import { isToConfirmLine } from './quotation-line-status.ts';
import { resolveAirTariff, type AirTariffState } from './air-tariff.ts';

type Row = Record<string, unknown>;
export type CommercialAmountBasis = 'before_sodatra_vat' | 'taxes_included' | 'unknown';
export type CommercialKind = 'source' | 'additional' | 'customs_estimate' | 'storage_estimate';
export interface CommercialLine {
  id: string;
  label: string;
  kind: CommercialKind;
  included: boolean;
  original: Row | null;
  supplier: { amount_ht_xof: number | null; status: 'known' | 'estimated' | 'unknown'; evidence: unknown } | null;
  client_amount_xof: number | null;
  amount_basis: CommercialAmountBasis;
  status: 'source' | 'estimated' | 'to_confirm';
  reason: string;
}
export type CommercialAction =
  | { type: 'edit'; line_id: string; amount: number | null; basis: CommercialAmountBasis; reason: string }
  | { type: 'add'; line_id: string; label: string; kind: Exclude<CommercialKind, 'source'>; amount: number | null; basis: CommercialAmountBasis; reason: string }
  | { type: 'remove' | 'restore'; line_id: string; reason: string }
  | { type: 'storage'; line_id: string; tariff_key: string; weight_fact_id: string; billable_days: number | null; reason: string };
export interface CommercialEvent {
  operation_id: string;
  revision: number;
  actor_id: string;
  occurred_at: string;
  action: CommercialAction;
  before: CommercialLine | null;
  after: CommercialLine;
}
export interface CommercialPreparation {
  case_id: string;
  source_version_id: string;
  source_snapshot: Row;
  revision: number;
  lines: CommercialLine[];
  events: CommercialEvent[];
}
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const validAmount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1e12;
const amount = (n: unknown): number | null => validAmount(n) ? n : null;
const bases: CommercialAmountBasis[] = ['before_sodatra_vat', 'taxes_included', 'unknown'];
const kinds: CommercialKind[] = ['source', 'additional', 'customs_estimate', 'storage_estimate'];
const copy = <T,>(v: T): T => structuredClone(v);

export function parseCommercialAmount(value: string): number | null {
  const compact = value.replace(/[\s\u00a0\u202f]/g, '');
  if (!compact) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(compact)) throw new Error('Montant numérique positif attendu');
  const parsed = Number(compact.replace(',', '.'));
  if (!validAmount(parsed)) throw new Error('Montant hors limites');
  return parsed;
}

/** The immutable source is copied; a known purchase never fills the client price. */
export function prepareCommercialQuote(caseId: string, versionId: string, snapshot: Row): CommercialPreparation {
  if (!caseId || !versionId || !Array.isArray(snapshot.raw_lines) || snapshot.is_multi_lot === true) throw new Error('Base mono-lot de version requise');
  const original = copy(snapshot);
  const lines = (original.raw_lines as unknown[]).map((value, index): CommercialLine => {
    const sourceLine = row(value), source = row(sourceLine.source), air = row(source.air_handling);
    const sourceCurrency = sourceLine.currency ?? row(original.totals).currency ?? original.currency;
    const currencyIsXof = typeof sourceCurrency === 'string' && ['XOF','FCFA','CFA'].includes(sourceCurrency.trim().toUpperCase());
    const airAmount = currencyIsXof ? amount(air.supplier_known_ht_xof) : null;
    const known = currencyIsXof && !isToConfirmLine(sourceLine) ? amount(sourceLine.amount) : null;
    return {
      id: `source:${index}`, label: String(sourceLine.label ?? sourceLine.description ?? sourceLine.category ?? `Prestation ${index + 1}`),
      kind: 'source', included: true, original: copy(sourceLine),
      supplier: Object.keys(air).length ? { amount_ht_xof: airAmount, status: airAmount === null ? 'unknown' : 'known', evidence: copy(air) } : null,
      client_amount_xof: known, amount_basis: 'unknown', status: known === null ? 'to_confirm' : 'source',
      reason: currencyIsXof ? '' : `Devise source ${typeof sourceCurrency === 'string' ? sourceCurrency : 'non attestée'} : montant XOF à renseigner explicitement, sans conversion automatique.`,
    };
  });
  const preparation = { case_id: caseId, source_version_id: versionId, source_snapshot: original, revision: 0, lines, events: [] };
  commercialPreparationSummary(preparation);
  return preparation;
}

/** Caller must later bind actor/context to server authorization; this helper grants no permission. */
export function reviseCommercialPreparation(
  draft: CommercialPreparation,
  action: CommercialAction,
  context: { expected_revision: number; operation_id: string; actor_id: string; occurred_at: string; air?: AirTariffState; air_case_id?: string },
): CommercialPreparation {
  if (!context.operation_id || !context.actor_id || !Number.isFinite(Date.parse(context.occurred_at))) throw new Error('Acteur, opération et date requis');
  const replay = draft.events.find(e => e.operation_id === context.operation_id);
  if (replay) {
    if (JSON.stringify(replay.action) !== JSON.stringify(action) || replay.actor_id !== context.actor_id) throw new Error('Opération réutilisée avec un contenu différent');
    return copy(draft);
  }
  if (context.expected_revision !== draft.revision) throw new Error('Préparation modifiée : relire la révision');
  if (typeof action.reason !== 'string' || action.reason.trim().length < 10 || action.reason.length > 2000) throw new Error('Justification de 10 à 2000 caractères requise');
  if (typeof action.line_id !== 'string' || !action.line_id.trim() || action.line_id.length > 100) throw new Error('Référence de ligne requise');
  const next = copy(draft), index = next.lines.findIndex(l => l.id === action.line_id), before = index >= 0 ? copy(next.lines[index]) : null;
  let line = index >= 0 ? next.lines[index] : null;
  if (action.type === 'add') {
    if (line || next.lines.length >= 100 || action.line_id.startsWith('source:')) throw new Error('Ajout de ligne invalide');
    if (!action.label.trim() || action.label.length > 160 || !kinds.includes(action.kind) || action.kind === ('source' as CommercialKind)) throw new Error('Libellé ou nature invalide');
    line = { id: action.line_id, label: action.label.trim(), kind: action.kind, included: true, original: null, supplier: null,
      client_amount_xof: null, amount_basis: 'unknown', status: 'to_confirm', reason: action.reason.trim() };
    next.lines.push(line);
  } else if (!line) throw new Error('Ligne absente de la préparation');
  if (!line) throw new Error('Ligne requise');
  if (action.type === 'add' || action.type === 'edit') {
    if (action.amount !== null && !validAmount(action.amount)) throw new Error('Montant positif ou zéro explicite requis ; vide reste inconnu');
    if (!bases.includes(action.basis) || (action.amount !== null && action.basis === 'unknown')) throw new Error('Base du montant client à choisir');
    line.client_amount_xof = action.amount;
    line.amount_basis = action.basis;
    line.status = action.amount === null ? 'to_confirm' : 'estimated';
  } else if (action.type === 'remove' || action.type === 'restore') {
    line.included = action.type === 'restore';
  } else if (action.type === 'storage') {
    const state = context.air;
    if (context.air_case_id !== draft.case_id || !state?.catalogue || !state.basis || !state.selection) throw new Error('Catalogue et sélection du dossier requis');
    const historicalProofs = (next.source_snapshot.raw_lines as unknown[]).map(v => row(row(row(v).source).air_handling)).filter(v => Object.keys(v).length);
    const previousEstimate = row(line.supplier?.evidence);
    const pinnedProofs = [...historicalProofs, ...(previousEstimate.selection_id ? [previousEstimate] : [])];
    if (pinnedProofs.some(proof => row(proof.catalogue).id !== state.catalogue!.id || proof.context_hash !== state.context_hash || proof.selection_id !== state.selection!.id)) throw new Error('Base fournisseur modifiée : préparer une nouvelle base source');
    if (action.billable_days !== null && (typeof action.billable_days !== 'number' || !Number.isFinite(action.billable_days) || action.billable_days < 0 || action.billable_days >= 1e6)) throw new Error('Nombre de jours invalide');
    if (line.kind !== 'storage_estimate') throw new Error('Utiliser une rubrique de magasinage distincte');
    const isolated = copy(state);
    isolated.basis!.ordinary_storage = { enabled: true, tariff_key: action.tariff_key, weight_fact_id: action.weight_fact_id,
      billable_days: action.billable_days, days_status: action.billable_days === null ? 'unknown' : 'assumed', source_reference: action.reason.trim() };
    const result = resolveAirTariff(isolated, context.occurred_at.slice(0, 10));
    const storage = result?.components.find(c => c.code === 'ordinary_storage');
    const estimated = amount(storage?.estimated_supplier_ht_xof);
    line.supplier = { amount_ht_xof: estimated, status: estimated === null ? 'unknown' : 'estimated', evidence: copy(result) };
    // New days/bases invalidate the prior customer decision, never silently copy an estimated cost.
    line.client_amount_xof = null;
    line.amount_basis = 'unknown';
    line.status = 'to_confirm';
  } else throw new Error('Action inconnue');
  line.reason = action.reason.trim();
  // Reject an aggregate overflow while the old draft and edited fields are still intact.
  commercialPreparationSummary(next);
  next.revision++;
  next.events.push({ operation_id: context.operation_id, revision: next.revision, actor_id: context.actor_id, occurred_at: context.occurred_at, action: copy(action), before, after: copy(line) });
  return next;
}

/** Separate buckets only: this preparation deliberately does not replace canonical fiscal totals. */
export function commercialPreparationSummary(draft: CommercialPreparation) {
  const active = draft.lines.filter(l => l.included);
  const sum = (basis: CommercialAmountBasis) => {
    const selected = active.filter(l => l.amount_basis === basis && l.client_amount_xof !== null);
    const value = selected.reduce((n, l) => n + l.client_amount_xof!, 0);
    if (!Number.isFinite(value) || value >= 1e12) throw new Error('Somme hors limites');
    return selected.length ? value : null;
  };
  return { before_sodatra_vat: sum('before_sodatra_vat'), taxes_included: sum('taxes_included'), basis_unknown: sum('unknown'),
    unpriced_lines: active.filter(l => l.client_amount_xof === null).length, estimated_lines: active.filter(l => l.status === 'estimated').length,
    removed_lines: draft.lines.filter(l => !l.included).length, firm: false as const };
}
