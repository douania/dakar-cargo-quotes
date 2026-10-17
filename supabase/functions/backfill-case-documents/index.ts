/** Prepare one stored case document through the canonical extractor, under the caller's JWT. */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { EXTRACTION_CONTRACT, extractionMessage, hasExtractedText } from '../_shared/document-extraction.ts';

export async function handleBackfillCaseDocuments(req: Request): Promise<Response> {
  const reply = (data: unknown, status = 200) => Response.json(data, {status,headers:corsHeaders});
  if (req.method === 'OPTIONS') return new Response(null,{headers:corsHeaders});
  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const {case_id, document_id} = await req.json().catch(() => ({}));
    if (typeof case_id !== 'string' || !case_id || (document_id !== undefined && typeof document_id !== 'string')) {
      return reply({error:'case_id et document_id invalides'},400);
    }
    const url = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_ANON_KEY')!;
    const user = createClient(url,key,{global:{headers:{Authorization:req.headers.get('Authorization')!}},auth:{persistSession:false}});
    const access = await user.from('quote_cases').select('id').eq('id',case_id).maybeSingle();
    if (access.error || !access.data) return reply({error:'Dossier inaccessible'},403);
    const read = () => user.from('case_documents').select('id,case_id,file_name,extracted_text',{count:'exact'}).eq('case_id',case_id).order('id');
    const initial = await read();
    if (initial.error || initial.count === null || initial.count > (initial.data?.length ?? 0)) {
      return reply({success:false,error:extractionMessage('DOCUMENT_READ_FAILED')},503);
    }
    const pending = (initial.data ?? []).filter(doc => !hasExtractedText(doc.extracted_text));
    const target = document_id ? initial.data?.find(doc => doc.id === document_id) : pending[0];
    if (document_id && !target) return reply({error:'Document inaccessible dans ce dossier'},403);
    if (!target || hasExtractedText(target.extracted_text)) return reply({
      success:true,status:'ok',extraction_contract:EXTRACTION_CONTRACT,remaining:pending.length,
      ...(target ? {processed_id:target.id,processed_file:target.file_name,text_length:target.extracted_text!.length,replayed:true} : {}),
    });

    const form = new FormData();form.append('case_document_id',target.id);
    const response = await fetch(url+'/functions/v1/parse-document',{
      method:'POST',headers:{Authorization:req.headers.get('Authorization')!,apikey:key},body:form,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true || result?.extraction_contract !== EXTRACTION_CONTRACT ||
        result?.extraction?.status !== 'extracted' || result?.extraction?.persisted !== true ||
        !(result.extraction.text_length > 0) || result?.document?.id !== target.id) {
      return reply({success:false,status:'error',extraction_contract:EXTRACTION_CONTRACT,
        processed_id:target.id,processed_file:target.file_name,remaining:pending.length,
        error:result?.error ?? extractionMessage('EXTRACTION_UNAVAILABLE'),extraction:result?.extraction},response.ok ? 502 : response.status);
    }
    const after = await read();
    const saved = after.data?.find(doc => doc.id === target.id);
    if (after.error || after.count === null || after.count > (after.data?.length ?? 0) || !hasExtractedText(saved?.extracted_text)) {
      return reply({success:false,error:extractionMessage('DOCUMENT_READ_FAILED')},503);
    }
    return reply({success:true,status:'ok',extraction_contract:EXTRACTION_CONTRACT,
      processed_id:target.id,processed_file:target.file_name,text_length:saved.extracted_text.length,
      remaining:after.data!.filter(doc => !hasExtractedText(doc.extracted_text)).length,extraction:result.extraction});
  } catch {
    return reply({success:false,error:extractionMessage('EXTRACTION_UNAVAILABLE')},502);
  }
}
if (import.meta.main) Deno.serve(handleBackfillCaseDocuments);