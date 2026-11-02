import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {CurrentPricingInputDiagnostics} from '../CurrentPricingInputDiagnostics';
import {projectPartialInputRead} from '../../../../supabase/functions/_shared/partial-pricing-input-read';
import {selectedTariffReference} from '../../../../supabase/functions/_shared/selected-tariff-reference';
import type {AirTariffState} from '../../../../supabase/functions/_shared/air-tariff';
import {airTariffSeed} from '../../../../supabase/functions/_shared/air-tariff-seed';
const mock=vi.hoisted(()=>({user:{id:'actor-a'} as {id:string}|null,status:'authenticated',rpc:vi.fn(),invoke:vi.fn(),callbacks:new Set<(e:string)=>void>()}));
vi.mock('@/features/auth',()=>({useAuth:()=>({user:mock.user,authStatus:mock.status})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,functions:{invoke:mock.invoke},auth:{onAuthStateChange:(cb:(e:string)=>void)=>{mock.callbacks.add(cb);return {data:{subscription:{unsubscribe:()=>mock.callbacks.delete(cb)}}};}}}}));
function state(kg=80):AirTariffState{return {request_type:'AIR_IMPORT',lot_count:0,context_hash:'current',selection:{id:'selected',profile_id:'profile',context_hash:'current',source_reference:'Synthetic selection only',warehouse_bracket_confirmed:true},
 profile:{id:'profile',revision:1,supplier:'2AS',airport:'DSS',direction:'IMPORT',cargo_class:'GENERAL_CARGO',effective_from:'2026-01-01',effective_to:'2099-01-01',source_reference:'Synthetic source only',evidence:{},rates:{collection_per_kg:1,security_per_kg:1,documents:1,warehouse_passage:1,it:1}},
 facts:[{id:'weight',fact_key:'cargo.chargeable_weight_kg',value_number:kg,source_type:'operator',is_validated:true}]};}
const props={caseId:'case-a',requestType:'AIR_IMPORT',packageKey:'AIR_IMPORT_DAP',serviceKeys:['AIR_HANDLING','TRUCKING','CUSTOMS_DAKAR','AGENCY'],revisionKey:'revision-a',active:true,upstream:'ready' as const};
function ddpRead(source='source-a',caseId='case-a',serviceKeys=props.serviceKeys){return projectPartialInputRead({
 case_id:caseId,request_type:'AIR_IMPORT',checked_at:new Date().toISOString(),context_hash:'a'.repeat(64),tariff_hash:(source==='source-a'?'b':'c').repeat(64),
 eligibility:{allowProvisional:true,packageKey:'AIR_IMPORT_DDP',requestType:'AIR_IMPORT',lotCount:0,scopeEvent:{actor_type:'operator',event_data:{freight_scope:false,customs_scope:true}},serviceKeys},
 facts:[{fact_key:'cargo.weight_kg',value_number:190,source_type:'operator',is_validated:true}],lines:[{id:'delivery',service:'TRUCKING'}],
 selected:[{id:'delivery',source:'catalogue_sodatra',rule_id:'rule-a',tariff_reference:selectedTariffReference('pricing_service_catalogue',{id:source,service_code:'TRUCKING',unit_type:'KG',pricing_mode:'UNIT_RATE',source_reference:`Synthetic ${source}`},new Date().toISOString())}],
 rules:[{id:'rule-a',service_key:'TRUCKING',quantity_basis:'KG',requires_fact_key:'cargo.weight_kg'}],ambiguous:()=>false,
});}
function ddpResponse(source='source-a',caseId='case-a',serviceKeys=props.serviceKeys){return {data:{ok:true,data:ddpRead(source,caseId,serviceKeys)},error:null};}
function prerequisiteResponse(key:string|null='cargo.weight_kg',fixed=false){return {data:{ok:true,data:projectPartialInputRead({
 case_id:'case-a',request_type:'AIR_IMPORT',checked_at:new Date().toISOString(),context_hash:'d'.repeat(64),tariff_hash:(fixed?'f':'e').repeat(64),
 eligibility:{allowProvisional:true,packageKey:'AIR_IMPORT_DDP',requestType:'AIR_IMPORT',lotCount:0,scopeEvent:{actor_type:'operator',event_data:{freight_scope:false,customs_scope:true}},serviceKeys:props.serviceKeys},
 facts:[],lines:[{id:'delivery',service:'TRUCKING'}],
 selected:[{id:'delivery',source:fixed?'catalogue_sodatra':'missing_quantity',rule_id:'rule-a',...(fixed?{tariff_reference:selectedTariffReference('pricing_service_catalogue',{id:'fixed-source',service_code:'TRUCKING',unit_type:'FORFAIT',pricing_mode:'FIXED'},new Date().toISOString())}:{})}],
 rules:[{id:'rule-a',service_key:'TRUCKING',quantity_basis:'KG',requires_fact_key:key}],quantity_prerequisites:[{service_key:'TRUCKING',rule_id:'rule-a',kind:'applicable_catalogue_unit_rate_kg'}],ambiguous:()=>false,
 })},error:null};}
