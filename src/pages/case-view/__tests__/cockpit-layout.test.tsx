import React, { useEffect, useImperativeHandle, useState } from 'react';
import { createPortal } from 'react-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';
import type { CockpitState } from '@/hooks/useCockpitState';
import type { QuotationPreparationSummary } from '@/components/puzzle/SendQuotationPanel';
import { CASE_PRESENTATION_KEY } from '../presentation';
import userEvent from '@testing-library/user-event';
import type { SelectedScenarioEstimate } from '@/components/case/ScenarioEstimateResult';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sourceRevisionHistory, type CaseSourceChanges } from '@/lib/caseSourceChanges';

// Exercise the actual CaseView composition + pricing/result components.
// Unrelated panels and I/O are test doubles; no network or customer data.
const empty: never[] = [];
const invoke = vi.fn(), estimateAction = vi.fn(), cargoAction = vi.fn(), from = vi.fn();
let caseId = 'case-a', status = 'PRICED_DRAFT', hasSelection = true, totalPartnerRequests = 0, closedPartnerRequests = 0;
let cockpitOverrides: Partial<CockpitState> = {}, cockpitError: Error | null = null, cockpitFetching = false;
let versionMounts = 0;
let panelMounts: Record<string, number> = {};
let preparationFixture: QuotationPreparationSummary | null = null;
const run: NonNullable<SelectedScenarioEstimate['run']> = { id:'r', scenario_id:'s', run_seq:1, status:'success', qualification:'partial',
  firm_total_ht:0,firm_total_ttc:0,assumptions_snapshot:[],
  completed_at:'2026-09-15T12:00:00Z', currency:'XOF', indicative_total_ht:1000, indicative_total_ttc:1180,
  tariff_lines:[{id:'pad',category:'PAD_DROIT_PASSAGE',amount:null,notes:'Catégorie à choisir',source:{type:'TO_CONFIRM'}}],
  reservations:['SCENARIO_DG_UNKNOWN'],blockers:[] };
const initialGaps = [{id:'g',gap_key:'cargo.pad_category',status:'open',is_blocking:true,question_fr:'Catégorie PAD à préciser'}];
let gaps = initialGaps;
type FactFixture = {id:string;fact_key:string;value_text?:string;value_number?:number;value_json?:unknown;is_current:boolean;fact_category?:string;source_type?:string;confidence?:number;is_validated?:boolean};
const initialFacts: FactFixture[] = [{id:'f',fact_key:'service.package',value_text:'DAP',is_current:true}];
let facts = initialFacts, requestType = 'SEA_FCL_IMPORT';
let lotCount: number | null = 0;
let readPending: string | null = null, readFailed: string | null = null;
let threadId: string | null = null, sourceEmailCount: number | null = 0, documentCount: number | null = 0;
type EventFixture = {event_type:string;created_at:string;actor_type:string;event_data:Record<string,unknown>};
let timeline: EventFixture[] = [];
let showSourceResolution = false;
let sourceChanges: CaseSourceChanges = {sources:[],runs:[],revisions:[]};
vi.doMock('react-router-dom',()=>({useParams:()=>({caseId}),useNavigate:()=>vi.fn()}));
vi.doMock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke},from}}));
vi.doMock('@tanstack/react-query',async()=>({
  ...await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query'),
  useQuery:({queryKey}:{queryKey:string[]})=>({isLoading:queryKey[0]===readPending,error:queryKey[0]===readFailed?new Error('Read refused'):queryKey[0]==='cockpit-state'?cockpitError:null,isFetching:queryKey[0]===readPending||(queryKey[0]==='cockpit-state'&&cockpitFetching),refetch:vi.fn(),
    data: queryKey[0]==='case-view' ? {id:caseId,status,thread_id:threadId,request_type:requestType,puzzle_completeness:70}
      : queryKey[0]==='case-facts' ? facts : queryKey[0]==='case-gaps' ? gaps
      : queryKey[0]==='case-source-changes' ? sourceChanges
      : queryKey[0]==='case-timeline' ? timeline : queryKey[0]==='quote-request-lines-count' ? lotCount
      : queryKey[0]==='case-source-emails-count' ? sourceEmailCount : queryKey[0]==='case-documents-count' ? documentCount
      : queryKey[0]==='cockpit-state' ? {status,totalPartnerRequests,closedPartnerRequests,blockingGapsCount:0,padReviewCount:0,...cockpitOverrides}
      : queryKey[0].includes('count') || queryKey[0]==='pricing-provisional-check' ? 0
      : queryKey[0]==='pricing-run-recovery' ? null : empty}),
}));
const source = readFileSync(resolve('src/pages/CaseView.tsx'),'utf8');
for (const match of source.matchAll(/import (.+) from "(@\/components\/(?:case|puzzle|layout)\/[^"]+)";/g)) {
  const [, imported, path] = match;
  if(path.endsWith('/CaseSourceChangesNotice')) {
    vi.doMock(path,async()=>{const actual=await vi.importActual<typeof import('@/components/case/CaseSourceChangesNotice')>(path);
      return {...actual,CaseSourceChangesNotice:(props:Parameters<typeof actual.CaseSourceChangesNotice>[0])=>showSourceResolution?<actual.CaseSourceChangesNotice {...props}/>:null};});continue;
  }
  if(path.endsWith('/CaseFactsTable')) {
    vi.doMock(path,async()=>{const actual=await vi.importActual<typeof import('@/components/case/CaseFactsTable')>(path);
      return {...actual,CaseFactsTable:(props:Parameters<typeof actual.CaseFactsTable>[0])=>showSourceResolution?<actual.CaseFactsTable {...props}/>:null};});continue;
  }
  if(path.endsWith('/CaseDocumentAnalysisNotice')) {
    vi.doMock(path,async()=>({...await vi.importActual<Record<string,unknown>>(path),CaseDocumentAnalysisNotice:()=>null}));continue;
  }
  if (path.endsWith('/ScenarioEstimateResult') || path.endsWith('/PricingLaunchPanel') || path.endsWith('/CaseTodoCard')) continue;
  const names=imported.startsWith('{') ? imported.replace(/[{}]/g,'').split(',').map(s=>s.trim()).filter(s=>!s.startsWith('type ')) : ['default'];
  vi.doMock(path,()=>Object.fromEntries(names.map(name=>[name, path.endsWith('/MainLayout')
    ? ({children}:{children:React.ReactNode})=><main>{children}</main>
    : path.endsWith('/QuoteScenariosPanel') ? function ScenarioDouble(props: {caseId:string;onSelectedEstimateChange:(value:SelectedScenarioEstimate|null)=>void;actionRef:React.Ref<{estimateSelected:()=>void}>}) {
      const {caseId:fixtureCaseId,onSelectedEstimateChange,actionRef}=props;
      useEffect(()=>{onSelectedEstimateChange(hasSelection ? {caseId:fixtureCaseId,title:'Scénario test',run,pending:false,error:null}:null);},[fixtureCaseId,onSelectedEstimateChange]);
      useImperativeHandle(actionRef,()=>({estimateSelected:estimateAction}));
      const [draft, setDraft] = useState('');
      return <><p>Groupes de test à vérifier</p><label>Note variante non enregistrée<input value={draft} onChange={e => setDraft(e.target.value)} /></label></>;
    } : path.endsWith('/QuotationVersionCard') ? function VersionDouble() {
      const [draft,setDraft]=useState('');useEffect(()=>{versionMounts++;},[]);
      return <label>Brouillon de test<input value={draft} onChange={e=>setDraft(e.target.value)} /></label>;
    } : path.endsWith('/SendQuotationPanel') ? function SendDouble({onPreparationChange}:{onPreparationChange:(summary:QuotationPreparationSummary)=>void}) {
      const fixture=preparationFixture;
      useEffect(()=>{if(fixture) onPreparationChange(fixture);},[onPreparationChange,fixture]);
      return <p>Panneau envoi de test</p>;
    } : path.endsWith('/PadGroupConfirmationsPanel') ? function PadDouble({onChanged,onEstimateReview}:{onChanged:()=>void;onEstimateReview:()=>void}) {
      const [value,setValue]=useState('');useEffect(()=>{panelMounts.pad=(panelMounts.pad??0)+1;},[]);
      return <><button onClick={onChanged}>Simuler actualisation du dossier</button><button onClick={onEstimateReview}>Modifier les groupes pour l’estimation</button><label>Source PAD de test<input value={value} onChange={e=>setValue(e.target.value)}/></label></>;
    } : path.endsWith('/CargoCanonicalPreviewPanel') ? function CargoDouble({actionPortalId}:{actionPortalId:string}) {
      const [value,setValue]=useState('');const [target,setTarget]=useState<HTMLElement|null>(null);
      useEffect(()=>{panelMounts.cargo=(panelMounts.cargo??0)+1;setTarget(document.getElementById(actionPortalId));},[actionPortalId]);
      return <><label>Source cargo de test<input value={value} onChange={e=>setValue(e.target.value)}/></label>{target&&createPortal(<button onClick={cargoAction}>Action cargo de test</button>,target)}</>;
    }
      : ()=> <p>{path.split('/').pop()}</p>])));
}
const CaseView = (await import('../../CaseView')).default;
let client: QueryClient;
beforeEach(()=>{caseId='case-a';status='PRICED_DRAFT';hasSelection=true;totalPartnerRequests=0;closedPartnerRequests=0;invoke.mockReset();estimateAction.mockReset();
  localStorage.setItem(CASE_PRESENTATION_KEY,'previous');cockpitOverrides={};cockpitError=null;cockpitFetching=false;versionMounts=0;preparationFixture=null;gaps=initialGaps;
  facts=initialFacts;requestType='SEA_FCL_IMPORT';lotCount=0;readPending=null;readFailed=null;timeline=[];
  threadId=null;sourceEmailCount=0;documentCount=0;from.mockReset();
  showSourceResolution=false;sourceChanges={sources:[],runs:[],revisions:[]};
  panelMounts={};client=new QueryClient(); Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();client.clear();localStorage.clear();vi.useRealTimers();vi.restoreAllMocks();});
