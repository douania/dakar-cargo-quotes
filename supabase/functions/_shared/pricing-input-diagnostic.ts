/** Local read-only candidate. No production reader, DB, AI, question or pricing mutation.
 * Dependencies describe the supplied source, not universal customer requirements.
 * Existing resolvers remain the sole authority for their own bounded contracts.
 */
import { resolveAirTariff, type AirTariffState } from './air-tariff.ts';
import { partialDestinationDdpEligible, partialKgQuantity, type PartialQuoteFact } from './partial-destination-quote.ts';
import type { SelectedTariffReference } from './selected-tariff-reference.ts';

type Fact = PartialQuoteFact & { id?: string; is_current?: boolean };
export type InputObservation = {
  fact_id: string | null; source_type: string | null; is_validated: boolean;
  knowledge: 'scenario_assumption' | 'operator_origin' | 'other_origin';
};
export type InputDependency = {
  key: string; kind: 'fact' | 'tariff_basis' | 'condition' | 'duration';
  presence: 'absent' | 'present' | 'multiple' | 'not_established';
  observations: InputObservation[];
};
const limits = {
  runtime_source_freshness: 'NOT_CHECKED', tariff_applicability_outside_resolver: 'NOT_CHECKED',
  customer_request: 'NOT_DETERMINED', quote_readiness: 'NOT_DETERMINED', selling_price: 'NOT_DETERMINED',
  automatic_question: false,
} as const;
function dependency(key: string, facts: Fact[]): InputDependency {
  const rows = facts.filter(f => f.fact_key === key);
  return { key, kind: 'fact', presence: rows.length > 1 ? 'multiple' : rows.length ? 'present' : 'absent',
    observations: rows.map(f => ({fact_id:f.id ?? null, source_type:f.source_type ?? null, is_validated:f.is_validated === true,
      knowledge:f.source_type === 'scenario_assumption' ? 'scenario_assumption'
        : ['operator','operator_correction','manual_input','lta'].includes(f.source_type ?? '') ? 'operator_origin' : 'other_origin'})) };
}
const unknown = (key: string, kind: InputDependency['kind']): InputDependency =>
  ({key,kind,presence:'not_established',observations:[]});

/** Only the existing explicit provisional mono-air destination DDP contract.
 * The caller supplies a source already retained elsewhere. Never select a tariff here.
 * Quantity-rule identity is separate: a weight rule is not a tariff provenance receipt.
 */
export function diagnosePartialKgInput(input: {
  service_key: string;
  eligibility: Parameters<typeof partialDestinationDdpEligible>[0];
  selected_source: SelectedTariffReference | null;
  quantity_rule: { id: string; quantity_basis: string; requires_fact_key?: string | null } | null;
  facts: Fact[];
}) {
  const scope = partialDestinationDdpEligible(input.eligibility) && input.eligibility.serviceKeys.includes(input.service_key);
  const source = input.selected_source ? structuredClone(input.selected_source) : null;
  const base = {service_key:input.service_key,contract:'EXPLICIT_PARTIAL_DESTINATION_DDP_KG',source,
    quantity_rule:input.quantity_rule ? {...input.quantity_rule} : null,limits};
  const empty = (reason: string) => ({...base,status:'not_evaluated' as const,reason,dependencies:[] as InputDependency[],resolver_result:null});
  if (!scope) return empty('OUTSIDE_EXISTING_PARTIAL_DDP_CONTRACT');
  if (!source?.id || source.schema_version !== 1) return empty('SELECTED_SOURCE_NOT_ESTABLISHED');
  const snapshot = source.snapshot;
  if (snapshot.service_key && snapshot.service_key !== input.service_key) return empty('SOURCE_SERVICE_MISMATCH');
  const unit = String(snapshot.unit_type ?? snapshot.unit ?? '').trim().toUpperCase();
  if (['FIXED','FLAT'].includes(String(snapshot.pricing_mode)) || unit !== 'KG' || input.quantity_rule?.quantity_basis !== 'KG')
    return empty('KG_SOURCE_AND_QUANTITY_CONTRACT_NOT_ESTABLISHED');
  const result = partialKgQuantity(input.quantity_rule,input.facts);
  const dependencies = result.factKey ? [dependency(result.factKey,input.facts)] : [unknown('documented_weight_basis','tariff_basis')];
  const multiple = dependencies.some(d => d.presence === 'multiple');
  const assumed = dependencies.some(d => d.observations.some(f => f.knowledge === 'scenario_assumption'));
  return {...base,status:'diagnosed' as const,reason:multiple ? 'MULTIPLE_FACTS_REVIEW' : assumed ? 'ASSUMPTION_REQUIRES_VISIBLE_REVIEW' : result.reason,
    dependencies,resolver_result:{...result},observations_require_review:multiple || assumed};
}

