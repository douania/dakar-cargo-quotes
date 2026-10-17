import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { PDFDocument, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';
import { handleParseDocument } from './index.ts';
import { handleBackfillCaseDocuments } from '../backfill-case-documents/index.ts';
import { hasExtractedText } from '../_shared/document-extraction.ts';

type Doc = {id:string;case_id:string;file_name:string;storage_path:string;mime_type:string;extracted_text:string|null};
async function fixture(run:(f: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const original = fetch, keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'];
  const prior = keys.map(k=>Deno.env.get(k));
  Deno.env.set(keys[0],'https://fixture.invalid');Deno.env.set(keys[1],'synthetic-anon');Deno.env.set(keys[2],'synthetic-service');Deno.env.delete(keys[3]);
  const f=await makeFixture();globalThis.fetch=f.fetch;
  try { await run(f); } finally { globalThis.fetch=original;keys.forEach((k,i)=>prior[i]===undefined?Deno.env.delete(k):Deno.env.set(k,prior[i]!)); }
}
async function makeFixture() {
  const docs:Doc[]=[{id:'doc-a',case_id:'case-a',file_name:'synthetic.png',storage_path:'case-a/immutable.png',mime_type:'image/png',extracted_text:null}];
  let bytes=new Uint8Array([137,80,78,71]),provider='success',admitted=true,writeFailure=false,downloadFailure=false,concurrentText:string|null=null,countUnknown=false,countOverflow=false;
  const calls:Array<{path:string;method:string;auth:string|null}> = [],standalone:unknown[]=[];
  const json=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
  const network:typeof fetch=async(input,init)=>{
    const req=input instanceof Request?input:new Request(String(input),init),url=new URL(req.url);calls.push({path:url.pathname,method:req.method,auth:req.headers.get('Authorization')});
    if(url.hostname==='ai.gateway.lovable.dev'){
      if(provider==='throws')throw new TypeError('Synthetic provider failure');
      return provider==='error'?json({error:'synthetic provider unavailable'},503):json({choices:[{message:{content:provider==='empty'?' \n ':'FACTURE SYNTHETIQUE - colis 5 kg - montant documentaire 100 EUR'}}]});
    }
    assertEquals(url.hostname,'fixture.invalid','No real service or credential may be used');
    if(url.pathname==='/auth/v1/user')return json({id:'actor-synthetic'});
    if(url.pathname.endsWith('/has_workspace_access'))return json(admitted);
    if(url.pathname==='/functions/v1/parse-document')return handleParseDocument(req);
    if(url.pathname==='/rest/v1/quote_cases')return json([{id:'case-a'}]);
    if(url.pathname==='/rest/v1/case_documents'){
      if(req.method==='PATCH' && concurrentText!==null) docs[0].extracted_text=concurrentText;
      const selected=docs.filter(d=>['id','case_id','storage_path','extracted_text'].every(k=>{
        const p=url.searchParams.get(k);return !p || (p==='is.null'?(d as unknown as Record<string,unknown>)[k]===null:p==='eq.'+String((d as unknown as Record<string,unknown>)[k]));
      }));
      if(req.method==='PATCH'){
        if(writeFailure)return json({message:'injected write refusal'},500);
        const value=await req.json();for(const doc of selected)Object.assign(doc,value);return json(selected);
      }
      const headers:Record<string,string>=countUnknown?{}:{'Content-Range':`0-${Math.max(selected.length-1,0)}/${countOverflow?selected.length+1:selected.length}`};
      return json(selected,200,headers);
    }
    if(url.pathname.startsWith('/storage/v1/object/')&&req.method==='GET')return downloadFailure?json({error:'missing'},404):new Response(bytes.slice(),{headers:{'Content-Type':docs[0].mime_type}});
    if(url.pathname.startsWith('/storage/v1/object/')&&req.method==='POST')return json({Key:'documents/synthetic'});
    if(url.pathname==='/rest/v1/documents'&&req.method==='POST'){const value=await req.json();standalone.push(value);return json({id:'standalone-a',...value});}
    throw new Error('Unexpected fixture request '+req.method+' '+url.pathname);
  };
  const parse=(id:string|null='doc-a',file?:File,authenticated=true)=>{const form=new FormData();if(id)form.append('case_document_id',id);if(file)form.append('file',file);return handleParseDocument(new Request('https://fixture.invalid/parse',{method:'POST',headers:authenticated?{Authorization:'Bearer synthetic-user-token'}:{},body:form}));};
  const backfill=(body:unknown={case_id:'case-a'})=>handleBackfillCaseDocuments(new Request('https://fixture.invalid/backfill',{method:'POST',headers:{Authorization:'Bearer synthetic-user-token','Content-Type':'application/json'},body:JSON.stringify(body)}));
  return {docs,calls,standalone,fetch:network,parse,backfill,setProvider(value:string){provider=value;if(value==='absent')Deno.env.delete('LOVABLE_API_KEY');else Deno.env.set('LOVABLE_API_KEY','synthetic-provider-key-not-real');},setBytes(value:Uint8Array,name='synthetic.pdf',mime='application/pdf'){bytes=value.slice();docs[0].file_name=name;docs[0].mime_type=mime;},setAdmitted(value:boolean){admitted=value;},setWriteFailure(){writeFailure=true;},setDownloadFailure(){downloadFailure=true;},setConcurrentText(value:string){concurrentText=value;},setCountUnknown(){countUnknown=true;},setCountOverflow(){countOverflow=true;}};
}
async function pdf(text:string){const doc=await PDFDocument.create(),page=doc.addPage(),font=await doc.embedFont(StandardFonts.Helvetica);page.drawText(text,{font,size:12,x:50,y:700});return doc.save();}

Deno.test('extraction: anonymous/non-member denied before document/Storage reads',()=>fixture(async f=>{
  assertEquals((await f.parse('doc-a',undefined,false)).status,401);assertEquals(f.calls.length,0);f.setAdmitted(false);assertEquals((await f.parse()).status,403);assert(!f.calls.some(c=>c.path.includes('case_documents')||c.path.includes('storage')));
}));
Deno.test('extraction: inaccessible ID cannot use service writes or supplied bytes',()=>fixture(async f=>{
  assertEquals((await f.parse('missing',new File(['forged'],'forged.txt'))).status,403);assert(!f.calls.some(c=>c.path.includes('storage')||c.method==='PATCH'));
}));
for(const [mode,status,state] of [['absent',503,'error'],['error',502,'error'],['throws',502,'error'],['empty',422,'empty']] as const){
  Deno.test('extraction: image '+mode+' is not HTTP200 success, preserves source and remains retryable',()=>fixture(async f=>{
    f.setProvider(mode);const before=JSON.stringify(f.docs);const response=await f.parse(),body=await response.json();assertEquals(response.status,status);assertEquals(body.success,false);assertEquals(body.extraction.status,state);assertEquals(body.extraction.persisted,false);assertEquals(JSON.stringify(f.docs),before);assert(!f.calls.some(c=>c.method==='PATCH'));assert(!JSON.stringify(body).includes('synthetic-provider-key'));
  }));
}
Deno.test('extraction: short and long actual PDF text work locally, size retained and no AI request',()=>fixture(async f=>{
  for(const text of ['5 kg','FACTURE SYNTHETIQUE - marchandise colisage poids et valeur documentaire 100 EUR']){
    f.docs[0].extracted_text=null;const bytes=await pdf(text);f.setBytes(bytes);const response=await f.parse(),body=await response.json();assertEquals(response.status,200);assertEquals(body.extraction.status,'extracted');assertEquals(body.document.extracted_data.rawSize,bytes.length);assertEquals(f.docs[0].extracted_text,text);
  }
  assert(!f.calls.some(c=>c.path.includes('chat/completions')));
}));
Deno.test('extraction: scanned/empty PDF without provider never persists an error marker',()=>fixture(async f=>{
  f.setBytes(await pdf(' '));const response=await f.parse();assertEquals(response.status,503);assertEquals(f.docs[0].extracted_text,null);
}));
Deno.test('extraction: stored bytes are authoritative and conditional write pins case/source/previous text',()=>fixture(async f=>{
  f.setBytes(new TextEncoder().encode('POIDS SOURCE 5 kg'),'source.txt','text/plain');const response=await f.parse('doc-a',new File(['FORGED CLIENT TEXT'],'forged.txt'));assertEquals(response.status,200);assertEquals(f.docs[0].extracted_text,'POIDS SOURCE 5 kg');const reads=f.calls.filter(c=>c.path==='/rest/v1/case_documents'&&c.method==='GET');assert(reads.every(c=>c.auth==='Bearer synthetic-user-token'));assertEquals(f.calls.filter(c=>c.method==='PATCH').length,1);
}));
Deno.test('extraction: valid previous text is a replay without provider/download/mutation',()=>fixture(async f=>{
  f.docs[0].extracted_text='5 kg';f.setProvider('error');const before=JSON.stringify(f.docs),response=await f.parse(),body=await response.json();assertEquals(response.status,200);assertEquals(body.extraction.replayed,true);assertEquals(JSON.stringify(f.docs),before);assert(!f.calls.some(c=>c.path.includes('storage')||c.method==='PATCH'||c.path.includes('chat/completions')));
}));
Deno.test('extraction: empty/error retry of same stored image later succeeds without new source or duplicate',()=>fixture(async f=>{
  f.docs[0].extracted_text='[OCR vide]';f.setProvider('empty');assertEquals((await f.parse()).status,422);assertEquals(f.docs[0].extracted_text,'[OCR vide]');f.setProvider('success');const before={...f.docs[0]},response=await f.parse();assertEquals(response.status,200);assert(hasExtractedText(f.docs[0].extracted_text));assertEquals(f.docs.length,1);assertEquals(f.docs[0].storage_path,before.storage_path);assertEquals(f.docs[0].id,before.id);assert(!f.calls.some(c=>c.path.includes('storage')&&c.method==='POST'));const again=await(await f.parse()).json();assertEquals(again.extraction.replayed,true);assertEquals(f.calls.filter(c=>c.method==='PATCH').length,1);
}));
Deno.test('extraction: failed write is not success, and concurrent valid extraction wins CAS',()=>fixture(async f=>{
  f.setProvider('success');f.setWriteFailure();assertEquals((await f.parse()).status,500);assertEquals(f.docs[0].extracted_text,null);
}));
Deno.test('extraction: CAS zero rows preserves a concurrent valid text',()=>fixture(async f=>{
  f.setProvider('success');f.setConcurrentText('AUTRE EXTRACTION VALIDE');assertEquals((await f.parse()).status,409);assertEquals(f.docs[0].extracted_text,'AUTRE EXTRACTION VALIDE');
}));
Deno.test('extraction: standalone failed image retains uploaded file metadata as error, never evidence',()=>fixture(async f=>{
  f.setProvider('absent');const response=await f.parse(null,new File([new Uint8Array([137,80])],'synthetic.png',{type:'image/png'}));assertEquals(response.status,503);assertEquals(f.standalone.length,1);const row=f.standalone[0] as {content_text:string;extracted_data:{extractionStatus:string}};assertEquals(row.content_text,'');assertEquals(row.extracted_data.extractionStatus,'error');
}));
Deno.test('backfill: legacy placeholders are retryable; provider failure cannot become remaining0',()=>fixture(async f=>{
  f.docs[0].extracted_text='[Extraction echouee]';f.setProvider('absent');const response=await f.backfill(),body=await response.json();assertEquals(response.status,503);assertEquals(body.remaining,1);assertEquals(f.docs[0].extracted_text,'[Extraction echouee]');f.setProvider('success');const success=await(await f.backfill()).json();assertEquals(success.status,'ok');assertEquals(success.remaining,0);assertEquals(success.extraction_contract,1);assert(f.calls.filter(c=>c.path==='/functions/v1/parse-document').every(c=>c.auth==='Bearer synthetic-user-token'));
}));
Deno.test('backfill: case/document mismatch and unknown/truncated counts fail closed',()=>fixture(async f=>{
  assertEquals((await f.backfill({case_id:'case-a',document_id:'other-case-doc'})).status,403);f.setCountUnknown();assertEquals((await f.backfill()).status,503);
}));
Deno.test('backfill: truncated scan cannot announce ready',()=>fixture(async f=>{f.setCountOverflow();assertEquals((await f.backfill()).status,503);}));
Deno.test('extraction: exact historical markers only; real short text and longer sentences remain evidence',()=>{
  for(const t of [null,'',' \n ','[OCR vide]','[Extraction echouee]','[PDF - extraction indisponible]'])assertEquals(hasExtractedText(t),false);
  for(const t of ['5 kg','A','[OCR vide] suivi du vrai document','Erreur lors de livraison : colis de 5 kg'])assertEquals(hasExtractedText(t),true);
});
