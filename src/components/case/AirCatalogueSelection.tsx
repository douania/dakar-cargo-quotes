import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { readAirCatalogues, readAirCase, previewAir } from '@/lib/airHandlingApi';
import type { AirTariffBasis } from '../../../supabase/functions/_shared/air-tariff';
import type { AirResolution } from '../../../supabase/functions/_shared/air-handling';
import { AirHandlingResult } from './AirHandlingPanel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function AirCatalogueSelection({caseId,isLocked}:{caseId:string;isLocked:boolean}) {
  const state=useQuery({queryKey:['air-handling-case',caseId],queryFn:()=>readAirCase(caseId),retry:false});
  const catalogs=useQuery({queryKey:['air-tariff-catalogues'],queryFn:readAirCatalogues,retry:false}),qc=useQueryClient();
  const [catalogId,setCatalogId]=useState(''),[general,setGeneral]=useState(false),[warehouse,setWarehouse]=useState(false),[enabled,setEnabled]=useState(false);
  const [tariffKey,setTariffKey]=useState('storage_0'),[factId,setFactId]=useState(''),[days,setDays]=useState(''),[status,setStatus]=useState<'confirmed'|'assumed'|'unknown'>('unknown');
  const [source,setSource]=useState(''),[storageSource,setStorageSource]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [result,setResult]=useState<AirResolution|null>(null);
  const op=useRef<string|null>(null),lock=useRef(false),mounted=useRef(true),generation=useRef(0),errorRef=useRef<HTMLParagraphElement>(null);
  const activeCase=useRef(caseId);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{activeCase.current=caseId;generation.current++;op.current=null;setCatalogId('');setGeneral(false);setWarehouse(false);setEnabled(false);setFactId('');setDays('');setStatus('unknown');setSource('');setStorageSource('');setError('');setResult(null);},[caseId]);
  useEffect(()=>{generation.current++;setResult(null);},[state.data?.selection?.id,state.data?.context_hash]);
  const changed=()=>{op.current=null;generation.current++;setResult(null);setError('');};
  const catalogue=catalogs.data?.catalogues.find(c=>c.id===catalogId);
  const weights=state.data?.facts.filter(f=>f.id && ['cargo.weight_kg','cargo.weight_net_kg','cargo.chargeable_weight_kg'].includes(f.fact_key))??[];
  async function save() {
    if(lock.current||isLocked||!state.data)return;
    if(!catalogue||!general||source.trim().length<10 || (days.trim() && (!Number.isFinite(Number(days))||Number(days)<0))) {
      setError('Choisissez un catalogue, confirmez la nature et fournissez une justification. Les jours doivent être positifs ou zéro explicitement confirmé.');queueMicrotask(()=>errorRef.current?.focus());return;
    }
    const basis:AirTariffBasis={general_cargo_confirmed:general,warehouse_bracket_confirmed:warehouse,ordinary_storage:{enabled,tariff_key:tariffKey,weight_fact_id:factId||null,billable_days:days.trim()?Number(days):null,days_status:status,source_reference:storageSource.trim()}};
    lock.current=true;setPending(true);setError('');op.current??=crypto.randomUUID();const operationId=op.current,submittedCase=caseId;
    try {
      const {error:writeError}=await supabase.rpc('air_tariff_select',{p_id:op.current,p_case_id:caseId,p_expected_id:state.data.selection?.id??null,p_catalogue_id:catalogue.id,p_basis:basis,p_source_reference:source.trim(),p_context_hash:state.data.context_hash});
      const verified=await readAirCase(caseId);
      if(verified.selection?.id!==operationId || (writeError && verified.catalogue?.id!==catalogue.id))throw new Error('Association unconfirmed');
      if(!mounted.current || activeCase.current!==submittedCase)return;
      qc.setQueryData(['air-handling-case',caseId],verified);op.current=null;toast.success('Catalogue et bases associés pour les prochains calculs. Les anciens devis sont conservés.');
    } catch {if(mounted.current && activeCase.current===submittedCase){setError('Association non confirmée. Actualisez les données avant de réessayer ; votre saisie est conservée.');queueMicrotask(()=>errorRef.current?.focus());}}
    finally {lock.current=false;if(mounted.current)setPending(false);}
  }
  async function preview() {
    if(lock.current)return;lock.current=true;setPending(true);setError('');const token=++generation.current;
    try {const r=await previewAir({case_id:caseId});if(mounted.current && token===generation.current)setResult(r);}
    catch {if(mounted.current && token===generation.current)setError('Simulation indisponible. Actualisez les données et reconfirmez la sélection si nécessaire.');}
    finally {lock.current=false;if(mounted.current)setPending(false);}
  }
  return <section aria-label="Catalogue complet et magasinage" className="space-y-4 rounded-md border p-4">
    <h3 className="font-semibold">Catalogue complet et magasinage ordinaire</h3>
    <p className="text-sm">Les forfaits sont calculés seulement si leur nature et leurs conditions sont justifiées. La collecte et la sécurité restent à confirmer : la grille ne précise pas leur base de poids brut ou taxable. Pour le magasinage, choisissez séparément le poids et les jours justifiés ; aucune franchise ni règle d'arrondi n'est présumée.</p>
    {catalogs.isLoading && <p role="status">Chargement des catalogues.</p>}
    {state.isError && <Alert variant="destructive"><AlertDescription>Bases du dossier indisponibles. Actualisez catalogue et bases pour réessayer ; aucune association n’est possible avant une lecture confirmée.</AlertDescription></Alert>}
    {catalogs.isError && <Alert variant="destructive"><AlertDescription>Catalogue indisponible. <Button variant="outline" onClick={()=>void catalogs.refetch()}>Réessayer les catalogues</Button></AlertDescription></Alert>}
    {state.data?.catalogue && <p>Catalogue associé : révision {state.data.catalogue.revision}. Base de magasinage : {state.data.basis?.ordinary_storage.days_status==='confirmed'?'jours confirmés':state.data.basis?.ordinary_storage.days_status==='assumed'?'durée hypothétique':'à confirmer'}.</p>}
    {state.data?.catalogue && <p className="break-words text-sm">Justification enregistrée : {state.data.basis?.ordinary_storage.source_reference || state.data.selection?.source_reference}</p>}
    {catalogs.data?.catalogues.length===0 && <p>Aucun catalogue complet disponible.</p>}
    {state.data && !!catalogs.data?.catalogues.length && <form noValidate onSubmit={e=>{e.preventDefault();void save();}} className="space-y-3">
      <fieldset disabled={pending||isLocked} className="space-y-3"><legend className="sr-only">Catalogue et bases du dossier</legend>
        <Label htmlFor={`full-air-catalogue-${caseId}`}>Catalogue à associer</Label><Select value={catalogId} onValueChange={v=>{changed();setCatalogId(v);}}><SelectTrigger id={`full-air-catalogue-${caseId}`}><SelectValue placeholder="Choisir explicitement un catalogue"/></SelectTrigger><SelectContent>{catalogs.data.catalogues.map(c=><SelectItem key={c.id} value={c.id}>2AS — révision {c.revision} — {c.effective_from}</SelectItem>)}</SelectContent></Select>
        <div className="flex items-start gap-2"><Checkbox id={`full-air-general-${caseId}`} checked={general} onCheckedChange={v=>{changed();setGeneral(v===true);}}/><Label htmlFor={`full-air-general-${caseId}`}>La pièce confirme 2AS, DSS et la nature general cargo de ce dossier.</Label></div>
        <div className="flex items-start gap-2"><Checkbox id={`full-air-dms-${caseId}`} checked={warehouse} onCheckedChange={v=>{changed();setWarehouse(v===true);}}/><Label htmlFor={`full-air-dms-${caseId}`}>Éligibilité de la taxe fixe magasin DMS de la colonne initiale attestée séparément.</Label></div>
        <Label htmlFor={`full-air-source-${caseId}`}>Justification du choix de catalogue et de la nature</Label><Textarea className="resize-none" id={`full-air-source-${caseId}`} value={source} maxLength={2000} onChange={e=>{changed();setSource(e.target.value);}}/>
        <div className="flex items-start gap-2"><Checkbox id={`full-air-storage-${caseId}`} checked={enabled} onCheckedChange={v=>{changed();setEnabled(v===true);}}/><Label htmlFor={`full-air-storage-${caseId}`}>Renseigner le magasinage ordinaire pour ce dossier</Label></div>
        {enabled && <>
          <Label htmlFor={`full-air-storage-rate-${caseId}`}>Colonne de magasinage documentée</Label><Select value={tariffKey} onValueChange={v=>{changed();setTariffKey(v);}}><SelectTrigger id={`full-air-storage-rate-${caseId}`}><SelectValue/></SelectTrigger><SelectContent>{catalogue?.payload.entries.filter(e=>/^storage_[0-3]$/.test(e.key)).map(e=><SelectItem key={e.key} value={e.key}>{e.value??'À confirmer'} {e.unit} — {e.condition}</SelectItem>)}</SelectContent></Select>
          <Label htmlFor={`full-air-weight-${caseId}`}>Fait de poids servant de base au magasinage</Label><Select value={factId} onValueChange={v=>{changed();setFactId(v);}}><SelectTrigger id={`full-air-weight-${caseId}`}><SelectValue placeholder="Choisir la base de poids justifiée"/></SelectTrigger><SelectContent>{weights.map(f=><SelectItem key={f.id} value={f.id!}>{f.fact_key==='cargo.weight_kg'?'Poids brut':f.fact_key==='cargo.weight_net_kg'?'Poids net':'Poids taxable'} — {f.value_number??'À confirmer'} kg</SelectItem>)}</SelectContent></Select>
          {!weights.length && <p className="text-sm">Aucun fait de poids disponible. Le montant restera à confirmer.</p>}
          <Label htmlFor={`full-air-days-${caseId}`}>Nombre de jours facturables (après franchise seulement si justifiée)</Label><Input id={`full-air-days-${caseId}`} inputMode="decimal" className="max-w-xs" value={days} onChange={e=>{changed();setDays(e.target.value);}}/>
          <Label htmlFor={`full-air-days-status-${caseId}`}>Qualification des jours</Label><Select value={status} onValueChange={v=>{changed();setStatus(v as typeof status);}}><SelectTrigger id={`full-air-days-status-${caseId}`}><SelectValue/></SelectTrigger><SelectContent><SelectItem value="unknown">À confirmer</SelectItem><SelectItem value="confirmed">Confirmés par la pièce citée</SelectItem><SelectItem value="assumed">Hypothèse explicite — estimation séparée</SelectItem></SelectContent></Select>
          <Label htmlFor={`full-air-storage-source-${caseId}`}>Source du poids choisi, du tarif applicable et des jours facturables</Label><Textarea id={`full-air-storage-source-${caseId}`} className="resize-none" maxLength={2000} value={storageSource} onChange={e=>{changed();setStorageSource(e.target.value);}}/>
        </>}
        <Button type="submit">Associer le catalogue et les bases</Button>
      </fieldset>
    </form>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending||!state.data?.catalogue} onClick={()=>void preview()}>Simuler le catalogue associé</Button><Button variant="outline" disabled={pending} onClick={()=>{void state.refetch();void catalogs.refetch();}}>Actualiser catalogue et bases</Button></div>
    <p ref={errorRef} tabIndex={-1} role={error?'alert':undefined} className="text-sm text-destructive">{error}</p>
    {result && <AirHandlingResult result={result}/>}
  </section>;
}