const mount=()=>render(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
it.each([false,true])('explicit readable source choice preserves exclusions for normal/forced UI, force=%s',async forced=>{
  emptyAnalysisFixture();facts=[{id:'synthetic-articles',is_current:true,fact_key:'cargo.articles_detail',value_json:[]}];documentCount=2;
  const hash='a'.repeat(32),documents=[{id:'bad',name:'photo-synthetique.png',readable:false,text_hash:'b'.repeat(64),source_hash:'c'.repeat(32)},{id:'good',name:'facture.txt',readable:true,text_hash:'d'.repeat(64),source_hash:'e'.repeat(32)}];
  const offer={contract:1,scope:'manual_case_documents',context_hash:hash,documents,readable_email_count:0,latest:null};
  const warning=vi.spyOn(toast,'warning'),success=vi.spyOn(toast,'success');
  invoke.mockImplementation(async(name,options)=>{
    if(name==='backfill-case-documents')return {data:{success:false,extraction_contract:1,extraction:{status:'error',code:'OCR_NOT_CONFIGURED',persisted:false,text_length:0},analysis_offer:offer},error:null};
    if(name==='build-case-puzzle')return {data:{job_id:'document-job'},error:null};
    throw Error('Unexpected '+name);
  });
  mount();await userEvent.click(screen.getByRole('button',{name:forced?'Admin - Forcer refresh articles':"Relancer l'analyse"}));
  expect(invoke).toHaveBeenCalledTimes(1);const choice=screen.getByRole('button',{name:'Analyser les sources lisibles'});expect(choice).toBeEnabled();
  expect(screen.getByText(/photo-synthetique.png.*texte non disponible/)).toBeInTheDocument();expect(success).not.toHaveBeenCalled();
  vi.useFakeTimers();fireEvent.click(choice);await act(async()=>{});
  const start=invoke.mock.calls.find(([name])=>name==='build-case-puzzle')!;
  expect(start[1].body.document_analysis).toEqual({mode:'readable',context_hash:hash});expect(start[1].body.force_articles_detail).toBe(forced?true:undefined);
  invoke.mockResolvedValue({data:{status:'completed',final_result:{case_id:'case-a',new_status:'NEED_INFO',ready_to_price:false,document_analysis:{mode:'readable',state:'partial',context_hash:hash}}},error:null});
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('partielle'));expect(success).not.toHaveBeenCalled();
  expect(invoke.mock.calls.filter(([name])=>name==='backfill-case-documents')).toHaveLength(1);
});
it('zero readable source leaves the explicit partial action disabled',async()=>{
  emptyAnalysisFixture();documentCount=1;
  invoke.mockResolvedValue({data:{success:false,extraction_contract:1,extraction:{status:'empty',code:'DOCUMENT_TEXT_EMPTY',persisted:false,text_length:0},
    analysis_offer:{contract:1,scope:'manual_case_documents',context_hash:'a'.repeat(32),documents:[{id:'bad',name:'scan.png',readable:false,text_hash:'b'.repeat(64),source_hash:'c'.repeat(32)}],readable_email_count:0,latest:null}},error:null});
  mount();await userEvent.click(screen.getByRole('button',{name:"Lancer l'analyse"}));
  expect(screen.getByRole('button',{name:'Analyser les sources lisibles'})).toBeDisabled();expect(invoke).toHaveBeenCalledTimes(1);
});

it.each(['INTAKE','NEW_THREAD','RFQ_DETECTED'].flatMap(fixtureStatus=>[false,true].map(guided=>({fixtureStatus,guided}))))('email-sourced empty analysis is available for $fixtureStatus guided=$guided',({fixtureStatus,guided})=>{
  status=fixtureStatus;facts=[];gaps=[];hasSelection=false;threadId='synthetic-source-thread';sourceEmailCount=3;documentCount=0;
  if(guided)localStorage.removeItem(CASE_PRESENTATION_KEY);mount();
  const action=screen.getByRole('button',{name:"Lancer l'analyse"});expect(action).toBeVisible();expect(action).toBeEnabled();
  expect(screen.getByLabelText('Analyse de la demande')).toHaveTextContent(/3 courriel/);expect(invoke).not.toHaveBeenCalled();
});

function emptyAnalysisFixture() {
  status='RFQ_DETECTED';facts=[];gaps=[];hasSelection=false;threadId='synthetic-source-thread';sourceEmailCount=2;documentCount=0;
}
it('accepts uploaded documents for a manual case but not extracted facts alone',()=>{
  emptyAnalysisFixture();threadId=null;documentCount=1;const {rerender}=mount();
  expect(screen.getByRole('button',{name:"Lancer l'analyse"})).toBeEnabled();
  documentCount=0;facts=initialFacts;rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(screen.getByRole('button',{name:"Relancer l'analyse"})).toBeDisabled();
  expect(screen.getByLabelText('Analyse de la demande')).toHaveTextContent(/Ajoutez un document/);expect(invoke).not.toHaveBeenCalled();
});
it('does not substitute documents or facts for missing thread emails',()=>{
  emptyAnalysisFixture();sourceEmailCount=0;documentCount=2;facts=initialFacts;mount();
  expect(screen.getByRole('button',{name:"Relancer l'analyse"})).toBeDisabled();
  expect(screen.getByLabelText('Analyse de la demande')).toHaveTextContent(/Aucun courriel trouvé/);expect(invoke).not.toHaveBeenCalled();
});
it.each(['case-source-emails-count','case-documents-count'])('fails closed for pending or failed %s with cached sources',key=>{
  emptyAnalysisFixture();if(key==='case-documents-count'){threadId=null;documentCount=1;}
  readPending=key;const {rerender}=mount();
  expect(screen.getByRole('button',{name:"Lancer l'analyse"})).toBeDisabled();
  expect(screen.getByLabelText('Analyse de la demande')).toHaveTextContent(/Vérification des sources de la demande/);
  readPending=null;readFailed=key;rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(screen.getByRole('button',{name:"Lancer l'analyse"})).toBeDisabled();
  expect(screen.getByLabelText('Analyse de la demande')).toHaveTextContent(/Vérification des sources impossible/);expect(invoke).not.toHaveBeenCalled();
});
it.each([false,true])('does not launch for unknown source counts, manual=%s',manual=>{
  emptyAnalysisFixture();if(manual){threadId=null;documentCount=null;}else sourceEmailCount=null;
  mount();expect(screen.getByRole('button',{name:"Lancer l'analyse"})).toBeDisabled();expect(invoke).not.toHaveBeenCalled();
});
it('rechecks both source counts when refreshing sources',async()=>{
  emptyAnalysisFixture();sourceEmailCount=0;const invalidate=vi.spyOn(client,'invalidateQueries');mount();
  await userEvent.click(screen.getByRole('button',{name:'Actualiser les sources'}));
  expect(invalidate).toHaveBeenCalledWith({queryKey:['case-documents-count','case-a']});
  expect(invalidate).toHaveBeenCalledWith({queryKey:['case-source-emails-count','case-a']});expect(invoke).not.toHaveBeenCalled();
});
it.each(['PRICED_DRAFT','QUOTED_VERSIONED','SENT','ACCEPTED','REJECTED','ARCHIVED','PRICING_RUNNING'])('does not reopen analysis for %s',async(locked)=>{
  emptyAnalysisFixture();status=locked;documentCount=1;mount();
  expect(screen.queryByRole('button',{name:/Lancer l'analyse|Relancer l'analyse/})).toBeNull();
  await userEvent.click(screen.getByRole('tab',{name:'Données & audit'}));
  await userEvent.click(screen.getByText(/Sources, faits et historique/));
  expect(screen.queryByRole('button',{name:/Lancer l'analyse|Relancer l'analyse/})).toBeNull();expect(invoke).not.toHaveBeenCalled();
});
it('can launch from empty facts sourced by email without an upload instruction',async()=>{
  emptyAnalysisFixture();mount();await userEvent.click(screen.getByRole('tab',{name:'Données & audit'}));
  await userEvent.click(screen.getByText(/Sources, faits et historique/));
  const factsPanel=screen.getByRole('tabpanel',{name:'Faits (0)'});
  expect(within(factsPanel).getByRole('button',{name:"Lancer l'analyse"})).toBeEnabled();
  expect(factsPanel).toHaveTextContent(/2 courriel/);expect(factsPanel).not.toHaveTextContent(/Ajoutez un document/);expect(invoke).not.toHaveBeenCalled();
});
it('stops at a document preparation error before starting analysis',async()=>{
  emptyAnalysisFixture();const failure=vi.spyOn(toast,'error');
  invoke.mockResolvedValue({data:null,error:new Error('Preparation denied')});mount();
  await userEvent.click(screen.getByRole('button',{name:"Lancer l'analyse"}));
  expect(invoke).toHaveBeenCalledTimes(1);expect(invoke).toHaveBeenCalledWith('backfill-case-documents',{body:{case_id:'case-a',analysis_contract:1}});
  expect(failure).toHaveBeenCalledWith(expect.stringContaining("Le fichier est conservé"));
  expect(screen.getByRole('button',{name:"Lancer l'analyse"})).toBeEnabled();
});
it.each([false,true])('failed/empty extraction never starts normal or forced analysis, force=%s',async forced=>{
  emptyAnalysisFixture();facts=[{id:'synthetic-articles',is_current:true,fact_key:'cargo.articles_detail',value_json:[]}];documentCount=1;
  const success=vi.spyOn(toast,'success');invoke.mockResolvedValue({data:{success:false,status:'error',extraction_contract:1,remaining:1,extraction:{status:'empty',code:'DOCUMENT_TEXT_EMPTY',text_length:0,persisted:false}},error:null});mount();
  await userEvent.click(screen.getByRole('button',{name:forced?'Admin - Forcer refresh articles':"Relancer l'analyse"}));
  expect(invoke.mock.calls.map(([name])=>name)).toEqual(['backfill-case-documents']);expect(screen.getByRole('alert')).toHaveTextContent('Aucun texte lisible');expect(success).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:"Relancer l'analyse"})).toBeEnabled();
});
it('five preparation passes with pending sources cannot start the analysis',async()=>{
  emptyAnalysisFixture();invoke.mockResolvedValue({data:{success:true,status:'ok',extraction_contract:1,remaining:1,processed_id:'doc',text_length:4},error:null});mount();
  await userEvent.click(screen.getByRole('button',{name:"Lancer l'analyse"}));await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(5));
  expect(invoke.mock.calls.every(([name])=>name==='backfill-case-documents')).toBe(true);expect(screen.getByRole('alert')).toHaveTextContent('restent à préparer');
});
it.each(['failed','cancelled'])('ends a %s analysis job immediately and preserves the failure',async(jobStatus)=>{
  emptyAnalysisFixture();vi.useFakeTimers();const failure=vi.spyOn(toast,'error'),success=vi.spyOn(toast,'success');
  invoke.mockResolvedValueOnce({data:{success:true,status:"ok",extraction_contract:1,remaining:0},error:null})
    .mockResolvedValueOnce({data:{job_id:'synthetic-job'},error:null})
    .mockResolvedValue({data:{status:jobStatus,error_message:'Source analysis rejected'},error:null});
  mount();fireEvent.click(screen.getByRole('button',{name:"Lancer l'analyse"}));
  await act(async()=>{});
  expect(screen.getByRole('button',{name:'Analyse en cours…'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Analyse en cours…'}));expect(invoke).toHaveBeenCalledTimes(2);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
  expect(failure).toHaveBeenCalledWith("Erreur lors de l'analyse : "+(jobStatus==='failed'?'Source analysis rejected':'Job cancelled'));
  expect(success).not.toHaveBeenCalled();expect(invoke).toHaveBeenCalledTimes(3);
  expect(screen.getByRole('button',{name:"Lancer l'analyse"})).toBeEnabled();
  await act(async()=>{await vi.advanceTimersByTimeAsync(300_000);});expect(invoke).toHaveBeenCalledTimes(3);
});
it('retains transport retries and runs post-analysis work only after completion',async()=>{
  emptyAnalysisFixture();vi.useFakeTimers();const success=vi.spyOn(toast,'success'),failure=vi.spyOn(toast,'error');
  const read={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:null,error:null})};
  from.mockReturnValue(read);
  invoke.mockResolvedValueOnce({data:{success:true,status:"ok",extraction_contract:1,remaining:0},error:null})
    .mockResolvedValueOnce({data:{job_id:'synthetic-job'},error:null})
    .mockRejectedValueOnce(new Error('Temporary transport failure'))
    .mockResolvedValueOnce({data:{status:'completed',final_result:{}},error:null})
    .mockResolvedValue({data:{ok:true},error:null});
  mount();fireEvent.click(screen.getByRole('button',{name:"Lancer l'analyse"}));await act(async()=>{});
  expect(invoke.mock.calls.map(([name])=>name)).toEqual(['backfill-case-documents','build-case-puzzle']);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(invoke).toHaveBeenCalledTimes(3);expect(success).not.toHaveBeenCalled();
  await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
  expect(invoke.mock.calls.map(([name])=>name)).toEqual(['backfill-case-documents','build-case-puzzle','build-case-puzzle','build-case-puzzle','sync-gap-client-actions','analyze-case-coherence']);
  expect(invoke.mock.calls[1][1]).toEqual({body:{case_id:'case-a',mode:'start'}});
  expect(invoke.mock.calls[2][1]).toEqual({body:{job_id:'synthetic-job',mode:'poll'}});
  expect(success).toHaveBeenCalledWith('Analyse terminée avec succès');expect(failure).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:"Lancer l'analyse"})).toBeEnabled();
});

