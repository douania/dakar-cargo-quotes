/** Explicit local candidate only. Not imported by App or an active route. */
import React, {useEffect,useMemo,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import Intake from './Intake';
import type {IntakeUploadPort} from '@/services/railwayReplacement/recoveryUpload';
import {Button} from '@/components/ui/button';
import {Alert,AlertDescription} from '@/components/ui/alert';
import {createRecoverySession,type IntakeReference} from '@/services/railwayReplacement/recoverySession';
import type {RecoveryGateway} from '@/services/railwayReplacement/recoveryClient';
import type {RecoveryOperation} from '@/services/railwayReplacement/recoveryContract';
import {validateDurableIntakeReceipt} from '@/services/railwayReplacement/durableIntake';
import type {IntakeResponse} from '@/services/railwayApi';
export default function IntakeRecoveryCandidate(props:{actor:string|null;gateway:RecoveryGateway;randomUUID:()=>string;storage?:IntakeUploadPort}){
 const location=useLocation(),navigate=useNavigate();
 const routeId=new URLSearchParams(location.search).get('intake_operation');
 const active=useRef({id:routeId,generation:0});
 // Our own synchronous reference write precedes navigate. Any different route
 // reference is external navigation and replaces the entire sensitive boundary.
 if(active.current.id!==routeId)active.current={id:routeId,generation:active.current.generation+1};
 const reference=useMemo<IntakeReference>(()=>({read:()=>active.current.id,write(id){active.current.id=id;const params=new URLSearchParams(location.search);if(id===null)params.delete('intake_operation');else params.set('intake_operation',id);navigate({pathname:location.pathname,search:params.toString()},{replace:true});}}),[location.pathname,location.search,navigate]);
 return <ActorCandidate key={`${props.actor??'signed-out'}:${active.current.generation}`} {...props} reference={reference}/>;
}
function ActorCandidate({actor,gateway,randomUUID,reference,storage}:{actor:string|null;gateway:RecoveryGateway;randomUUID:()=>string;reference:IntakeReference;storage?:IntakeUploadPort}){
 // Preserve the in-flight gateway and allocator for this actor/navigation boundary.
 // Recreated props cannot mint a second operation. External navigation remounts.
 const currentReference=useRef(reference);currentReference.current=reference;
 const [session]=useState(()=>createRecoverySession(gateway,{read:()=>currentReference.current.read(),write:id=>currentReference.current.write(id)},randomUUID,storage));
 const [,refresh]=useState(0);
 const candidate=useMemo(()=>({...session,async submit(form:Parameters<typeof session.submit>[0]){setBusy(true);try{return await session.submit(form);}finally{setBusy(false);refresh(n=>n+1);}}}),[session]);
 const [ready,setReady]=useState(!session.operationId()),[saved,setSaved]=useState<RecoveryOperation|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>()=>session.clearSensitive(),[session]);
 if(!actor)return <Alert><AlertDescription>Connectez-vous pour reprendre votre demande.</AlertDescription></Alert>;
 async function restore(){setBusy(true);setError('');try{const op=await session.restore();
  if(op.state==='abandoned')throw new Error('Demande abandonnée ; commencez explicitement une nouvelle demande.');
  setSaved(op);setReady(true);
 }catch{setReady(false);setSaved(null);setError('Reprise non confirmée. Gardez cette référence et vérifiez la session d’origine ; aucun nouveau dossier ne sera créé automatiquement.');}finally{setBusy(false);}}
 if(!ready)return <div className="container mx-auto max-w-4xl px-4 py-8 space-y-4"><p>Une demande existe sur cette adresse. Reprenez-la pour retrouver les informations enregistrées.</p><Button disabled={busy} onClick={restore}>{busy?'Vérification…':'Reprendre ma demande'}</Button>{error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}</div>;
 const current=session.current();
 const uncertain=current&&Object.values(current.steps).some(step=>step?.state==='unknown'||step?.state==='running');
 const result=saved?.state==='committed'&&saved.prepared&&(!saved.draft.file||saved.document_receipt)?validateDurableIntakeReceipt(saved.prepared.command,saved.receipt) as unknown as IntakeResponse:undefined;
 return <>{error&&<Alert><AlertDescription>{error}</AlertDescription></Alert>}{uncertain&&<Alert><AlertDescription>Une étape documentaire reste non confirmée. La reprise consulte son état ; aucun traitement ne sera relancé automatiquement.</AlertDescription></Alert>}{current?.state==='committed'&&current.draft.file&&!current.document_receipt&&<Alert><AlertDescription>Dossier enregistré ; rattachement du document non confirmé. Relancez la même demande pour vérifier ce seul rattachement, sans créer un autre dossier.</AlertDescription></Alert>}<div className="container mx-auto max-w-4xl px-4 pt-4"><Button variant="outline" disabled={busy||!session.operationId()} onClick={restore}>Vérifier la demande enregistrée</Button></div><Intake key={`${saved?.operation_id??'new'}:${saved?.revision??0}:${saved?.state??'new'}`} manualCandidate={candidate} restoredForm={saved?.draft.form} restoredResult={result} documentCandidate={{file:current?.draft.file??null,busy,locked:session.isLocked(),linked:Boolean(current?.document_receipt),warning:current?.steps.extraction?.output?.case_text_status==='legacy_prefix_invalid_utf16'?'Le texte intégral est conservé, mais sa projection dans le dossier reste à vérifier (limite Unicode).':'',async analyze(file,form,prefill){setBusy(true);try{return await session.document(form,file,prefill);}finally{setBusy(false);refresh(n=>n+1);}},interrupt(){session.clearSensitive();setSaved(null);setReady(!session.operationId());setError(session.operationId()?'Préparation interrompue côté écran. Une étape lancée peut avoir abouti ; reprenez cette même demande pour vérifier son état.':'Préparation interrompue avant enregistrement. Vous pouvez recommencer explicitement après la fin de la vérification.');}}}/></>;
}
