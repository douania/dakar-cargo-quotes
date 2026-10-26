import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { imapAccountKey, imapAccountSnapshot } from '../_shared/imap-import-identity.ts';
Deno.env.set('MAIL_FUNCTION_DISABLE_SERVE', '1');
const { IMAPClient, handler } = await import('./index.ts');
const config = { id: 'fixture-config', host: 'fixture.invalid', port: 143, username: 'mailbox@example.invalid', use_ssl: true, folder: 'INBOX', is_active: true };
const root = '<root@example.invalid>';
const messages = [101,102,103,104].map((uid, i) => ({ uid, messageId: i ? `<reply-${i}@example.invalid>` : root,
  references: i ? root : '', subject: 'Fixture quotation', from: 'sender@example.invalid', to: ['mailbox@example.invalid'],
  date: '2026-01-01T12:00:00Z', bodyText: 'New fetched body must not overwrite existing', bodyHtml: '<p>New HTML</p>',
  attachments: [{ filename: 'fixture.pdf', contentType: 'application/pdf', size: 100, partNumber: '2', encoding: 'base64' }],
}));
const identity = { configId: config.id, accountKey: await imapAccountKey(config), mailbox: 'INBOX', uidValidity: 77,
  messages: messages.map(({uid,messageId}) => ({uid,messageId})),
};

async function fixture(options: { identity?: unknown; root?: string; validity?: number; rpcError?: {code: string}; headerId?: string; headerRoot?: string; fetchedId?: string; mixed?: boolean; summaryState?: 'approved' | 'pending' | 'concurrent' } = {}) {
  const env = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'];
  const previous = env.map(key => Deno.env.get(key));
  env.forEach((key,i) => Deno.env.set(key, ['https://fixture.invalid','fixture-anon','fixture-service','fixture-only-ai-key'][i]));
  const proto = IMAPClient.prototype as unknown as Record<string, unknown>;
  const methods = ['connect','login','select','logout','fetchHeaders','fetchMessage','fetchAttachment'];
  const originals = methods.map(key => proto[key]);
  let headerReads = 0, bodyReads = 0, attachmentReads = 0;
  proto.connect = () => Promise.resolve(); proto.login = () => Promise.resolve(true); proto.logout = () => Promise.resolve();
  proto.select = function(this: {uidValidity: number}) { this.uidValidity = options.validity ?? 77; return Promise.resolve(); };
  proto.fetchHeaders = (uid: number) => { headerReads++; const m = messages.find(m=>m.uid===uid)!; return Promise.resolve({ ...m,
    messageId: uid === 104 && options.headerId ? options.headerId : m.messageId,
    references: uid === 104 && options.headerRoot ? options.headerRoot : m.references,
  }); };
  proto.fetchMessage = (uid: number) => { bodyReads++; const m=messages.find(m=>m.uid===uid)!; return Promise.resolve({ ...m, messageId: options.fetchedId ?? m.messageId }); };
  proto.fetchAttachment = (uid: number) => {
    attachmentReads++; assertEquals(options.mixed,true); assertEquals(uid,104,'Only new email attachment is fetched');
    return Promise.resolve(new Uint8Array([1,2,3,4]));
  };
  const fetchBefore = globalThis.fetch;
  const requests: { method: string; path: string; query: string; payload?: Record<string, unknown> }[] = [];
  const stored = messages.map((m, i) => ({ id: `fixture-email-${i}`, email_config_id: config.id, message_id: m.messageId,
    thread_id: root, thread_ref: 'fixture-thread', body_text: 'Original stored body', body_html: '<p>Stored</p>',
    subject: m.subject, from_address: m.from, to_addresses: m.to, sent_at: m.date, extracted_data: { operator: 'preserve' },
  }));
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEquals(['https://fixture.invalid','https://ai.gateway.lovable.dev'].includes(url.origin),true);
    const method = init?.method ?? 'GET', payload = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({method,path:url.pathname,query:url.search,payload});
    const json = (data: unknown, status=200) => Promise.resolve(new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json'}}));
    if(url.pathname==='/auth/v1/user') return json({id:'fixture-user',email:'operator@example.invalid'});
    if(url.pathname.endsWith('/rpc/has_workspace_access')) return json(true);
    if(url.pathname.endsWith('/rpc/read_mailbox_secret')) return json('fixture-only-password');
    if(url.pathname.endsWith('/email_configs') && method==='GET') return json(config);
    if(url.origin==='https://ai.gateway.lovable.dev') {
      assertEquals(options.mixed,true,'No AI request for existing emails alone');
      return json({choices:[{message:{content:JSON.stringify({summary:'Fixture-only analysis',extractions:[],quotation_detected:false})}}]});
    }
    if(url.pathname.endsWith('/rpc/persist_imap_import_batch')) {
      if(options.rpcError) return json({...options.rpcError,message:'fixture conflict'},400);
      assertEquals(payload.p_account,imapAccountSnapshot(config));
      assertEquals(payload.p_uid_validity,77); assertEquals(payload.p_mailbox,'INBOX'); assertEquals(payload.p_root_message_id,root);
      assertEquals((payload.p_messages as unknown[]).length,4);
      return json({emails:messages.map((m,i)=>({id:`fixture-email-${i}`,uid:m.uid,created:options.mixed===true&&i===3})),thread_id:root,thread_ref:'fixture-thread'});
    }
    if(url.pathname.endsWith('/emails') && method==='GET') return json(stored);
    if(options.mixed && method==='PATCH' && url.pathname.endsWith('/emails')) {
      assertEquals(url.searchParams.get('id'),'eq.fixture-email-3'); assertEquals(Object.keys(payload),['extracted_data']); return json(null);
    }
    if(options.mixed && url.pathname.startsWith('/storage/v1/object/documents/')) {
      assertEquals(url.pathname.includes('/fixture-email-3/'),true); return json({Key:'fixture-file'});
    }
    if(options.mixed && url.pathname.endsWith('/email_attachments') && method==='POST') {
      assertEquals(payload.email_id,'fixture-email-3'); return json({id:'fixture-new-attachment',...payload});
    }
    if(options.mixed && url.pathname.endsWith('/learned_knowledge')) {
      if (options.summaryState && method === 'GET') return json({id:'synthetic-summary',is_validated:options.summaryState === 'approved'});
      if (options.summaryState && method === 'PATCH') assertEquals(url.searchParams.get('is_validated'),'eq.false','Summary update must guard concurrent approval');
      return json(method==='GET'?[]:null);
    }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  };
  try {
    const response = await handler(new Request('https://fixture.invalid/import-thread',{method:'POST',headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json'},
      body:JSON.stringify({configId:config.id,uids:[101,102,103,104],threadKey:options.root ?? root,
        learningCase:'quotation',searchIdentity: Object.hasOwn(options,'identity') ? options.identity : identity}),
    }));
    const data=await response.json();
    if(!options.mixed) {
      assertEquals(requests.filter(r=>r.method!=='GET'&&!r.path.includes('/rpc/')).length,0,'No existing body/PJ/AI mutations');
      assertEquals(attachmentReads,0);
    } else assertEquals(attachmentReads,1);
    return {status:response.status,data,requests,headerReads,bodyReads};
  } finally { globalThis.fetch=fetchBefore; methods.forEach((key,i)=>{proto[key]=originals[i];}); env.forEach((key,i)=>previous[i]===undefined?Deno.env.delete(key):Deno.env.set(key,previous[i]!)); }
}