const partialCta = 'Générer une offre partielle à destination';
it.each(['sync-gap-client-actions','analyze-thread-event','analyze-case-coherence'])('characterizes busy after completed job while %s is pending',async pendingName=>{
  emptyAnalysisFixture();vi.useFakeTimers();const success=vi.spyOn(toast,'success');
  const read={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{id:'email'},error:null})};
  from.mockReturnValue(read);
  let release:((value:{data:{ok:boolean};error:null})=>void)|undefined;
  const pending=new Promise<{data:{ok:boolean};error:null}>(resolve=>{release=resolve;});
  invoke.mockImplementation(async(name,options)=>{
    if(name==='backfill-case-documents')return {data:{success:true,status:'ok',extraction_contract:1,remaining:0},error:null};
    if(name==='build-case-puzzle')return options.body.mode==='start'?{data:{job_id:'completed-synthetic-job'},error:null}:{data:{status:'completed',final_result:{}},error:null};
    if(name===pendingName)return pending;
    return {data:{ok:true},error:null};
  });
  mount();fireEvent.click(screen.getByRole('button',{name:"Lancer l'analyse"}));await act(async()=>{});
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
  expect(invoke.mock.calls.filter(([name,options])=>name==='build-case-puzzle'&&options.body.mode==='poll')).toHaveLength(1);
  expect(invoke.mock.calls.some(([name])=>name===pendingName)).toBe(true);
  await act(async()=>{await vi.advanceTimersByTimeAsync(600_000);});
  expect(screen.getByRole('button',{name:'Analyse en cours…'})).toBeDisabled();expect(success).not.toHaveBeenCalled();
  expect(invoke.mock.calls.filter(([name,options])=>name==='build-case-puzzle'&&options.body.mode==='start')).toHaveLength(1);
  await act(async()=>{release!({data:{ok:true},error:null});});
  expect(screen.getByRole('button',{name:"Lancer l'analyse"})).toBeEnabled();expect(success).toHaveBeenCalledWith('Analyse terminée avec succès');
});

it('operator sees a source conflict, confirms the actual fact and rereads linked resolution history',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);
  status='NEED_INFO';hasSelection=false;showSourceResolution=true;gaps=[{id:'source-gap',gap_key:'source_revision.cargo.description',status:'open',is_blocking:true,question_fr:'Descriptions contradictoires : confirmer la désignation.'}];
  facts=[{id:'description',fact_key:'cargo.description',fact_category:'cargo',value_text:'Marchandises générales',source_type:'email_body',confidence:.8,is_validated:false,is_current:true}];
  const conflict={id:'conflict-event',created_at:'2026-10-19T10:00:00Z',event_data:{source:'email-fact-revision',revision_id:'revision',fact_key:'cargo.description',status:'conflict',reason:'current_source_not_orderable',old_fact:{value_text:'Marchandises générales'},source_evidence:{candidates:[{email_id:'email',value:'textiles',excerpt:'Textiles.'}]}}};
  sourceChanges={sources:[],runs:[],revisions:sourceRevisionHistory([conflict])};
  const invalidate=vi.spyOn(client,'invalidateQueries');
  invoke.mockImplementation(async(name,options)=>{
    expect(name).toBe('set-case-fact');expect(options.body).toEqual({case_id:'case-a',fact_key:'cargo.description',value_text:'Textiles confirmés',value_number:null});
    facts=[{id:'manual-description',fact_key:'cargo.description',fact_category:'cargo',value_text:'Textiles confirmés',source_type:'manual_input',confidence:1,is_validated:true,is_current:true}];gaps=[];
    sourceChanges={...sourceChanges,revisions:sourceRevisionHistory([conflict,{id:'resolution-event',created_at:'2026-10-19T10:01:00Z',event_data:{source:'email-fact-revision',revision_id:'revision',fact_key:'cargo.description',status:'resolved',reason:'explicit_manual_successor',old_fact:{value_text:'Marchandises générales'},new_value:'Textiles confirmés',source_evidence:{manual:{excerpt:'TEST ONLY confirmation opérateur'}}}}])};
    return {data:{success:true},error:null};
  });
  mount();expect(screen.getByText(/1 correction\(s\) en conflit/)).toBeVisible();
  const missing=screen.getByRole('region',{name:'Informations à compléter'});
  await userEvent.click(within(missing).getByRole('button',{name:'Descriptions contradictoires : confirmer la désignation.'}));
  expect(document.getElementById('gap-review-source-gap')).toBeVisible();
  expect(within(document.getElementById('gap-review-source-gap')!).queryByRole('textbox')).toBeNull();
  await userEvent.click(screen.getByRole('button',{name:'Présentation précédente'}));
  await userEvent.click(screen.getByRole('tab',{name:'Données & audit'}));await userEvent.click(screen.getByText(/Sources, faits et historique/));
  const edit=screen.getByRole('button',{name:/Modifier .*description|Modifier .*désignation/i});await userEvent.click(edit);
  const input=screen.getByRole('textbox',{name:/description|désignation/i});await userEvent.clear(input);await userEvent.type(input,'Textiles confirmés{Enter}');
  await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1));
  expect(invalidate).toHaveBeenCalledWith({queryKey:['case-source-changes','case-a']});
  expect(screen.queryByText(/1 correction\(s\) en conflit/)).toBeNull();
  await userEvent.click(screen.getByText(/Historique des corrections de faits/));
  expect(screen.getByText(/Résolu par décision manuelle/)).toBeVisible();expect(screen.getByText(/TEST ONLY confirmation opérateur/)).toBeVisible();
});

