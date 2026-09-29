import React, { useEffect, useImperativeHandle, useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { CockpitState } from '@/hooks/useCockpitState';
import type { QuotationPreparationSummary } from '@/components/puzzle/SendQuotationPanel';
import { CASE_PRESENTATION_KEY } from '../presentation';
import userEvent from '@testing-library/user-event';
import type { SelectedScenarioEstimate } from '@/components/case/ScenarioEstimateResult';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Exercise the actual CaseView composition + pricing/result components.
// Unrelated panels and I/O are test doubles; no network or customer data.
const empty: never[] = [];
const invoke = vi.fn(), estimateAction = vi.fn();
let caseId = 'case-a', status = 'PRICED_DRAFT', hasSelection = true, totalPartnerRequests = 0, closedPartnerRequests = 0;
let cockpitOverrides: Partial<CockpitState> = {}, cockpitError: Error | null = null, cockpitFetching = false;
let versionMounts = 0;
let preparationFixture: QuotationPreparationSummary | null = null;
const run: NonNullable<SelectedScenarioEstimate['run']> = { id:'r', scenario_id:'s', run_seq:1, status:'success', qualification:'partial',
  firm_total_ht:0,firm_total_ttc:0,assumptions_snapshot:[],
  completed_at:'2026-09-15T12:00:00Z', currency:'XOF', indicative_total_ht:1000, indicative_total_ttc:1180,
  tariff_lines:[{id:'pad',category:'PAD_DROIT_PASSAGE',amount:null,notes:'Catégorie à choisir',source:{type:'TO_CONFIRM'}}],
  reservations:['SCENARIO_DG_UNKNOWN'],blockers:[] };
const gaps = [{id:'g',gap_key:'cargo.pad_category',status:'open',is_blocking:true,question_fr:'Catégorie PAD à préciser'}];
const facts = [{id:'f',fact_key:'service.package',value_text:'DAP',is_current:true}];
vi.doMock('react-router-dom',()=>({useParams:()=>({caseId}),useNavigate:()=>vi.fn()}));
vi.doMock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke},from:vi.fn()}}));
vi.doMock('@tanstack/react-query',async()=>({
  ...await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query'),
  useQuery:({queryKey}:{queryKey:string[]})=>({isLoading:false,error:queryKey[0]==='cockpit-state'?cockpitError:null,isFetching:queryKey[0]==='cockpit-state'&&cockpitFetching,refetch:vi.fn(),
    data: queryKey[0]==='case-view' ? {id:caseId,status,request_type:'SEA_FCL_IMPORT',puzzle_completeness:70}
      : queryKey[0]==='case-facts' ? facts : queryKey[0]==='case-gaps' ? gaps
      : queryKey[0]==='cockpit-state' ? {status,totalPartnerRequests,closedPartnerRequests,blockingGapsCount:0,padReviewCount:0,...cockpitOverrides}
      : queryKey[0].includes('count') || queryKey[0]==='pricing-provisional-check' ? 0
      : queryKey[0]==='pricing-run-recovery' ? null : empty}),
}));
const source = readFileSync(resolve('src/pages/CaseView.tsx'),'utf8');
for (const match of source.matchAll(/import (.+) from "(@\/components\/(?:case|puzzle|layout)\/[^"]+)";/g)) {
  const [, imported, path] = match;
  if (path.endsWith('/ScenarioEstimateResult') || path.endsWith('/PricingLaunchPanel') || path.endsWith('/CaseTodoCard')) continue;
  const names=imported.startsWith('{') ? imported.replace(/[{}]/g,'').split(',').map(s=>s.trim()).filter(s=>!s.startsWith('type ')) : ['default'];
  vi.doMock(path,()=>Object.fromEntries(names.map(name=>[name, path.endsWith('/MainLayout')
    ? ({children}:{children:React.ReactNode})=><main>{children}</main>
    : path.endsWith('/QuoteScenariosPanel') ? function ScenarioDouble(props: {caseId:string;onSelectedEstimateChange:(value:SelectedScenarioEstimate|null)=>void;actionRef:React.Ref<{estimateSelected:()=>void}>}) {
      const {caseId:fixtureCaseId,onSelectedEstimateChange,actionRef}=props;
      useEffect(()=>{onSelectedEstimateChange(hasSelection ? {caseId:fixtureCaseId,title:'Scénario test',run,pending:false,error:null}:null);},[fixtureCaseId,onSelectedEstimateChange]);
      useImperativeHandle(actionRef,()=>({estimateSelected:estimateAction}));
      return <p>Groupes de test à vérifier</p>;
    } : path.endsWith('/QuotationVersionCard') ? function VersionDouble() {
      const [draft,setDraft]=useState('');useEffect(()=>{versionMounts++;},[]);
      return <label>Brouillon de test<input value={draft} onChange={e=>setDraft(e.target.value)} /></label>;
    } : path.endsWith('/SendQuotationPanel') ? function SendDouble({onPreparationChange}:{onPreparationChange:(summary:QuotationPreparationSummary)=>void}) {
      const fixture=preparationFixture;
      useEffect(()=>{if(fixture) onPreparationChange(fixture);},[onPreparationChange,fixture]);
      return <p>Panneau envoi de test</p>;
    } : path.endsWith('/PadGroupConfirmationsPanel') ? ({onChanged}:{onChanged:()=>void}) => <button onClick={onChanged}>Simuler actualisation du dossier</button>
      : ()=> <p>{path.split('/').pop()}</p>])));
}
const CaseView = (await import('../../CaseView')).default;
let client: QueryClient;
beforeEach(()=>{caseId='case-a';status='PRICED_DRAFT';hasSelection=true;totalPartnerRequests=0;closedPartnerRequests=0;invoke.mockReset();estimateAction.mockReset();
  localStorage.setItem(CASE_PRESENTATION_KEY,'previous');cockpitOverrides={};cockpitError=null;cockpitFetching=false;versionMounts=0;preparationFixture=null;
  client=new QueryClient(); Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();client.clear();localStorage.clear();});
const mount=()=>render(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);

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
  expect(cargoActions).toHaveTextContent('Actions cargo canonique');
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
  expect(screen.getByRole('button',{name:'Relire les éléments et tracer l’envoi manuel'})).toBeVisible();
  cockpitOverrides={...cockpitOverrides,selectedVersionNumber:2,selectedVersionSnapshot:{totals:{total_payable:1450000,currency:'XOF'},meta:{quoteQualification:{level:'firm'}}}};
  rerender(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);
  expect(clientQuote).toHaveTextContent('Version v2');expect(clientQuote).not.toHaveTextContent('Livraison à Thiès');
  expect(clientQuote).toHaveTextContent('qualification ferme');expect(invoke).not.toHaveBeenCalled();
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

it.each(['fetching','error'])('does not advise an action from stale cockpit data while %s',mode=>{
  localStorage.removeItem(CASE_PRESENTATION_KEY);cockpitFetching=mode==='fetching';cockpitError=mode==='error'?new Error('offline'):null;
  mount();const todo=screen.getByRole('region',{name:'À faire dans le dossier'});
  expect(within(todo).queryByRole('button',{name:'Relire le calcul avant de créer une version'})).toBeNull();
  expect(within(todo).queryByRole('region',{name:'Document destiné au client'})).toBeNull();
  expect(within(todo).getByRole('button',{name:'Consulter les documents'})).toBeEnabled();
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
  screen.getByRole('button',{name:'Consulter les documents'}).focus();
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
