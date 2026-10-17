import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Link,Routes,Route} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {CommercialPreparationWorkspace} from '../CommercialPreparationWorkspace';
import {prepareCommercialQuote,reviseCommercialPreparation} from '@/lib/commercialPreparation';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
vi.mock('@/features/auth',()=>({useAuth:()=>({user:{id:'fixture-user'}})}));
class ResizeObserverStub{observe(){}unobserve(){}disconnect(){}}
globalThis.ResizeObserver=ResizeObserverStub;Element.prototype.scrollIntoView=vi.fn();Element.prototype.hasPointerCapture=()=>false;Element.prototype.setPointerCapture=()=>{};Element.prototype.releasePointerCapture=()=>{};
afterEach(()=>{cleanup();vi.restoreAllMocks();mocks.invoke.mockReset();});
const source={totals:{currency:'XOF'},raw_lines:[{label:'Handling',amount:null,source:{type:'TO_CONFIRM',air_handling:{supplier_known_ht_xof:34420}}}]};
function state(caseId:string){return{available:true,source_version_id:'source-version',source_hash:'source-hash',context_hash:'context-hash',head_id:null,draft:prepareCommercialQuote(caseId,'source-version',source),air:null,can_write:true,case_status:'QUOTED_VERSIONED'};}
const renderWorkspace=(caseId:string)=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return {...render(<QueryClientProvider client={client}><MemoryRouter><Routes><Route path="/" element={<><Link to="/away">Autre page</Link><CommercialPreparationWorkspace caseId={caseId} onVersionCreated={vi.fn()}/></>}/><Route path="/away" element={<Link to="/">Retour dossier</Link>}/></Routes></MemoryRouter></QueryClientProvider>),client};
};
async function edit(){fireEvent.click(await screen.findByRole('button',{name:'Modifier Handling'}));fireEvent.change(screen.getByLabelText(/Montant client en FCFA/),{target:{value:'40000'}});fireEvent.keyDown(screen.getByLabelText('Base du montant client'),{key:'Enter'});fireEvent.click(await screen.findByRole('option',{name:'Taxes comprises'}));fireEvent.change(screen.getByLabelText(/Justification et source/),{target:{value:'Décision opérateur fictive pour ce dossier'}});fireEvent.click(screen.getByRole('button',{name:'Retenir dans la préparation'}));}
it('saves operations only, preserves lost-response retry id, rereads durable revision then versions the exact revision',async()=>{
 let current=state('durable-save');let first=true;let savedId:string|null=null;const writes:Record<string,unknown>[]=[];
 mocks.invoke.mockImplementation(async(name,{body})=>{
  if(name==='generate-quotation-version')return{data:{ok:true,data:{version_number:2,idempotent:false}},error:null};
  if(body.action==='read')return{data:{ok:true,data:current},error:null};
  writes.push(structuredClone(body));
  if(first){first=false;return{data:null,error:{context:{json:async()=>({error:{message:'Réponse interrompue, réessayez'}})}}};}
  const op=body.operations[0];savedId=body.operation_id;
  current={...current,head_id:savedId,draft:reviseCommercialPreparation(current.draft,op.action,{operation_id:op.operation_id,expected_revision:0,actor_id:'server-user',occurred_at:'2026-10-17T12:00:00Z'})} as typeof current;
  return{data:{ok:true,data:{id:savedId,draft:current.draft}},error:null};
 });
 renderWorkspace('durable-save');await edit();fireEvent.click(screen.getByRole('button',{name:'Enregistrer les décisions'}));expect(await screen.findByRole('alert')).toHaveTextContent('interrompue');
 expect(screen.getAllByText(/40.*000 FCFA/).length).toBeGreaterThan(0);fireEvent.click(screen.getByRole('button',{name:'Enregistrer les décisions'}));await screen.findByText(/Décisions enregistrées et relues depuis le serveur/);
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(writes[0]).not.toHaveProperty('draft');expect(writes[0]).not.toHaveProperty('actor_id');
 fireEvent.click(screen.getByRole('button',{name:'Créer la version avec ces décisions'}));await screen.findByText(/Version v2 créée/);
 expect(mocks.invoke).toHaveBeenCalledWith('generate-quotation-version',{body:{case_id:'durable-save',commercial_revision_id:savedId}});
});
it('refuses UI writes for a member without case write access',async()=>{
 mocks.invoke.mockResolvedValue({data:{ok:true,data:{...state('read-only'),can_write:false}},error:null});renderWorkspace('read-only');
 expect(await screen.findByRole('button',{name:'Modifier Handling'})).toBeDisabled();expect(screen.getByRole('button',{name:'Enregistrer les décisions'})).toBeDisabled();
});
it('dirty navigation asks before leaving and restores unsaved decisions on return without browser storage',async()=>{
 mocks.invoke.mockResolvedValue({data:{ok:true,data:state('navigation-test')},error:null});const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);renderWorkspace('navigation-test');await edit();
 fireEvent.click(screen.getByRole('link',{name:'Autre page'}));expect(confirm).toHaveBeenCalled();expect(screen.getByRole('button',{name:'Enregistrer les décisions'})).toBeEnabled();
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('link',{name:'Autre page'}));fireEvent.click(await screen.findByRole('link',{name:'Retour dossier'}));expect((await screen.findAllByText(/40.*000 FCFA/)).length).toBeGreaterThan(0);expect(screen.getByRole('button',{name:'Enregistrer les décisions'})).toBeEnabled();
});
it('ignores a deferred old read after a newer refresh and operator edits',async()=>{
 let resolveOld!:(value:unknown)=>void;const deferred=new Promise(resolve=>{resolveOld=resolve;});
 mocks.invoke.mockImplementationOnce(()=>deferred).mockResolvedValue({data:{ok:true,data:state('read-race')},error:null});
 const client=new QueryClient();const tree=(refreshToken:number)=><QueryClientProvider client={client}><MemoryRouter><CommercialPreparationWorkspace caseId="read-race" refreshToken={refreshToken} onVersionCreated={vi.fn()}/></MemoryRouter></QueryClientProvider>;
 const rendered=render(tree(0));rendered.rerender(tree(1));await edit();
 const obsolete={...state('read-race'),source_version_id:'obsolete-source',draft:prepareCommercialQuote('read-race','obsolete-source',source)};
 await act(async()=>{resolveOld({data:{ok:true,data:obsolete},error:null});await deferred;});
 expect(screen.getAllByText(/40.*000 FCFA/).length).toBeGreaterThan(0);expect(screen.getByRole('button',{name:'Enregistrer les décisions'})).toBeEnabled();
});
it('holds the existing selection mutation key until commercial version creation and refresh settle',async()=>{
 let resolveVersion!:(value:unknown)=>void;const deferred=new Promise(resolve=>{resolveVersion=resolve;});
 mocks.invoke.mockImplementation((name)=>name==='generate-quotation-version'?deferred:Promise.resolve({data:{ok:true,data:{...state('version-lock'),head_id:'saved-revision'}},error:null}));
 const rendered=renderWorkspace('version-lock');fireEvent.click(await screen.findByRole('button',{name:'Créer la version avec ces décisions'}));
 await waitFor(()=>expect(rendered.client.isMutating({mutationKey:['select-quotation-version','version-lock']})).toBe(1));
 await act(async()=>{resolveVersion({data:{ok:true,data:{version_number:2,idempotent:false}},error:null});await deferred;});
 await waitFor(()=>expect(rendered.client.isMutating({mutationKey:['select-quotation-version','version-lock']})).toBe(0));
});