/** Read the current supplier resolver's output, not its translated reason strings.
 * Financial totals are deliberately not exposed as a customer quotation.
 */
export function diagnoseAirHandlingInputs(state: AirTariffState, date: string) {
  const catalogue = state.catalogue;
  const source = catalogue ? {table:'air_tariff_catalogues',id:catalogue.id,revision:catalogue.revision,
    reference:catalogue.source_reference,effective_from:catalogue.effective_from,effective_to:catalogue.effective_to}
    : state.profile ? {table:'air_handling_profiles',id:state.profile.id,revision:state.profile.revision,
      reference:state.profile.source_reference,effective_from:state.profile.effective_from,effective_to:state.profile.effective_to} : null;
  const base = {service_key:'AIR_HANDLING',contract:'EXISTING_SUPPLIER_RESOLVER',source,selection_id:state.selection?.id ?? null,
    context:{selected_hash:state.selection?.context_hash ?? null,current_hash:state.context_hash,date},limits};
  let resolution;
  try { resolution = resolveAirTariff(state,date); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'AIR_TARIFF_BASIS_MISSING') throw error;
    return {...base,status:'not_evaluated' as const,reason:error.message,components:[],reserves:[]};
  }
  if (!resolution) return {...base,status:'not_selected' as const,reason:'NO_OPT_IN_SELECTION',components:[],reserves:[]};
  const keys: Record<string,string> = {collection_per_kg:'collection_0',security_per_kg:'security_0',documents:'doc_DME_0',warehouse_passage:'dms_0',it:'it_0'};
  const components = resolution.components.map(component => {
    const entry = catalogue?.payload.entries.find(e => e.key === (component.code === 'ordinary_storage' ? state.basis?.ordinary_storage.tariff_key : keys[component.code]));
    const dependencies: InputDependency[] = [];
    if (['collection_per_kg','security_per_kg'].includes(component.code)) {
      dependencies.push(catalogue ? unknown('documented_weight_basis','tariff_basis') : dependency('cargo.chargeable_weight_kg',state.facts));
    }
    if (component.code === 'warehouse_passage' && component.reason) dependencies.push(unknown('warehouse_bracket_eligibility','condition'));
    if (component.code === 'ordinary_storage') {
      const storage = state.basis?.ordinary_storage;
      const rows = state.facts.filter(f => f.id === storage?.weight_fact_id);
      dependencies.push(rows.length === 1 ? dependency(rows[0].fact_key,rows) : unknown('selected_storage_weight_fact','fact'));
      dependencies.push(unknown('ordinary_storage.billable_days_and_justification','duration'));
    }
    const multiple = dependencies.some(d => d.presence === 'multiple');
    const assumed = dependencies.some(d => d.observations.some(f => f.knowledge === 'scenario_assumption'))
      || (component.code === 'ordinary_storage' && state.basis?.ordinary_storage.days_status === 'assumed');
    return {component:component.code,label:component.label,
      resolver_state:component.supplier_ht_xof !== null ? 'known_supplier_component'
        : component.estimated_supplier_ht_xof != null ? 'estimate_only' : 'unresolved',
      resolver_reason:component.reason,dependencies,observations_require_review:multiple || assumed,
      conditions:entry ? {entry_key:entry.key,unit:entry.unit,qualification:entry.qualification,condition:entry.condition,
        source_condition:entry.source.calculation_condition,sheet:entry.source.sheet,row:entry.source.parsed_row,
        numeric_constraints:{minimum:entry.minimum,weight_from_kg:entry.weight_from_kg,weight_to_kg:entry.weight_to_kg,
          day_from:entry.day_from,day_to:entry.day_to,free_hours:entry.free_hours,threshold:entry.threshold}} : null,
      storage_basis:component.code === 'ordinary_storage' ? structuredClone(state.basis?.ordinary_storage ?? null) : null};
  });
  return {...base,status:'diagnosed' as const,reason:null,components,reserves:[...resolution.reserves]};
}