function destinationPartialFixture() {
  status='NEED_INFO';requestType='AIR_IMPORT';hasSelection=false;
  facts=[{id:'pkg',fact_key:'service.package',value_text:'AIR_IMPORT_DDP',is_current:true},
    {id:'gross',fact_key:'cargo.weight_kg',value_number:190,is_current:true},
    {id:'net',fact_key:'cargo.weight_net_kg',value_number:151,is_current:true},
    {id:'pieces',fact_key:'cargo.pieces',value_number:30,is_current:true},
    {id:'dimensions',fact_key:'cargo.dimensions_evidence',value_json:{conflict:true},is_current:true}];
  gaps=[{id:'hs',gap_key:'cargo.hs_code',status:'open',is_blocking:true,question_fr:'HS requis'},
    {id:'value',gap_key:'cargo.value',status:'open',is_blocking:true,question_fr:'Valeur requise'}];
  timeline=[{event_type:'service_scope_v1',created_at:'2026-10-14T12:33:57Z',actor_type:'system',
    event_data:{freight_scope:false,customs_scope:true,request_evidence:{mode:'destination'}}}];
}
async function openQuotePresentation(guided:boolean) {
  if(guided) await userEvent.click(within(screen.getByRole('navigation',{name:'Navigation du dossier'})).getByRole('button',{name:'Devis'}));
  else await userEvent.click(screen.getByRole('tab',{name:'Devis & offre'}));
}
it.each([false,true])('exposes the destination partial action with HS and value missing in guided=%s',async(guided)=>{
  destinationPartialFixture();if(guided)localStorage.removeItem(CASE_PRESENTATION_KEY);
  const originalFacts=structuredClone(facts);mount();await openQuotePresentation(guided);
  expect(screen.getByRole('button',{name:partialCta})).toBeVisible();
  expect(screen.getByRole('button',{name:partialCta})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Calculer le devis confirmé'})).toBeDisabled();
  expect(facts).toEqual(originalFacts);expect(invoke).not.toHaveBeenCalled();
});
it.each(['cargo.weight_kg','routing.destination_city','cargo.imo_goods_scope_confirmation','service.package'])('retains other blocking gap %s',async(key)=>{
  destinationPartialFixture();gaps.push({id:'other',gap_key:key,status:'open',is_blocking:true,question_fr:'Autre contrôle'});
  mount();await openQuotePresentation(false);expect(screen.queryByRole('button',{name:partialCta})).toBeNull();expect(invoke).not.toHaveBeenCalled();
});
it.each(['freight-scope','freight-override','non-ddp','non-air','multi-lot','missing-scope','malformed-scope','latest-scope-freight'])('does not extend the destination exception to %s',async(kind)=>{
  destinationPartialFixture();
  if(kind==='freight-scope')timeline[0].event_data.freight_scope=true;
  if(kind==='freight-override')facts.push({id:'override',fact_key:'service.overrides',value_json:{add:['AIR_FREIGHT'],remove:[]},is_current:true});
  if(kind==='non-ddp')facts[0].value_text='AIR_IMPORT_DAP';
  if(kind==='non-air')requestType='SEA_FCL_IMPORT';
  if(kind==='multi-lot')lotCount=2;
  if(kind==='missing-scope')timeline=[];
  if(kind==='malformed-scope')timeline[0].event_data={freight_scope:'false',request_evidence:{mode:'destination'}};
  if(kind==='latest-scope-freight')timeline.push({...timeline[0],created_at:'2026-10-14T13:00:00Z',event_data:{freight_scope:true,customs_scope:true,request_evidence:{mode:'destination'}}});
  mount();await openQuotePresentation(false);expect(screen.queryByRole('button',{name:partialCta})).toBeNull();expect(invoke).not.toHaveBeenCalled();
});
it.each(['quote-request-lines-count','case-facts','case-timeline','case-gaps'])('fails closed for pending and failed %s reads even with cached data',async(key)=>{
  destinationPartialFixture();readPending=key;const {rerender}=mount();await openQuotePresentation(false);
  expect(screen.queryByRole('button',{name:partialCta})).toBeNull();readPending=null;readFailed=key;
  rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(screen.queryByRole('button',{name:partialCta})).toBeNull();expect(invoke).not.toHaveBeenCalled();
});
it('fails closed for an unknown lot count',async()=>{
  destinationPartialFixture();lotCount=null;mount();await openQuotePresentation(false);
  expect(screen.queryByRole('button',{name:partialCta})).toBeNull();expect(invoke).not.toHaveBeenCalled();
});
it.each(['quote-request-lines-count','case-facts','case-timeline','case-gaps'])('does not fall back to value-only provisional during pending or failed %s reads',async(key)=>{
  destinationPartialFixture();facts.push({id:'hs',fact_key:'cargo.hs_code',value_text:'3004909900',is_current:true});gaps=gaps.filter(g=>g.gap_key==='cargo.value');
  readPending=key;const {rerender}=mount();await openQuotePresentation(false);
  expect(screen.queryByRole('button',{name:/Générer (une offre partielle|un devis provisoire)/})).toBeNull();
  readPending=null;readFailed=key;rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(screen.queryByRole('button',{name:/Générer (une offre partielle|un devis provisoire)/})).toBeNull();expect(invoke).not.toHaveBeenCalled();
});
it.each(['SENT','ACCEPTED','REJECTED','PRICING_RUNNING'])('retains the %s status lock for destination partial pricing',async(locked)=>{
  destinationPartialFixture();status=locked;mount();await openQuotePresentation(false);
  expect(screen.queryByRole('button',{name:partialCta})).toBeNull();expect(invoke).not.toHaveBeenCalled();
});
it('retains the latest commercial intent lock',async()=>{
  destinationPartialFixture();timeline.push({event_type:'thread_intent_v1',created_at:'2026-10-14T13:00:00Z',actor_type:'system',event_data:{intent:{pricing_gate:false,intent_type:'opportunity_check'}}});
  mount();await openQuotePresentation(false);expect(screen.queryByRole('button',{name:partialCta})).toBeNull();expect(invoke).not.toHaveBeenCalled();
});
it('preserves the existing value-only provisional path outside destination AIR',async()=>{
  status='NEED_INFO';hasSelection=false;facts=[{id:'pkg',fact_key:'service.package',value_text:'DDP',is_current:true},{id:'hs',fact_key:'cargo.hs_code',value_text:'3004909900',is_current:true}];
  gaps=[{id:'value',gap_key:'cargo.value',status:'open',is_blocking:true,question_fr:'Valeur requise'}];
  mount();await openQuotePresentation(false);expect(screen.getByRole('button',{name:'Générer un devis provisoire (hors droits & taxes)'})).toBeEnabled();
  expect(screen.queryByRole('button',{name:partialCta})).toBeNull();expect(invoke).not.toHaveBeenCalled();
});

it('confirms commercial outcomes, blocks repeated clicks and retains server errors',async()=>{
  status='SENT'; mount();
  await userEvent.click(screen.getByRole('tab',{name:'Devis & offre'}));
  await userEvent.click(screen.getByText('Devis confirmé, versions et envoi'));
  const outcomeButton=screen.getByRole('button',{name:'Client a accepté'});
  await userEvent.click(outcomeButton);
  expect(invoke).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button',{name:'Annuler'}));
  expect(invoke).not.toHaveBeenCalled();
  await userEvent.click(outcomeButton);
  let finish!:(value:unknown)=>void;
  invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const confirm=screen.getByRole('button',{name:'Confirmer la décision'});
  fireEvent.click(confirm);fireEvent.click(confirm);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('close-commercial-outcome',{body:{case_id:'case-a',outcome:'ACCEPTED'}});
  finish({data:{ok:false,error:{message:'Décision refusée'}},error:null});
  await waitFor(()=>expect(screen.getByRole('alertdialog')).toHaveTextContent('Décision refusée'));
  expect(screen.getByRole('button',{name:'Confirmer la décision'})).toBeEnabled();
});

it('puts demand before questions and groups, with variants in Devis and tools collapsed',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='NEED_INFO';
  gaps=[{id:'optional',gap_key:'cargo.description',status:'open',is_blocking:false,question_fr:'Description complémentaire ?'},
    {id:'destination',gap_key:'routing.destination_city',status:'open',is_blocking:true,question_fr:'Destination à préciser ?'}];
  const {container}=mount();await userEvent.click(screen.getByRole('button',{name:'Marchandise'}));
  const steps=Array.from(container.querySelectorAll('[id^="section-"]')).filter(e=>['section-request','section-data','section-scenarios','section-merchandise-tools'].includes(e.id));
  expect(steps.map(e=>e.id)).toEqual(['section-request','section-data','section-scenarios','section-merchandise-tools']);
  expect(steps[0]).toBeVisible();expect(steps[1]).toHaveAttribute('open');
  expect(steps[2]).toHaveAttribute('open');expect(steps[3]).not.toHaveAttribute('open');
  expect(container.querySelector('#section-scenario-variants')).not.toBeVisible();
  const blocker=container.querySelector('#gap-review-destination')!,optional=container.querySelector('#gap-review-optional')!;
  expect(blocker).toBeVisible();expect(optional).toBeVisible();
  expect(blocker.compareDocumentPosition(optional)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getAllByRole('button',{name:'Préparer les questions au client'})).toHaveLength(1);
  expect(screen.getByLabelText('Résumé de la marchandise')).toHaveTextContent('2 questions ouvertes');
  expect(screen.getByLabelText('Résumé de la marchandise')).toHaveTextContent('Poids déclaré à renseigner');
  expect(screen.getByRole('button',{name:'Action cargo de test',hidden:true})).not.toBeVisible();
  expect(steps[3]).toContainElement(container.querySelector('#cargo-canonical-action'));
  expect(steps[3]).toContainElement(container.querySelector('#cargo-legacy-sync-action'));
  await userEvent.click(screen.getByRole('button',{name:'Présentation précédente'}));
  await userEvent.click(screen.getByText('Données du dossier et contrôles avant devis confirmé'));
  expect(container.querySelector('#gap-review-optional')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it('preserves PAD and cargo instances, portal actions and drafts when the layout changes twice',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);const {container}=mount();
  await userEvent.click(screen.getByRole('button',{name:'Marchandise'}));
  const pad=screen.getByRole('textbox',{name:'Source PAD de test'});await userEvent.type(pad,'PAD non enregistré');
  await userEvent.click(screen.getByText('Détails et outils'));await userEvent.click(screen.getByText('Outils avancés'));
  const cargo=screen.getByRole('textbox',{name:'Source cargo de test'});await userEvent.type(cargo,'Cargo non enregistré');
  const action=screen.getByRole('button',{name:'Action cargo de test'});
  await userEvent.click(screen.getByRole('button',{name:'Présentation précédente'}));
  await userEvent.click(screen.getByText('Données du dossier et contrôles avant devis confirmé'));
  expect(screen.getByRole('textbox',{name:'Source cargo de test'})).toBe(cargo);
  expect(cargo).toHaveValue('Cargo non enregistré');expect(pad).toHaveValue('PAD non enregistré');
  expect(screen.getByRole('button',{name:'Action cargo de test'})).toBe(action);
  await userEvent.click(screen.getByRole('button',{name:'Présentation guidée'}));
  expect(screen.getByRole('textbox',{name:'Source PAD de test'})).toBe(pad);
  expect(panelMounts).toEqual({pad:1,cargo:1});
  expect(container.querySelectorAll('#cargo-canonical-action')).toHaveLength(1);
  expect(action.closest('#section-merchandise-tools')).not.toHaveAttribute('open');
  expect(invoke).not.toHaveBeenCalled();
});

it('shows an honest empty step, then opens arriving questions without hiding the groups',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);gaps=[];const {container,rerender}=mount();
  await userEvent.click(screen.getByRole('button',{name:'Marchandise'}));
  expect(screen.getByText('Rien à compléter')).toBeVisible();
  expect(screen.getByText('1. Ce qu’il faut compléter')).not.toBeVisible();
  expect(container.querySelector('#section-scenarios')).toHaveAttribute('open');
  expect(screen.getByLabelText('Résumé de la marchandise')).toHaveTextContent('0 question ouverte');
  gaps=initialGaps;rerender(<QueryClientProvider client={client}><CaseView/></QueryClientProvider>);
  expect(screen.queryByText('Rien à compléter')).toBeNull();
  expect(container.querySelector('#gap-review-g')).toBeVisible();
  expect(container.querySelectorAll('#section-data')).toHaveLength(1);
  expect(invoke).not.toHaveBeenCalled();
});

