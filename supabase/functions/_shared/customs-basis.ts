/** Explicit operator valuation; never promotes documentary FOC/HS into client facts. */
import { documentCargoEvidence } from './cargo-source-evidence.ts';
import { documentaryCustomsProposals, assertDocumentarySources } from './customs-source-proposals.ts';
import { equivalentHsTaxation, HS_TAX_BASIS_VERSION, HS_TAX_FIELDS, type TaxRow } from './hs-tax-profile.ts';

export type CustomsRow = Record<string, unknown>;
export const customsRow = (v: unknown): CustomsRow => v && typeof v === 'object' && !Array.isArray(v) ? v as CustomsRow : {};
export const customsUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 8 && v.length <= 1000;
export interface CustomsDecision {
  source_attachment_ids: string[];
  caf_xof: number;
  valuation_basis: string;
  hs_digits: string;
  regime_code: string;
  exemptions_reviewed: true;
  commitment: 'estimated' | 'confirmed';
  note: string;
}
export interface CustomsContext {
  proposal_schema_version?: number;
  attachments: CustomsRow[];
  profiles: TaxRow[];
  regimes: TaxRow[];
  scope: CustomsRow;
  facts?: CustomsRow[];
}
export function validateCustomsDecision(value: unknown): CustomsDecision {
  const d = customsRow(value);
  const keys = ['source_attachment_ids','caf_xof','valuation_basis','hs_digits','regime_code','exemptions_reviewed','commitment','note'];
  if (Object.keys(d).length !== keys.length || Object.keys(d).some(k => !keys.includes(k)) ||
    !Array.isArray(d.source_attachment_ids) || d.source_attachment_ids.length < 1 || d.source_attachment_ids.length > 20 ||
    d.source_attachment_ids.some(id => !customsUuid(id)) || new Set(d.source_attachment_ids).size !== d.source_attachment_ids.length ||
    typeof d.caf_xof !== 'number' || !Number.isFinite(d.caf_xof) || d.caf_xof <= 0 || d.caf_xof >= 1e12 ||
    Math.abs(d.caf_xof * 100 - Math.round(d.caf_xof * 100)) > .001 || !text(d.valuation_basis) || !text(d.note) ||
    typeof d.hs_digits !== 'string' || !/^(?:\d{6}|\d{8}|\d{10})$/.test(d.hs_digits) ||
    typeof d.regime_code !== 'string' || !/^[A-Z0-9][A-Z0-9._/-]{0,31}$/.test(d.regime_code) ||
    d.exemptions_reviewed !== true || !['estimated','confirmed'].includes(String(d.commitment)) ||
    (d.hs_digits.length !== 10 && d.commitment !== 'estimated')) throw new Error('Bases douanières invalides : valeur CAF XOF, justification, sources, régime et revue des exonérations requis. Un HS incomplet reste une estimation.');
  return structuredClone(d) as unknown as CustomsDecision;
}
export function customsProposals(context: CustomsContext) {
  return documentaryCustomsProposals(context);
}
const regimeFlags = ['dd','stx','rs','tin','tva','cosec','pcs','pcc','tpast','ta','hors_promad','hors_bic'];
function supportedProfile(p: TaxRow, regime: string): boolean {
  const e = customsRow(p.tax_evidence);
  return p.tax_profile_status === 'verified' && HS_TAX_FIELDS.every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && Number(p[k]) >= 0) &&
    p.bic === false && p.mercurialis === false && ['uemoa','tev','ta','t_past','t_para','t_ciment','ref'].every(k => p[k] === 0) &&
    text(e.source_ref) && typeof e.verified_at === 'string' && Number.isFinite(Date.parse(e.verified_at)) &&
    e.basis_version === HS_TAX_BASIS_VERSION && e.exemptions === 'none' && Array.isArray(e.regime_codes) && e.regime_codes.includes(regime);
}
export function assessCustomsDecision(d: CustomsDecision, context: CustomsContext): {eligible: boolean; reason: string; evidence?: unknown} {
  if (context.facts?.some(f => f.fact_key==='regulatory.exemption_title' && String(f.value_text??'').trim())) return {eligible:false,reason:'Titre d’exonération à examiner ; aucun calcul sans cette revue'};
  if (!/^AIR_IMPORT(?:_|$)/.test(String(context.scope.request_type)) || Number(context.scope.lot_count) > 1 ||
    context.scope.package !== 'AIR_IMPORT_DDP' || context.scope.incoterm !== 'DDP') return {eligible:false,reason:'Périmètre aérien DDP mono-lot requis'};
  if (d.source_attachment_ids.some(id => !context.attachments.some(a => a.id === id))) throw new Error('Pièce source absente du dossier');
  if (context.proposal_schema_version === 2) {
    try { assertDocumentarySources(d.source_attachment_ids, context); }
    catch { return {eligible:false,reason:'Sources documentaires à revoir : pièce sans preuve exploitable ou contexte ambigu'}; }
  }
  const regime = context.regimes.find(r => r.code === d.regime_code);
  if (!regime || regime.is_active !== true || !regimeFlags.every(k => typeof regime[k] === 'boolean')) return {eligible:false,reason:'Régime actif complet non justifié'};
  if (d.hs_digits.length === 10) {
    const profile = context.profiles.find(p => p.code_normalized === d.hs_digits);
    return profile && supportedProfile(profile,d.regime_code) ? {eligible:true,reason:'Profil national vérifié',evidence:{profile,regime}}
      : {eligible:false,reason:'Profil fiscal national incomplet, non vérifié ou non pris en charge'};
  }
  const candidates = context.profiles.filter(p => String(p.code_normalized).startsWith(d.hs_digits.slice(0,6)));
  const equivalent = equivalentHsTaxation(candidates,candidates.length,{sourceDigits:d.hs_digits,allowEstimate:true,cargoValue:d.caf_xof,
    currency:'XOF',regimeCode:d.regime_code,regime,exemptionsReviewed:true,transportMode:'aerien'});
  return equivalent.eligible === true ? {eligible:true,reason:'Profil commun vérifié ; classement national à confirmer',evidence:equivalent}
    : {eligible:false,reason:equivalent.reason};
}
export interface CustomsBasisSnapshot {
  schema_version: 1; id: string; case_id: string; revision: number; context_hash: string;
  created_by: string; created_at: string; decision: CustomsDecision; sources: Array<{attachment_id:string;filename:string;[key:string]:unknown}>;
  assessment: ReturnType<typeof assessCustomsDecision>;
}
export function customsBasisSnapshot(record: CustomsRow, context: CustomsContext): CustomsBasisSnapshot {
  const decision = validateCustomsDecision(record.decision);
  // Immutable legacy contexts keep their original projection, including previously retained sources.
  const sources = context.proposal_schema_version === 2 ? customsProposals(context)
    : context.attachments.map(a => ({attachment_id:String(a.id),filename:String(a.filename),...documentCargoEvidence(a.extracted_data)}));
  return readCustomsBasisSnapshot({schema_version:1,id:record.id,case_id:record.case_id,revision:record.revision,context_hash:record.context_hash,
    created_by:record.created_by,created_at:record.created_at,decision,sources:sources.filter(p => decision.source_attachment_ids.includes(p.attachment_id)),
    assessment:assessCustomsDecision(decision,context)})!;
}
export function readCustomsBasisSnapshot(value: unknown): CustomsBasisSnapshot | null {
  if (value === undefined) return null;
  const b = customsRow(value);
  validateCustomsDecision(b.decision);
  if (b.schema_version !== 1 || !customsUuid(b.id) || !customsUuid(b.case_id) || !customsUuid(b.created_by) ||
    !Number.isInteger(b.revision) || Number(b.revision) < 1 || typeof b.context_hash !== 'string' || !/^[a-f0-9]{32}$/.test(b.context_hash) ||
    typeof b.created_at !== 'string' || !Number.isFinite(Date.parse(b.created_at)) || !Array.isArray(b.sources) || !b.sources.length ||
    typeof customsRow(b.assessment).eligible !== 'boolean') throw new Error('Preuve douanière figée invalide');
  return structuredClone(b) as unknown as CustomsBasisSnapshot;
}

