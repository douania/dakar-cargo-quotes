import {describe,it,expect,vi} from 'vitest';
import {createManualIntakeHandler} from '../../../supabase/functions/manual-intake/handler';
import {newManualIntakeOperation} from './manualIntakeCommand';
import {decodeRecoveryOperation,type RecoveryOperation} from './recoveryContract';
import {createRecoveryGateway} from './recoveryClient';
import {createRecoverySession} from './recoverySession';
import {recoveryFixture,operationId as id,actorId,syntheticForm as form} from '../../../scripts/railway-exit/recovery-fixture';
const colleague='cccccccc-cccc-4ccc-8ccc-000000000501';
const reference=()=>({read:()=>id,write:vi.fn()});
const emptyReference=()=>{let saved:string|null=null;return {read:()=>saved,write:(v:string|null)=>{saved=v;}};};
async function committed(){const f=recoveryFixture();await createRecoverySession(f.gateway,emptyReference(),()=>id).submit(form());return {f,row:structuredClone(f.rows.get(id)!) as RecoveryOperation};}
describe('approved collaboration: server projection contracts, synthetic only',()=>{
 it('linked colleague read preserves origin and validates the actual viewer',async()=>{
  const {row}=await committed();row.access={viewer_user_id:colleague,case_id:id,can_write:false};
  expect(decodeRecoveryOperation(row,id,colleague)).toMatchObject({actor_user_id:actorId,access:{can_write:false}});
  expect(()=>decodeRecoveryOperation(row,id,actorId)).toThrow();
 });
 it.each([
  {viewer_user_id:colleague,case_id:null,can_write:true},
  {viewer_user_id:colleague,case_id:'dddddddd-dddd-4ddd-8ddd-000000000501',can_write:true},
  {viewer_user_id:colleague,case_id:id,can_write:'yes'},
  {viewer_user_id:colleague,case_id:id,can_write:true,owner_override:true},
 ])('rejects malformed, unattached or foreign access projection %j',async access=>{
  const {row}=await committed();expect(()=>decodeRecoveryOperation({...row,access},id,colleague)).toThrow();
 });
 it('an unlinked draft cannot claim shared case rights or a different origin',async()=>{
  const f=recoveryFixture();f.lose('reserve');await expect(createRecoverySession(f.gateway,emptyReference(),()=>id).submit(form())).rejects.toThrow();
  const row=f.rows.get(id)!;expect(()=>decodeRecoveryOperation({...row,access:{viewer_user_id:colleague,case_id:id,can_write:true}},id,colleague)).toThrow();
  expect(()=>decodeRecoveryOperation(row,id,colleague)).toThrow();
 });
 it('read-only session restores evidence and blocks mutation before gateway dispatch',async()=>{
  const {row}=await committed();row.access={viewer_user_id:colleague,case_id:id,can_write:false};
  const call=vi.fn(async()=>structuredClone(row)),s=createRecoverySession({identity:async()=>colleague,call},reference(),vi.fn());
  expect((await s.restore()).actor_user_id).toBe(actorId);expect(s.isLocked()).toBe(true);
  await expect(s.submit(form())).rejects.toMatchObject({code:'READ_ONLY',outcome:'BLOCKED'});
  await expect(s.abandon()).rejects.toMatchObject({code:'READ_ONLY'});
  expect(call.mock.calls).toHaveLength(1);
 });
 it('assigned colleague restores the original receipt without creating or reclassifying a case',async()=>{
  const {row}=await committed();row.access={viewer_user_id:colleague,case_id:id,can_write:true};
  const call=vi.fn(async()=>structuredClone(row)),allocate=vi.fn(),s=createRecoverySession({identity:async()=>colleague,call},reference(),allocate);
  await s.restore();expect((await s.submit(form())).snapshot_id).toBe((row.receipt as {snapshot_id:string}).snapshot_id);
  expect(call).toHaveBeenCalledTimes(1);expect(allocate).not.toHaveBeenCalled();expect(s.current()?.actor_user_id).toBe(actorId);
 });
 it('identity change while a shared response arrives discards sensitive data',async()=>{
  const {row}=await committed();let viewer=colleague;row.access={viewer_user_id:colleague,case_id:id,can_write:true};
  const gateway=createRecoveryGateway({auth:{getSession:async()=>({data:{session:{access_token:'SYNTHETIC',user:{id:viewer}}}})},functions:{invoke:async()=>{viewer=actorId;return {data:{ok:true,data:row},error:null};}}});
  const s=createRecoverySession(gateway,reference(),vi.fn());await expect(s.restore()).rejects.toMatchObject({code:'ACTOR_CHANGED',outcome:'UNKNOWN'});expect(s.current()).toBe(null);expect(s.hasUnresolved()).toBe(true);
 });
});
describe('attested SQL refusal differs from lost transport, without clearing prior uncertainty',()=>{
 it.each([['PT409','Automatic source revision requires the ordered writer','SOURCE_REVISION_CONFLICT'],['23505','duplicate key value violates unique constraint "case_documents_case_id_file_name_unique"','INTAKE_CONFLICT'],['23505','MIR_DOCUMENT_COLLISION','MIR_DOCUMENT_COLLISION']])('maps trusted SQL %s to a sanitized confirmed refusal',async(code,message,expected)=>{
  const f=recoveryFixture(),orig=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>args[2].p_action==='commit'?{data:null,error:{code,message}}:orig(...args));
  const s=createRecoverySession(f.gateway,emptyReference(),()=>id);await expect(s.submit(form())).rejects.toMatchObject({code:expected,outcome:'BLOCKED'});
  expect(f.cases.size).toBe(0);expect(f.rows.get(id)?.state).toBe('prepared');expect(s.hasUnresolved()).toBe(true);expect(()=>s.startNew()).toThrow();
 });
 it('lost commit ACK remains UNKNOWN and a later SQL refusal does not unlock a new UUID',async()=>{
  const f=recoveryFixture(),ref={value:null as string|null,read(){return this.value;},write(v:string|null){this.value=v;}},s=createRecoverySession(f.gateway,ref,()=>id);
  f.lose('commit');await expect(s.submit(form())).rejects.toMatchObject({outcome:'UNKNOWN'});expect(f.cases.size).toBe(1);
  f.rpc.mockImplementationOnce(async()=>({data:null,error:{code:'23505',message:'duplicate key value violates unique constraint "case_documents_case_id_file_name_unique"'}}));
  await expect(s.restore()).rejects.toMatchObject({outcome:'BLOCKED'});expect(s.hasUnresolved()).toBe(true);expect(()=>s.startNew()).toThrow();
  expect((await s.restore()).state).toBe('committed');expect(s.hasUnresolved()).toBe(false);expect(f.cases.size).toBe(1);
 });
 it('unclassified transport exception is still UNKNOWN rather than a SQL refusal',async()=>{
  const f=recoveryFixture(),orig=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(...args)=>{if(args[2].p_action==='commit')throw new TypeError('synthetic transport lost');return orig(...args);});
  await expect(createRecoverySession(f.gateway,emptyReference(),()=>id).submit(form())).rejects.toMatchObject({code:'RECOVERY_UNCONFIRMED',outcome:'UNKNOWN'});
 });
});

