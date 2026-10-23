/** Explicit inactive gateway. URL stores UUID only; source lives behind JWT SQL.
 * No local/sessionStorage, IndexedDB, token persistence, retry or fallback. */
import { httpRefusal } from './manualIntakeClient';
import { RecoveryError, decodeRecoveryOperation, uuid, type RecoveryOperation } from './recoveryContract';
export interface RecoveryTransport {
 auth:{getSession():Promise<{data:{session:{access_token:string;user:{id:string}}|null};error?:unknown}>};
 functions:{invoke(name:string,options:{body:unknown;headers:Record<string,string>}):Promise<{data:unknown;error:unknown}>};
}
export interface RecoveryGateway {
 identity():Promise<string>;
 call(id:string,action:string,payload?:Record<string,unknown>):Promise<RecoveryOperation|{found:false;operation_id:string}>;
}
export function createRecoveryGateway(transport:RecoveryTransport):RecoveryGateway {
 async function session(){let s;try{s=await transport.auth.getSession();}catch{throw new RecoveryError('AUTH_UNAVAILABLE');}if(s.error||!s.data.session?.access_token||!uuid(s.data.session.user.id))throw new RecoveryError('AUTH_REQUIRED');return s.data.session;}
 return {identity:async()=>(await session()).user.id,async call(id,action,payload={}){
  if(!uuid(id))throw new RecoveryError('OPERATION_ID_INVALID');const auth=await session();let response;
  try{response=await transport.functions.invoke('manual-intake-recovery',{body:{operation_id:id,action,payload},headers:{Authorization:`Bearer ${auth.access_token}`}});}catch{throw new RecoveryError('RECOVERY_UNCONFIRMED',action==='read'||action==='verify'?'BLOCKED':'UNKNOWN');}
  const envelope=(response.data??await httpRefusal(response.error)) as {ok?:unknown;data?:unknown;error?:{code?:unknown;outcome?:unknown}}|null;
  // Verify identity again before any source or receipt is handed to the UI.
  const after=await session();if(after.user.id!==auth.user.id)throw new RecoveryError('ACTOR_CHANGED','UNKNOWN');
  if(envelope?.ok===false&&typeof envelope.error?.code==='string'&&/^[A-Z_]{1,64}$/.test(envelope.error.code)&&['BLOCKED','UNKNOWN'].includes(envelope.error.outcome as string))throw new RecoveryError(envelope.error.code,envelope.error.outcome as 'BLOCKED'|'UNKNOWN');
  if(response.error||envelope?.ok!==true)throw new RecoveryError('RECOVERY_UNCONFIRMED',action==='read'||action==='verify'?'BLOCKED':'UNKNOWN');
  return decodeRecoveryOperation(envelope.data,id,auth.user.id);
 }};
}