/** Qualification follows the pinned decision even if an older run lost its reason code. */
export function withCustomsEstimateQualification<T>(qualification:T,basis:unknown):T|CustomsRow {
  if(basis===undefined||basis===null)return qualification;
  const proof=readCustomsBasisSnapshot(basis);
  if(proof?.decision.commitment!=='estimated')return qualification;
  const q=customsRow(qualification),reasons=Array.isArray(q.reasons)?q.reasons:[];
  return {...q,level:q.level==='partial'?'partial':'provisional',
    reasons:[...reasons.filter(r=>customsRow(r).code!=='CUSTOMS_OPERATOR_ESTIMATE'),
      {code:'CUSTOMS_OPERATOR_ESTIMATE',message:'Droits et taxes sur bases opérateur estimatives et révisables'}],
    firmTotalPolicy:q.firmTotalPolicy==='excludes_reserved_items'?'excludes_reserved_items':'all_included'};
}
export interface CustomsRpcClient { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown;error: {message?: string;code?: string}|null}> }
export async function loadCustomsBasis(client: CustomsRpcClient, actor: string, caseId: string, id: unknown): Promise<CustomsBasisSnapshot> {
  if (!customsUuid(id) || !customsUuid(caseId)) throw new Error('Référence de bases douanières invalide');
  const r = await client.rpc('customs_basis_get',{p_actor:actor,p_case:caseId,p_id:id});
  if (r.error) throw new Error('Bases douanières modifiées ou accès refusé : relisez les bases avant calcul.');
  const state = customsRow(r.data), result = customsBasisSnapshot(customsRow(state.head),state.context as CustomsContext);
  if(result.id!==id || result.case_id!==caseId)throw new Error('Preuve douanière d’un autre dossier ou d’une autre décision');
  if (!result.assessment.eligible) throw new Error('Droits et taxes réservés : '+result.assessment.reason);
  return result;
}
/** Overlay exists only inside the opted-in calculation, never inside quote_facts. */
export function customsPricingFacts(b: CustomsBasisSnapshot): CustomsRow[] {
  const d=b.decision;
  return [['cargo.value',d.caf_xof],['cargo.value_currency','XOF'],['cargo.hs_code',d.hs_digits],['customs.regime_code',d.regime_code]]
    .map(([fact_key,value]) => ({fact_key,...(typeof value === 'number'?{value_number:value}:{value_text:value}),source_type:'operator',is_validated:true}));
}
export function applyCustomsPricingFacts<T extends CustomsRow>(facts: T[], b: CustomsBasisSnapshot | null): T[] {
  if (!b) return facts;
  const overlay = customsPricingFacts(b);
  return [...facts.filter(f => !overlay.some(o => o.fact_key === f.fact_key)),...overlay] as T[];
}
export function assertCustomsRequest(b: CustomsBasisSnapshot, request: CustomsRow): void {
  if (request.transportMode !== 'aerien' || request.incoterm !== 'DDP' || request.hsCode !== b.decision.hs_digits ||
    request.regimeCode !== b.decision.regime_code || request.cargoValue !== b.decision.caf_xof || request.cargoCurrency !== 'XOF' ||
    (Array.isArray(request.containers) && request.containers.length) || request.articlesDetail != null || request.isTransit === true || request.scenarioCargoContext != null || request.scenarioPricingMode != null)
    throw new Error('Les paramètres ne correspondent pas aux bases douanières retenues');
}
export function customsBasisText(value: unknown): string[] {
  const b=readCustomsBasisSnapshot(value);if(!b)return [];
  const d=b.decision;
  return [`Bases douanières ${d.commitment==='estimated'?'estimatives et révisables':'retenues'} : CAF ${d.caf_xof.toLocaleString('fr-FR')} FCFA, fret et assurance compris ; aucun ajout de fret ou d’assurance à cette base.`,
    `Classement ${d.hs_digits}${d.hs_digits.length<10?' : position nationale à confirmer':''} ; régime ${d.regime_code} ; exonérations revues, aucun titre retenu.`,
    `Sources documentaires : ${b.sources.map(s=>s.filename).join(', ')}. La valeur douanière a fait l’objet d’une décision opérateur distincte des montants déclarés.`];
}
