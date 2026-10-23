// Synthetic in-memory RPC fixture, NOT a database/Auth/Storage implementation.
import {vi} from 'vitest';
import {createRecoveryGateway} from '../../src/services/railwayReplacement/recoveryClient';
import {createRecoveryHandler} from '../../supabase/functions/manual-intake-recovery/handler';
import {prepareManualIntake} from '../../src/services/railwayReplacement/manualIntakeCommand';
import {sha256Bytes,verifyIntakeFile,readFileBytes} from '../../src/services/railwayReplacement/intakeDocument';
import {RecoveryError,type RecoveryOperation} from '../../src/services/railwayReplacement/recoveryContract';
export const operationId='aaaaaaaa-aaaa-4aaa-8aaa-000000000501',actorId='bbbbbbbb-bbbb-4bbb-8bbb-000000000501';
export const syntheticForm=(text='Deux conteneurs de 20 pieds depuis Shanghai vers Dakar.')=>({request:{source:{type:'email_text',text},client_name:'Synthetic',client_email:'synthetic@example.invalid',customer_ref:'SYNTHETIC'},analysis:null,has_extracted_document:false});
export function syntheticReceipt(command:ReturnType<typeof prepareManualIntake>['command']){return {...command.p_classification,success:true,case_id:command.p_case_id,status:'INTAKE',snapshot_id:'dddddddd-dddd-4ddd-8ddd-000000000501',operation_key:command.p_operation_key,replayed:false,evidence_status:'heuristic_unverified',batch_receipt:{case_id:command.p_case_id,status:'INTAKE',source_type:command.p_batch.source_type,confidence:command.p_batch.source_type==='email_body'?0.7:0.8,created_case:true,request_type:null,replayed:false,facts:(command.p_batch.facts as {fact_key:string}[]).map((f,i)=>({fact_key:f.fact_key,fact_id:'eeeeeeee-eeee-4eee-8eee-'+String(i+1).padStart(12,'0')}))}};}
export function recoveryFixture(){
 const rows=new Map<string,RecoveryOperation>(),cases=new Set<string>();let actor:string|null=actorId,lose:string|null=null,fail:string|null=null;
 const actions:string[]=[],files=new Map<string,Blob>(),projections=new Map<string,Record<string,unknown>>(),archives=new Map<string,string>();let unknownStep:string|null=null;
 const uuid=()=>crypto.randomUUID();
 const rpc=vi.fn(async(_token:string,_name:string,params:Record<string,unknown>)=>{
  const id=params.p_id as string,action=params.p_action as string,p=params.p_payload as Record<string,unknown>;actions.push(_name==='manual_intake_document_result'?'document_result':action);
  if(!actor)return {data:null,error:{code:'42501',message:'MIR_AUTH_REQUIRED'}};
  let row=rows.get(id);if(row&&row.actor_user_id!==actor)return {data:null,error:{code:'42501',message:'MIR_OWNER_REQUIRED'}};
  if(_name==='manual_intake_document_result')return {data:projections.get(id+':'+params.p_step)??null,error:null};
  if(fail===action){fail=null;return {data:null,error:{code:'23505',message:'MIR_REVISION_CONFLICT'}};}
  if(action==='read')return {data:row?structuredClone(row):{found:false,operation_id:id},error:null};
  if(!row){if(!['reserve','abandon'].includes(action))return {data:null,error:{code:'22023',message:'MIR_NOT_FOUND'}};
   row={found:true,operation_id:id,actor_user_id:actor,state:action==='abandon'?'abandoned':'reserved',revision:1,draft:structuredClone(p.draft) as RecoveryOperation['draft'],prepared:null,prepared_hash:null,receipt:null,document_receipt:null,steps:{}};rows.set(id,row);
  }else if(action==='save'){if(row.revision!==p.expected_revision)return {data:null,error:{code:'23505',message:'MIR_REVISION_CONFLICT'}};row.draft=structuredClone(p.draft) as RecoveryOperation['draft'];row.revision++;}
  else if(action==='commit'){if(!row.prepared)throw Error('fixture unprepared');row.state='committed';row.receipt=syntheticReceipt(row.prepared.command);cases.add(id);}
  else if(action==='claim'){const step=p.step as 'upload'|'extraction'|'analysis';if(!row.steps[step]){row.steps[step]={claim_id:p.claim_id as string,state:'running',input:structuredClone(p.input) as Record<string,unknown>,output:null,error_code:null};return {data:{...structuredClone(row),claimed:true},error:null};}return {data:{...structuredClone(row),claimed:false},error:null};}
  else if(action==='link'){const f=row.draft.file!;row.document_receipt={case_id:id,document_id:f.document_id,storage_path:f.path,sha256:f.sha256,extraction_status:row.steps.extraction?.output?.case_text_status==='legacy_prefix_invalid_utf16'?'unconfirmed_legacy_prefix_utf16':row.steps.extraction?'extracted':'not_requested'};}
  else if(action==='abandon')row.state='abandoned';
  return {data:structuredClone(row),error:null};
 });
 const attestPrepared=vi.fn(async(_auth:unknown,id:string,p:Record<string,unknown>)=>{actions.push('prepare');const row=rows.get(id)!;row.state='prepared';row.prepared=structuredClone(p) as unknown as RecoveryOperation['prepared'];row.prepared_hash='a'.repeat(64);return {data:structuredClone(row),error:null};});
 const verifyFile=async(_token:string,operation:Record<string,unknown>)=>{const f=(operation as unknown as RecoveryOperation).draft.file!;await verifyIntakeFile({read:async path=>({data:files.get(path)??null,error:null})},f);};
 const documentStep=async(_auth:unknown,operation:Record<string,unknown>,payload:Record<string,unknown>)=>{
  const row=rows.get(operation.operation_id as string)!,step=payload.step as 'upload'|'extraction'|'analysis',file=row.draft.file!;actions.push((payload.recover?'recover:':'step:')+step);
  if(payload.recover&&step!=='upload')return structuredClone(row);
  await verifyFile('',row as unknown as Record<string,unknown>);
  if(step==='upload'){const ticket=row.steps.upload!;ticket.state='complete';ticket.output={descriptor:file};return structuredClone(row);}
  if(row.steps[step])return structuredClone(row);
  const extraction=row.steps.extraction;
  if(step==='analysis'&&extraction?.state!=='complete')throw new RecoveryError('ARCHIVED_EXTRACTION_REQUIRED');
  const claim=uuid(),text=new TextDecoder().decode(await readFileBytes(files.get(file.path)!)).substring(0,2000000),textHash=await sha256Bytes(new TextEncoder().encode(text).buffer);
  const input=step==='extraction'?{file_sha256:file.sha256}:{file_sha256:file.sha256,extraction_claim_id:extraction!.claim_id,text_sha256:textHash};
  row.steps[step]={claim_id:claim,state:'unknown',dispatch_authorized:true,input,output:null,error_code:null};
  if(unknownStep===step){unknownStep=null;return structuredClone(row);}
  const ref={archive_id:uuid(),operation_id:row.operation_id,claim_id:claim,file_sha256:file.sha256,text_sha256:textHash,payload_sha256:'a'.repeat(64)};
  const split=text.length>200000&&/[\uD800-\uDBFF]$/.test(text.substring(0,200000));
  const projection=step==='extraction'?{...ref,text_preview:text.substring(0,500),text_length:text.length,tags:[],detected_type:'transit_order',case_text_status:split?'legacy_prefix_invalid_utf16':'available'}:{...ref,extraction_claim_id:extraction!.claim_id,analysis:{cargo_description:'Charge synthétique 😀',origin:'Shanghai',destination:'Dakar',container_count:2,container_type:'20',weight_kg:1000}};
  row.steps[step]!.state='complete';row.steps[step]!.output={...ref,...(step==='extraction'?{extraction_contract:1,text_length:text.length,case_text_status:split?'legacy_prefix_invalid_utf16':'available'}:{extraction_claim_id:extraction!.claim_id})};projections.set(row.operation_id+':'+step,projection);archives.set(row.operation_id+':'+step,text);return structuredClone(row);
 };
 const storage={put:vi.fn(async(expectedActor:string,path:string,blob:Blob,options:{upsert:false})=>{if(actor!==expectedActor||options.upsert!==false||files.has(path))return {error:Error('synthetic collision or actor')};files.set(path,blob);if(lose==='upload'){lose=null;throw Error('synthetic lost upload ack');}return {error:null};})};
 const handler=createRecoveryHandler({authenticate:async()=>actor?{token:'synthetic-only',user:{id:actor}}:new Response('{}',{status:401}),rpc,attestPrepared,verifyFile,documentStep});
 const getSession=vi.fn(async()=>({data:{session:actor?{access_token:'synthetic-only',user:{id:actor}}:null}}));
 const invoke=vi.fn(async(_name:string,options:{body:unknown;headers:Record<string,string>})=>{const body=options.body as {action:string};const response=await handler(new Request('http://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json',...options.headers},body:JSON.stringify(body)}));if(lose===body.action){lose=null;throw new RecoveryError('LOST_SYNTHETIC_ACK','UNKNOWN');}return {data:await response.json(),error:response.ok?null:Error('synthetic HTTP')};});
 const transport={auth:{getSession},functions:{invoke}};
 return {rows,cases,actions,files,archives,storage,rpc,attestPrepared,handler,transport,unknown:(step:string)=>{unknownStep=step;},gateway:createRecoveryGateway(transport),setActor:(value:string|null)=>{actor=value;},lose:(action:string)=>{lose=action;},fail:(action:string)=>{fail=action;}};
}
