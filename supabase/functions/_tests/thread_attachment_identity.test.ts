import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('MAIL_FUNCTION_DISABLE_SERVE','1');Deno.env.set('SYNC_EMAILS_DISABLE_SERVE','1');
const {processAttachment}=await import(Deno.env.get('IMPORT_ATTACHMENT_MODULE_URL')??'../import-thread/index.ts');
const {processEmailAttachments}=await import(Deno.env.get('SYNC_ATTACHMENT_MODULE_URL')??'../sync-emails/index.ts');
const {handler:repair,IMAPClient}=await import(Deno.env.get('REPAIR_ATTACHMENT_MODULE_URL')??'../force-download-attachment/index.ts');
type Row=Record<string,unknown>;
type Result={data:Row[];error:{message:string}|null};
interface Query{select(...args:unknown[]):Query;eq(key:string,value:unknown):Query;limit(n:number):Query;insert(value:Row):Query;
 single():Promise<{data:Row;error:null}>;maybeSingle():Promise<{data:Row|null;error:null}>;
 then(resolve:(value:Result)=>unknown,reject?:(error:unknown)=>unknown):Promise<unknown>}
const bytes=(part:string)=>new TextEncoder().encode('different content part '+part);
const part=(partNumber:string)=>({filename:'invoice.pdf',partNumber,contentType:'application/pdf',size:bytes(partNumber).length,encoding:'base64'});
function store(failUpload=false){const rows:Row[]=[],files=new Map<string,Uint8Array>(),upserts:boolean[]=[];
 const client={from(){let payload:Row={};const filters=new Map<string,unknown>();const q:Query={select:()=>q,eq(key,value){filters.set(key,value);return q;},limit:()=>q,
 insert(value){payload=value;return q;},single(){const row={id:'attachment-'+rows.length,...payload};rows.push(row);return Promise.resolve({data:row,error:null});},
 maybeSingle:()=>Promise.resolve({data:rows.find(r=>[...filters].every(([k,v])=>r[k]===v))??null,error:null}),
 then(resolve,reject){if(Object.keys(payload).length)rows.push({id:'attachment-'+rows.length,...payload});return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};return q;},
 storage:{from:()=>({upload(name:string,content:Uint8Array,options:{upsert:boolean}){upserts.push(options.upsert);if(failUpload)return Promise.resolve({error:{message:'Fictitious refused upload'}});files.set(name,content.slice());return Promise.resolve({data:{path:name},error:null});}})}};
 return {client,rows,files,upserts};}
const imap=(parts=[part('2'),part('3')])=>({fetchAttachment:(_uid:number,n:string)=>Promise.resolve(bytes(n)),fetchBodyStructure:()=>Promise.resolve(parts)});

Deno.test('attachment identity: import preserves homonyms and their distinct bytes in the same millisecond',async()=>{
 const f=store(),clock=Date.now;Date.now=()=>1000;const source=imap() as unknown as Parameters<typeof processAttachment>[0];
 try{for(const p of [part('2'),part('3')])await processAttachment(source,101,p,'mail',f.client);}finally{Date.now=clock;}
 assertEquals(f.rows.length,2);assertEquals(f.files.size,2);assertEquals(new Set(f.rows.map(r=>r.storage_path)).size,2);assertEquals(f.upserts,[false,false]);
 assertEquals([...f.files.values()],[bytes('2'),bytes('3')]);assertEquals(f.rows.map(r=>r.filename),['invoice.pdf','invoice.pdf']);
});
Deno.test('attachment identity: sync retains same-name same-size distinct MIME parts',async()=>{
 const f=store(),clock=Date.now;Date.now=()=>1000;
 try{await processEmailAttachments(imap() as unknown as Parameters<typeof processEmailAttachments>[0],101,'mail',f.client);}finally{Date.now=clock;}
 assertEquals(f.rows.length,2);assertEquals(f.files.size,2);assertEquals(f.upserts,[false,false]);assertEquals([...f.files.values()],[bytes('2'),bytes('3')]);
});
Deno.test('attachment identity: repeated identical MIME part is imported once, names do not define identity',async()=>{
 const f=store();await processEmailAttachments(imap([part('2'),part('2'),part('3')]) as unknown as Parameters<typeof processEmailAttachments>[0],101,'mail',f.client);
 assertEquals(f.rows.length,2);assertEquals(f.files.size,2);
});
Deno.test('attachment identity: sync upload refusal is visible and keeps both source placeholders',async()=>{
 const f=store(true);await assertRejects(()=>processEmailAttachments(imap() as unknown as Parameters<typeof processEmailAttachments>[0],101,'mail',f.client));
 assertEquals(f.rows.length,2);assertEquals(f.files.size,0);assert(f.rows.every(r=>r.storage_path===null));
});

async function force(parts:number,alreadyStored=false){
 const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],saved=keys.map(k=>Deno.env.get(k));
 ['https://fixture.invalid','fixture-anon','fixture-service'].forEach((v,i)=>Deno.env.set(keys[i],v));
 const proto=IMAPClient.prototype as unknown as Record<string,unknown>,methods=['connect','login','select','searchByMessageId','fetchBodyStructure','fetchAttachment','logout','close'];
 const originals=methods.map(n=>proto[n]);let downloads=0,connections=0,writes=0,uploads=0,closed=0;
 proto.connect=()=>{connections++;return Promise.resolve();};proto.login=()=>Promise.resolve(true);proto.select=()=>Promise.resolve();proto.searchByMessageId=()=>Promise.resolve(101);
 proto.fetchBodyStructure=()=>Promise.resolve(Array.from({length:parts},(_,i)=>part(String(i+2))));
 proto.fetchAttachment=()=>{downloads++;return Promise.resolve(bytes('2'));};proto.logout=()=>Promise.resolve();proto.close=()=>{closed++;};
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  const options=init as {method?:string;body?:unknown;headers?:HeadersInit}|undefined;
  const url=new URL(input instanceof Request?input.url:String(input));assertEquals(url.hostname,'fixture.invalid');const method=options?.method??'GET';
  const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  if(url.pathname.endsWith('/user'))return json({id:'fixture-operator',email:'operator@fixture.invalid'});
  if(url.pathname.endsWith('/has_workspace_access'))return json(true);
  if(url.pathname.endsWith('/read_mailbox_secret'))return json('fixture-only-secret');
  if(url.pathname.endsWith('/email_attachments')){
   if(method==='GET')return json({id:'source',filename:'invoice.pdf',content_type:'application/pdf',storage_path:alreadyStored?'existing-file':null,
    emails:{id:'mail',message_id:'<source@fixture.invalid>',email_configs:{id:'config',host:'fixture.invalid',username:'mailbox@fixture.invalid',folder:'INBOX'}}});
   assertEquals(method,'PATCH');assertEquals(url.searchParams.get('id'),'eq.source');writes++;return json(null);
  }
  if(url.pathname.startsWith('/storage/v1/object/documents/')){uploads++;assertEquals(new Headers(options?.headers).get('x-upsert'),'false');return json({Key:'fixture-file'});}
  throw new Error('Unexpected fixture transport '+method+' '+url.pathname);
 };
 try{const response=await repair(new Request('https://fixture.invalid/repair',{method:'POST',headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json'},body:JSON.stringify({attachmentId:'source'})}));
  return {status:response.status,body:await response.json(),downloads,connections,writes,uploads,closed};
 }finally{globalThis.fetch=oldFetch;methods.forEach((name,i)=>proto[name]=originals[i]);keys.forEach((name,i)=>saved[i]===undefined?Deno.env.delete(name):Deno.env.set(name,saved[i]!));}
}
Deno.test('attachment identity: ambiguous repair refuses before content fetch, Storage or fact/document mutation',async()=>{
 const r=await force(2);assertEquals(r.status,409);assertEquals(r.body.code,'ATTACHMENT_IDENTITY_AMBIGUOUS');assertEquals([r.downloads,r.writes,r.uploads],[0,0,0]);assertEquals(r.closed,1);
});
Deno.test('attachment identity: unique repair still updates exactly the requested source',async()=>{
 const r=await force(1);assertEquals(r.status,200);assertEquals(r.body.success,true);assertEquals([r.downloads,r.writes,r.uploads],[1,1,1]);
});
Deno.test('attachment identity: missing repair source is explicit and does not mutate',async()=>{
 const r=await force(0);assertEquals(r.status,404);assertEquals([r.downloads,r.writes,r.uploads],[0,0,0]);
});
Deno.test('attachment identity: existing source bytes are not downloaded or overwritten on replay',async()=>{
 const r=await force(2,true);assertEquals(r.status,400);assertEquals([r.connections,r.downloads,r.writes,r.uploads],[0,0,0,0]);
});