/** Operator-only explanation of existing resolvers. Never a readiness verdict or a question queue. */
export type DiagnosticOwner = 'client' | 'operator' | 'reference';
export type DiagnosticState = 'provided' | 'missing' | 'assumption' | 'contradiction' | 'invalid' | 'unqualified' | 'not_evaluated';
export type PricingInputNeed = {
  key: string; service_key: string; component: string; label: string;
  owner: DiagnosticOwner; state: DiagnosticState; why: string; next_step: string;
  fact_ids: string[]; observations: Array<{ source_type: string | null; is_validated: boolean; value_number: number | null }>;
  source: { reference: string; id: string; conditions: string[] } | null;
};
export type PricingInputReport = {
  schema_version: 1; contract: string; needs: PricingInputNeed[]; reserves: string[];
  automatic_question: false; quote_readiness: 'NOT_DETERMINED';
  coverage: string;
};
const factLabels: Record<string,string> = {
  'cargo.weight_kg':'Poids brut total', 'cargo.weight_net_kg':'Poids net total',
  'cargo.chargeable_weight_kg':'Poids taxable retenu',
};
const contractReasons:Record<string,string>={
 OUTSIDE_EXISTING_PARTIAL_DDP_CONTRACT:'Ce contrat partiel DDP ne couvre pas le périmètre de cette demande.',
 SELECTED_SOURCE_NOT_ESTABLISHED:'La source tarifaire retenue n’est pas établie.',
 SOURCE_SERVICE_MISMATCH:'La source retenue concerne une autre prestation.',
 KG_SOURCE_AND_QUANTITY_CONTRACT_NOT_ESTABLISHED:'Le tarif ou la règle de quantité ne correspond pas au contrat kg examiné.',
 AIR_TARIFF_BASIS_MISSING:'La sélection et les bases du catalogue doivent être renseignées.',
 NO_OPT_IN_SELECTION:'Aucun profil fournisseur n’a été sélectionné pour ce diagnostic.',
};
const sourceConditionLabels:Record<string,string>={unit:'Unité',unit_type:'Unité',pricing_mode:'Mode du tarif',effective_from:'Début de validité',effective_to:'Fin de validité'};
const currentFacts = (facts: Fact[]) => facts.filter(f=>f.is_current!==false);
function describeWeight(key:string,facts:Fact[],accepted:boolean):Pick<PricingInputNeed,'state'|'owner'|'fact_ids'|'observations'> {
  const rows=currentFacts(facts).filter(f=>f.fact_key===key);
  const assumptions=rows.some(f=>/assumption/.test(f.source_type??''));
  const valid=rows.length===1&&typeof rows[0].value_number==='number'&&Number.isFinite(rows[0].value_number)&&rows[0].value_number!>0;
  const state:DiagnosticState=rows.length>1?'contradiction':!rows.length?'missing':!valid?'invalid':assumptions?'assumption':accepted?'provided':'unqualified';
  return {state,owner:key==='cargo.chargeable_weight_kg'||state!=='missing'?'operator':'client',
    fact_ids:rows.flatMap(f=>f.id?[f.id]:[]),observations:rows.map(f=>({source_type:f.source_type??null,is_validated:f.is_validated===true,
      value_number:typeof f.value_number==='number'&&Number.isFinite(f.value_number)?f.value_number:null}))};
}
const report=(contract:string,coverage:string):PricingInputReport=>({schema_version:1,contract,coverage,needs:[],reserves:[],automatic_question:false,quote_readiness:'NOT_DETERMINED'});
function add(r:PricingInputReport,n:Omit<PricingInputNeed,'fact_ids'|'observations'> & Partial<Pick<PricingInputNeed,'fact_ids'|'observations'>>) {
  r.needs.push({fact_ids:[],observations:[],...n});
}
type PartialInput=Parameters<typeof diagnosePartialKgInput>[0] & {
  context?:{selected:string;current:string};
};
export function explainPartialKgInputs(input:PartialInput):PricingInputReport {
  const facts=currentFacts(input.facts),d=diagnosePartialKgInput({...input,facts});
  const r=report(d.contract,'Contrat partiel DDP destination, uniquement pour la prestation et la source déjà retenues.');
  const source=input.selected_source?{id:input.selected_source.id,reference:String(input.selected_source.snapshot.source_reference??input.selected_source.snapshot.source??input.selected_source.id),
    conditions:['Validité et applicabilité hors résolveur non vérifiées.',...['unit','unit_type','pricing_mode','effective_from','effective_to'].flatMap(k=>input.selected_source?.snapshot[k]!=null?[`${sourceConditionLabels[k]} : ${String(input.selected_source.snapshot[k])}`]:[])]}:null;
  if(d.status!=='diagnosed') {
    add(r,{key:'contract',service_key:input.service_key,component:'quantity',label:'Contrat tarifaire à qualifier',owner:'operator',state:'unqualified',
      why:contractReasons[d.reason]??'Le contrat tarifaire ne peut pas être établi par ce diagnostic.',next_step:'Vérifier le périmètre et la source retenue ; aucune donnée client ne peut être déduite de ce diagnostic.',source});return r;
  }
  if(input.context&&input.context.selected!==input.context.current) {
    add(r,{key:'context',service_key:input.service_key,component:'quantity',label:'Sélection à actualiser',owner:'operator',state:'contradiction',
      why:'Le contexte fourni ne correspond plus à celui de la sélection.',next_step:'Relire les sources et reconfirmer la sélection avant de réutiliser ce diagnostic.',source});return r;
  }
  if(!d.resolver_result.factKey) {
    add(r,{key:'weight_basis',service_key:input.service_key,component:'quantity',label:'Assiette de poids du tarif',owner:'reference',state:'unqualified',
      why:'L’unité kg ne précise pas si le tarif exige le poids brut, net ou taxable.',next_step:'Faire préciser cette assiette dans la source tarifaire ; ne pas redemander le poids au client par défaut.',source});return r;
  }
  const key=d.resolver_result.factKey,info=describeWeight(key,facts,d.resolver_result.kg!==null);
  const conflict=d.resolver_result.reason==='DIMENSIONS_CONFLICT_CHARGEABLE_UNCONFIRMED';
  add(r,{...info,key,service_key:input.service_key,component:'quantity',label:factLabels[key]??key,
    state:conflict?'contradiction':info.state,owner:conflict?'operator':info.owner,
    why:conflict?'Les dimensions contradictoires ne permettent pas de retenir ce poids taxable.':
      info.state==='provided'?'La donnée fournie satisfait l’assiette explicite du résolveur.':
      info.state==='assumption'?'Une hypothèse est disponible ; elle reste distincte d’un fait confirmé.':
      info.state==='contradiction'?'Plusieurs faits courants correspondent à cette assiette ; aucun n’est choisi par ce diagnostic.':
      info.state==='invalid'?'La valeur disponible ne constitue pas un poids positif exploitable.':'Le tarif retenu exige cette assiette précise.',
    next_step:info.state==='provided'?'Réutiliser la donnée existante, sans demande documentaire supplémentaire.':
      info.state==='missing'&&info.owner==='client'?'Vérifier les informations déjà reçues et les hypothèses admises ; demander seulement cette donnée si elle reste nécessaire.':
      'Faire vérifier ou choisir la base par l’opérateur, avec sa provenance et ses réserves visibles.',source});
  r.reserves.push('Source sélectionnée non homologuée par ce diagnostic ; prix de vente, taxes et fraîcheur distante non vérifiés.');
  return r;
}

