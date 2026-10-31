import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AirCrossTradeEditor} from '../AirCrossTradeWorkspace';
import {AirCallError,type AirScreenState,type AirRow} from '@/lib/airCrossTradeApi';
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:vi.fn()}}}));
vi.mock('@/features/auth',()=>({useAuth:()=>({user:null})}));
class RO{observe(){}unobserve(){}disconnect(){}}globalThis.ResizeObserver=RO;
Element.prototype.scrollIntoView=vi.fn();Element.prototype.hasPointerCapture=()=>false;Element.prototype.setPointerCapture=()=>{};Element.prototype.releasePointerCapture=()=>{};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function state():AirScreenState{return{case:{id:'case',request_type:'AIR_CROSS_TRADE'},facts:[],request_lines:[],context_hash:'ctx1',sources_hash:'src1',countries:[{country_code:'KE',country_name:'Kenya'},{country_code:'NL',country_name:'Netherlands'}],sources:[],fx:[],head:null,source_revisions_clear:true,applicable:true,demand:{origin_country:'KE',destination_country:'NL',arrival_airport:'AMS'},can_write:true,catalog:[],partner_catalog:[],fx_catalog:[],catalog_has_more:false,evaluation:null};}
function mount(api:ReturnType<typeof vi.fn>,caseId:string){const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={qc}><AirCrossTradeEditor caseId={caseId} actorId="synthetic-actor" api={api}/></QueryClientProvider>);}
async function edit(){fireEvent.change(await screen.findByLabelText('Référence de la demande et du périmètre'),{target:{value:'SYNTHETIC REQUEST SCOPE'}});fireEvent.click(screen.getByRole('button',{name:'Vérifier sans enregistrer'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Enregistrer le plan'})).toBeEnabled());}
it('retains partial plan, refuses empty implicit prices and shows explicit pending requirements',async()=>{
 const api=vi.fn(async(body:AirRow)=>{if(body.action==='read')return{...state(),evaluation:body.operator?{ready_to_price:false,needs:[{key:'service.qualification',owner:'operator',service_key:'AIR_FREIGHT',reason:'Offre à qualifier'}],pricing:null}:null};return{id:body.operation_id};});
 mount(api,'air-pending');await edit();expect(screen.getByText('Opérateur : Offre à qualifier')).toBeVisible();expect(screen.getByRole('button',{name:'Calculer et enregistrer'})).toBeDisabled();
 expect(api.mock.calls.every(([b])=>b.action==='read')).toBe(true);
});
it('lost response preserves the same UUID and explicit recovery; a refusal never clears earlier uncertainty',async()=>{
 const bodies:AirRow[]=[];let attempt=0;const api=vi.fn(async(body:AirRow)=>{if(body.action==='read')return state();if(body.action==='save'){bodies.push(structuredClone(body));attempt++;throw new AirCallError(attempt===1?'lost':'refused',attempt===1?'unknown':'refused',409);}return{plan:null,pricing:null};});
 mount(api,'air-unknown');await edit();fireEvent.click(screen.getByRole('button',{name:'Enregistrer le plan'}));expect(await screen.findByRole('alert')).toHaveTextContent('Résultat non confirmé');
 fireEvent.click(screen.getByRole('button',{name:'Reprendre la même opération'}));await waitFor(()=>expect(bodies).toHaveLength(2));expect(bodies[1]).toEqual(bodies[0]);expect(screen.getByRole('button',{name:'Enregistrer le plan'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Vérifier l’opération'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('reste inconnu'));
});
it('confirmed write plus failed refresh cannot resend the mutation',async()=>{
 let written=false;const api=vi.fn(async(body:AirRow)=>{if(body.action==='save'){written=true;return{id:body.operation_id};}if(body.action==='read'){if(written)throw new AirCallError('offline','unknown');return state();}return{plan:null,pricing:null};});
 mount(api,'air-confirmed');await edit();fireEvent.click(screen.getByRole('button',{name:'Enregistrer le plan'}));expect(await screen.findByRole('alert')).toHaveTextContent('Écriture confirmée');expect(screen.getByRole('button',{name:'Reprendre la même opération'})).toBeDisabled();expect(api.mock.calls.filter(([b])=>b.action==='save')).toHaveLength(1);
});
it('navigation restores in-session draft only after authorized read and preserves it against a newer head',async()=>{
 const api=vi.fn(async()=>state());const page=mount(api,'air-navigation');fireEvent.change(await screen.findByLabelText('Référence de la demande et du périmètre'),{target:{value:'SYNTHETIC UNSAVED SCOPE'}});page.unmount();
 mount(api,'air-navigation');expect(await screen.findByLabelText('Référence de la demande et du périmètre')).toHaveValue('SYNTHETIC UNSAVED SCOPE');expect(api).toHaveBeenCalledTimes(2);
});
it('denied re-read does not expose cached draft from the same actor',async()=>{
 const api=vi.fn(async()=>state());const page=mount(api,'air-revoked');fireEvent.change(await screen.findByLabelText('Référence de la demande et du périmètre'),{target:{value:'SYNTHETIC PRIVATE DRAFT'}});page.unmount();
 mount(vi.fn(async()=>{throw new AirCallError('Accès non autorisé','refused',403);}), 'air-revoked');expect(await screen.findByRole('alert')).toHaveTextContent('Accès non autorisé');expect(screen.queryByDisplayValue('SYNTHETIC PRIVATE DRAFT')).not.toBeInTheDocument();
});
it('an existing operator scope requires visible explicit revision acknowledgement',async()=>{
 const api=vi.fn(async()=>({...state(),facts:[{id:'scope-old',fact_key:'service.package',source_type:'operator',value_text:'AIR_IMPORT_STANDARD'}]}));mount(api,'air-ack');
 const box=await screen.findByRole('checkbox',{name:/Réviser explicitement service.package/});expect(box).not.toBeChecked();fireEvent.click(box);expect(box).toBeChecked();
});

it('confirmed A remains available after navigation when the reread sees concurrent B',async()=>{
 let written=false;const b={id:'plan-B',revision:3,request:{scope_reference:'SYNTHETIC OTHER OPERATOR',requested_services:[],client_data_keys:[],attestations:[],plan:{route:{departure_airport:'',departure_country:'',arrival_airport:'AMS',arrival_country:'NL',pre_carriage:'none',routing_reference:'',acceptance_reference:null},services:[]}},plan:{id:'plan-B',revision:3,case_id:'air-concurrent',actor_id:'other',context_fingerprint:'ctxB',plan:{route:{},services:[]}}};
 const api=vi.fn(async(body:AirRow)=>{if(body.action==='save'){written=true;return{id:body.operation_id};}return written?{...state(),context_hash:'ctxB',head:b}:state();});
 const page=mount(api,'air-concurrent');await edit();fireEvent.click(screen.getByRole('button',{name:'Enregistrer le plan'}));expect(await screen.findByRole('status')).toHaveTextContent('un plan plus récent');expect(screen.getByLabelText('Référence de la demande et du périmètre')).toHaveValue('SYNTHETIC REQUEST SCOPE');page.unmount();
 mount(api,'air-concurrent');expect(await screen.findByLabelText('Référence de la demande et du périmètre')).toHaveValue('SYNTHETIC REQUEST SCOPE');expect(screen.getByRole('button',{name:'Comparer avant de reprendre'})).toBeEnabled();expect(screen.getByRole('button',{name:'Enregistrer le plan'})).toBeDisabled();
});

it.each([401,403])('access denial %s during editing hides data, clears memory and restores only a fresh authorized read',async status=>{
 let denied=false;const api=vi.fn(async()=>{if(denied)throw new AirCallError('Accès non autorisé','refused',status);return state();});
 const page=mount(api,'air-mid-edit-'+status);fireEvent.change(await screen.findByLabelText('Référence de la demande et du périmètre'),{target:{value:'SYNTHETIC PRIVATE UNSAVED CONTENT'}});denied=true;fireEvent.click(screen.getByRole('button',{name:'Actualiser l’état serveur'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('retirée de cette session');expect(screen.queryByDisplayValue('SYNTHETIC PRIVATE UNSAVED CONTENT')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Enregistrer le plan'})).not.toBeInTheDocument();page.unmount();
 denied=false;mount(api,'air-mid-edit-'+status);expect(await screen.findByLabelText('Référence de la demande et du périmètre')).toHaveValue('');
});

it.each([false,true])('a late UNKNOWN from a revoked access epoch never repopulates memory (readmission first=%s)',async readmitFirst=>{
 let rejectSearch:((error:Error)=>void)|undefined,rejectSave:((error:Error)=>void)|undefined,searchStarted=false;
 const api=vi.fn(async(body:AirRow)=>{if(body.action==='save')return new Promise((_,reject)=>{rejectSave=reject;});
  if(body.action==='read'&&body.query==='SYNTHETIC SEARCH'&&!searchStarted){searchStarted=true;return new Promise((_,reject)=>{rejectSearch=reject;});}return state();});
 const id='air-late-revocation-'+readmitFirst,page=mount(api,id);await edit();fireEvent.change(screen.getByLabelText('Rechercher une source tarifaire'),{target:{value:'SYNTHETIC SEARCH'}});await waitFor(()=>expect(rejectSearch).toBeDefined());
 fireEvent.click(screen.getByRole('button',{name:'Enregistrer le plan'}));await waitFor(()=>expect(rejectSave).toBeDefined());await act(async()=>rejectSearch!(new AirCallError('Accès non autorisé','refused',403)));
 expect(await screen.findByRole('alert')).toHaveTextContent('retirée de cette session');
 if(readmitFirst){fireEvent.click(screen.getByRole('button',{name:'Réessayer la lecture'}));expect(await screen.findByLabelText('Référence de la demande et du périmètre')).toHaveValue('');}
 await act(async()=>rejectSave!(new AirCallError('Lost response','unknown')));page.unmount();mount(api,id);
 expect(await screen.findByLabelText('Référence de la demande et du périmètre')).toHaveValue('');expect(screen.queryByRole('button',{name:'Vérifier l’opération'})).not.toBeInTheDocument();
});

it.each([404,503])('rollout: unavailable candidate endpoint %s stays read-only until an explicit fresh read',async status=>{
 let available=false;const api=vi.fn(async(_body:AirRow)=>{if(!available)throw new AirCallError('Parcours serveur indisponible pendant la mise à jour','unknown',status);return state();});
 mount(api,'air-rollout-unavailable-'+status);
 expect(await screen.findByRole('alert')).toHaveTextContent('indisponible');
 expect(screen.queryByRole('button',{name:'Enregistrer le plan'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Calculer et enregistrer'})).not.toBeInTheDocument();
 expect(api).toHaveBeenCalledTimes(1);
 available=true;fireEvent.click(screen.getByRole('button',{name:'Réessayer la lecture'}));
 expect(await screen.findByLabelText('Référence de la demande et du périmètre')).toHaveValue('');
 expect(api).toHaveBeenCalledTimes(2);
 expect(api.mock.calls.every(([body])=>(body as AirRow).action==='read')).toBe(true);
});