it('opens the separate variants step from PAD without changing forms or pricing',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);const {container}=mount();
  await userEvent.click(screen.getByRole('button',{name:'Marchandise'}));
  await userEvent.click(screen.getByRole('button',{name:'Modifier les groupes pour l’estimation'}));
  expect(container.querySelector('#section-scenario-variants')).toBeVisible();
  expect(container.querySelector('#section-scenario-variants')).toHaveFocus();
  expect(screen.getByText('Groupes de test à vérifier')).toBeVisible();
  expect(invoke).not.toHaveBeenCalled();expect(estimateAction).not.toHaveBeenCalled();
});

it('opens the tools parent and focuses stay assumptions from the existing estimate action',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);
  const previousLines=run.tariff_lines;
  run.tariff_lines=[{id:'warehouse_franchise',category:'Magasinage',amount:null,source:{type:'TO_CONFIRM'}}];
  try {
    const {container}=mount();await userEvent.click(within(screen.getByRole('navigation',{name:'Navigation du dossier'})).getByRole('button',{name:'Devis'}));
    await userEvent.click(screen.getByRole('button',{name:'Renseigner les hypothèses de séjour'}));
    expect(container.querySelector('#section-merchandise-tools')).toHaveAttribute('open');
    expect(container.querySelector('#section-stay-assumptions')).toBeVisible();
    expect(container.querySelector('#section-stay-assumptions')).toHaveFocus();
    expect(invoke).not.toHaveBeenCalled();expect(estimateAction).not.toHaveBeenCalled();
  } finally {run.tariff_lines=previousLines;}
});

it('uses the same danger question on the home and control, with the original diagnostic available on demand',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='NEED_INFO';cockpitOverrides={blockingGapsCount:1};
  const original='Contrôle du périmètre IMO. NO_DIRECT_BINDING. Lot 2 : vérifier la source client.';
  gaps=[{id:'imo',gap_key:'cargo.imo_goods_scope_confirmation',status:'open',is_blocking:true,question_fr:original}];
  const {container}=mount();
  await userEvent.click(screen.getByRole('button',{name:'Vérifier les informations de danger et les conteneurs concernés'}));
  const control=container.querySelector('#gap-review-imo');
  expect(control).toHaveFocus();
  expect(control).toHaveTextContent('statut dangereux');
  expect(screen.getByText(original)).not.toBeVisible();
  await userEvent.click(screen.getByText('Détail du contrôle d’origine'));
  expect(screen.getByText(original)).toBeVisible();
  expect(screen.getByText('Chiffres et suivi du dossier').closest('details')).not.toHaveAttribute('open');
  expect(invoke).not.toHaveBeenCalled();
});

it('preserves the inline response through both presentations and a failed save, with the same payload',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='NEED_INFO';cockpitOverrides={blockingGapsCount:1};
  gaps=[{id:'destination',gap_key:'routing.destination_city',status:'open',is_blocking:true,question_fr:'Quelle est la destination finale ?'}];
  mount();await userEvent.click(screen.getByRole('button',{name:'Quelle est la destination finale ?'}));
  const input=screen.getByRole('textbox',{name:'Quelle est la destination finale ?'});
  expect(input).toHaveAccessibleDescription(/calcul du devis peut démarrer automatiquement/);
  await userEvent.type(input,'Thiès');
  await userEvent.click(screen.getByRole('button',{name:'Présentation précédente'}));
  await userEvent.click(screen.getByRole('tab',{name:'Marchandise'}));
  await userEvent.click(screen.getByText('Données du dossier et contrôles avant devis confirmé'));
  expect(input).toHaveValue('Thiès');
  await userEvent.click(screen.getByRole('button',{name:'Présentation guidée'}));
  expect(screen.getByRole('textbox',{name:'Quelle est la destination finale ?'})).toBe(input);
  invoke.mockResolvedValue({error:new Error('Refus de test')});
  await userEvent.click(screen.getByRole('button',{name:'Enregistrer : Quelle est la destination finale ?'}));
  expect(invoke).toHaveBeenCalledExactlyOnceWith('set-case-fact',{body:{case_id:'case-a',fact_key:'routing.destination_city',value_text:'Thiès',value_number:null}});
  expect(input).toHaveValue('Thiès');
});

