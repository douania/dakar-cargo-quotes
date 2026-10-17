import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import { useMutation,useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth';
import { Button } from '@/components/ui/button';
import { CommercialPreparationPanel } from './CommercialPreparationPanel';
import type { CommercialPreparation } from '@/lib/commercialPreparation';
import type { AirTariffState } from '../../../supabase/functions/_shared/air-tariff';

interface State {available:boolean;source_version_id:string;source_hash:string;context_hash:string;head_id:string|null;draft:CommercialPreparation;air:AirTariffState;can_write:boolean;case_status:string}
interface Pending {state:State;draft:CommercialPreparation;request:Record<string,unknown>|null}
// Keep unsaved edits across in-app navigation; no secrets or source data written to browser storage.
const pendingByCase=new Map<string,Pending>();
async function invoke(name:string,body:Record<string,unknown>) {
  const {data,error}=await supabase.functions.invoke(name,{body});
  if(error) {
    const detail=await error.context?.json?.().catch(()=>null);
    throw new Error(detail?.error?.message ?? 'Enregistrement indisponible. Votre saisie est conservée ; réessayez ou actualisez la base.');
  }
  if(!data?.ok)throw new Error(data?.error?.message??'Opération refusée');
  return data.data;
}
export function CommercialPreparationWorkspace({caseId,isLocked=false,onVersionCreated,refreshToken}:{caseId:string;isLocked?:boolean;onVersionCreated:()=>void;refreshToken?:number}) {
  return <CommercialWorkspace key={caseId} caseId={caseId} isLocked={isLocked} onVersionCreated={onVersionCreated} refreshToken={refreshToken}/>;
}
function CommercialWorkspace({caseId,isLocked,onVersionCreated,refreshToken}:{caseId:string;isLocked:boolean;onVersionCreated:()=>void;refreshToken?:number}) {
  const [state,setState]=useState<State|null>(null),[draft,setDraft]=useState<CommercialPreparation|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [epoch,setEpoch]=useState(0);
  const request=useRef<Record<string,unknown>|null>(null),mounted=useRef(true);
  const readGeneration=useRef(0),busyRef=useRef(false);
  const {user}=useAuth(),queryClient=useQueryClient();
  const navigation=useContext(UNSAFE_NavigationContext);
  const dirty=!!draft&&!!state&&draft.revision>state.draft.revision;
  const changed=useCallback((next:CommercialPreparation)=>{setDraft(next);request.current=null;if(state)pendingByCase.set(caseId,{state,draft:next,request:null});},[caseId,state]);
  useEffect(()=>{
    mounted.current=true;
    const generation=++readGeneration.current;
    let cancelled=false;
    const pending=pendingByCase.get(caseId);
    if(pending){setState(pending.state);setDraft(pending.draft);request.current=pending.request;setNotice('Vos décisions non enregistrées ont été conservées.');}
    else invoke('manage-commercial-preparation',{action:'read',case_id:caseId}).then(value=>{if(!cancelled&&mounted.current&&generation===readGeneration.current){setState(value);setDraft(value?.draft??null);}}).catch(e=>{if(!cancelled&&mounted.current&&generation===readGeneration.current)setError(e.message);});
    return()=>{cancelled=true;mounted.current=false;};
  },[caseId,refreshToken]);
  useEffect(()=>{
    if(!dirty||!navigation)return;
    const nav=navigation.navigator, push=nav.push,replace=nav.replace,go=nav.go;
    const accept=()=>window.confirm('Des décisions ne sont pas enregistrées. Elles resteront disponibles pendant cette session. Quitter ce dossier ?');
    const wrappedPush:typeof push=(...args)=>{if(accept())push.apply(nav,args);};
    const wrappedReplace:typeof replace=(...args)=>{if(accept())replace.apply(nav,args);};
    const wrappedGo:typeof go=(...args)=>{if(accept())go.apply(nav,args);};
    nav.push=wrappedPush;nav.replace=wrappedReplace;nav.go=wrappedGo;
    return()=>{if(nav.push===wrappedPush)nav.push=push;if(nav.replace===wrappedReplace)nav.replace=replace;if(nav.go===wrappedGo)nav.go=go;};
  },[dirty,navigation]);
  async function save() {
    if(!state||!draft||!dirty||busyRef.current)return;
    busyRef.current=true;const generation=++readGeneration.current;
    setBusy(true);setError('');setNotice('');
    request.current??={action:'save',case_id:caseId,source_version_id:state.source_version_id,parent_id:state.head_id,source_hash:state.source_hash,context_hash:state.context_hash,
      operation_id:crypto.randomUUID(),operations:draft.events.filter(e=>e.revision>state.draft.revision).map(e=>({operation_id:e.operation_id,action:e.action}))};
    pendingByCase.set(caseId,{state,draft,request:request.current});
    try {
      const saved=await invoke('manage-commercial-preparation',request.current);
      const reread=await invoke('manage-commercial-preparation',{action:'read',case_id:caseId});
      if(reread?.head_id!==saved.id)throw new Error('Votre révision est enregistrée, mais une révision plus récente existe. Conservez vos décisions puis actualisez la base.');
      if(!mounted.current||generation!==readGeneration.current)return;
      pendingByCase.delete(caseId);
      if(mounted.current){setState(reread);setDraft(reread.draft);setEpoch(n=>n+1);request.current=null;setNotice('Décisions enregistrées et relues depuis le serveur. Créez une nouvelle version pour les reprendre dans le devis.');}
    }catch(e){if(mounted.current)setError((e as Error).message);}
    finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  }
  async function version() {
    if(!state?.head_id||dirty||busyRef.current)return;
    busyRef.current=true;
    setBusy(true);setError('');
    try {
      const result=await invoke('generate-quotation-version',{case_id:caseId,commercial_revision_id:state.head_id});
      await Promise.all([queryClient.invalidateQueries({queryKey:['quotation-versions',caseId]}),queryClient.invalidateQueries({queryKey:['send-quotation-data',caseId]}),queryClient.invalidateQueries({queryKey:['case-timeline',caseId]})]);
      if(mounted.current){onVersionCreated();setNotice(`Version v${result.version_number} ${result.idempotent?'déjà enregistrée':'créée'}. Son PDF reprend ces décisions ; les anciennes versions sont conservées.`);}
    }catch(e){if(mounted.current)setError((e as Error).message);}
    finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  }
  async function reload() {
    if(busyRef.current)return;
    if(dirty&&!window.confirm('Abandonner explicitement les décisions non enregistrées et relire la base serveur ?'))return;
    busyRef.current=true;const generation=++readGeneration.current;
    setBusy(true);setError('');
    try{const value=await invoke('manage-commercial-preparation',{action:'read',case_id:caseId});if(mounted.current&&generation===readGeneration.current){pendingByCase.delete(caseId);request.current=null;setState(value);setDraft(value?.draft??null);setEpoch(n=>n+1);setNotice('Base serveur actualisée.');}}
    catch(e){if(mounted.current&&generation===readGeneration.current)setError((e as Error).message);}finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  }
  const versionMutation=useMutation({mutationKey:['select-quotation-version',caseId],mutationFn:version,
    onSettled:()=>Promise.all([queryClient.invalidateQueries({queryKey:['quotation-versions',caseId]}),queryClient.invalidateQueries({queryKey:['send-quotation-data',caseId]})])});
  const locked=isLocked||!state?.can_write||!['PRICED_DRAFT','HUMAN_REVIEW','QUOTED_VERSIONED'].includes(state?.case_status??'');
  return <section className="mt-4 space-y-3" aria-label="Préparation commerciale enregistrée">
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
    {state?.available&&draft?<>
      <CommercialPreparationPanel key={`${state.source_version_id}:${epoch}:${state.head_id}`} initial={draft} actorId={user?.id??'opérateur'} airState={state.air} isLocked={locked||busy||request.current!==null} persistedRevision={state.draft.revision} onDraftChanged={changed}/>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={locked||busy||!dirty} onClick={save}>{busy?'Opération en cours…':'Enregistrer les décisions'}</Button>
        <Button type="button" variant="outline" disabled={locked||busy||dirty||!state.head_id} onClick={()=>versionMutation.mutate()}>Créer la version avec ces décisions</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={reload}>Relire la base serveur</Button></div>
      <p className="text-xs text-muted-foreground">{dirty?'Décisions non enregistrées.':state.head_id?'Révision commerciale enregistrée.':'Aucune décision commerciale enregistrée.'} Les achats et justificatifs restent internes. Aucun devis n’est envoyé par ces actions.</p>
    </>:<p className="text-sm text-muted-foreground">{state?'Créez et sélectionnez d’abord une version source mono-lot depuis le calcul.':'Chargement de la préparation commerciale…'}</p>}
    {!state&&<Button type="button" variant="outline" disabled={busy} onClick={reload}>Réessayer la lecture</Button>}
  </section>;
}
