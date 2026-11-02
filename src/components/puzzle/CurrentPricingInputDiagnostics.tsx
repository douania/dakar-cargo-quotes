import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/features/auth';
import { supabase } from '@/integrations/supabase/client';
import { readPartialPricingInputs } from '@/lib/partialPricingInputsApi';
import { readAirCase } from '@/lib/airHandlingApi';
import { Button } from '@/components/ui/button';
import { PricingInputDiagnostics } from './PricingInputDiagnostics';
import { explainAirHandlingInputs, type PricingInputReport } from '../../../supabase/functions/_shared/pricing-input-diagnostic';
import { readServiceScopeEvent } from '../../../supabase/functions/_shared/request-service-evidence';

type Props={caseId:string;requestType:string;packageKey:string;serviceKeys:string[];revisionKey:string;scopeEvent?:unknown;active:boolean;upstream:'ready'|'loading'|'error'};
type Reading={key:string;epoch:number;report:PricingInputReport|null;failed:boolean;checkedAt:string};
function notEvaluated(label:string,why:string):PricingInputReport {
 return {schema_version:1,contract:'CURRENT_READ_ONLY_INPUTS',coverage:'Ce diagnostic est limité au handling 2AS sélectionné et au contrat kg DDP partiel documenté.',
  automatic_question:false,quote_readiness:'NOT_DETERMINED',reserves:[],needs:[{key:'not-evaluated',service_key:'SCOPE',component:'scope',label,owner:'operator',state:'not_evaluated',
  why,next_step:'Conserver les contrôles du parcours existant ; aucune donnée client ni règle tarifaire ne peut être déduite ici.',fact_ids:[],observations:[],source:null}]};
}
export function CurrentPricingInputDiagnostics(props:Props) {
 const {user,authStatus}=useAuth();
 if(!props.active)return null;
 if(!user||authStatus!=='authenticated')return <PricingInputDiagnostics report={null} status={authStatus==='loading'?'loading':'error'}/>;
 return <CurrentInputs key={user.id+':'+props.caseId} {...props} actorId={user.id}/>;
}
function CurrentInputs({caseId,actorId,requestType,packageKey,serviceKeys,revisionKey,scopeEvent,upstream}:Props&{actorId:string}) {
 const [attempt,setAttempt]=useState(0),[reading,setReading]=useState<Reading|null>(null),[signedOut,setSignedOut]=useState(false);
 const epoch=useRef(0),identity=useRef('');
 const surface=useRef<HTMLElement>(null),reservedHeight=useRef(0);
 const advanceAccess=useCallback(()=>{epoch.current++;},[]);
 const scope=readServiceScopeEvent(scopeEvent);
 const hasDirection=!!scope&&Object.prototype.hasOwnProperty.call(scope,'shipment_type');
 const rawDirection=hasDirection?scope!.shipment_type:undefined;
 const declaredDirection=typeof rawDirection==='string'?rawDirection.trim().toLowerCase():rawDirection;
 const hasHandling=serviceKeys.includes('AIR_HANDLING'),hasPartial=packageKey==='AIR_IMPORT_DDP';
 const supported=(hasHandling||hasPartial)&&(scopeEvent==null||scope!==null)&&/^AIR_IMPORT(?:_|$)/.test(requestType)&&packageKey!=='AIR_CROSS_TRADE'&&(!hasDirection||declaredDirection==='import');
 const serviceIdentity=JSON.stringify([...serviceKeys].sort());
 const expectedServices=useMemo<string[]>(()=>JSON.parse(serviceIdentity),[serviceIdentity]);
 const key=JSON.stringify([actorId,caseId,requestType,packageKey,[...serviceKeys].sort(),hasDirection,declaredDirection,supported,revisionKey,attempt]);identity.current=key;
 const refresh=useCallback(()=>{advanceAccess();setReading(null);setAttempt(n=>n+1);},[advanceAccess]);
 useEffect(()=>{
  const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{
   advanceAccess();setReading(null);setSignedOut(event==='SIGNED_OUT');if(event!=='SIGNED_OUT')setAttempt(n=>n+1);
  });
  return()=>{advanceAccess();subscription.unsubscribe();};
 },[advanceAccess]);
 useEffect(()=>{
  let mounted=true,expired=false;const access=epoch.current;setReading(null);
  if(upstream!=='ready'||signedOut||!supported)return()=>{mounted=false;};
  const timeout=setTimeout(()=>{expired=true;if(mounted&&identity.current===key&&epoch.current===access)setReading({key,epoch:access,report:null,failed:true,checkedAt:''});},10_000);
  void Promise.all([hasHandling?readAirCase(caseId):Promise.resolve(null),
   hasPartial?readPartialPricingInputs(caseId,{requestType,packageKey,serviceKeys:expectedServices}):Promise.resolve(null)]).then(([state,partial])=>{
   if(!mounted||expired||identity.current!==key||epoch.current!==access)return;
   if(state&&state.request_type!==requestType)throw new Error('Case context changed');
   const report=state?state.lot_count>=2?notEvaluated('Dossier multi-lot','Les deux contrats de ce diagnostic ne qualifient pas ce dossier multi-lot.'):
    explainAirHandlingInputs(state,new Date().toISOString().slice(0,10)):partial!.report;
   if(state&&partial){
    report.needs.push(...partial.report.needs);report.reserves.push(...partial.report.reserves);
    report.coverage+=' Diagnostic kg DDP : uniquement les sources réellement retenues par le sélecteur courant.';
   }
   setReading({key,epoch:access,report,failed:false,checkedAt:new Date().toISOString()});
  }).catch(()=>{if(mounted&&!expired&&identity.current===key&&epoch.current===access)setReading({key,epoch:access,report:null,failed:true,checkedAt:''});}).finally(()=>clearTimeout(timeout));
  return()=>{mounted=false;clearTimeout(timeout);};
 },[key,supported,upstream,signedOut,caseId,requestType,packageKey,hasHandling,hasPartial,expectedServices]);
 useEffect(()=>{const onFocus=(event:FocusEvent)=>{if(event.target===event.currentTarget)refresh();};window.addEventListener('focus',onFocus);return()=>window.removeEventListener('focus',onFocus);},[refresh]);
 const current=reading?.key===key&&reading.epoch===epoch.current?reading:null;
 useLayoutEffect(()=>{
  const node=surface.current;if(!node||!current||current.failed)return;
  const measure=()=>{reservedHeight.current=node.getBoundingClientRect().height;};measure();
  if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();
 },[current]);
 useEffect(()=>{
  if(!current||current.failed||upstream!=='ready')return;
  const timer=setTimeout(refresh,30_000);return()=>clearTimeout(timer);
 },[current,upstream,refresh]);
 if(upstream!=='ready'||signedOut)return <PricingInputDiagnostics report={null} status={upstream==='loading'&&!signedOut?'loading':'error'}/>;
 if(!supported)return <PricingInputDiagnostics report={notEvaluated('Parcours non couvert', 'Ce parcours ne relève pas des deux contrats documentés du diagnostic. Il n’est pas évalué ici.')}/>;
 return <section ref={surface} aria-label="Diagnostic des données courantes" className="mb-6 space-y-2" style={!current&&reservedHeight.current?{minHeight:reservedHeight.current}:undefined}>
  <PricingInputDiagnostics report={current?.report??null} status={!current?'loading':current.failed?'error':'ready'}/>
  {current?.checkedAt&&<p className="text-xs text-muted-foreground">Lecture vérifiée le {new Date(current.checkedAt).toLocaleString('fr-FR',{timeZone:'UTC'})} UTC. Actualisez après une modification du dossier.</p>}
  <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={refresh}>Actualiser le diagnostic</Button>
 </section>;
}
