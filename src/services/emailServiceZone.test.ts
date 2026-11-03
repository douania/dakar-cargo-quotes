import { describe,it,expect,vi,beforeEach } from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),from:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke},from:mocks.from}}));
import { generateEmailResponse, processQuotationRequest } from './emailService';
const raw={draft:{id:'draft',subject:'Fixture',body_text:'Fixture',to_addresses:['synthetic@example.invalid']},sodatra_fees:{fees:[],total_suggested:120,complexity_reasons:[],transport_mode:'maritime'},quotation_metadata:{zone_resolution:{status:'unknown',source:'delivery_zones'},zone:null},extracted_data:{destination:'Ville inconnue'},quotation_lines:[],quotation_totals:{dap:120}};
beforeEach(()=>{mocks.invoke.mockReset();mocks.from.mockReset();});
describe('actual generation service consumers',()=>{
 it('opts in and unwraps the standard response without changing existing instructions/language',async()=>{
  mocks.invoke.mockResolvedValue({data:{ok:true,data:raw},error:null});expect(await generateEmailResponse('email','Instruction','auto','EN')).toBe(raw);
  expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({emailId:'email',customInstructions:'Instruction',reply_language_override:'EN',zone_reply_contract:'optional_factor_v1'});
 });
 it('exposes the refused unknown message, performs one request and never retries generation',async()=>{
  mocks.invoke.mockResolvedValue({data:null,error:{context:Response.json({ok:false,error:{code:'ZONE_CONFIRMATION_REQUIRED',message:'Zone indéterminée'}})}});
  await expect(generateEmailResponse('email')).rejects.toThrow('Zone indéterminée');expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });
 it('rejects a fresh response without server pricing before any local fee substitution',async()=>{
  const email={id:'email',thread_ref:null,subject:'SYNTHETIC',from_address:'synthetic@example.invalid',body_text:'Fixture'};
  mocks.invoke.mockImplementation(async(name:string)=>name==='import-thread'?{data:{emails:[email],hasMore:false,remainingUids:[]},error:null}:{data:{ok:true,data:{draft:raw.draft,can_quote_now:true,extracted_data:{destination:'Ville inconnue'}}},error:null});
  let single=false;const query={select:()=>query,eq:()=>query,in:()=>query,single:()=>{single=true;return query;},then:(done:(v:unknown)=>void)=>{const data=single?email:[email];single=false;return done({data,error:null});}};mocks.from.mockReturnValue(query);
  await expect(processQuotationRequest('config',[1])).rejects.toThrow(/Honoraires serveur incomplets/);
  expect(mocks.invoke.mock.calls.filter(([name])=>name==='generate-response')).toHaveLength(1);
 });
 it('the real legacy fallback maps the envelope and server pricing, without a local factor',async()=>{
  const email={id:'email',thread_ref:null,subject:'SYNTHETIC',from_address:'synthetic@example.invalid',body_text:'Fixture'};
  mocks.invoke.mockImplementation(async(name:string)=>name==='import-thread'?{data:{emails:[email],hasMore:false,remainingUids:[]},error:null}:{data:{ok:true,data:raw},error:null});
  let single=false;const query={select:()=>query,eq:()=>query,in:()=>query,single:()=>{single=true;return query;},then:(done:(v:unknown)=>void)=>{const data=single?email:[email];single=false;return done({data,error:null});}};mocks.from.mockReturnValue(query);
  const result=await processQuotationRequest('config',[1]);expect(result.pipelineUsed).toBe('generate-response-fallback');expect(result.draft.id).toBe('draft');expect(result.serverPricing!.fees.total_suggested).toBe(120);expect(result.serverPricing!.fees.complexity_factor).toBeUndefined();
 });
});