it('names automatic select saving and preserves the existing answer lock while pricing runs',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='NEED_INFO';cockpitOverrides={blockingGapsCount:1};
  gaps=[{id:'mode',gap_key:'routing.transport_mode',status:'open',is_blocking:true,question_fr:'Quel mode de transport ?'}];
  const {rerender}=mount();await userEvent.click(screen.getByRole('button',{name:'Quel mode de transport ?'}));
  expect(screen.getByRole('combobox',{name:'Quel mode de transport ?'})).toHaveAccessibleDescription(/enregistré dès sa sélection/);
  status='PRICING_RUNNING';rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(screen.queryByRole('combobox',{name:'Quel mode de transport ?'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Enregistrer : Quel mode de transport ?'})).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it('puts the current estimate first despite a PAD gap, with diagnostics and sources collapsed',()=>{
  const {container}=mount();
  const result=screen.getByLabelText('Résultat de l’estimation sélectionnée');
  expect(result.closest('details')).toBeNull();
  expect(screen.getByText(/Estimation disponible/)).toBeVisible();
  expect(screen.getByText('1 point à résoudre avant devis confirmé')).not.toBeVisible();
  expect(screen.getByText('Sources, faits et historique').closest('details')).not.toHaveAttribute('open');
  expect(container.querySelector('#section-data')).toHaveTextContent('Données du dossier et contrôles avant devis confirmé');
  expect(container.querySelector('#section-sources')).toHaveTextContent('Sources, faits et historique');
  expect(screen.getByText('Marchandises et catégories portuaires').closest('summary')).toHaveTextContent('catégorie PAD à confirmer');
  expect(screen.getByText('Partenaires et coordination').closest('summary')).not.toHaveTextContent('plan 0/0');
  expect(screen.getByText('Partenaires et coordination').closest('summary')).not.toHaveTextContent('demandes partenaires');
  expect(screen.getByText('Sources, faits et historique').closest('summary')).toHaveTextContent('1 fait · 0 événement');
  expect(screen.getByText('Sources, faits et historique').closest('summary')).toHaveTextContent('0 document');
  expect(screen.getByRole('tab',{name:'Documents (0)',hidden:true})).toBeInTheDocument();
  expect(screen.getByRole('tab',{name:'Historique (0)',hidden:true})).toBeInTheDocument();
  expect(screen.getAllByText('PartnerCollectionReadinessCard')).toHaveLength(1);
  const cargoActions = container.querySelector('[aria-label="Actions des outils avancés"]');
  expect(cargoActions).toHaveClass('hidden', 'has-[button]:flex');
  expect(cargoActions).toHaveTextContent('Actions sur la marchandise');
  expect(container.querySelector('#section-pricing')!.compareDocumentPosition(container.querySelector('#section-scenarios')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
});
it('summarizes partner requests only when they exist',()=>{
  totalPartnerRequests=3;closedPartnerRequests=2;mount();
  const summary=screen.getByText('Partenaires et coordination').closest('summary');
  expect(summary).toHaveTextContent('demandes partenaires 2/3');
  expect(summary).not.toHaveTextContent('plan');
});
it('opens the mounted scenario review without saving or calculating',async()=>{
  mount();
  await userEvent.click(screen.getByRole('button',{name:'Vérifier les choix PAD par groupe'}));
  expect(screen.getByText('Groupes de test à vérifier')).toBeVisible();
  expect(estimateAction).not.toHaveBeenCalled();expect(invoke).not.toHaveBeenCalled();
});
it('uses the existing selected-scenario action once, without opening or calling firm pricing',async()=>{
  mount(); await userEvent.click(screen.getByRole('button',{name:'Actualiser l’estimation'}));
  expect(estimateAction).toHaveBeenCalledTimes(1); expect(invoke).not.toHaveBeenCalled();
  expect(screen.getByText('Groupes de test à vérifier')).not.toBeVisible();
});
it('refreshes PAD confirmations when dossier data is refreshed',async()=>{
  mount(); const invalidate=vi.spyOn(client,'invalidateQueries');
  await userEvent.click(screen.getByRole('tab',{name:'Marchandise'}));
  await userEvent.click(screen.getByText('Marchandises et catégories portuaires'));
  await userEvent.click(screen.getByRole('button',{name:'Simuler actualisation du dossier'}));
  expect(invalidate).toHaveBeenCalledWith({queryKey:['pad-group-confirmations',caseId]});
  expect(invoke).not.toHaveBeenCalled();
});
it('keeps the single classification help closed by default in the merchandise section',async()=>{
  const {container}=mount();
  await userEvent.click(screen.getByRole('tab',{name:'Marchandise'}));
  const merchandise=container.querySelector('#section-scenarios') as HTMLDetailsElement;
  merchandise.open=true;
  const help=screen.getByText('Aide à la classification').closest('details');
  expect(help).not.toHaveAttribute('open');
  expect(help).toContainElement(screen.getByRole('button',{name:'Rechercher une catégorie PAD'}));
  expect(screen.getAllByText('PadNstSuggestionsPanel')).toHaveLength(1);
  expect(screen.getAllByText('CommodityClassificationCandidatesPanel')).toHaveLength(1);
  expect(invoke).not.toHaveBeenCalled();
});
it('opens the proposal review when no scenario is selected',async()=>{
  hasSelection=false;mount(); await userEvent.click(screen.getByRole('button',{name:'Préparer l’estimation'}));
  expect(screen.getByText('Groupes de test à vérifier')).toBeVisible();
  expect(estimateAction).toHaveBeenCalledTimes(1);expect(invoke).not.toHaveBeenCalled();
});
it('preserves printable details and restores the operator layout afterwards',()=>{
  const {container}=mount(); const details=Array.from(container.querySelectorAll('details'));
  details[0].open=true;const before=details.map(d=>d.open);
  window.dispatchEvent(new Event('beforeprint'));
  expect(details.every(d=>d.open)).toBe(true);
  window.dispatchEvent(new Event('afterprint'));
  expect(details.map(d=>d.open)).toEqual(before);expect(invoke).not.toHaveBeenCalled();
});
it.each(['SENT','ACCEPTED','REJECTED','ARCHIVED','PRICING_RUNNING'])('preserves %s locks while allowing read-only result inspection',locked=>{
  status=locked;mount();
  expect(screen.getByLabelText('Résultat de l’estimation sélectionnée')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Actualiser l’estimation'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Calculer le devis confirmé'})).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it('guides an incomplete dossier to the existing gap panel without mutations or blocking other sections',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='NEED_INFO';cockpitOverrides={blockingGapsCount:1};
  const {container}=mount();
  expect(screen.getByRole('region',{name:'À faire dans le dossier'})).toBeVisible();
  expect(screen.getByText('Aucune version client sélectionnée')).toBeVisible();
  await userEvent.click(screen.getByRole('button',{name:'Examiner les informations manquantes'}));
  expect(container.querySelector('#section-data')).toBeVisible();
  expect(container.querySelector('#section-data')).toHaveAttribute('open');
  expect(container.querySelector('#section-data')).toHaveFocus();
  await userEvent.click(screen.getByRole('button',{name:'Échanges et documents'}));
  await userEvent.click(screen.getByRole('button',{name:'Documents et pièces jointes'}));
  expect(screen.getByText('CaseDocumentsTab')).toBeVisible();
  expect(invoke).not.toHaveBeenCalled();expect(estimateAction).not.toHaveBeenCalled();
});

it('shows selected-version reservations beside its total, and replaces them when selection changes',()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';
  cockpitOverrides={hasSelectedVersion:true,selectedVersionNumber:1,hasPdf:true,hasDraftEmail:true,
    selectedVersionSnapshot:{totals:{total_payable:1200000,currency:'XOF'},raw_lines:[{description:'Livraison à Thiès',source:'TO_CONFIRM'}]}};
  const {rerender}=mount();const clientQuote=screen.getByRole('region',{name:'Document destiné au client'});
  expect(clientQuote).toHaveTextContent('Total partiel');expect(clientQuote).toHaveTextContent('Livraison à Thiès — à confirmer');
  expect(clientQuote.textContent?.replace(/\s/g,'')).toContain('1200000');
  expect(screen.getByRole('button',{name:'Relire le devis et ses réserves'})).toBeVisible();
  expect(screen.getByText('Version v1 · Total partiel — hors postes réservés')).toBeVisible();
  cockpitOverrides={...cockpitOverrides,selectedVersionNumber:2,selectedVersionSnapshot:{totals:{total_payable:1450000,currency:'XOF'},meta:{quoteQualification:{level:'firm'}}}};
  rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(clientQuote).toHaveTextContent('Version v2');expect(clientQuote).not.toHaveTextContent('Livraison à Thiès');
  expect(clientQuote).toHaveTextContent('qualification ferme');expect(invoke).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Relire le devis et ses réserves'})).toBeNull();
  expect(screen.getByRole('button',{name:'Relire les éléments et tracer l’envoi manuel'})).toBeVisible();
});

it('keeps snapshot reservations readable on the home while preserving the original source and selected version', async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';
  const original = `Danger à confirmer; e-mail aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee; SHA256 ${'a'.repeat(64)}; supplément IMO non compris`;
  cockpitOverrides={hasSelectedVersion:true,selectedVersionNumber:1,
    selectedVersionSnapshot:{totals:{total_payable:1200000,currency:'XOF'},meta:{quoteQualification:{level:'partial',reasons:[{code:'SYNTHETIC_SOURCE',message:original}]}}}};
  const before=JSON.stringify(cockpitOverrides);
  mount();
  const region=screen.getByRole('region',{name:'Document destiné au client'});
  const conditions=within(region).getByRole('region',{name:'Conditions particulières'});
  // Client wording: machine references removed by the shared projection (same text as PDF/e-mail).
  expect(within(conditions).getByText('Danger à confirmer; e-mail source; supplément IMO non compris')).toBeVisible();
  expect(conditions).not.toHaveTextContent('aaaaaaaa-bbbb');
  // The exact recorded reservation stays in the folded operator detail.
  const detail=within(region).getByText('Détail opérateur : réserves enregistrées (1)').closest('details')!;
  expect(detail).not.toHaveAttribute('open');
  await userEvent.click(within(region).getByText('Détail opérateur : réserves enregistrées (1)'));
  await userEvent.click(within(detail).getByText('Détails techniques de la source'));
  expect(within(detail).getByText(original)).toBeVisible();
  expect(region).toHaveTextContent('Total partiel');
  expect(region.textContent?.replace(/\s/g,'')).toContain('1200000');
  expect(JSON.stringify(cockpitOverrides)).toBe(before);
  expect(invoke).not.toHaveBeenCalled();expect(estimateAction).not.toHaveBeenCalled();
});

it('keeps the home quote card short: pending items once, three reservations open and the rest one click away',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';
  const reasons=['Cotation sur bases opérateur explicites et révisables.','commodity_classification_unknown',
    ...[1,2,3].map(lot=>`Périmètre lot-${lot} : commodity_classification_unknown`),
    `Magasinage — lot lot-1 — à confirmer. ${'Franchise et conditions à vérifier avant usage contractuel. '.repeat(5)}`,
    'Réserve finale à relire'].map((message,i)=>({code:`R${i}`,message}));
  cockpitOverrides={hasSelectedVersion:true,selectedVersionNumber:1,
    selectedVersionSnapshot:{totals:{total_payable:48024930,currency:'XOF'},meta:{quoteQualification:{level:'partial',reasons}},
      raw_lines:[{description:'Magasinage — lot lot-1 — à confirmer',source:'TO_CONFIRM'},{description:'Magasinage — lot lot-1 — à confirmer',source:'TO_CONFIRM'}]}};
  mount();const region=screen.getByRole('region',{name:'Document destiné au client'});
  expect(region).toHaveTextContent('Postes à confirmer, exclus du total (2)');
  expect(within(region).getAllByText('Magasinage — lot 1 — à confirmer (×2)')).toHaveLength(1);
  expect(region).not.toHaveTextContent('à confirmer — à confirmer');
  const conditions=within(region).getByRole('region',{name:'Conditions particulières'});
  expect(conditions).toHaveTextContent('Conditions particulières (5)');
  expect(within(conditions).getByText('Lot 1, lot 2, lot 3 : Classification marchandise inconnue')).toBeVisible();
  expect(within(conditions).getByText('Classification marchandise inconnue')).toBeVisible();
  expect(within(conditions).getByText('Magasinage — lot 1 — à confirmer.')).toBeVisible();
  expect(within(conditions).getByText('Cotation sur bases opérateur explicites et révisables.')).toBeVisible();
  expect(region).not.toHaveTextContent('commodity_classification_unknown');
  const last=within(conditions).getByText('Réserve finale à relire');expect(last).not.toBeVisible();
  await userEvent.click(within(conditions).getByText('Voir l’autre condition'));
  expect(last).toBeVisible();
  expect(within(conditions).getByText('Lire la suite')).toBeVisible();
  // No general clause applies here: no blanket 'non citées' exclusion is printed.
  expect(within(region).queryByText(/^Conditions générales/)).toBeNull();
  expect(within(region).getByText('Détail opérateur : réserves enregistrées (7)').closest('details')).not.toHaveAttribute('open');
  expect(region.textContent?.replace(/\s/g,'')).toContain('48024930');
  expect(invoke).not.toHaveBeenCalled();
});

