import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,within,waitFor,cleanup,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import CaseDocumentsTab from '../CaseDocumentsTab';
const m=vi.hoisted(()=>({invoke:vi.fn(),from:vi.fn(),upload:vi.fn(),toast:vi.fn(),getUser:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:m.from,functions:{invoke:m.invoke},auth:{getUser:m.getUser},storage:{from:()=>({upload:m.upload})}}}));
vi.mock('@/hooks/use-toast',()=>({toast:m.toast}));
vi.mock('../DocumentMetadataEditor',()=>({default:()=>null}));
vi.mock('../AttachmentCargoEvidence',()=>({AttachmentCargoEvidence:()=>null}));
type Doc={id:string;case_id:string;file_name:string;storage_path:string;extracted_text:string|null};
let docs:Doc[],client:QueryClient,mode:string,block:Promise<void>|null;
const ready={success:true,status:'ok',extraction_contract:1,remaining:0};
beforeEach(()=>{
  HTMLElement.prototype.hasPointerCapture=()=>false;HTMLElement.prototype.setPointerCapture=()=>{};HTMLElement.prototype.releasePointerCapture=()=>{};HTMLElement.prototype.scrollIntoView=()=>{};
  vi.clearAllMocks();mode='absent';block=null;docs=[];client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  m.getUser.mockResolvedValue({data:{user:{id:'synthetic-user'}}});m.upload.mockResolvedValue({data:{},error:null});
  m.from.mockImplementation((table:string)=>{
    let inserted:Record<string,unknown>|null=null;const result=()=>{
      if(inserted&&table==='case_documents'){docs.push({...inserted,extracted_text:null} as Doc);inserted=null;}
      return {data:table==='case_documents'?docs.map(d=>({...d})):table==='quote_cases'?{thread_id:null}:[],error:null};
    };
    const b={select:()=>b,eq:()=>b,in:()=>b,order:()=>b,single:async()=>result(),insert:(value:Record<string,unknown>)=>{inserted=value;return b;},then:(resolve:(r:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return b;
  });
  m.invoke.mockImplementation(async(name:string,options:{body:FormData})=>{
    if(name==='parse-document'){
      if(block)await block;
      const id=options.body.get('case_document_id') as string;
      if(mode==='success'){docs.find(d=>d.id===id)!.extracted_text='POIDS SOURCE 5 kg';return {data:{success:true,extraction_contract:1,extraction:{status:'extracted',text_length:17,persisted:true},document:{id}},error:null};}
      const data={success:false,extraction_contract:1,extraction:{status:mode==='empty'?'empty':'error',code:mode==='empty'?'DOCUMENT_TEXT_EMPTY':'OCR_NOT_CONFIGURED',text_length:0,persisted:false}};
      return mode==='legacy200'?{data:{success:true,document:{extracted_data:{extractionStatus:'error'},text_preview:''}},error:null}:{data:null,error:{context:Response.json(data,{status:mode==='empty'?422:503})}};
    }
    if(name==='backfill-case-documents')return {data:(options.body as unknown as {mode?:string}).mode==='inspect'?{success:true,document_analysis_inventory:inventory()}:ready,error:null};
    if(name==='build-case-puzzle')return {data:{case_id:'case-a',new_status:'FACTS_PARTIAL',facts_added:1},error:null};
    throw new Error('Unexpected invocation '+name);
  });
});
afterEach(()=>{cleanup();client.clear();vi.restoreAllMocks();});
const mount=()=>render(<QueryClientProvider client={client}><CaseDocumentsTab caseId="case-a"/></QueryClientProvider>);
const inventory=()=>({contract:1,scope:'manual_case_documents',context_hash:'a'.repeat(32),documents:docs.map(d=>({id:d.id,name:d.file_name,readable:!!d.extracted_text&&!d.extracted_text.startsWith('[OCR'),text_hash:'b'.repeat(64),source_hash:'c'.repeat(32)})),readable_email_count:0,latest:null});
it('mixed manual sources require explicit consent and retain the failed upload before partial success',async()=>{
 docs=[{id:'good',case_id:'case-a',file_name:'invoice.txt',storage_path:'case-a/good',extracted_text:'190 kg'}];
 const original=m.invoke.getMockImplementation()!;
 m.invoke.mockImplementation(async(name,options)=>name==='build-case-puzzle'?{data:{case_id:'case-a',new_status:'NEED_INFO',ready_to_price:false,document_analysis:{mode:'readable',state:'partial',context_hash:'a'.repeat(32)}},error:null}:original(name,options));
 mount();await upload();const action=await screen.findByRole('button',{name:'Analyser les sources lisibles'});
 expect(action).toBeEnabled();expect(m.invoke.mock.calls.some(([name])=>name==='build-case-puzzle')).toBe(false);
 const ids=docs.map(d=>d.id);await userEvent.click(action);
 await waitFor(()=>expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Analyse partielle enregistrée'})));
 expect(m.toast).not.toHaveBeenCalledWith(expect.objectContaining({title:'Analyse terminée'}));expect(docs.map(d=>d.id)).toEqual(ids);expect(docs[1].extracted_text).toBeNull();
 expect(m.invoke).toHaveBeenCalledWith('build-case-puzzle',{body:{case_id:'case-a',document_analysis:{mode:'readable',context_hash:'a'.repeat(32)}}});
 expect(screen.getByText('Analyse partielle enregistrée. Des documents manuels restent exclus.')).toBeVisible();
});
it('an unavailable inventory cannot offer partial analysis after failed extraction',async()=>{
 const original=m.invoke.getMockImplementation()!;m.invoke.mockImplementation(async(name,options)=>name==='backfill-case-documents'?{data:null,error:new Error('SYNTHETIC refused')}:original(name,options));
 mount();await upload();expect((await screen.findAllByText(/La couverture documentaire n.a pas pu être vérifiée/)).length).toBeGreaterThan(0);
 expect(screen.queryByRole('button',{name:'Analyser les sources lisibles'})).toBeNull();expect(docs).toHaveLength(1);
});
async function upload(){
  await userEvent.click(await screen.findByRole('button',{name:'Ajouter un document'}));
  await userEvent.click(screen.getByRole('combobox'));await userEvent.click(screen.getByRole('option',{name:'Autre'}));
  await userEvent.upload(screen.getByLabelText('Fichier'),new File([new Uint8Array([137,80])],'synthetic-source.png',{type:'image/png'}));
  await userEvent.click(screen.getByRole('button',{name:'Uploader'}));
  await screen.findByRole('cell',{name:'synthetic-source.png'});
}
it.each(['absent','empty','legacy200'])('uploaded source is retained with clear retry; no puzzle/success after %s',async value=>{
  mode=value;mount();await upload();await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('conservé'));
  expect(docs).toHaveLength(1);expect(docs[0].extracted_text).toBeNull();expect(m.upload).toHaveBeenCalledTimes(1);
  expect(m.invoke.mock.calls.map(([name])=>name)).toEqual(value==='legacy200'?['parse-document']:['parse-document','backfill-case-documents']);expect(m.toast).not.toHaveBeenCalledWith(expect.objectContaining({title:'Analyse terminée'}));
  expect(screen.getByRole('button',{name:'Réessayer l’extraction'})).toBeEnabled();
});
it('successful retry uses same source/ID without upload duplication, then confirmed analysis',async()=>{
  mount();await upload();await screen.findByRole('alert');const before={...docs[0]};mode='success';
  await userEvent.click(screen.getByRole('button',{name:'Réessayer l’extraction'}));
  await waitFor(()=>expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Analyse terminée'})));
  expect(docs).toHaveLength(1);expect(docs[0].id).toBe(before.id);expect(docs[0].storage_path).toBe(before.storage_path);expect(docs[0].file_name).toBe(before.file_name);expect(m.upload).toHaveBeenCalledTimes(1);
  expect(m.invoke.mock.calls.map(([name])=>name)).toEqual(['parse-document','backfill-case-documents','parse-document','backfill-case-documents','build-case-puzzle']);
  const body=m.invoke.mock.calls[2][1].body as FormData;expect(body.get('case_document_id')).toBe(before.id);expect(body.get('file')).toBeNull();
  expect(await screen.findByText('Texte extrait')).toBeVisible();expect(screen.queryByRole('button',{name:'Réessayer l’extraction'})).toBeNull();
});
it('empty legacy document stays retryable after mounting, and duplicate clicks do not duplicate extraction',async()=>{
  docs=[{id:'old-doc',case_id:'case-a',file_name:'legacy.png',storage_path:'case-a/legacy.png',extracted_text:'[OCR vide]'}];let release!:()=>void;block=new Promise<void>(r=>{release=r;});mount();
  const button=await screen.findByRole('button',{name:'Réessayer l’extraction'});fireEvent.click(button);fireEvent.click(button);
  await waitFor(()=>expect(m.invoke).toHaveBeenCalledTimes(1));expect(screen.getByRole('button',{name:'Extraction en cours…'})).toBeDisabled();release();await screen.findByRole('alert');
  expect(docs[0].extracted_text).toBe('[OCR vide]');expect(m.upload).not.toHaveBeenCalled();await waitFor(()=>expect(m.invoke).toHaveBeenCalledTimes(2));
});
it('successful extraction without confirmed puzzle result gives inline recovery, no analysis success',async()=>{
  mode='success';const original=m.invoke.getMockImplementation()!;m.invoke.mockImplementation(async(name,options)=>name==='build-case-puzzle'?{data:{job_id:'pending'},error:null}:original(name,options));mount();await upload();
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent("n'a pas abouti"));expect(m.toast).not.toHaveBeenCalledWith(expect.objectContaining({title:'Analyse terminée'}));expect(docs[0].extracted_text).toBeTruthy();
});
