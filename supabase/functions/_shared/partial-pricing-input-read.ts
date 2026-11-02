/** Read-only projection of the production selector's actual output; never select a tariff here. */
import { explainPartialKgInputs, explainPartialKgPrerequisite, type PricingInputReport } from './pricing-input-diagnostic.ts';
import type { SelectedTariffReference } from './selected-tariff-reference.ts';
import type { PartialQuoteFact, partialDestinationDdpEligible } from './partial-destination-quote.ts';
export type DiagnosticQuantityRule = { id: string; service_key: string; quantity_basis: string; requires_fact_key: string | null };
export type QuantityPrerequisite = {service_key:string;rule_id:string;kind:'applicable_catalogue_unit_rate_kg'};
type SelectedLine = { id: string; source: string; rule_id: string | null; tariff_reference?: SelectedTariffReference };
export type PartialPricingInputRead = {
 schema_version: 1; case_id: string; request_type: string; package_key: string; service_keys: string[];
 checked_at: string; context_hash: string; tariff_hash: string;
 selections: Array<{service_key: string; source: {table: string; id: string} | null; quantity_rule: DiagnosticQuantityRule | null; state: 'selected_kg' | 'quantity_prerequisite' | 'not_evaluated' | 'ambiguous'}>;
 report: PricingInputReport;
};
export function projectPartialInputRead(input: {
 case_id: string; request_type: string; eligibility: Parameters<typeof partialDestinationDdpEligible>[0];
 checked_at: string; context_hash: string; tariff_hash: string; facts: PartialQuoteFact[];
 lines: Array<{id: string; service: string}>; selected: SelectedLine[]; rules: DiagnosticQuantityRule[];
 quantity_prerequisites?: QuantityPrerequisite[];
 ambiguous: (service: string, selected: SelectedLine) => boolean;
}): PartialPricingInputRead {
 const report: PricingInputReport = {schema_version:1,contract:'EXPLICIT_PARTIAL_DESTINATION_DDP_KG',
  coverage:'Lecture du sélecteur courant, limitée aux tarifs au kg du contrat partiel DDP destination. Les autres rubriques restent non évaluées.',
  automatic_question:false,quote_readiness:'NOT_DETERMINED',needs:[],reserves:[
   'Lecture vérifiée à un instant donné, sans verrou transactionnel ni garantie de disponibilité future du tarif.',
   'Cette lecture ne confirme ni prix, ni taxes, ni homologation de la source, ni préparation du devis.']};
 const selections: PartialPricingInputRead['selections'] = [];
 for(const line of input.lines){
  const selected=input.selected.find(x=>x.id===line.id);
  if(!selected)throw new Error('Incomplete selector response');
  const rule=input.rules.find(x=>x.id===selected.rule_id&&x.service_key===line.service)??null;
  const source=selected.tariff_reference??null;
  const ambiguous=input.ambiguous(line.service,selected);
  const unit=String(source?.snapshot.unit??source?.snapshot.unit_type??'').toUpperCase();
  const kg=!!source&&unit==='KG'&&rule?.quantity_basis==='KG'&&!['FIXED','FLAT'].includes(String(source.snapshot.pricing_mode));
  const prerequisite=!source&&selected.source==='missing_quantity'&&rule&&input.quantity_prerequisites?.some(p=>p.kind==='applicable_catalogue_unit_rate_kg'&&p.service_key===line.service&&p.rule_id===rule.id);
  selections.push({service_key:line.service,source:source?{table:source.table,id:source.id}:null,quantity_rule:rule?{id:rule.id,service_key:rule.service_key,quantity_basis:rule.quantity_basis,requires_fact_key:rule.requires_fact_key}:null,
   state:ambiguous?'ambiguous':kg?'selected_kg':prerequisite?'quantity_prerequisite':'not_evaluated'});
  if(prerequisite&&!ambiguous&&rule){
   const detail=explainPartialKgPrerequisite({service_key:line.service,eligibility:input.eligibility,quantity_rule:rule,facts:input.facts});
   report.needs.push(...detail.needs);for(const reserve of detail.reserves)if(!report.reserves.includes(reserve))report.reserves.push(reserve);
   continue;
  }
  if(kg&&!ambiguous){
   const detail=explainPartialKgInputs({service_key:line.service,eligibility:input.eligibility,selected_source:source,quantity_rule:rule?{id:rule.id,quantity_basis:rule.quantity_basis,requires_fact_key:rule.requires_fact_key}:null,facts:input.facts});
   for(const need of detail.needs){
    if(need.source)need.source.conditions.push(`Source : ${source.table}/${source.id}`,`Règle de quantité : ${rule!.id} (${rule!.requires_fact_key??'assiette non documentée'})`);
    report.needs.push(need);
   }
   continue;
  }
  report.needs.push({key:'selector-contract',service_key:line.service,component:'quantity',label:ambiguous?'Sélection tarifaire ambiguë':selected.source==='missing_quantity'?'Sélection tarifaire non atteinte':'Contrat hors diagnostic kg',
   owner:'reference',state:ambiguous?'contradiction':'not_evaluated',
   why:ambiguous?'Plusieurs sources ou règles de même priorité existent ; le choix historique du moteur ne constitue pas une sélection stable.':
    selected.source==='missing_quantity'?'Le sélecteur s’arrête sur la quantité avant de retenir une source. Aucun tarif candidat n’est présenté comme retenu.':
    'Le sélecteur n’a pas retenu de contrat au kg documenté pour cette rubrique. Les autres contrôles existants restent nécessaires.',
   next_step:'Faire qualifier la source et son assiette par l’opérateur ou le référentiel ; aucune demande client automatique.',
   fact_ids:[],observations:[],source:source?{id:source.id,reference:`${source.table}/${source.id}`,conditions:[`Règle de quantité : ${rule?.id??'non retenue'}`, 'Applicabilité du contrat kg non établie par ce diagnostic.']}:null});
 }
 return {schema_version:1,case_id:input.case_id,request_type:input.request_type,package_key:input.eligibility.packageKey,
  service_keys:input.eligibility.serviceKeys,checked_at:input.checked_at,context_hash:input.context_hash,tariff_hash:input.tariff_hash,selections,report};
}
