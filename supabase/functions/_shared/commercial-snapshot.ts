import { readAirCrossTradeBasis, airCrossTradeMissingCoverage } from "./air-cross-trade-snapshot.ts";
import { readCustomsBasisSnapshot } from './customs-basis.ts';
import type { CommercialPreparation } from './commercial-preparation.ts';
import { commercialFeeTotals } from './commercial-fee-totals.ts';
import { isToConfirmLine } from './quotation-line-status.ts';

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12;
const same = (a: number, b: number) => Math.abs(a-b) < 0.001;

/** The existing fiscal rule is reused, not changed: VAT only on SODATRA fees.
 * An explicit before-VAT decision designates a SODATRA service/fee; TTC adds no VAT.
 * Source amounts must first reconcile to their saved commercial totals. */
export function composeCommercialSnapshot(draft: CommercialPreparation, revisionId: string) {
  const source = structuredClone(draft.source_snapshot) as Row;
  const original = source.raw_lines as Row[];
  if (!Array.isArray(original) || source.is_multi_lot || row(source.meta).scenario_id) throw new Error('Version canonique mono-lot requise');
  const totals = row(source.totals);
  if (totals.currency !== 'XOF') throw new Error('Version source XOF requise');
  const pricedSource = original.filter(l => !isToConfirmLine(l) && number(l.amount));
  const originalSum = pricedSource.reduce((sum,l) => sum+(l.amount as number),0);
  const originalFees = pricedSource.filter(l=>l.bloc === 'honoraires').reduce((sum,l)=>sum+(l.amount as number),0);
  const originalTax = commercialFeeTotals(originalSum,originalFees);
  if (!number(totals.subtotal_before_sodatra_vat) || !number(totals.honoraires_ht) || !number(totals.honoraires_tva)
    || !same(originalSum,totals.subtotal_before_sodatra_vat) || !same(originalFees,totals.honoraires_ht)
    || !same(originalTax.honorairesTva,totals.honoraires_tva)) throw new Error('Base commerciale source non rapprochable ; revue requise');
  let subtotal = 0, fees = 0, priced = 0, unknown = 0;
  const lines = draft.lines.map((line,index) => {
    const originalLine = row(line.original);
    const inherited = line.status === 'source' && line.kind === 'source';
    const sourceIndex = /^source:(0|[1-9]\d*)$/.exec(line.id);
    const savedLine = sourceIndex && Array.isArray(source.lines) ? row(source.lines[Number(sourceIndex[1])]) : {};
    // Prefer the saved normalized line; legacy raw sources may attest an explicit rate.
    const sourceQuantity = savedLine.quantity ?? originalLine.quantity;
    const sourceUnitPrice = savedLine.unit_price ?? originalLine.unitPrice ?? originalLine.unit_price ?? originalLine.rate;
    const value = line.included && number(line.client_amount_xof) ? line.client_amount_xof : null;
    const unresolved = line.included && (value === null || (!inherited && line.amount_basis === 'unknown'));
    if (unresolved) unknown++;
    const taxable = inherited ? originalLine.bloc === 'honoraires' : line.amount_basis === 'before_sodatra_vat';
    if (line.included && !unresolved && value !== null) {subtotal += value; priced++; if (taxable) fees += value;}
    const modified = !inherited;
    const customsEstimate = line.kind === 'customs_estimate' || (modified && originalLine.category === 'CUSTOMS_RESERVE');
    // No supplier proof, internal reason, actor or purchase amount in client line data.
    const label = line.label;
    const explanation = !line.included ? 'Rubrique retirée explicitement du devis.' : unresolved ? 'Montant ou base à confirmer ; non compris dans le total.'
      : modified ? customsEstimate ? 'Provision douanière estimée par l’opérateur ; aucun classement ou taux fiscal validé.'
      : line.kind === 'storage_estimate' ? 'Magasinage estimé selon les jours hypothétiques retenus ; montant client décidé par l’opérateur.'
      : 'Montant retenu par l’opérateur, estimatif et révisable.' : 'Montant repris de la version source.';
    return {service_code:String(originalLine.service_code ?? originalLine.category ?? `COMMERCIAL_${index+1}`),description:label,label,
      category:customsEstimate ? 'CUSTOMS_PROVISION' : originalLine.category ?? line.kind,
      quantity:inherited && number(sourceQuantity) && number(sourceUnitPrice) ? sourceQuantity : 1,
      unit_price:line.included && !unresolved ? inherited && number(sourceQuantity) && number(sourceUnitPrice) ? sourceUnitPrice : value : null,
      amount:line.included && !unresolved ? value : null,currency:'XOF',
      bloc:taxable ? 'honoraires' : 'debours',explanation,
      source:{type:!line.included ? 'EXCLUDED_BY_RULE' : unresolved ? 'TO_CONFIRM' : modified ? 'OPERATOR_ESTIMATE' : 'SAVED_SOURCE',
        reference:!line.included ? 'COMMERCIAL_REMOVED' : 'COMMERCIAL_REVISION',firm_eligible:false},
      commercial:{line_id:line.id,included:line.included,estimated:modified,basis:inherited ? taxable ? 'before_sodatra_vat' : 'taxes_included' : line.amount_basis,customs_estimate:customsEstimate,storage_estimate:line.kind==='storage_estimate'},
    };
  });
  const calculated = commercialFeeTotals(subtotal,fees);
  if (![subtotal,fees,calculated.totalPayable].every(number)) throw new Error('Total commercial hors limites');
  const airCrossTradeBasis = readAirCrossTradeBasis(source.air_cross_trade);
  const airScopeReduced = airCrossTradeMissingCoverage(airCrossTradeBasis, lines).length > 0;
  const customsBasis=readCustomsBasisSnapshot(source.customs_basis);
  return {...(airCrossTradeBasis ? {air_cross_trade:airCrossTradeBasis} : {}),...(customsBasis?{customs_basis:customsBasis}:{}),inputs:source.inputs,client:source.client,...(source.operator_basis ? {operator_basis:source.operator_basis} : {}),
    meta:{...row(source.meta),version_id:null,version_number:null,created_at:null,
      commercial_revision_id:revisionId,commercial_source_version_id:draft.source_version_id,
      quoteQualification:{level:unknown || airScopeReduced ? 'partial' : 'provisional',firmTotalPolicy:unknown || airScopeReduced ? 'excludes_reserved_items' : 'all_included',
        reasons:[...(Array.isArray(row(row(source.meta).quoteQualification).reasons) ? row(row(source.meta).quoteQualification).reasons as unknown[] : []),...(airScopeReduced ? [{code:'AIR_CROSS_TRADE_SCOPE_REDUCED',message:'Périmètre aérien réduit : le montant ne couvre pas le parcours complet.'}] : []),{code:'COMMERCIAL_OPERATOR_REVISION',message:'Montants retenus par l’opérateur ; estimations révisables, postes inconnus exclus.'}]}},
    lines,raw_lines:structuredClone(lines),sources:[],
    totals:{currency:'XOF',commercial_amounts:true,total_ht:priced ? subtotal : null,total_ttc:priced ? calculated.totalPayable : null,
      subtotal_before_sodatra_vat:priced ? subtotal : null,total_payable:priced ? calculated.totalPayable : null,
      honoraires_ht:priced ? fees : null,honoraires_tva:priced ? calculated.honorairesTva : null,
      honoraires_ttc:priced ? calculated.honorairesTtc : null},
    commercial:{schema_version:1,revision_id:revisionId,source_version_id:draft.source_version_id,unknown_lines:unknown,estimated:true,
      conditions:['Décisions commerciales opérateur, non contractuelles.','Une provision douanière ne valide ni classement ni taux fiscal.','Un poste à confirmer n’est pas gratuit.']},
  };
}
