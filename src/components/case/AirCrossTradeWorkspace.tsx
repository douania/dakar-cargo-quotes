import {documentedCountryChoices} from '../../../supabase/functions/_shared/request-country';
import { useCallback,useEffect,useId,useRef,useState } from 'react';
import { useAuth } from '@/features/auth';
import { useQueryClient } from '@tanstack/react-query';
import { Card,CardHeader,CardTitle,CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select,SelectTrigger,SelectValue,SelectContent,SelectItem } from '@/components/ui/select';
import { AlertDialog,AlertDialogContent,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction } from '@/components/ui/alert-dialog';
import { AirCallError,airCrossTradeCall,type AirScreenState,type AirRow } from '@/lib/airCrossTradeApi';
import { airClientDataLabels,airServiceLabels,airDraftPayload,blankAirDraft,sourceAttestation } from '@/lib/airCrossTradeDraft';
import type { AirOperatorRequest,AirSourceAttestation } from '../../../supabase/functions/_shared/air-cross-trade-loader';
import type { AirServiceDecision } from '../../../supabase/functions/_shared/air-cross-trade';

type Api=<T>(body:AirRow)=>Promise<T>;
type Pending={body:AirRow;uncertain:boolean;receipt?:AirRow};
type Cached={draft:AirOperatorRequest;base:AirScreenState;pending:Pending|null;stale?:boolean};
const memory=new Map<string,Cached>(); // actor/case-scoped, no business content in browser storage
export function AirCrossTradeWorkspace(props:{caseId:string;isLocked?:boolean;onChanged?:()=>void}) {
 const {user}=useAuth();const actorId=user?.id;
 useEffect(()=>{for(const key of memory.keys())if(!actorId||!key.startsWith(actorId+':'))memory.delete(key);},[actorId]);
 return user?<AirCrossTradeEditor key={user.id+':'+props.caseId} {...props} actorId={user.id}/>:null;
}
export function AirCrossTradeEditor({caseId,actorId,isLocked=false,onChanged,api=airCrossTradeCall}:{caseId:string;actorId:string;isLocked?:boolean;onChanged?:()=>void;api?:Api}) {
 const qc=useQueryClient(),prefix=useId(),key=actorId+':'+caseId;
 const [state,setState]=useState<AirScreenState|null>(null),[draft,setDraft]=useState<AirOperatorRequest|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [preview,setPreview]=useState<AirScreenState|null>(null),[pending,setPending]=useState<Pending|null>(null),[stale,setStale]=useState(false),[compare,setCompare]=useState(false);
 const [query,setQuery]=useState(''),[composing,setComposing]=useState(false),[tried,setTried]=useState(false),[denied,setDenied]=useState(false);
 const accessEpoch=useRef(0),accessDenied=useRef(false),mounted=useRef(true),generation=useRef(0),mutationLock=useRef(false),form=useRef<HTMLFormElement>(null),rows=useRef(new Map<string,AirRow>());
 const revokeAccess=useCallback((e:unknown)=>{
  if(!(e instanceof AirCallError)||![401,403].includes(e.status))return false;
  accessDenied.current=true;accessEpoch.current++;generation.current++;memory.delete(key);rows.current.clear();
  setState(null);setDraft(null);setPreview(null);setPending(null);setDirty(false);setDenied(true);setLoading(false);setNotice('');
  setError(e.message+' La saisie a été retirée de cette session. Toute opération en attente devra être vérifiée après rétablissement de l’accès.');return true;
 },[key]);
 const rememberRows=(value:AirScreenState)=>{for(const r of value.catalog??[])rows.current.set('rate_card:'+r.id,r);for(const r of value.partner_catalog??[])rows.current.set('partner_fact:'+r.id,r);for(const r of value.sources??[])rows.current.set(r.kind+':'+r.id,r.row as AirRow);};
 const changed=(next:AirOperatorRequest)=>{setDraft(next);setDirty(true);setPreview(null);setError('');setTried(false);if(state)memory.set(key,{draft:next,base:state,pending,stale});};
 useEffect(()=>{
  mounted.current=true;const g=++generation.current;
  api<AirScreenState>({action:'read',case_id:caseId}).then(value=>{
   if(!mounted.current||g!==generation.current)return;rememberRows(value);const saved=memory.get(key);setState(value);accessDenied.current=false;setDenied(false);
   if(saved){setDraft(saved.draft);setPending(saved.pending);setDirty(true);setStale(saved.stale===true||saved.base.context_hash!==value.context_hash||saved.base.head?.id!==value.head?.id);setNotice('Saisie de cette session restaurée. Vérifiez la qualification avant enregistrement.');}
   else setDraft(value.head?.request??blankAirDraft(value));
  }).catch(e=>{if(mounted.current&&g===generation.current){if(!revokeAccess(e))setError((e as Error).message);}}).finally(()=>{if(mounted.current&&g===generation.current)setLoading(false);});
  return()=>{mounted.current=false;};
 },[key,caseId,actorId,api,revokeAccess]);
 useEffect(()=>{if(!dirty&&!pending)return;const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty,pending]);
 useEffect(()=>{
  if(!query||composing)return;const g=++generation.current;const timer=setTimeout(()=>{
   api<AirScreenState>({action:'read',case_id:caseId,query}).then(value=>{if(mounted.current&&g===generation.current){rememberRows(value);setState(current=>current?{...current,catalog:value.catalog,catalog_has_more:value.catalog_has_more,partner_catalog:value.partner_catalog}:value);}}).catch(e=>{if(mounted.current&&g===generation.current&&!revokeAccess(e))setError('Recherche de sources indisponible. Votre saisie est conservée.');});
  },300);return()=>clearTimeout(timer);
 },[query,composing,api,caseId,revokeAccess]);
 const locked=isLocked||busy||denied||!state?.can_write||!!pending;
 async function refresh(){const g=++generation.current;setLoading(true);try{const value=await api<AirScreenState>({action:'read',case_id:caseId,query});if(!mounted.current||g!==generation.current)return;rememberRows(value);setState(value);accessDenied.current=false;setDenied(false);setPreview(null);
  if(dirty){setStale(true);setNotice('État serveur relu. Comparez-le à votre saisie avant de reprendre.');}else setDraft(value.head?.request??blankAirDraft(value));
 }catch(e){if(mounted.current){if(!revokeAccess(e))setError((e as Error).message);}}finally{if(mounted.current)setLoading(false);}}
 async function verify(){if(!draft||mutationLock.current)return;const epoch=accessEpoch.current;setTried(true);setError('');try{
  const operator=airDraftPayload(draft);if(!operator.scope_reference.trim())throw new Error('Indiquez la référence de la demande et des prestations.');
  mutationLock.current=true;setBusy(true);const value=await api<AirScreenState>({action:'read',case_id:caseId,operator,query});if(!mounted.current||accessDenied.current||epoch!==accessEpoch.current)return;
  rememberRows(value);setPreview(value);setNotice(value.qualification_error??(value.evaluation?.ready_to_price?'Qualification cohérente, non enregistrée.':'Qualification à compléter ; le plan peut rester en attente.'));
 }catch(e){if(epoch!==accessEpoch.current||accessDenied.current||revokeAccess(e))return;setError((e as Error).message);queueMicrotask(()=>form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());}finally{mutationLock.current=false;if(mounted.current)setBusy(false);}}
 async function confirmed(body:AirRow,data:AirRow,epoch:number){if(!mounted.current||accessDenied.current||epoch!==accessEpoch.current)return;if(data.id!==body.operation_id)throw new AirCallError('Confirmation incohérente. Vérifiez l’opération.','unknown');
  const confirmedOp={body,uncertain:false,receipt:data};setPending(confirmedOp);if(state&&draft)memory.set(key,{draft,base:state,pending:confirmedOp});
  let value:AirScreenState;try{value=await api<AirScreenState>({action:'read',case_id:caseId,query});}catch(e){if(epoch!==accessEpoch.current||accessDenied.current||revokeAccess(e))return;setError('Écriture confirmée ; relecture indisponible. Vérifiez l’opération pour actualiser, sans la renvoyer.');return;}
  if(!mounted.current||accessDenied.current||epoch!==accessEpoch.current)return;rememberRows(value);setState(value);setPending(null);setPreview(null);memory.delete(key);setDirty(false);
  const newer=body.action==='save'&&value.head?.id!==data.id;setStale(newer);if(!newer)setDraft(value.head?.request??blankAirDraft(value));
  if(body.action==='price'&&value.last_pricing_run?.id!==data.pricing_run_id){setNotice('Calcul confirmé ; une version plus récente existe. Relisez le calcul conservé avant de poursuivre.');return;}
  if(newer){if(draft)memory.set(key,{draft,base:value,pending:null,stale:true});setDirty(true);setNotice('Votre plan est enregistré, mais un plan plus récent existe. Votre saisie est conservée pour comparaison.');return;}
  setNotice(body.action==='price'?'Calcul enregistré et relu. La création de version reste une étape distincte.':'Plan enregistré et relu depuis le serveur.');
  await Promise.all([qc.invalidateQueries({queryKey:['quote-case',caseId]}),qc.invalidateQueries({queryKey:['case-timeline',caseId]}),qc.invalidateQueries({queryKey:['pricing-runs',caseId]})]);onChanged?.();}
 async function dispatch(body:AirRow,priorUncertain=false){if(mutationLock.current)return;const epoch=accessEpoch.current;mutationLock.current=true;setBusy(true);setError('');const op={body,uncertain:priorUncertain};setPending(op);if(state&&draft)memory.set(key,{draft,base:state,pending:op});
  try{const data=await api<AirRow>(body);await confirmed(body,data,epoch);}catch(e){if(!mounted.current||epoch!==accessEpoch.current||accessDenied.current||revokeAccess(e))return;const uncertain=priorUncertain||!(e instanceof AirCallError)||e.outcome==='unknown';
   const next=uncertain?{body,uncertain:true}:null;setPending(next);if(state&&draft)memory.set(key,{draft,base:state,pending:next});setError(uncertain?'Résultat non confirmé. Vérifiez l’opération ; aucune nouvelle opération ne sera créée.':(e as Error).message);
   if(e instanceof AirCallError&&e.status===403)setDenied(true);
  }finally{mutationLock.current=false;if(mounted.current)setBusy(false);}}
 function save(){if(!draft||!state||!preview||stale||locked)return;void dispatch({action:'save',case_id:caseId,operation_id:crypto.randomUUID(),parent_id:state.head?.id??null,expected_context:preview.context_hash,expected_sources:preview.sources_hash,operator:airDraftPayload(draft)});}
 function price(){if(!state?.head||dirty||stale||locked||!state.evaluation?.ready_to_price)return;void dispatch({action:'price',case_id:caseId,operation_id:crypto.randomUUID(),parent_id:state.head.id,plan_id:state.head.id,expected_context:state.context_hash,expected_sources:state.sources_hash});}
 async function check(){if(!pending||mutationLock.current)return;const epoch=accessEpoch.current;mutationLock.current=true;setBusy(true);try{const data=await api<{plan:AirRow|null;pricing:AirRow|null}>({action:'operation',case_id:caseId,operation_id:pending.body.operation_id});const receipt=pending.body.action==='save'?data.plan:data.pricing;
  if(epoch!==accessEpoch.current||accessDenied.current)return;if(receipt)await confirmed(pending.body,receipt,epoch);else setError('Aucune confirmation disponible. Le résultat précédent reste inconnu ; la même opération peut être reprise explicitement.');
 }catch(e){if(!revokeAccess(e))setError((e as Error).message);}finally{mutationLock.current=false;if(mounted.current)setBusy(false);}}
 const field=(name:string,label:string,value:unknown,onValue:(s:string)=>void,required=false)=><div className="space-y-1" key={name}><Label htmlFor={prefix+name}>{label}</Label><Input id={prefix+name} value={value==null?'':String(value)} onChange={e=>onValue(e.target.value)} required={required} aria-invalid={tried&&required&&!String(value??'').trim()} aria-describedby={tried&&required&&!String(value??'').trim()?prefix+name+'-error':undefined}/>{tried&&required&&!String(value??'').trim()&&<p id={prefix+name+'-error'} className="text-sm text-destructive">Renseignez ce champ pour vérifier la qualification.</p>}</div>;
 const select=(name:string,label:string,value:string,options:Array<[string,string]>,onValue:(s:string)=>void)=><div className="space-y-1" key={name}><Label htmlFor={prefix+name}>{label}</Label><Select value={value} onValueChange={onValue} disabled={locked}><SelectTrigger id={prefix+name} className="cursor-pointer"><SelectValue placeholder="À préciser"/></SelectTrigger><SelectContent className="w-[var(--radix-select-trigger-width)]">{options.map(([v,l])=><SelectItem className="cursor-pointer" key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>;
 function changeService(k:string,patch:Partial<AirServiceDecision>){if(!draft)return;const next=structuredClone(draft);const d=next.plan.services.find(d=>d.service_key===k);if(d)Object.assign(d,patch);changed(next);}
 function changeAttestation(k:string,patch:Partial<AirSourceAttestation>){if(!draft)return;const next=structuredClone(draft);const d=next.plan.services.find(d=>d.service_key===k),a=next.attestations.find(a=>d?.source_id===a.source_kind+':'+a.source_id);if(a)Object.assign(a,patch);changed(next);}
 function inclusion(k:string,patch:Partial<AirSourceAttestation['included_services'][number]>){if(!draft)return;const next=structuredClone(draft),child=next.plan.services.find(d=>d.service_key===k),parent=next.plan.services.find(d=>d.service_key===child?.included_in),att=next.attestations.find(a=>parent?.source_id===a.source_kind+':'+a.source_id);if(!att){setError('Choisissez d’abord la source de la prestation englobante.');return;}
  const existing=att.included_services.find(i=>i.service_key===k);if(existing)Object.assign(existing,patch);else att.included_services.push({service_key:k,origin_country:'',destination_country:'',origin_airport:null,destination_airport:null,reference:'',...patch});changed(next);}
 function chooseSource(k:string,id:string){if(!draft)return;const raw=rows.current.get(id);if(!raw)return;const next=structuredClone(draft),d=next.plan.services.find(d=>d.service_key===k)!;next.attestations=next.attestations.filter(a=>a.service_key!==k);next.attestations.push(sourceAttestation(id.startsWith('rate_card:')?'rate_card':'partner_fact',raw,k,state?.countries??[]));
  Object.assign(d,{source_id:id,source_fingerprint:undefined,fx_id:undefined,fx_fingerprint:undefined,source_role:'purchase',applicability_reference:''});changed(next);}
 if(loading&&!state)return <Card><CardContent className="py-6" role="status">Chargement du parcours aérien…</CardContent></Card>;
 if(!state||!draft)return <Card><CardContent className="py-6"><p role="alert">{error||'Parcours indisponible.'}</p><Button type="button" variant="outline" onClick={()=>void refresh()}>Réessayer la lecture</Button></CardContent></Card>;
 const countries=(state.country_choices??documentedCountryChoices(state.countries)).map(c=>[c.country_code,`${c.country_code} — ${c.country_name??c.country_code}`] as [string,string]);
 const patchRoute=(patch:Partial<AirOperatorRequest['plan']['route']>)=>changed({...draft,plan:{...draft.plan,route:{...draft.plan.route,...patch}}});
 const evaluated=preview??state;
 const protectedScope=state.facts.filter(f=>['service.package','service.overrides'].includes(String(f.fact_key))&&(f.is_validated===true||['operator','manual_input','operator_correction'].includes(String(f.source_type))));
 return <Card className="mb-6" id="air-cross-trade-panel"><CardHeader><CardTitle>Parcours aérien entre pays tiers</CardTitle></CardHeader><CardContent className="space-y-5">
  <p>Les prestations, le départ et les offres sont qualifiés par l’opérateur. Aucun frais d’import Sénégal n’est ajouté par défaut.</p>
  <p className="text-sm text-muted-foreground">{state.head?`Plan enregistré : révision ${state.head.revision}.`:'Aucun plan enregistré.'} {dirty?'Modifications non enregistrées.':''}</p>
  {!state.applicable&&<p role="alert">Pays et mode documentés à qualifier avant d’enregistrer ce parcours.</p>}
  {error&&<p role="alert" className="text-destructive">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>void refresh()}>Actualiser l’état serveur</Button>{stale&&<Button type="button" variant="outline" disabled={busy} onClick={()=>setCompare(true)}>Comparer avant de reprendre</Button>}</div>
  {pending&&<div className="rounded-md border p-3 space-y-2"><p>Une opération attend sa confirmation. La saisie reste conservée dans cette session.</p><Button type="button" variant="outline" disabled={busy} onClick={()=>void check()}>Vérifier l’opération</Button><Button type="button" variant="outline" disabled={busy||denied||!!pending.receipt} onClick={()=>void dispatch(pending.body,true)}>Reprendre la même opération</Button></div>}
  <form ref={form} noValidate onSubmit={e=>e.preventDefault()} className="space-y-5"><fieldset disabled={locked} className="space-y-5">
   <section className="space-y-3" aria-labelledby={prefix+'route'}><h3 id={prefix+'route'} className="font-semibold">Trajet retenu</h3><p>Origine documentée : {state.demand.origin_country??'à qualifier'}. Arrivée demandée : {state.demand.arrival_airport??'à qualifier'} ({state.demand.destination_country??'pays à qualifier'}).</p>
    <div className="grid gap-3 sm:grid-cols-2">{field('departure','Aéroport de départ retenu (code IATA)',draft.plan.route.departure_airport,v=>patchRoute({departure_airport:v.toUpperCase()}))}{select('departure-country','Pays du départ',draft.plan.route.departure_country,countries,v=>patchRoute({departure_country:v}))}
    {select('pre','Préacheminement',draft.plan.route.pre_carriage,[['none','Non retenu'],['retained','Retenu, à couvrir']],v=>patchRoute({pre_carriage:v as 'none'|'retained'}))}
    {field('route-ref','Référence justifiant le trajet',draft.plan.route.routing_reference,v=>patchRoute({routing_reference:v}))}{field('acceptance','Référence d’éligibilité du fret : offre ou accord partenaire',draft.plan.route.acceptance_reference,v=>patchRoute({acceptance_reference:v||null}))}</div>
   </section>
   <section className="space-y-3"><h3 className="font-semibold">Prestations demandées</h3>{field('scope','Référence de la demande et du périmètre',draft.scope_reference,v=>changed({...draft,scope_reference:v}),true)}
    <div className="grid gap-2 sm:grid-cols-2">{Object.entries(airServiceLabels).map(([k,label])=><label key={k} className="flex items-center gap-2"><Checkbox checked={draft.requested_services.includes(k)} onCheckedChange={value=>{const next=structuredClone(draft);if(value){next.requested_services.push(k);next.plan.services.push({service_key:k,disposition:'pending',reason:''});}else{next.requested_services=next.requested_services.filter(x=>x!==k);next.plan.services=next.plan.services.filter(d=>d.service_key!==k);}changed(next);}}/>{label}</label>)}</div>
   </section>
   <section className="space-y-3"><h3 className="font-semibold">Sources et montants</h3><div className="flex gap-2"><div className="space-y-1"><Label htmlFor={prefix+'search'}>Rechercher une source tarifaire</Label><Input id={prefix+'search'} value={query} onChange={e=>setQuery(e.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}/></div>{query&&<Button type="button" variant="outline" onClick={()=>{setQuery('');const g=++generation.current;void api<AirScreenState>({action:'read',case_id:caseId,query:''}).then(value=>{if(mounted.current&&!accessDenied.current&&g===generation.current){rememberRows(value);setState(current=>current?{...current,catalog:value.catalog,catalog_has_more:value.catalog_has_more}:value);}}).catch(e=>{if(!revokeAccess(e))setError('Recherche indisponible.');});}}>Effacer la recherche</Button>}</div>{state.catalog_has_more&&<p>Les 100 premiers résultats sont affichés. Précisez la recherche pour trouver une autre source.</p>}
    {draft.plan.services.map(d=>{
     const k=d.service_key,a=draft.attestations.find(a=>a.source_kind+':'+a.source_id===d.source_id),raw=d.source_id?rows.current.get(d.source_id):null;
     const options=[...(state.catalog??[]).filter(r=>r.service_key===k).map(r=>['rate_card:'+r.id,`Tarif : ${String(r.source??r.service_key)} — ${r.value} ${r.currency}/${r.unit}`] as [string,string]),...(state.partner_catalog??[]).map(r=>['partner_fact:'+r.id,`Offre validée : ${r.fact_key} — ${r.proposed_value_number} ${r.currency}`] as [string,string])];
     if(d.source_id&&!options.some(([id])=>id===d.source_id))options.unshift([d.source_id,'Source conservée — vérifier ses conditions']);
     const ext=d as typeof d & {amount_text?:string;trips_text?:string};
     return <div key={k} className="rounded-md border p-4 space-y-3"><h4 className="font-semibold">{airServiceLabels[k]}</h4><div className="grid gap-3 sm:grid-cols-2">
      {select(k+'-status','Qualification',d.disposition,[['pending','En attente'],['priced','À chiffrer depuis une source'],['included','Comprise dans une autre prestation'],['excluded','Exclue du périmètre']],v=>changeService(k,{disposition:v as AirServiceDecision['disposition']}))}
      {field(k+'-reason','Motif de la décision',d.reason,v=>changeService(k,{reason:v}))}
      {d.disposition==='included'&&select(k+'-parent','Prestation qui la comprend',d.included_in??'',draft.plan.services.filter(x=>x.service_key!==k&&x.disposition==='priced').map(x=>[x.service_key,airServiceLabels[x.service_key]]),v=>changeService(k,{included_in:v}))}
      {(d.disposition==='priced'||d.disposition==='pending')&&select(k+'-source','Source de prix',d.source_id??'',options,v=>chooseSource(k,v))}
      </div>
      {d.disposition==='included'&&(()=>{const parent=draft.plan.services.find(p=>p.service_key===d.included_in),att=draft.attestations.find(a=>parent?.source_id===a.source_kind+':'+a.source_id),proof=att?.included_services.find(i=>i.service_key===k);return <div className="space-y-3"><p>Renseignez le segment réellement compris dans l’offre englobante. Une modification du trajet ne modifie pas cette preuve.</p><div className="grid gap-3 sm:grid-cols-2">
 {select(k+'-included-from','Pays origine compris',proof?.origin_country??'',countries,v=>inclusion(k,{origin_country:v}))}{select(k+'-included-to','Pays destination compris',proof?.destination_country??'',countries,v=>inclusion(k,{destination_country:v}))}
 {field(k+'-included-airport-from','Aéroport origine compris, si précisé',proof?.origin_airport,v=>inclusion(k,{origin_airport:v.toUpperCase()||null}))}{field(k+'-included-airport-to','Aéroport destination compris, si précisé',proof?.destination_airport,v=>inclusion(k,{destination_airport:v.toUpperCase()||null}))}
 {field(k+'-included-proof','Référence de l’inclusion dans cette offre',proof?.reference,v=>inclusion(k,{reference:v}))}
 {select(k+'-included-coverage','Segment compris',d.coverage??'',[['pickup','Collecte'],['pre_carriage','Préacheminement'],['air_leg','Vol'],['departure','Au départ'],['arrival','À l’arrivée'],['journey','Ensemble du trajet']],v=>changeService(k,{coverage:v as AirServiceDecision['coverage']}))}
 </div></div>;})()}
      {a&&(d.disposition==='priced'||d.disposition==='pending')&&<>
       <p className="text-sm">Source chargée : {String(raw?.value??raw?.proposed_value_number??'à relire')} {String(raw?.currency??'')} — ce montant n’est pas le prix client.</p>
       <div className="grid gap-3 sm:grid-cols-2">{select(k+'-role','Nature de la source',d.source_role??'',[['purchase','Achat fournisseur'],...(a.source_kind==='rate_card'?[['sale','Tarif de vente existant'] as [string,string]]:[])],v=>changeService(k,{source_role:v as 'purchase'|'sale'}))}
       {field(k+'-source-ref','Preuve des conditions et de l’applicabilité de l’offre',a.reference,v=>{changeAttestation(k,{reference:v});})}
       {select(k+'-from','Pays origine couvert par la source',a.origin_country,countries,v=>changeAttestation(k,{origin_country:v}))}{select(k+'-to','Pays destination couvert par la source',a.destination_country,countries,v=>changeAttestation(k,{destination_country:v}))}
       {field(k+'-airport-from','Aéroport origine dans la source, si précisé',a.origin_airport,v=>changeAttestation(k,{origin_airport:v.toUpperCase()||null}))}{field(k+'-airport-to','Aéroport destination dans la source, si précisé',a.destination_airport,v=>changeAttestation(k,{destination_airport:v.toUpperCase()||null}))}
       {field(k+'-valid-from','Début de validité (AAAA-MM-JJ ou instant indiqué)',a.effective_from,v=>changeAttestation(k,{effective_from:v}))}{field(k+'-valid-to','Fin de validité, si indiquée',a.effective_to,v=>changeAttestation(k,{effective_to:v||null}))}
       {select(k+'-coverage','Segment tarifé',d.coverage??'',[['pickup','Collecte'],['pre_carriage','Préacheminement'],['air_leg','Vol'],['departure','Au départ du vol'],['arrival','À l’arrivée du vol'],['journey','Ensemble du trajet']],v=>changeService(k,{coverage:v as AirServiceDecision['coverage']}))}
       {a.unit==='kg'&&select(k+'-weight','Assiette kg explicitement prévue par la source',d.weight_basis??'',[['gross_kg','Poids brut'],['net_kg','Poids net'],['chargeable_kg','Poids taxable']],v=>changeService(k,{weight_basis:v as AirServiceDecision['weight_basis']}))}
       {a.unit==='voyage'&&field(k+'-trips','Nombre de voyages retenu',ext.trips_text??d.service_quantity?.value,v=>changeService(k,{trips_text:v} as Partial<AirServiceDecision>))}
       {String(raw?.currency??'XOF')!=='XOF'&&select(k+'-fx','Source de change retenue',d.fx_id??'',state.fx_catalog.filter(f=>f.currency_code===raw?.currency).map(f=>[String(f.id),`${f.currency_code} : ${f.rate_to_xof} XOF — ${f.source}`]),v=>changeService(k,{fx_id:v}))}
       {field(k+'-applicability','Justification de l’assiette et des conditions retenues',d.applicability_reference,v=>changeService(k,{applicability_reference:v}))}
       {field(k+'-sale','Montant client pour toute la prestation (XOF)',ext.amount_text??d.client_sale?.amount_xof,v=>changeService(k,{amount_text:v} as Partial<AirServiceDecision>))}
       {select(k+'-basis','Base du montant client',d.client_sale?.basis??'unknown',[['unknown','À confirmer'],['taxes_included','Taxes déjà comprises'],['before_sodatra_vat','Avant TVA sur honoraires SODATRA']],v=>changeService(k,{client_sale:{amount_xof:d.client_sale?.amount_xof??null,basis:v as 'unknown'|'taxes_included'|'before_sodatra_vat',reason:d.client_sale?.reason??''}}))}
       {field(k+'-sale-reason','Motif du montant client',d.client_sale?.reason,v=>changeService(k,{client_sale:{amount_xof:d.client_sale?.amount_xof??null,basis:d.client_sale?.basis??'unknown',reason:v}}))}
       </div>
       <p className="text-sm font-medium">Données exigées par cette source, sans demande documentaire automatique</p><div className="grid gap-2 sm:grid-cols-2">{Object.entries(airClientDataLabels).map(([fact,label])=><label className="flex gap-2 items-center" key={fact}><Checkbox checked={a.required_fact_keys.includes(fact)} onCheckedChange={yes=>changeAttestation(k,{required_fact_keys:yes?[...a.required_fact_keys,fact]:a.required_fact_keys.filter(x=>x!==fact)})}/>{label}</label>)}</div>
      </>}
     </div>;
    })}
   </section>
   {protectedScope.length>0&&<section className="space-y-2"><h3 className="font-semibold">Périmètre opérateur existant</h3><p>Une nouvelle révision peut remplacer les choix de prestations précédents ; les valeurs historiques sont conservées.</p>{protectedScope.map(f=><label key={String(f.id)} className="flex gap-2 items-center"><Checkbox checked={draft.acknowledged_scope_fact_ids?.includes(String(f.id))??false} onCheckedChange={yes=>changed({...draft,acknowledged_scope_fact_ids:yes?[...(draft.acknowledged_scope_fact_ids??[]),String(f.id)]:(draft.acknowledged_scope_fact_ids??[]).filter(x=>x!==f.id)})}/>Réviser explicitement {String(f.fact_key)} : {String(f.value_text??JSON.stringify(f.value_json))}</label>)}</section>}
   <section className="space-y-2"><h3 className="font-semibold">Informations à demander au client après vérification</h3><p className="text-sm">Sélectionnez seulement une donnée réellement absente et nécessaire. Tarifs, départ, poids taxable et acceptation du fret restent des sujets internes.</p><div className="grid gap-2 sm:grid-cols-2">{Object.entries(airClientDataLabels).map(([fact,label])=><label className="flex gap-2 items-center" key={fact}><Checkbox checked={draft.client_data_keys?.includes(fact)??false} onCheckedChange={yes=>changed({...draft,client_data_keys:yes?[...(draft.client_data_keys??[]),fact]:(draft.client_data_keys??[]).filter(x=>x!==fact)})}/>{label}</label>)}</div></section>
  </fieldset>
  {evaluated.evaluation&&<section className="rounded-md border p-3 space-y-2" aria-live="polite"><h3 className="font-semibold">{evaluated.evaluation.ready_to_price?'Qualification complète pour le calcul':'Qualification en attente'}</h3><ul className="list-disc pl-5">{evaluated.evaluation.needs.map(n=><li key={n.key+':'+n.service_key}>{n.owner==='client'?'Client':n.owner==='tariff'?'Source tarifaire':'Opérateur'} : {n.reason}</li>)}</ul>{evaluated.evaluation.pricing&&<p>Montant client provisoire : {evaluated.evaluation.pricing.total_ttc.toLocaleString('fr-FR')} XOF. Achat conservé séparément.</p>}</section>}
  <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={locked||!state.applicable} onClick={()=>void verify()}>Vérifier sans enregistrer</Button><Button type="button" disabled={locked||stale||!preview||!state.applicable} onClick={save}>Enregistrer le plan</Button><Button type="button" disabled={locked||dirty||stale||!state.head||!state.evaluation?.ready_to_price} onClick={price}>Calculer et enregistrer</Button></div>
  <p className="text-sm text-muted-foreground">Le plan peut être conservé en attente. Aucun prix inconnu n’est remplacé par zéro ; aucun message n’est envoyé au client.</p>
  </form>
  <AlertDialog open={compare} onOpenChange={setCompare}><AlertDialogContent><AlertDialogTitle>Reprendre sur l’état courant ?</AlertDialogTitle><AlertDialogDescription>Votre saisie sera conservée. Le plan serveur est en révision {state.head?.revision??0}, départ {state.head?.plan.plan.route.departure_airport||'non retenu'}. Vérifiez les différences et les sources avant de créer une nouvelle révision.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>Continuer la comparaison</AlertDialogCancel><AlertDialogAction onClick={()=>{setStale(false);setPreview(null);setNotice('Saisie conservée ; nouvelle vérification nécessaire sur cette base.');}}>Reprendre puis vérifier</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </CardContent></Card>;
}
