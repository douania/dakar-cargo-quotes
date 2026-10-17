import { requireUser } from '../_shared/auth.ts';
import { handleCors } from '../_shared/cors.ts';
import { getCorrelationId,respondOk } from '../_shared/runtime.ts';
import { commercialUuid,readCommercial,saveCommercial } from '../_shared/commercial-service.ts';
import { corsHeaders } from '../_shared/cors.ts';

export async function handleCommercialPreparation(req: Request): Promise<Response> {
  const cors=handleCors(req);if(cors) return cors;
  const auth=await requireUser(req);if(auth instanceof Response)return auth;
  const correlationId=getCorrelationId(req);
  try {
    if(req.method!=='POST')return new Response(null,{status:405,headers:corsHeaders});
    const text=await req.text();if(text.length>100000)throw new Error('Demande trop volumineuse');
    const body=JSON.parse(text);
    if(!commercialUuid(body.case_id))throw new Error('Dossier requis');
    if(body.action==='read')return respondOk(await readCommercial(auth,body.case_id),correlationId);
    if(body.action==='save')return respondOk(await saveCommercial(auth,body),correlationId);
    throw new Error('Action commerciale invalide');
  } catch(error) {
    const e=error as Error & {status?:number};
    return new Response(JSON.stringify({ok:false,error:{code:e.status===409?'CONFLICT_INVALID_STATE':e.status===403?'FORBIDDEN_OWNER':'VALIDATION_FAILED',message:e.message},correlationId}),
      {status:e.status??400,headers:{...corsHeaders,'Content-Type':'application/json'}});
  }
}
if(import.meta.main)Deno.serve(handleCommercialPreparation);