describe('manual intake endpoint confirmed SQL conflicts',()=>{
 it.each([['PT409','SOURCE_REVISION_CONFLICT'],['23505','INTAKE_CONFLICT']])('maps %s without exposing database details',async(code,expected)=>{
  const handler=createManualIntakeHandler({authenticate:async()=>({token:'SYNTHETIC'}),record:async()=>({data:null,error:{code,message:code==='PT409'?'Automatic source revision requires the ordered writer':'duplicate key value violates unique constraint "case_documents_case_id_file_name_unique"'}})});
  const response=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(newManualIntakeOperation(form(),()=>id))}));
  expect(response.status).toBe(409);expect(await response.json()).toEqual({ok:false,error:{code:expected,outcome:'BLOCKED'}});
 });
});

describe('SQL markers alone do not attest rollback',()=>{
 it.each(['PT409','23505'])('keeps unexpected %s diagnostic UNKNOWN in both handlers',async code=>{
  const message='upstream DIS_IDEMPOTENCY_CONFLICT unavailable';
  const f=recoveryFixture(),orig=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...a)=>a[2].p_action==='commit'?{data:null,error:{code,message}}:orig(...a));
  await expect(createRecoverySession(f.gateway,emptyReference(),()=>id).submit(form())).rejects.toMatchObject({outcome:'UNKNOWN'});
  const manual=createManualIntakeHandler({authenticate:async()=>({token:'SYNTHETIC'}),record:async()=>({data:null,error:{code,message}})});
  const response=await manual(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(newManualIntakeOperation(form(),()=>id))}));
  expect((await response.json()).error.outcome).toBe('UNKNOWN');
 });
});
