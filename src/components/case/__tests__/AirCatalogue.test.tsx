import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AirCatalogueAdmin } from '../AirCatalogueAdmin';
import { AirCatalogueSelection } from '../AirCatalogueSelection';
import { airTariffSeed } from '../../../../supabase/functions/_shared/air-tariff-seed';
import type { AirCatalogue } from '../../../../supabase/functions/_shared/air-tariff';
const mock=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),admin:true,fail:false,readFail:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,functions:{invoke:mock.invoke}}}));
vi.mock('sonner',()=>({toast:{success:vi.fn()}}));
class ResizeObserverStub {observe(){}unobserve(){}disconnect(){}}
globalThis.ResizeObserver=ResizeObserverStub;
Element.prototype.scrollIntoView=vi.fn();Element.prototype.hasPointerCapture=()=>false;Element.prototype.setPointerCapture=()=>{};Element.prototype.releasePointerCapture=()=>{};
const seed:AirCatalogue={id:'catalogue-1',parent_id:null,revision:1,effective_from:'2026-10-16',effective_to:null,source_reference:'Synthetic complete workbook source',payload:structuredClone(airTariffSeed)};
let catalogues:AirCatalogue[],caseState:Record<string,unknown>;
const wrap=(ui:React.ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
async function select(label:string,option:string|RegExp){fireEvent.keyDown(screen.getByLabelText(label),{key:'Enter'});fireEvent.click(await screen.findByRole('option',{name:option}));}
beforeEach(()=>{
  mock.admin=true;mock.fail=false;mock.readFail=false;catalogues=[structuredClone(seed)];
  caseState={selection:null,catalogue:null,basis:null,context_hash:'ctx',facts:[{id:'gross',fact_key:'cargo.weight_kg',value_number:190,is_validated:true}],request_type:'AIR_IMPORT',lot_count:0};
  mock.rpc.mockReset();mock.invoke.mockReset();mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
    if(name==='air_tariff_read')return {error:mock.readFail?{}:null,data:args.p_case_id?caseState:{catalogues,can_edit:mock.admin}};
    if(mock.fail)return {error:{},data:null};
    if(name==='air_tariff_publish'){catalogues=[...catalogues,{...seed,id:String(args.p_id),parent_id:String(args.p_parent_id),revision:2,payload:args.p_payload as AirCatalogue['payload'],effective_from:String(args.p_effective_from),effective_to:args.p_effective_to as string|null,source_reference:String(args.p_source_reference)}];return {data:args.p_id,error:null};}
    if(name==='air_tariff_select'){caseState={...caseState,selection:{id:args.p_id},catalogue:catalogues[0],basis:args.p_basis};return {data:args.p_id,error:null};}
    throw new Error('Unexpected RPC '+name);
  });
});
afterEach(cleanup);
describe('Complete AIR catalogue administration',()=>{
  it('shows all180 entries in a bounded catalogue, textual billing codes, source and contradictory export label',async()=>{
    wrap(<AirCatalogueAdmin/>);await screen.findByText(/180 rubriques enregistrées/);expect(screen.getAllByRole('row')).toHaveLength(11);
    await select('Famille de rubriques','Codes de facturation');expect(screen.getByText(/0100 — Montant associé/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Consulter ou modifier billing_0100'}));expect(screen.getByLabelText(/Code de facturation \(texte/)).toHaveValue('0100');
    await select('Famille de rubriques','Frigorifique');fireEvent.click(screen.getByRole('button',{name:'Page suivante'}));
    expect(screen.getAllByText(/EXPORT/).length).toBeGreaterThan(0);
  });
  it('saves a complete child revision after an ordinary-storage rate edit; all other source rubrics survive',async()=>{
    wrap(<AirCatalogueAdmin/>);await screen.findByText(/180 rubriques/);await select('Famille de rubriques','Magasinage ordinaire');
    fireEvent.click(screen.getByRole('button',{name:'Consulter ou modifier storage_0'}));fireEvent.change(screen.getByLabelText('Montant ou pourcentage'),{target:{value:'23'}});
    fireEvent.change(screen.getByLabelText('Justification de la nouvelle révision complète'),{target:{value:'Synthetic new supplier storage tariff'}});
    fireEvent.change(screen.getByLabelText('Début du catalogue (AAAA-MM-JJ)'),{target:{value:'2099-01-01'}});
    fireEvent.click(screen.getByRole('button',{name:'Enregistrer le catalogue complet'}));await waitFor(()=>expect(catalogues).toHaveLength(2));
    expect(catalogues[1].payload.entries).toHaveLength(180);expect(catalogues[1].payload.entries.find(e=>e.key==='storage_0')!.value).toBe(23);
    expect(catalogues[1].payload.entries.filter(e=>e.key!=='storage_0')).toEqual(seed.payload.entries.filter(e=>e.key!=='storage_0'));expect(catalogues[0]).toEqual(seed);
    await waitFor(()=>expect(screen.queryByText(/Modifications non enregistrées/)).not.toBeInTheDocument());
  });
  it('offers all fifteen annex services including minimum and started-hour units',async()=>{
    wrap(<AirCatalogueAdmin/>);await screen.findByText(/180 rubriques/);await select('Famille de rubriques','Services annexes');
    fireEvent.click(screen.getByRole('button',{name:'Consulter ou modifier service_5201'}));expect(screen.getByLabelText('Minimum de perception')).toHaveValue('13100');
    expect(screen.getByText(/XOF\/heure commencée\/agent/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Page suivante'}));expect(screen.getByRole('button',{name:'Consulter ou modifier service_5215'})).toBeInTheDocument();
  });
  it('preserves the draft and operation ID after uncertain failure and blocks duplicate submits',async()=>{
    mock.fail=true;wrap(<AirCatalogueAdmin/>);await screen.findByText(/180 rubriques/);fireEvent.change(screen.getByLabelText('Justification de la nouvelle révision complète'),{target:{value:'Synthetic retry source reference'}});
    const save=screen.getByRole('button',{name:'Enregistrer le catalogue complet'});fireEvent.click(save);fireEvent.click(save);
    const error=await screen.findByText(/Enregistrement non confirmé/);await waitFor(()=>expect(error).toHaveFocus());
    expect(mock.rpc.mock.calls.filter(c=>c[0]==='air_tariff_publish')).toHaveLength(1);fireEvent.click(save);await waitFor(()=>expect(mock.rpc.mock.calls.filter(c=>c[0]==='air_tariff_publish')).toHaveLength(2));
    const calls=mock.rpc.mock.calls.filter(c=>c[0]==='air_tariff_publish');expect(calls[1][1].p_id).toBe(calls[0][1].p_id);expect(screen.getByLabelText('Justification de la nouvelle révision complète')).toHaveValue('Synthetic retry source reference');
  });
  it('keeps operator tariff edits disabled and gives a read retry',async()=>{
    mock.admin=false;mock.readFail=true;wrap(<AirCatalogueAdmin/>);await screen.findByText(/Catalogue indisponible/);mock.readFail=false;fireEvent.click(screen.getByRole('button',{name:'Réessayer le catalogue'}));
    await screen.findByText(/180 rubriques/);expect(screen.getByRole('button',{name:'Enregistrer le catalogue complet'})).toBeDisabled();expect(mock.rpc.mock.calls.every(c=>c[0]==='air_tariff_read')).toBe(true);
  });
  it('associates a saved catalogue with explicit gross weight and hypothetical billable days, never an operator tariff amount',async()=>{
    wrap(<AirCatalogueSelection caseId="case-1" isLocked={false}/>);await screen.findByLabelText('Catalogue à associer');
    await select('Catalogue à associer',/révision 1/);fireEvent.click(screen.getByLabelText('La pièce confirme 2AS, DSS et la nature general cargo de ce dossier.'));
    fireEvent.change(screen.getByLabelText('Justification du choix de catalogue et de la nature'),{target:{value:'Synthetic source and general cargo attestation'}});
    fireEvent.click(screen.getByLabelText('Renseigner le magasinage ordinaire pour ce dossier'));
    await select('Fait de poids servant de base au magasinage',/Poids brut — 190 kg/);fireEvent.change(screen.getByLabelText(/Nombre de jours facturables/),{target:{value:'2'}});
    await select('Qualification des jours','Hypothèse explicite — estimation séparée');fireEvent.change(screen.getByLabelText('Source du poids choisi, du tarif applicable et des jours facturables'),{target:{value:'Synthetic documented weight and two assumed days'}});
    fireEvent.click(screen.getByRole('button',{name:'Associer le catalogue et les bases'}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('air_tariff_select',expect.objectContaining({p_catalogue_id:'catalogue-1',p_context_hash:'ctx',p_basis:expect.objectContaining({ordinary_storage:{enabled:true,tariff_key:'storage_0',weight_fact_id:'gross',billable_days:2,days_status:'assumed',source_reference:'Synthetic documented weight and two assumed days'}})})));
    const args=mock.rpc.mock.calls.find(c=>c[0]==='air_tariff_select')![1];expect(JSON.stringify(args.p_basis)).not.toContain('unit_rate');
  });
  it('does not associate or classify automatically and blocks locked submissions',async()=>{
    wrap(<AirCatalogueSelection caseId="case-1" isLocked/>);await screen.findByLabelText('Catalogue à associer');expect(screen.getByRole('button',{name:'Associer le catalogue et les bases'})).toBeDisabled();expect(mock.rpc.mock.calls.every(c=>c[0]==='air_tariff_read')).toBe(true);
  });
});