/** A server-observed prerequisite of an applicable KG catalogue, NOT a selected tariff.
 * Called only after the production selector's non-quantity predicates and priority guards.
 */
export function explainPartialKgPrerequisite(input: {
 service_key:string; eligibility:Parameters<typeof partialDestinationDdpEligible>[0];
 quantity_rule:{id:string;quantity_basis:string;requires_fact_key?:string|null}; facts:Fact[];
}):PricingInputReport {
 const r=report('EXPLICIT_PARTIAL_DESTINATION_DDP_KG','Préalable au choix du tarif, démontré par le service et la règle courants ; aucun tarif sélectionné.');
 const facts=currentFacts(input.facts),rule=input.quantity_rule;
 if(!partialDestinationDdpEligible(input.eligibility)||!input.eligibility.serviceKeys.includes(input.service_key)||rule.quantity_basis!=='KG'){
  add(r,{key:'prerequisite-scope',service_key:input.service_key,component:'quantity',label:'Préalable non établi',owner:'reference',state:'not_evaluated',
   why:'La nécessité de cette donnée ne peut pas être établie dans ce périmètre.',next_step:'Qualifier le service et la règle applicable avant toute demande client.',source:null});return r;
 }
 const result=partialKgQuantity(rule,facts);
 if(!result.factKey){
  add(r,{key:'prerequisite-basis',service_key:input.service_key,component:'quantity',label:'Assiette du tarif kg à préciser',owner:'reference',state:'unqualified',
   why:`La règle ${rule.id} exige une quantité au kg sans préciser un poids brut, net ou taxable exploitable. Aucun tarif n’est sélectionné.`,
   next_step:'Faire préciser l’assiette dans le référentiel ; aucune demande de poids au client n’est justifiée ici.',source:null});return r;
 }
 const key=result.factKey,info=describeWeight(key,facts,result.kg!==null),conflict=result.reason==='DIMENSIONS_CONFLICT_CHARGEABLE_UNCONFIRMED';
 add(r,{...info,key:'prerequisite:'+key,service_key:input.service_key,component:'quantity',label:factLabels[key]??key,
  state:conflict?'contradiction':info.state,owner:conflict?'operator':info.owner,
  why:`Dans les conditions du sélecteur courant, la règle ${rule.id} attend cette assiette pour la prestation demandée et le catalogue au kg admissible. `+
   (conflict?'Les dimensions contradictoires empêchent de retenir le poids taxable disponible.':
    info.state==='missing'?'Cette donnée est absente des faits courants.':info.state==='contradiction'?'Plusieurs faits courants portent cette assiette ; aucun n’est choisi ici.':
    info.state==='assumption'?'La valeur reste une hypothèse visible à relire.':info.state==='invalid'?'La valeur disponible n’est pas un poids positif exploitable.':'Une valeur est disponible pour cette règle.')+
   ' Le tarif n’a pas encore été sélectionné.',
  next_step:info.state==='missing'&&info.owner==='client'?
   'Vérifier les informations déjà reçues et les hypothèses admises avec l’opérateur ; demander seulement ce poids s’il reste nécessaire et indisponible.':
   'Faire qualifier cette assiette avec l’opérateur à partir des informations disponibles ; ne pas transformer ce besoin interne en question client automatique.',source:null});
 r.reserves.push('Préalable de quantité seulement : aucun tarif candidat n’est présenté comme sélectionné, aucun prix ni devis n’est établi.');
 r.reserves.push('La validité contractuelle et l’homologation du catalogue restent à qualifier ; ce préalable ne justifie pas à lui seul une demande client.');
 return r;
}

