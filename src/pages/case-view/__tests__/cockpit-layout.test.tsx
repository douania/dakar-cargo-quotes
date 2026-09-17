import React, { useEffect, useImperativeHandle } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SelectedScenarioEstimate } from '@/components/case/ScenarioEstimateResult';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Exercise the actual CaseView composition + pricing/result components.
// Unrelated panels and I/O are test doubles; no network or customer data.
const empty: never[] = [];
const invoke = vi.fn(), estimateAction = vi.fn();
let caseId = 'case-a', status = 'PRICED_DRAFT', hasSelection = true;
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
  useQuery:({queryKey}:{queryKey:string[]})=>({isLoading:false,error:null,refetch:vi.fn(),
    data: queryKey[0]==='case-view' ? {id:caseId,status,request_type:'SEA_FCL_IMPORT',puzzle_completeness:70}
      : queryKey[0]==='case-facts' ? facts : queryKey[0]==='case-gaps' ? gaps
      : queryKey[0].includes('count') || queryKey[0]==='pricing-provisional-check' ? 0
      : queryKey[0]==='pricing-run-recovery' ? null : empty}),
}));
const source = readFileSync(resolve('src/pages/CaseView.tsx'),'utf8');
for (const match of source.matchAll(/import (.+) from "(@\/components\/(?:case|puzzle|layout)\/[^"]+)";/g)) {
  const [, imported, path] = match;
  if (path.endsWith('/ScenarioEstimateResult') || path.endsWith('/PricingLaunchPanel')) continue;
  const names=imported.startsWith('{') ? imported.replace(/[{}]/g,'').split(',').map(s=>s.trim()).filter(s=>!s.startsWith('type ')) : ['default'];
  vi.doMock(path,()=>Object.fromEntries(names.map(name=>[name, path.endsWith('/MainLayout')
    ? ({children}:{children:React.ReactNode})=><main>{children}</main>
    : path.endsWith('/QuoteScenariosPanel') ? function ScenarioDouble(props: {caseId:string;onSelectedEstimateChange:(value:SelectedScenarioEstimate|null)=>void;actionRef:React.Ref<{estimateSelected:()=>void}>}) {
      const {caseId:fixtureCaseId,onSelectedEstimateChange,actionRef}=props;
      useEffect(()=>{onSelectedEstimateChange(hasSelection ? {caseId:fixtureCaseId,title:'Scénario test',run,pending:false,error:null}:null);},[fixtureCaseId,onSelectedEstimateChange]);
      useImperativeHandle(actionRef,()=>({estimateSelected:estimateAction}));
      return <p>Groupes de test à vérifier</p>;
    } : path.endsWith('/PadGroupConfirmationsPanel') ? ({onChanged}:{onChanged:()=>void}) => <button onClick={onChanged}>Simuler actualisation du dossier</button>
      : ()=> <p>{path.split('/').pop()}</p>])));
}
const CaseView = (await import('../../CaseView')).default;
let client: QueryClient;
beforeEach(()=>{caseId='case-a';status='PRICED_DRAFT';hasSelection=true;invoke.mockReset();estimateAction.mockReset();
  client=new QueryClient(); Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();client.clear();});
const mount=()=>render(<QueryClientProvider client={client}><CaseView /></QueryClientProvider>);

it('puts the current estimate first despite a PAD gap, with diagnostics and sources collapsed',()=>{
  const {container}=mount();
  const result=screen.getByLabelText('Résultat de l’estimation sélectionnée');
  expect(result.closest('details')).toBeNull();
  expect(screen.getByText(/Estimation disponible/)).toBeVisible();
  expect(screen.getByText('1 point à résoudre avant devis confirmé')).not.toBeVisible();
  expect(screen.getByText('Sources, faits et historique').closest('details')).not.toHaveAttribute('open');
  expect(container.querySelector('#section-pricing')!.compareDocumentPosition(container.querySelector('#section-scenarios')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
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
  await userEvent.click(screen.getByText('Marchandises et catégories portuaires'));
  await userEvent.click(screen.getByRole('button',{name:'Simuler actualisation du dossier'}));
  expect(invalidate).toHaveBeenCalledWith({queryKey:['pad-group-confirmations',caseId]});
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