it('shows the same client projection as the PDF and e-mail, with the recorded detail folded for the operator',async()=>{
  const { clientQuoteSnapshot } = await import('../../../../supabase/functions/_tests/client-quote-fixture.ts');
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';
  cockpitOverrides={hasSelectedVersion:true,selectedVersionNumber:1,selectedVersionSnapshot:clientQuoteSnapshot};
  const before=JSON.stringify(clientQuoteSnapshot);
  mount();const region=screen.getByRole('region',{name:'Document destiné au client'});
  expect(within(region).getByText('Lot 1 : 39 × 20HQ, SOC, 55 000 kg par conteneur, dangereux (UN3536, classe 9)')).toBeVisible();
  expect(within(region).getByText('Distance routière retenue : 480,9 km (lots 2, 3)')).toBeVisible();
  const conditions=within(region).getByRole('region',{name:'Conditions particulières'});
  expect(within(conditions).getByText('Droits et taxes et calcul CAF non compris : périmètre DAP.')).toBeInTheDocument();
  // Stay and transport conditions recorded per lot stay reachable on screen (folded when long).
  expect(conditions).toHaveTextContent('détention après sortie et TVA fournisseur éventuelle exclus');
  expect(conditions).toHaveTextContent('montant transport TTC, TVA fournisseur incluse');
  expect(conditions).not.toHaveTextContent('Choisir et relier');
  expect(region).toHaveTextContent('Hypothèse : Séjour retenu — lot 1 : magasinage 15 jours, surestaries à confirmer');
  expect(conditions).not.toHaveTextContent('Postes non chiffrés');
  for (const banned of ['SCENARIO_','OPEN_POINT','TO_CONFIRM','commodity_classification','http','per_unit']) expect(conditions).not.toHaveTextContent(banned);
  expect(within(region).getByText('Conditions générales (6)').closest('details')).not.toHaveAttribute('open');
  expect(within(region).getByText('Sous-total avant TVA SODATRA : 47 925 930 XOF ; TVA SODATRA sur honoraires : 99 000 XOF.')).toBeVisible();
  expect(region).not.toHaveTextContent('non citées');
  const detail=within(region).getByText(/^Détail opérateur : réserves enregistrées/).closest('details')!;
  expect(detail).not.toHaveAttribute('open');
  expect(region.textContent?.replace(/\s/g,'')).toContain('48024930');
  expect(JSON.stringify(clientQuoteSnapshot)).toBe(before);
  expect(invoke).not.toHaveBeenCalled();
});

it.each([
  ['partial', 'Relire le devis et ses réserves', 'Des postes restent à confirmer'],
  ['provisional', 'Relire le devis et ses réserves', 'Cette version comporte des réserves'],
  ['unknown', 'Vérifier la qualification du devis', 'La qualification de cette version n’est pas disponible'],
])('keeps %s caution visible with a prepared draft and opens the existing review without sending',async(level,label,caution)=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';gaps=[];
  cockpitOverrides={hasSelectedVersion:true,selectedVersionNumber:1,hasPdf:true,hasDraftEmail:true,
    selectedVersionSnapshot:{totals:{total_payable:1200000,currency:'XOF'},meta:{quoteQualification:{level}}}};
  const {container}=mount();
  expect(screen.getByRole('region',{name:'Vérifications avant partage'})).toHaveTextContent(caution);
  const action=screen.getByRole('button',{name:label});action.focus();await userEvent.keyboard('{Enter}');
  expect(container.querySelector('#section-send')).toHaveFocus();
  expect(invoke).not.toHaveBeenCalled();expect(estimateAction).not.toHaveBeenCalled();
});

it('does not replace a blocking task with quote review, or expose stale qualification during a refresh error',()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';
  cockpitOverrides={blockingGapsCount:1,hasSelectedVersion:true,selectedVersionNumber:1,hasPdf:true,hasDraftEmail:true,
    selectedVersionSnapshot:{meta:{quoteQualification:{level:'partial'}}}};
  const {rerender}=mount();
  expect(screen.getByRole('button',{name:'Examiner les informations manquantes'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Relire le devis et ses réserves'})).toBeNull();
  cockpitError=new Error('Refresh failed');rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(screen.queryByText('Version v1 · Total partiel — hors postes réservés')).toBeNull();
  expect(screen.queryByRole('region',{name:'Document destiné au client'})).toBeNull();
  expect(screen.getByText('Le suivi du dossier n’a pas pu être actualisé.')).toBeVisible();
  expect(invoke).not.toHaveBeenCalled();
});

it('preserves the same form instance and unsaved text through navigation and both presentations',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';mount();
  const nav=screen.getByRole('navigation',{name:'Navigation du dossier'});
  await userEvent.click(within(nav).getByRole('button',{name:'Devis'}));
  const input=screen.getByRole('textbox',{name:'Brouillon de test'});
  await userEvent.type(input,'Texte non enregistré');
  await userEvent.click(within(nav).getByRole('button',{name:'Échanges et documents'}));
  await userEvent.click(screen.getByRole('button',{name:'Documents et pièces jointes'}));
  await userEvent.click(screen.getByRole('button',{name:'Présentation précédente'}));
  expect(localStorage.getItem(CASE_PRESENTATION_KEY)).toBe('previous');
  await userEvent.click(screen.getByRole('tab',{name:'Devis & offre'}));
  await userEvent.click(screen.getByText('Devis confirmé, versions et envoi'));
  expect(screen.getByRole('textbox',{name:'Brouillon de test'})).toBe(input);
  expect(input).toHaveValue('Texte non enregistré');
  await userEvent.click(screen.getByRole('button',{name:'Présentation guidée'}));
  expect(input).toBeVisible();expect(input).toHaveValue('Texte non enregistré');
  expect(versionMounts).toBe(1);expect(invoke).not.toHaveBeenCalled();
});

it('orders the guided quote tab as client version, latest calculation, then estimates, with the same instances',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';const {container}=mount();
  await userEvent.click(within(screen.getByRole('navigation',{name:'Navigation du dossier'})).getByRole('button',{name:'Devis'}));
  const client=screen.getByRole('region',{name:'Devis destiné au client'});
  const calculation=screen.getByRole('region',{name:'Dernier calcul du devis'});
  const estimate=container.querySelector('#section-scenario-variants')!;
  expect(client).toContainElement(container.querySelector('#section-version'));
  expect(client).toContainElement(container.querySelector('#section-send'));
  expect(calculation).toContainElement(container.querySelector('#section-pricing-result'));
  expect(container.querySelector('#section-pricing-result')).not.toHaveAttribute('open');
  expect(estimate).toContainElement(screen.getByLabelText('Résultat de l’estimation sélectionnée'));
  expect(client.compareDocumentPosition(calculation)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(calculation.compareDocumentPosition(estimate)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const input=screen.getByRole('textbox',{name:'Brouillon de test'});await userEvent.type(input,'Saisie conservée');
  await userEvent.click(screen.getByRole('button',{name:'Présentation précédente'}));
  expect(screen.queryByRole('region',{name:'Devis destiné au client'})).toBeNull();
  const previous=screen.getByText('Devis confirmé, versions et envoi').closest('details')!;
  expect(previous).not.toHaveAttribute('open');
  expect(previous).toContainElement(container.querySelector('#section-version'));
  expect(previous).toContainElement(container.querySelector('#section-send'));
  expect(screen.getByLabelText('Résultat de l’estimation sélectionnée').compareDocumentPosition(previous)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('textbox',{name:'Brouillon de test',hidden:true})).toBe(input);expect(input).toHaveValue('Saisie conservée');
  await userEvent.click(screen.getByRole('button',{name:'Présentation guidée'}));
  expect(screen.getByRole('region',{name:'Devis destiné au client'})).toContainElement(input);
  expect(input).toBeVisible();expect(input).toHaveValue('Saisie conservée');
  expect(versionMounts).toBe(1);expect(invoke).not.toHaveBeenCalled();expect(estimateAction).not.toHaveBeenCalled();
});

it('keeps the calculation first and open before any client version exists',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='PRICED_DRAFT';const {container}=mount();
  await userEvent.click(within(screen.getByRole('navigation',{name:'Navigation du dossier'})).getByRole('button',{name:'Devis'}));
  expect(screen.queryByRole('region',{name:'Devis destiné au client'})).toBeNull();
  const calculation=screen.getByRole('region',{name:'Dernier calcul du devis'});
  expect(calculation).toContainElement(container.querySelector('#section-pricing-result'));
  expect(calculation).toContainElement(container.querySelector('#section-version'));
  expect(container.querySelector('#section-pricing-result')).toHaveAttribute('open');
  expect(calculation.compareDocumentPosition(container.querySelector('#section-scenario-variants')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('Calcul')).toBeInTheDocument();expect(screen.queryByText('Pricing')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it.each(['fetching','error'])('does not advise an action from stale cockpit data while %s',mode=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);cockpitFetching=mode==='fetching';cockpitError=mode==='error'?new Error('offline'):null;
  mount();const todo=screen.getByRole('region',{name:'À faire dans le dossier'});
  expect(within(todo).queryByRole('button',{name:'Relire le calcul avant de créer une version'})).toBeNull();
  expect(within(todo).queryByRole('region',{name:'Document destiné au client'})).toBeNull();
  expect(screen.getByRole('button',{name:'Échanges et documents'})).toBeEnabled();
});

it('does not describe a dossier with no proposed action as complete',()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='RFQ_DETECTED';mount();
  expect(screen.getByText(/Aucune action automatique proposée/)).toBeVisible();
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps guided printing reversible and without duplicate form instances',()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';const {container}=mount();
  const details=Array.from(container.querySelectorAll('details'));const before=details.map(d=>d.open);
  window.dispatchEvent(new Event('beforeprint'));expect(details.every(d=>d.open)).toBe(true);
  window.dispatchEvent(new Event('afterprint'));expect(details.map(d=>d.open)).toEqual(before);
  expect(versionMounts).toBe(1);expect(invoke).not.toHaveBeenCalled();
});

it.each(['create','message'])('focuses the real %s panel from the guided action',async(kind)=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status=kind==='create'?'PRICED_DRAFT':'QUOTED_VERSIONED';
  if(kind==='message') cockpitOverrides={hasSelectedVersion:true,hasPdf:true,hasDraftEmail:true};
  const {container}=mount();
  await userEvent.click(screen.getByRole('button',{name:kind==='create'?'Relire le calcul avant de créer une version':'Relire les éléments et tracer l’envoi manuel'}));
  const target=container.querySelector(kind==='create'?'#section-pricing-result':'#section-send');
  expect(target).toHaveFocus();expect(target).toBeVisible();expect(invoke).not.toHaveBeenCalled();
});

it('keeps the fallback preference across a new mount and tolerates unavailable storage',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);const first=mount();
  await userEvent.click(screen.getByRole('button',{name:'Présentation précédente'}));
  first.unmount();const second=mount();
  expect(screen.getByRole('tab',{name:'Devis & offre'})).toBeVisible();second.unmount();
  const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('disabled');});
  const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('disabled');});
  try {
    mount();await userEvent.click(screen.getByRole('button',{name:'Présentation précédente'}));
    expect(screen.getByRole('tab',{name:'Devis & offre'})).toBeVisible();
  } finally {read.mockRestore();write.mockRestore();}
  expect(invoke).not.toHaveBeenCalled();
});

