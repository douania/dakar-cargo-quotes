import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import AirHandling from '@/pages/admin/AirHandling';
import { AirHandlingPanel, AirHandlingResult } from '../AirHandlingPanel';
import { resolveAirHandling, type AirProfile, type AirState } from '../../../../supabase/functions/_shared/air-handling';

const mock = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), canEdit: false, failRead: false, failWrite: false, writes: [] as string[] }));
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverStub;
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc, functions: { invoke: mock.invoke } } }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
const profile: AirProfile = { id:'profile-1',revision:1,supplier:'2AS',airport:'DSS',direction:'IMPORT',cargo_class:'GENERAL_CARGO',effective_from:'2026-10-16',effective_to:null,
  rates:{collection_per_kg:20,security_per_kg:10,documents:25000,warehouse_passage:6000,it:1500},source_reference:'Synthetic source reference',evidence:{} };
const state: AirState = {selection:null,profile:null,context_hash:'facts-1',request_type:'AIR_IMPORT',lot_count:0,facts:[]};
const wrap = (child: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions:{queries:{retry:false},mutations:{retry:false}} })}><MemoryRouter>{child}</MemoryRouter></QueryClientProvider>);
beforeEach(() => {
  mock.canEdit=false;mock.failRead=false;mock.failWrite=false;mock.writes=[];
  mock.rpc.mockReset();mock.invoke.mockReset();
  mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
    if(name==='air_handling_read') return mock.failRead ? {error:{},data:null} : {error:null,data:args.p_case_id ? state : {profiles:[profile],can_edit:mock.canEdit}};
    mock.writes.push(name);return {error:mock.failWrite?{}:null,data:null};
  });
  mock.invoke.mockImplementation(async(_name:string,{body}:{body:Record<string,unknown>})=>({error:null,data:{ok:true,data:{resolution:resolveAirHandling({ ...state, profile,
    selection:{id:'example',profile_id:profile.id,context_hash:'facts-1',source_reference:'Synthetic example',warehouse_bracket_confirmed:body.warehouse_bracket_confirmed===true},
    facts:[{fact_key:'cargo.chargeable_weight_kg',value_number:Number(body.taxable_kg),source_type:'operator'}]},'2026-10-16')}}}));
});
afterEach(cleanup);
describe('AIR_HANDLING controlled supplier configuration',()=>{
  it('shows provenance and reserves; an operator can simulate without tariff write permission',async()=>{
    wrap(<AirHandling/>);await screen.findByText(/Source : Synthetic source reference/);
    expect(screen.getByRole('button',{name:'Enregistrer une nouvelle révision'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Poids taxable LTA de l’exemple, en kg'),{target:{value:'64'}});
    fireEvent.click(screen.getByLabelText('Éligibilité passage magasin moins d’une tonne attestée pour cet exemple'));
    fireEvent.click(screen.getByRole('button',{name:'Simuler l’achat fournisseur'}));
    await screen.findByText(/Sous-total achat HT connu : 34\s?420 FCFA/);
    expect(screen.getByText(/TTC fournisseur et prix de vente SODATRA : à confirmer/)).toBeInTheDocument();
    expect(mock.writes).toEqual([]);expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it('rejects empty monetary inputs and focuses the validation error without invoking a mutation',async()=>{
    mock.canEdit=true;wrap(<AirHandling/>);await screen.findByText(/Source :/);
    fireEvent.change(screen.getByLabelText('Collecte HT par kg taxable'),{target:{value:''}});
    fireEvent.click(screen.getByRole('button',{name:'Enregistrer une nouvelle révision'}));
    const error=await screen.findByText(/Renseignez les cinq montants/);await waitFor(()=>expect(error).toHaveFocus());expect(mock.writes).toEqual([]);
  });
  it('keeps entered source after a rejected or uncertain write and prevents duplicate submits',async()=>{
    mock.canEdit=true;mock.failWrite=true;wrap(<AirHandling/>);await screen.findByText(/Source :/);
    fireEvent.change(screen.getByLabelText('Référence du barème et validation de cette révision'),{target:{value:'Synthetic revised source confirmation'}});
    const button=screen.getByRole('button',{name:'Enregistrer une nouvelle révision'});fireEvent.click(button);fireEvent.click(button);
    await screen.findByText(/Enregistrement non confirmé/);expect(mock.writes).toEqual(['air_handling_publish']);
    expect(screen.getByLabelText('Référence du barème et validation de cette révision')).toHaveValue('Synthetic revised source confirmation');
  });
  it('offers read retry after database failure instead of showing a fictitious zero or empty tariff',async()=>{
    mock.failRead=true;wrap(<AirHandling/>);await screen.findByText(/Profils indisponibles/);
    mock.failRead=false;fireEvent.click(screen.getByRole('button',{name:'Réessayer la lecture'}));await screen.findByText(/Source : Synthetic/);
  });
  it('does not automatically classify a case or associate a supplier profile',async()=>{
    wrap(<AirHandlingPanel caseId="case-1" isLocked={false}/>);await screen.findByText('Sélection enregistrée : Aucune');
    expect(screen.getByRole('button',{name:'Simuler sans enregistrer de calcul'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Associer pour les prochains calculs'}));
    await screen.findByText(/Choisissez un profil, confirmez la nature/);expect(mock.writes).toEqual([]);
  });
  it('keeps a locked case read-only',async()=>{
    wrap(<AirHandlingPanel caseId="case-1" isLocked/>);await screen.findByText('Sélection enregistrée : Aucune');
    expect(screen.getByRole('button',{name:'Associer pour les prochains calculs'})).toBeDisabled();
  });
  it('ignores an in-flight case preview after cached facts or selection changed',async()=>{
    const bound={...state,profile,selection:{id:'s',profile_id:profile.id,context_hash:'facts-1',source_reference:'Synthetic source',warehouse_bracket_confirmed:true},facts:[{fact_key:'cargo.chargeable_weight_kg',value_number:64,source_type:'operator'}]};
    mock.rpc.mockImplementation(async(_name:string,args:Record<string,unknown>)=>({error:null,data:args.p_case_id?bound:{profiles:[profile],can_edit:false}}));
    let resolvePreview!:(value:unknown)=>void;mock.invoke.mockImplementationOnce(()=>new Promise(resolve=>{resolvePreview=resolve;}));
    const q=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={q}><MemoryRouter><AirHandlingPanel caseId="case-1" isLocked={false}/></MemoryRouter></QueryClientProvider>);
    await screen.findByText('Sélection enregistrée : 2AS révision 1');
    fireEvent.click(screen.getByRole('button',{name:'Simuler sans enregistrer de calcul'}));
    await act(async()=>{q.setQueryData(['air-handling-case','case-1'],{...bound,context_hash:'facts-2'});});
    await act(async()=>{resolvePreview({error:null,data:{ok:true,data:{resolution:resolveAirHandling(bound,'2026-10-16')}}});});
    expect(screen.queryByText(/Sous-total achat HT connu/)).not.toBeInTheDocument();
  });
  it('clears a completed preview when a new profile revision is saved',async()=>{
    mock.canEdit=true;let profiles=[profile];
    mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
      if(name==='air_handling_read')return {error:null,data:{profiles,can_edit:true}};
      profiles=[...profiles,{...profile,id:String(args.p_id),revision:2,source_reference:String(args.p_source_reference)}];return {error:null,data:args.p_id};
    });
    wrap(<AirHandling/>);await screen.findByText(/Source :/);
    fireEvent.change(screen.getByLabelText('Poids taxable LTA de l’exemple, en kg'),{target:{value:'64'}});
    fireEvent.click(screen.getByRole('button',{name:'Simuler l’achat fournisseur'}));await screen.findByText(/Sous-total achat HT connu/);
    fireEvent.change(screen.getByLabelText('Référence du barème et validation de cette révision'),{target:{value:'Synthetic revised supplier source'}});
    fireEvent.click(screen.getByRole('button',{name:'Enregistrer une nouvelle révision'}));
    await waitFor(()=>expect(screen.queryByText(/Sous-total achat HT connu/)).not.toBeInTheDocument());
    await screen.findByText(/Source : Synthetic revised supplier source/);
  });
  it('publishes all five edited rates and validity dates as a child revision without changing the original',async()=>{
    mock.canEdit=true;const original=structuredClone(profile);let profiles=[profile];
    mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
      if(name==='air_handling_read')return {error:null,data:{profiles,can_edit:true}};
      profiles=[...profiles,{...profile,id:String(args.p_id),revision:2,rates:args.p_rates as AirProfile['rates'],
        effective_from:String(args.p_effective_from),effective_to:String(args.p_effective_to),source_reference:String(args.p_source_reference)}];
      return {error:null,data:args.p_id};
    });
    wrap(<AirHandling/>);await screen.findByText(/Source :/);
    for(const [label,value] of [['Collecte HT par kg taxable','21'],['Sécurité HT par kg taxable','11'],['Remise documentaire HT','26000'],
      ['Passage magasin HT, éligibilité attestée','6500'],['Informatique HT','1700']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
    fireEvent.change(screen.getByLabelText(/Début d.application \(AAAA-MM-JJ\)/),{target:{value:'2026-11-01'}});
    fireEvent.change(screen.getByLabelText(/Fin d.application, facultative \(AAAA-MM-JJ\)/),{target:{value:'2027-10-31'}});
    fireEvent.change(screen.getByLabelText('Référence du barème et validation de cette révision'),{target:{value:'Synthetic revised rates and validity conditions'}});
    fireEvent.click(screen.getByRole('button',{name:'Enregistrer une nouvelle révision'}));
    await screen.findByText(/Source : Synthetic revised rates and validity conditions/);
    expect(mock.rpc).toHaveBeenCalledWith('air_handling_publish',expect.objectContaining({p_parent_id:profile.id,
      p_rates:{collection_per_kg:21,security_per_kg:11,documents:26000,warehouse_passage:6500,it:1700},
      p_effective_from:'2026-11-01',p_effective_to:'2027-10-31',p_source_reference:'Synthetic revised rates and validity conditions'}));
    expect(profiles).toHaveLength(2);expect(profiles[0]).toEqual(original);expect(profiles[1].id).not.toBe(profile.id);
  });
  it('renders null costs as unknown while preserving an explicit known zero',()=>{
    const result=resolveAirHandling({...state,profile,selection:{id:'s',profile_id:profile.id,context_hash:'facts-1',source_reference:'Synthetic',warehouse_bracket_confirmed:false}},'2026-10-16')!;
    result.components[4].supplier_ht_xof=0;wrap(<AirHandlingResult result={result}/>);
    expect(screen.getAllByText('À confirmer HT fournisseur').length).toBeGreaterThan(0);expect(screen.getByText('0 FCFA HT fournisseur')).toBeInTheDocument();
  });
});
