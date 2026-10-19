import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {CaseDocumentAnalysisNotice,DocumentAnalysisChoice} from '../CaseDocumentAnalysisNotice';
const m=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:m.invoke}}}));
const documents=[{id:'bad',name:'photo.png',readable:false,text_hash:'a'.repeat(64),source_hash:'b'.repeat(32)},{id:'good',name:'invoice.txt',readable:true,text_hash:'c'.repeat(64),source_hash:'d'.repeat(32)}];
const inventory=(state='partial',changed=false)=>({contract:1,scope:'manual_case_documents',context_hash:'e'.repeat(32),documents,readable_email_count:0,
 latest:{id:'attempt',mode:state==='complete'?'complete':'readable',state,context_hash:'e'.repeat(32),documents,sources_changed:changed,created_at:'2026-10-19T09:00:00Z',completed_at:state==='pending'?null:'2026-10-19T09:01:00Z',actor_user_id:'synthetic-operator'}});
let client:QueryClient,data:ReturnType<typeof inventory>;
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false}}});data=inventory();m.invoke.mockReset();m.invoke.mockImplementation(async()=>({data:{success:true,document_analysis_inventory:data},error:null}));});
afterEach(()=>{cleanup();client.clear();});
const mount=()=>render(<QueryClientProvider client={client}><CaseDocumentAnalysisNotice caseId="case"/></QueryClientProvider>);
it('partial coverage and exact exclusions survive an independent query client and reload',async()=>{
 const first=mount();await screen.findByText('Analyse documentaire incomplète.');
 expect(screen.getByText(/photo.png.*texte non disponible/)).toBeInTheDocument();expect(screen.getByText(/1 sur 2/)).toBeVisible();
 first.unmount();client.clear();client=new QueryClient({defaultOptions:{queries:{retry:false}}});mount();await screen.findByText('Analyse documentaire incomplète.');
 expect(m.invoke).toHaveBeenCalledTimes(2);expect(m.invoke).toHaveBeenLastCalledWith('backfill-case-documents',{body:{case_id:'case',mode:'inspect',document_id:'__inspect_only_no_extraction__'}});
});
it.each(['pending','failed','complete'])('durable %s state is read honestly',async state=>{
 data=inventory(state);mount();
 await screen.findByText(state==='pending'?'Analyse documentaire en cours ou résultat non confirmé.':state==='failed'?'Analyse documentaire non finalisée. Les pièces et les faits restent à vérifier.':'Analyse des documents manuels confirmée.');
 if(state!=='complete')expect(screen.queryByText('Analyse des documents manuels confirmée.')).toBeNull();
});
it('changed sources invalidate even a complete record; a read failure and retry never invent completeness',async()=>{
 data=inventory('complete',true);mount();await screen.findByText('Analyse documentaire incomplète.');expect(screen.getByText(/Les sources ont changé/)).toBeVisible();
 m.invoke.mockResolvedValueOnce({data:null,error:new Error('SYNTHETIC refused')});
 await userEvent.click(screen.getByRole('button',{name:'Actualiser la couverture documentaire'}));await screen.findByRole('alert');
 expect(screen.queryByText('Analyse des documents manuels confirmée.')).toBeNull();
 data=inventory('complete',false);await userEvent.click(screen.getByRole('button',{name:'Actualiser la couverture documentaire'}));await screen.findByText('Analyse des documents manuels confirmée.');
});
it('keyboard activation is explicit and a pending or source-less choice is disabled',async()=>{
 const action=vi.fn(),offer={...inventory(),latest:null};const {rerender}=render(<DocumentAnalysisChoice inventory={offer as never} busy={false} onAnalyze={action}/>);
 const button=screen.getByRole('button',{name:'Analyser les sources lisibles'});button.focus();await userEvent.keyboard('{Enter}');expect(action).toHaveBeenCalledTimes(1);
 rerender(<DocumentAnalysisChoice inventory={inventory('pending') as never} busy={false} onAnalyze={action}/>);expect(button).toBeDisabled();
 rerender(<DocumentAnalysisChoice inventory={{...offer,documents:[documents[0]]} as never} busy={false} onAnalyze={action}/>);expect(button).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent('Aucune source lisible');
});