export function explainAirHandlingInputs(input:AirTariffState,date:string):PricingInputReport {
  const state={...input,facts:currentFacts(input.facts)},d=diagnoseAirHandlingInputs(state,date);
  const r=report(d.contract,'Profil historique 2AS ou catalogue complet sélectionné ; aucune extension aux autres prestations ou aux pays tiers.');
  const source=d.source?{id:d.source.id,reference:d.source.reference,conditions:[`Validité : ${d.source.effective_from} — ${d.source.effective_to??'fin non renseignée'}`]}:null;
  if(d.status!=='diagnosed') {
    add(r,{key:'selection',service_key:'AIR_HANDLING',component:'selection',label:'Source et bases à sélectionner',owner:'operator',state:'unqualified',
      why:contractReasons[d.reason??'']??'Aucune sélection exploitable.',next_step:'Choisir et qualifier la source selon le parcours existant ; ne pas inventer une question client.',source});return r;
  }
  const common={service_key:'AIR_HANDLING',source};
  for(const c of d.components) {
    const localSource=source?{...source,conditions:[...source.conditions,...(c.conditions?[c.conditions.condition,c.conditions.source_condition]:[])]}:null;
    add(r,{...common,source:localSource,key:`component:${c.component}`,component:c.component,label:c.label,
      owner:'reference',state:c.resolver_state==='known_supplier_component'?'provided':c.resolver_state==='estimate_only'?'assumption':'unqualified',
      why:c.resolver_state==='known_supplier_component'?'Le résolveur connaît cette composante fournisseur ; cela ne constitue pas un prix client.':c.resolver_reason??'Conditions de la rubrique à qualifier.',
      next_step:c.resolver_state==='known_supplier_component'?'Conserver la source et les conditions ; ne pas demander de document supplémentaire pour cette rubrique.':'Qualifier les conditions et bases ci-dessous avant de retenir cette composante.'});
    for(const dep of c.dependencies) {
      if(dep.kind==='fact'&&dep.key in factLabels) {
        // Data qualification is independent of a different missing condition (days,
        // source validity, etc.). These are the existing profile/storage evidence kinds.
        const dependencyFacts=c.component==='ordinary_storage'
          ?state.facts.filter(f=>f.id===state.basis?.ordinary_storage.weight_fact_id):state.facts;
        const justified=dependencyFacts.some(f=>f.fact_key===dep.key&&(f.is_validated===true||['operator','operator_correction','manual_input','lta'].includes(f.source_type??'')));
        const info=describeWeight(dep.key,dependencyFacts,justified);
        add(r,{...common,...info,key:`${c.component}:${dep.key}`,component:c.component,label:factLabels[dep.key],
          why:'Cette rubrique utilise l’assiette documentée dans le profil, sans substitution du poids brut au taxable.',
          next_step:info.state==='provided'?'Réutiliser la donnée disponible.':'Choisir ou confirmer la base justifiée avec l’opérateur ; ne pas demander au client de calculer le poids taxable.'});
      } else if(dep.key==='ordinary_storage.billable_days_and_justification') {
        const b=state.basis?.ordinary_storage,days=b?.billable_days;
        const invalid=days!=null&&(typeof days!=='number'||!Number.isFinite(days)||days<0||days>=1e6);
        const missing=days==null||!b||b.source_reference.trim().length<10||b.days_status==='unknown';
        const status:DiagnosticState=invalid?'invalid':missing?'missing':b?.days_status==='assumed'?'assumption':'provided';
        add(r,{...common,key:`${c.component}:days`,component:c.component,label:'Jours facturables justifiés',owner:'operator',state:status,
          why:status==='provided'?'La durée explicite et sa justification sont présentes ; zéro confirmé reste distinct d’une durée inconnue.':
            status==='assumption'?'La durée est hypothétique ; son estimation reste distincte du coût connu.':status==='invalid'?'La durée fournie n’est pas exploitable par le résolveur.':'La durée facturable ou sa justification manque.',
          next_step:'Qualifier la durée selon la source retenue ; aucune franchise ni gratuité n’est présumée.'});
      } else {
        const basis=dep.key==='documented_weight_basis';
        add(r,{...common,key:`${c.component}:${dep.key}`,component:c.component,
          label:basis?'Assiette de poids du tarif':dep.kind==='condition'?'Éligibilité de la rubrique':'Base de poids du magasinage',
          owner:basis?'reference':'operator',state:'unqualified',
          why:basis?'La grille ne précise pas brut ou taxable pour cette rubrique.':dep.kind==='condition'?'Le résolveur demande une qualification de la tranche ou des conditions.':'Le poids du magasinage doit être sélectionné parmi les faits justifiés.',
          next_step:basis?'Faire préciser la base par la source tarifaire ; aucune question client automatique.':'Vérifier les informations et conditions déjà disponibles avec l’opérateur.'});
      }
    }
  }
  r.reserves=[...d.reserves];
  return r;
}