it('names the missing information and focuses its existing control without writing',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='NEED_INFO';cockpitOverrides={blockingGapsCount:1};
  const {container}=mount();
  const missing=screen.getByRole('region',{name:'Informations à compléter'});
  await userEvent.click(within(missing).getByRole('button',{name:'Catégorie PAD à préciser'}));
  expect(container.querySelector('#gap-review-g')).toHaveFocus();
  expect(container.querySelector('#gap-review-g')).toBeVisible();
  expect(invoke).not.toHaveBeenCalled();
});

it('moves keyboard focus to documents and distinguishes dossier printing from the client PDF',async()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);const {container}=mount();
  expect(screen.getByRole('button',{name:'Imprimer le dossier'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Imprimer PDF'})).toBeNull();
  await userEvent.click(screen.getByRole('button',{name:'Échanges et documents'}));
  screen.getByRole('button',{name:'Documents et pièces jointes'}).focus();
  await userEvent.keyboard('{Enter}');
  expect(container.querySelector('#section-sources')).toHaveFocus();
  expect(screen.getByRole('tab',{name:'Documents (0)'})).toHaveAttribute('data-state','active');
  expect(invoke).not.toHaveBeenCalled();
});

it.each([['Vérifier le PDF client','section-version'],['Relire le destinataire et le message','section-send']])('opens the existing %s control without mutations',async(label,id)=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';
  cockpitOverrides={hasSelectedVersion:true,selectedVersionNumber:1};
  const {container}=mount();await userEvent.click(screen.getByRole('button',{name:label}));
  expect(container.querySelector('#'+id)).toHaveFocus();expect(invoke).not.toHaveBeenCalled();
});

it('shows saved client preparation with an unsaved warning, and hides it during errors or a version mismatch',()=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);status='QUOTED_VERSIONED';
  cockpitOverrides={hasSelectedVersion:true,selectedVersionNumber:1,selectedVersionId:'v1'};
  preparationFixture={caseId:'case-a',versionId:'v1',loading:false,error:false,hasPdf:true,hasDraft:true,
    recipient:'client@example.com',subject:'Offre Dakar',hasMessage:true,unsaved:true};
  const {rerender}=mount();const summary=screen.getByRole('region',{name:'Préparation de la version sélectionnée'});
  expect(summary).toHaveTextContent('Destinataire enregistré : client@example.com');
  expect(summary).toHaveTextContent('Objet enregistré : Offre Dakar');
  expect(summary).toHaveTextContent('Modifications non enregistrées');
  preparationFixture={...preparationFixture,error:true};
  rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(summary).not.toHaveTextContent('client@example.com');expect(summary).toHaveTextContent('n’ont pas pu être actualisés');
  preparationFixture={...preparationFixture,error:false};cockpitOverrides={...cockpitOverrides,selectedVersionId:'v2',selectedVersionNumber:2};
  rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(summary).not.toHaveTextContent('client@example.com');expect(invoke).not.toHaveBeenCalled();
});


it('preserves the same scenario draft through tab navigation and both presentation modes', async () => {
  localStorage.removeItem(CASE_PRESENTATION_KEY); mount();
  await userEvent.click(screen.getByRole('button', { name: 'Devis' }));
  const input = screen.getByRole('textbox', { name: 'Note variante non enregistrée' });
  await userEvent.type(input, 'Variante à revoir');
  await userEvent.click(screen.getByRole('button', { name: 'Marchandise' }));
  expect(input).not.toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Présentation précédente' }));
  fireEvent.click(screen.getByText('Marchandises et catégories portuaires', { exact: false }));
  fireEvent.click(screen.getByText('Variantes, choix de l’estimation et historique'));
  expect(screen.getByRole('textbox', { name: 'Note variante non enregistrée' })).toBe(input);
  expect(input).toHaveValue('Variante à revoir');
  await userEvent.click(screen.getByRole('button', { name: 'Présentation guidée' }));
  await userEvent.click(screen.getByRole('button', { name: 'Devis' }));
  expect(screen.getByRole('textbox', { name: 'Note variante non enregistrée' })).toBe(input);
  expect(input).toHaveValue('Variante à revoir');
  expect(invoke).not.toHaveBeenCalled(); expect(estimateAction).not.toHaveBeenCalled();
});


it.each([true,false])('opens AIR customs preparation before pricing from the real case navigation, guided=%s',async(guided)=>{
  status='NEED_INFO';requestType='AIR_IMPORT';localStorage.setItem(CASE_PRESENTATION_KEY,guided?'guided':'previous');mount();
  await userEvent.click(screen.getByRole('button',{name:'Préparer les montants'}));
  const target=screen.getByRole('region',{name:'Préparation des montants'});expect(target).toBeVisible();expect(target).toHaveFocus();
  await userEvent.click(within(target).getByRole('button',{name:'Bases douanières'}));
  expect(screen.getByRole('button',{name:'Lire les propositions depuis les pièces'})).toBeVisible();
  expect(document.getElementById('section-customs-basis')).toHaveFocus();expect(invoke).not.toHaveBeenCalled();
});
it('keeps commercial preparation before version history and mounted once across presentations',async()=>{
  status='QUOTED_VERSIONED';requestType='AIR_IMPORT';localStorage.setItem(CASE_PRESENTATION_KEY,'guided');mount();
  await userEvent.click(screen.getByRole('button',{name:'Préparer les montants'}));
  const preparation=screen.getByRole('region',{name:'Préparation des montants'}),versions=document.getElementById('section-version')!;
  expect(preparation.compareDocumentPosition(versions)&Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(within(preparation).getByText('CommercialPreparationWorkspace')).toBeVisible();
  await userEvent.click(screen.getByRole('button',{name:'Présentation précédente'}));
  expect(screen.getAllByText('CommercialPreparationWorkspace')).toHaveLength(1);
});