function event(name:string){act(()=>{for(const cb of mock.callbacks)cb(name);});}
beforeEach(()=>{mock.user={id:'actor-a'};mock.status='authenticated';mock.callbacks.clear();mock.rpc.mockReset();mock.invoke.mockReset();mock.rpc.mockImplementation(async()=>({data:state(),error:null}));mock.invoke.mockImplementation(async()=>ddpResponse());});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
describe('current authorized diagnostic host',()=>{
 it('uses the actual read adapter and resolver; no pricing, write or messaging function is called',async()=>{
  render(<CurrentPricingInputDiagnostics {...props}/>);await screen.findAllByText(/80 kg/);
  expect(mock.rpc.mock.calls).toEqual([['air_tariff_read',{p_case_id:'case-a'}]]);expect(mock.invoke).not.toHaveBeenCalled();
  expect(screen.getAllByText('Disponible').length).toBeGreaterThan(0);expect(screen.getByText(/Lecture vérifiée/)).toBeInTheDocument();
 });
 it('keeps the full catalogue basis distinct from the historical taxable profile',async()=>{
  const s=state();s.facts=[];s.catalogue={id:'catalogue',parent_id:null,revision:1,effective_from:'2026-01-01',effective_to:null,source_reference:'Synthetic catalogue contract',payload:structuredClone(airTariffSeed)};
  s.basis={general_cargo_confirmed:true,warehouse_bracket_confirmed:false,ordinary_storage:{enabled:false,tariff_key:'storage_0',weight_fact_id:null,billable_days:null,days_status:'unknown',source_reference:''}};
  mock.rpc.mockResolvedValue({data:s,error:null});render(<CurrentPricingInputDiagnostics {...props}/>);
  await screen.findAllByText('À traiter avec : Source tarifaire');expect(screen.getAllByText('Disponible').length).toBeGreaterThan(0);
  expect(screen.queryByText('À traiter avec : Information client')).not.toBeInTheDocument();expect(mock.invoke).not.toHaveBeenCalled();
 });
 it('does not transform missing source/basis into a fictitious client question or ready quote',async()=>{
  const s=state();s.selection=null;s.profile=null;mock.rpc.mockResolvedValue({data:s,error:null});render(<CurrentPricingInputDiagnostics {...props}/>);
  await screen.findByText('À qualifier');expect(screen.getByText(/Aucun profil fournisseur/)).toBeInTheDocument();expect(screen.queryByText(/^Prêt à chiffrer$/)).not.toBeInTheDocument();
 });
 it('does not evaluate other flows or explicit export/transit/unknown under an import alias',async()=>{
  const {rerender}=render(<CurrentPricingInputDiagnostics {...props} requestType="SEA_FCL_IMPORT"/>);
  expect(screen.getByText('Non évalué')).toBeInTheDocument();expect(mock.rpc).not.toHaveBeenCalled();
  for(const shipment_type of ['export','transit','unknown']){
   rerender(<CurrentPricingInputDiagnostics {...props} scopeEvent={{shipment_type,freight_scope:false,customs_scope:true}}/>);expect(screen.getByText('Non évalué')).toBeInTheDocument();expect(mock.rpc).not.toHaveBeenCalled();
  }
 });
 it('does not discard an invalid declared scope into the historical import fallback',()=>{
  render(<CurrentPricingInputDiagnostics {...props} scopeEvent={{shipment_type:'export'}}/>);expect(screen.getByText('Non évalué')).toBeInTheDocument();expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('accepts an explicitly declared import without changing the pricing or source selection',async()=>{
  render(<CurrentPricingInputDiagnostics {...props} scopeEvent={{shipment_type:' IMPORT ',freight_scope:false,customs_scope:true}}/>);
  await screen.findAllByText(/80 kg/);expect(mock.rpc).toHaveBeenCalledTimes(1);expect(mock.invoke).not.toHaveBeenCalled();
 });
 it('distinguishes an absent direction from explicit null, empty or malformed declarations',()=>{
  const {rerender}=render(<CurrentPricingInputDiagnostics {...props} scopeEvent={{shipment_type:null,freight_scope:false,customs_scope:true}}/>);
  for(const shipment_type of [null,'',42,{},[]]){rerender(<CurrentPricingInputDiagnostics {...props} scopeEvent={{shipment_type,freight_scope:false,customs_scope:true}}/>);
   expect(screen.getByText('Non évalué')).toBeInTheDocument();expect(mock.rpc).not.toHaveBeenCalled();}
 });
 it('does not diagnose handling after the effective service has been removed',async()=>{
  const {rerender}=render(<CurrentPricingInputDiagnostics {...props}/>);await screen.findAllByText(/80 kg/);
  rerender(<CurrentPricingInputDiagnostics {...props} serviceKeys={['TRUCKING']}/>);expect(screen.getByText('Non évalué')).toBeInTheDocument();
  expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();expect(mock.rpc).toHaveBeenCalledTimes(1);
 });
 it('reads partial DDP from the server selector through the explicit read action, no browser tariff lookup or pricing fallback',async()=>{
  render(<CurrentPricingInputDiagnostics {...props} packageKey="AIR_IMPORT_DDP"/>);
  await screen.findByRole('heading',{name:/^Transport terrestre .* Poids brut total$/});
  expect(mock.rpc.mock.calls).toEqual([['air_tariff_read',{p_case_id:'case-a'}]]);
  expect(mock.invoke.mock.calls).toEqual([['price-service-lines',{body:{action:'read_input_diagnostic',case_id:'case-a'}}]]);
  const row=screen.getByRole('heading',{name:/^Transport terrestre .* Poids brut total$/}).closest('li')!;
  fireEvent.click(within(row).getByRole('button',{name:'Source et conditions'}));expect(within(row).getByText('Référence : Synthetic source-a')).toBeInTheDocument();
  expect(within(row).getByText(/Règle de quantité : rule-a/)).toBeInTheDocument();expect(screen.queryByText(/^Prêt à chiffrer$/)).not.toBeInTheDocument();
 });
 it('reads DDP independently when handling was removed, and keeps other services non-evaluated server-side',async()=>{
  const keys=['TRUCKING','CUSTOMS_DAKAR','AGENCY'];mock.invoke.mockResolvedValue(ddpResponse('source-a','case-a',keys));
  render(<CurrentPricingInputDiagnostics {...props} packageKey="AIR_IMPORT_DDP" serviceKeys={keys}/>);
  await screen.findByRole('heading',{name:/^Transport terrestre .* Poids brut total$/});expect(mock.rpc).not.toHaveBeenCalled();expect(mock.invoke).toHaveBeenCalledTimes(1);
 });
 it('does not reuse a prior tariff after focus, permission failure or malformed/stale server context',async()=>{
  render(<CurrentPricingInputDiagnostics {...props} packageKey="AIR_IMPORT_DDP"/>);await screen.findByRole('heading',{name:/^Transport terrestre .* Poids brut total$/});
  const bad=ddpResponse();bad.data.data.case_id='other-case';mock.invoke.mockResolvedValue(bad);fireEvent.focus(window);await screen.findByRole('alert');
  expect(screen.queryByRole('heading',{name:/^Transport terrestre .* Poids brut total$/})).not.toBeInTheDocument();
  const stale=ddpResponse();stale.data.data.checked_at=new Date(Date.now()-31_000).toISOString();mock.invoke.mockResolvedValue(stale);
  fireEvent.click(screen.getByRole('button',{name:'Actualiser le diagnostic'}));await screen.findByRole('alert');expect(screen.queryByText(/190 kg/)).not.toBeInTheDocument();
  mock.invoke.mockResolvedValue({data:null,error:{code:'42501'}});fireEvent.click(screen.getByRole('button',{name:'Actualiser le diagnostic'}));await screen.findByRole('alert');
  mock.invoke.mockResolvedValue(ddpResponse('source-b'));fireEvent.click(screen.getByRole('button',{name:'Actualiser le diagnostic'}));await screen.findByRole('heading',{name:/^Transport terrestre .* Poids brut total$/});
  const row=screen.getByRole('heading',{name:/^Transport terrestre .* Poids brut total$/}).closest('li')!;fireEvent.click(within(row).getByRole('button',{name:'Source et conditions'}));
  expect(within(row).getByText('Référence : Synthetic source-b')).toBeInTheDocument();expect(screen.queryByText('Référence : Synthetic source-a')).not.toBeInTheDocument();
 });
 it('discards a late DDP selector response across actor changes and signout',async()=>{
  let oldResolve!:(r:unknown)=>void;mock.invoke.mockImplementationOnce(()=>new Promise(r=>{oldResolve=r;}));
  const {rerender}=render(<CurrentPricingInputDiagnostics {...props} packageKey="AIR_IMPORT_DDP"/>);await waitFor(()=>expect(mock.invoke).toHaveBeenCalledTimes(1));
  mock.user={id:'actor-b'};mock.invoke.mockResolvedValue(ddpResponse('source-b','case-b'));rerender(<CurrentPricingInputDiagnostics {...props} caseId="case-b" packageKey="AIR_IMPORT_DDP"/>);
  await screen.findByRole('heading',{name:/^Transport terrestre .* Poids brut total$/});event('SIGNED_OUT');await act(async()=>oldResolve(ddpResponse()));
  expect(screen.queryByRole('heading',{name:/^Transport terrestre .* Poids brut total$/})).not.toBeInTheDocument();expect(screen.getByRole('alert')).toBeInTheDocument();
 });
 it('shows a demonstrated gross prerequisite without presenting a candidate tariff or creating a client question',async()=>{
  mock.invoke.mockResolvedValue(prerequisiteResponse());render(<CurrentPricingInputDiagnostics {...props} packageKey="AIR_IMPORT_DDP"/>);
  const heading=await screen.findByRole('heading',{name:/^Transport terrestre .* Poids brut total$/});const row=heading.closest('li')!;
  expect(within(row).getByText('Manquante')).toBeInTheDocument();expect(within(row).getByText(/Information client/)).toBeInTheDocument();
  expect(within(row).getByText(/Le tarif n’a pas encore été sélectionné/)).toBeInTheDocument();expect(within(row).getByText(/informations déjà reçues/)).toBeInTheDocument();
  expect(within(row).queryByRole('button',{name:'Source et conditions'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/envoyer|demander|calculer/i})).not.toBeInTheDocument();
  expect(mock.invoke.mock.calls).toEqual([['price-service-lines',{body:{action:'read_input_diagnostic',case_id:'case-a'}}]]);
 });
 it('keeps taxable input with the operator and an undocumented basis with the reference owner',async()=>{
  for(const [key,label,owner] of [['cargo.chargeable_weight_kg','Poids taxable retenu','Décision opérateur'],[null,'Assiette du tarif kg à préciser','Source tarifaire']] as const){
   mock.invoke.mockResolvedValue(prerequisiteResponse(key));const {unmount}=render(<CurrentPricingInputDiagnostics {...props} packageKey="AIR_IMPORT_DDP"/>);
   const row=(await screen.findByRole('heading',{name:new RegExp('^Transport terrestre .* '+label+'$')})).closest('li')!;
   expect(within(row).getByText(new RegExp(owner))).toBeInTheDocument();expect(within(row).queryByText(/Information client/)).not.toBeInTheDocument();
   expect(within(row).queryByRole('button',{name:'Source et conditions'})).not.toBeInTheDocument();unmount();
  }
 });
 it('removes a missing-weight prerequisite while refreshing and after a current forfait replaces the applicable KG contract',async()=>{
  mock.invoke.mockResolvedValue(prerequisiteResponse());render(<CurrentPricingInputDiagnostics {...props} packageKey="AIR_IMPORT_DDP"/>);
  await screen.findByRole('heading',{name:/^Transport terrestre .* Poids brut total$/});let resolve!:(r:unknown)=>void;mock.invoke.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  fireEvent.click(screen.getByRole('button',{name:'Actualiser le diagnostic'}));expect(screen.queryByRole('heading',{name:/^Transport terrestre .* Poids brut total$/})).not.toBeInTheDocument();
  await act(async()=>resolve(prerequisiteResponse('cargo.weight_kg',true)));await screen.findByRole('heading',{name:/^Transport terrestre .* Contrat hors diagnostic kg$/});
  expect(screen.queryByRole('heading',{name:/^Transport terrestre .* Poids brut total$/})).not.toBeInTheDocument();expect(screen.queryByText('Manquante')).not.toBeInTheDocument();
 });
 it('hides stale cached content during upstream errors and before a changed fact revision is reread',async()=>{
  const {rerender}=render(<CurrentPricingInputDiagnostics {...props}/>);await screen.findAllByText(/80 kg/);
  rerender(<CurrentPricingInputDiagnostics {...props} upstream="error"/>);expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();expect(screen.getByRole('alert')).toBeInTheDocument();
  mock.rpc.mockImplementation(()=>new Promise(()=>{}));rerender(<CurrentPricingInputDiagnostics {...props} revisionKey="revision-b"/>);
  expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();expect(screen.getByRole('status')).toHaveTextContent('Vérification');
 });
 it('discards late responses from the previous case and actor',async()=>{
  let oldResolve!:(r:unknown)=>void;mock.rpc.mockImplementationOnce(()=>new Promise(r=>{oldResolve=r;}));
  const {rerender}=render(<CurrentPricingInputDiagnostics {...props}/>);await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));
  mock.user={id:'actor-b'};mock.rpc.mockResolvedValue({data:state(120),error:null});rerender(<CurrentPricingInputDiagnostics {...props} caseId="case-b"/>);
  await screen.findAllByText(/120 kg/);await act(async()=>oldResolve({data:state(),error:null}));
  expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();expect(mock.callbacks.size).toBe(1);
 });
 it('purges on signout/revocation and does not resurrect a prior read after re-admission',async()=>{
  let oldResolve!:(r:unknown)=>void;mock.rpc.mockImplementationOnce(()=>new Promise(r=>{oldResolve=r;}));render(<CurrentPricingInputDiagnostics {...props}/>);
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));event('SIGNED_OUT');expect(screen.getByRole('alert')).toBeInTheDocument();
  mock.rpc.mockResolvedValue({data:null,error:{code:'42501'}});event('SIGNED_IN');await screen.findByRole('alert');
  await act(async()=>oldResolve({data:state(),error:null}));expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();
  mock.rpc.mockResolvedValue({data:state(120),error:null});event('TOKEN_REFRESHED');await screen.findAllByText(/120 kg/);expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();
 });
 it('performs no read while unauthenticated, inactive or upstream data are incomplete',()=>{
  const {rerender}=render(<CurrentPricingInputDiagnostics {...props} active={false}/>);expect(mock.rpc).not.toHaveBeenCalled();
  mock.user=null;mock.status='unauthenticated';rerender(<CurrentPricingInputDiagnostics {...props}/>);expect(screen.getByRole('alert')).toBeInTheDocument();expect(mock.rpc).not.toHaveBeenCalled();
  mock.user={id:'actor-a'};mock.status='authenticated';rerender(<CurrentPricingInputDiagnostics {...props} upstream="loading"/>);expect(screen.getByRole('status')).toBeInTheDocument();expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('does not reread the server selector on an input focus inside the panel',async()=>{
  const {container}=render(<><input aria-label="Synthetic input"/><CurrentPricingInputDiagnostics {...props} packageKey="AIR_IMPORT_DDP"/></>);
  await screen.findByRole('heading',{name:/^Transport terrestre .* Poids brut total$/});
  fireEvent.focus(container.querySelector('input')!);expect(mock.invoke).toHaveBeenCalledTimes(1);
 });
 it('expires local evidence after30s, hides it while rereading and stops automatic retries after failure',async()=>{
  vi.useFakeTimers();render(<CurrentPricingInputDiagnostics {...props}/>);await act(async()=>{});expect(screen.getAllByText(/80 kg/).length).toBeGreaterThan(0);
  mock.rpc.mockResolvedValue({data:null,error:{code:'42501'}});await act(async()=>{vi.advanceTimersByTime(30_000);});expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();expect(screen.getByRole('alert')).toBeInTheDocument();
  await act(async()=>{vi.advanceTimersByTime(60_000);});expect(mock.rpc).toHaveBeenCalledTimes(2);
 });
 it('allows an explicit safe read retry and rejects a mismatched server case type',async()=>{
  mock.rpc.mockResolvedValueOnce({data:{...state(),request_type:'AIR_CROSS_TRADE'},error:null});render(<CurrentPricingInputDiagnostics {...props}/>);await screen.findByRole('alert');
  expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Actualiser le diagnostic'}));await screen.findAllByText(/80 kg/);expect(mock.invoke).not.toHaveBeenCalled();
 });
 it('bounds an unavailable read and never resurrects its late result after an explicit retry',async()=>{
  vi.useFakeTimers();let oldResolve!:(r:unknown)=>void;mock.rpc.mockImplementationOnce(()=>new Promise(r=>{oldResolve=r;}));
  render(<CurrentPricingInputDiagnostics {...props}/>);await act(async()=>{});await act(async()=>{vi.advanceTimersByTime(10_000);});
  expect(screen.getByRole('alert')).toBeInTheDocument();expect(mock.rpc).toHaveBeenCalledTimes(1);
  mock.rpc.mockResolvedValue({data:state(120),error:null});fireEvent.click(screen.getByRole('button',{name:'Actualiser le diagnostic'}));await act(async()=>{});
  await act(async()=>oldResolve({data:state(),error:null}));expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();expect(screen.getAllByText(/120 kg/).length).toBeGreaterThan(0);
 });
 it('reserves the displayed footprint during a read refresh while removing the old content',async()=>{
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({height:600} as DOMRect);
  render(<CurrentPricingInputDiagnostics {...props}/>);await screen.findAllByText(/80 kg/);
  mock.rpc.mockImplementation(()=>new Promise(()=>{}));fireEvent.click(screen.getByRole('button',{name:'Actualiser le diagnostic'}));
  expect(screen.queryByText(/80 kg/)).not.toBeInTheDocument();expect(screen.getByRole('region',{name:'Diagnostic des données courantes'})).toHaveStyle({minHeight:'600px'});
 });
});