Deno.test('import identity: all existing reuse UUIDs and stored content, skip attachments and learning',async()=>{
  for(let replay=0;replay<2;replay++) {
    const r=await fixture(); assertEquals(r.status,200); assertEquals(r.data.imported,0); assertEquals(r.data.alreadyExisted,4);
    assertEquals(r.data.threadId,root); assertEquals(r.data.analysis,null); assertEquals(r.data.attachmentsProcessed,0);
    assertEquals(r.data.emails.map((m:{id:string})=>m.id),['fixture-email-0','fixture-email-1','fixture-email-2','fixture-email-3']);
    assertEquals(r.data.emails.every((m:{body_text:string;bodyUpdated:boolean})=>m.body_text==='Original stored body'&&m.bodyUpdated===false),true);
    assertEquals(r.requests.filter(q=>q.path.includes('persist_imap_import_batch')).length,1);
  }
});
Deno.test('import identity: mixed handler processes one new PJ and fake AI without writing existing content',async()=>{
  const r=await fixture({mixed:true}); assertEquals(r.status,200); assertEquals(r.data.imported,1); assertEquals(r.data.alreadyExisted,3);
  assertEquals(r.data.attachmentsProcessed,1); assertEquals(r.data.analysis.summary,'Fixture-only analysis');
  assertEquals(r.requests.filter(q=>q.path.endsWith('/emails')&&q.method==='PATCH').length,1);
  assertEquals(r.requests.filter(q=>q.path.endsWith('/email_attachments')&&q.method==='POST').length,1);
});
for(const [name, change] of [
  ['missing', undefined], ['another config',{...identity,configId:'fixture-other-config'}], ['another mailbox',{...identity,mailbox:'Archive'}],
  ['another account',{...identity,accountKey:'other-account'}], ['old generation',{...identity,uidValidity:76}],
  ['ambiguous UID',{...identity,messages:[...identity.messages,identity.messages[0]]}],
  ['synthetic header ID',{...identity,messages:identity.messages.map(m=>({...m,messageId:`<${m.uid}@imported>`}))}],
] as const) Deno.test(`import identity: ${name} selection refuses before headers or persistence`,async()=>{
  const r=await fixture({identity:change}); assertEquals(r.status,409); assertEquals(r.headerReads,0); assertEquals(r.bodyReads,0);
  assertEquals(r.requests.some(q=>q.path.includes('persist_imap_import_batch')),false);
});
Deno.test('import identity: header Message-ID mismatch rejects all headers before bodies/persistence',async()=>{
  const r=await fixture({headerId:'<changed@example.invalid>'}); assertEquals(r.status,409); assertEquals(r.bodyReads,0);
  assertEquals(r.requests.some(q=>q.path.includes('persist_imap_import_batch')),false);
});
Deno.test('import identity: mixed roots or caller root mismatch rejects without persistence',async()=>{
  for(const options of [{headerRoot:'<other@example.invalid>'},{root:'<other@example.invalid>'}]) {
    const r=await fixture(options); assertEquals(r.status,409); assertEquals(r.bodyReads,0);
    assertEquals(r.requests.some(q=>q.path.includes('persist_imap_import_batch')),false);
  }
});
Deno.test('import identity: headers changing during body fetch reject without persistence',async()=>{
  const r=await fixture({fetchedId:'<changed@example.invalid>'}); assertEquals(r.status,409);
  assertEquals(r.requests.some(q=>q.path.includes('persist_imap_import_batch')),false);
});
Deno.test('import identity: atomic conflict refuses 409, missing RPC refuses 503 without legacy fallback',async()=>{
  for(const [code,status] of [['P0001',409],['23505',409],['PGRST202',503]] as const) {
    const r=await fixture({rpcError:{code}}); assertEquals(r.status,status);
    assertEquals(r.requests.some(q=>q.path.endsWith('/emails')),false);
  }
});
Deno.test('import transport: EXAMINE escapes folders and requires real UIDVALIDITY',async()=>{
  const commands:string[]=[]; const client=new IMAPClient('fixture.invalid');
  Object.assign(client,{sendCommand:(command:string)=>{commands.push(command);return Promise.resolve('* OK [UIDVALIDITY 77] valid\r\nA1 OK complete\r\n');}});
  await client.select('Archive "2026"'); assertEquals(client.uidValidity,77);
  assertEquals(commands,['EXAMINE "Archive \\"2026\\""']);
  Object.assign(client,{sendCommand:()=>Promise.resolve('A2 OK complete\r\n')});
  await assertRejects(()=>client.select('INBOX'),Error,'UIDVALIDITY');
});
Deno.test('import transport: UID FETCH cannot substitute another UID',async()=>{
  const client=new IMAPClient('fixture.invalid'); const raw='Message-ID: <root@example.invalid>\r\n\r\n';
  Object.assign(client,{sendCommand:()=>Promise.resolve(`* 1 FETCH (UID 102 BODY[HEADER.FIELDS (MESSAGE-ID)] {${raw.length}}\r\n${raw})\r\nA1 OK done\r\n`)});
  await assertRejects(()=>client.fetchHeaders(101),Error,'UID retourné');
});

Deno.test('import learning: an approved thread summary is neither overwritten nor devalidated', async () => {
  const r = await fixture({mixed:true, summaryState:'approved'});
  assertEquals(r.status,200);
  assertEquals(r.requests.some(q=>q.path.endsWith('/learned_knowledge') && q.method==='PATCH'),false);
});
Deno.test('import learning: a pending thread summary update is approval guarded', async () => {
  const r = await fixture({mixed:true, summaryState:'concurrent'});
  assertEquals(r.status,200);
  const updates=r.requests.filter(q=>q.path.endsWith('/learned_knowledge') && q.method==='PATCH');
  assertEquals(updates.length,1);
  assertEquals(new URLSearchParams(updates[0].query).get('is_validated'),'eq.false');
});
