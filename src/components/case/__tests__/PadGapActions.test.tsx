import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReadyActionsPanel } from '../ReadyActionsPanel';
import { NextActionBanner } from '../NextActionBanner';
import { CaseActionPlan } from '../CaseActionPlan';
import { needsPadReview, refreshGapActionQueries } from '@/lib/padGapReview';
import { PAD_WEIGHT_REVIEW_FR, PAD_WEIGHT_REVIEW_TITLE } from '@/lib/padGapReview';

type Row=Record<string,unknown>;
const io=vi.hoisted(()=>({invoke:vi.fn(),from:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:io.from,functions:{invoke:io.invoke}}}));
vi.mock('@/hooks/useQualifiedScopeGate',()=>({useQualifiedScopeGate:()=>({hasCriticalUnconfirmed:false})}));
let db:Record<string,Row[]>,client:QueryClient;
const pad='pricing.pad_category', weight='cargo.weight_kg';
function query(table:string) {
  const filters:((r:Row)=>boolean)[]=[];let single=false,limit=Infinity,sort='',desc=false;
  const q={select:()=>q,eq:(key:string,value:unknown)=>{filters.push(r=>r[key]===value);return q;},
    in:(key:string,values:unknown[])=>{filters.push(r=>values.includes(r[key]));return q;},
    order:(key:string,options:{ascending:boolean})=>{sort=key;desc=!options.ascending;return q;},
    limit:(n:number)=>{limit=n;return q;},maybeSingle:()=>{single=true;return q;},
    then:(resolve:(v:unknown)=>unknown)=>{
      let rows=(db[table]??[]).filter(r=>filters.every(f=>f(r)));
      if(sort)rows=rows.slice().sort((a,b)=>(Number(a[sort])-Number(b[sort]))*(desc?-1:1));
      const count=rows.length;rows=rows.slice(0,limit);
      return Promise.resolve(resolve({data:single?(rows[0]??null):rows,error:null,count}));
    }};return q;
}
function mount() {
  return render(<QueryClientProvider client={client}>
    <ReadyActionsPanel caseId="c"/><NextActionBanner caseId="c"/><CaseActionPlan caseId="c"/>
    <details data-testid="review-section"><summary>Sources</summary><div id="section-pad-review">Candidats PAD</div></details>
  </QueryClientProvider>);
}

it('names the weight conflict instead of asking to validate categories again', async () => {
  db.quote_gaps = [{ case_id: 'c', gap_key: pad, status: 'open', is_blocking: true, question_fr: PAD_WEIGHT_REVIEW_FR }];
  mount();
  expect((await screen.findAllByText(PAD_WEIGHT_REVIEW_TITLE)).length).toBeGreaterThan(0);
  expect(screen.queryByText('Vérifier la classification PAD en interne')).not.toBeInTheDocument();
});
function mixed(status='drafted') {
  db.quote_gaps.push({id:'weight-gap',case_id:'c',gap_key:weight,status:'open',is_blocking:false,question_fr:'Poids à préciser'});
  db.client_gap_requests=[{id:'request',case_id:'c',gap_key:weight,status,source_timeline_event_id:'old-mixed',draft_body:'OLD PAD QUESTION'}];
  db.case_timeline_events=[{id:'old-mixed',case_id:'c',event_type:'output_generated',created_at:1,
    event_data:{kind:'reply_draft_v1',requested_gap_keys:[pad,weight]}},
    ...Array.from({length:15},(_,i)=>({id:`recent${i}`,case_id:'c',event_type:'output_generated',created_at:i+2,event_data:{kind:'other'}}))];
}
beforeEach(()=>{
  io.invoke.mockReset();io.from.mockReset().mockImplementation(query);
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  Element.prototype.scrollIntoView=vi.fn();
  db={quote_cases:[{id:'c',status:'PRICED_DRAFT'}],quote_gaps:[{id:'pad',case_id:'c',gap_key:pad,status:'open',is_blocking:true,question_fr:'OLD GENERIC QUESTION'}],
    quote_facts:[{case_id:'c',fact_key:'cargo.description',is_current:true,value_text:'equipment alpha, transformers, parts'}],
    client_gap_requests:[],external_quote_requests:[],external_quote_response_facts:[],quotation_versions:[],case_timeline_events:[]};
});
afterEach(()=>{cleanup();client.clear();});
it('refreshes resolved and reopened PAD actions without reloading or changing another dossier',async()=>{
  mount();await screen.findByText('Interne');
  client.setQueryData(['ready-actions-panel','other'],{untouched:true});
  db.quote_gaps[0].status='resolved';
  await refreshGapActionQueries(client,'c');
  await waitFor(()=>expect(screen.queryByText('Vérifier la classification PAD en interne')).not.toBeInTheDocument());
  expect(screen.queryByText('Revue PAD interne')).not.toBeInTheDocument();
  expect(screen.queryByText('Vérifier la classification PAD en interne')).not.toBeInTheDocument();
  expect(client.getQueryState(['ready-actions-panel','other'])?.isInvalidated).toBe(false);
  db.quote_gaps[0].status='open';
  await refreshGapActionQueries(client,'c');
  await waitFor(()=>expect(screen.getAllByText('Vérifier la classification PAD en interne')).toHaveLength(2));
  expect(io.invoke).not.toHaveBeenCalled();
});
it('shows the PAD reminder only for a currently open PAD gap',()=>{
  expect(needsPadReview([])).toBe(false);
  expect(needsPadReview([{gap_key:pad,status:'resolved'}])).toBe(false);
  expect(needsPadReview([{gap_key:weight,status:'open'}])).toBe(false);
  expect(needsPadReview([{gap_key:pad,status:'open'}])).toBe(true);
});
it('PAD is an internal review with source navigation and no client-generation action',async()=>{
  mount();expect(await screen.findByText('Interne')).toBeInTheDocument();
  expect(screen.getByText(/Description disponible : equipment/)).toBeInTheDocument();
  expect(screen.queryByText('OLD GENERIC QUESTION')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Générer brouillon client'})).not.toBeInTheDocument();
  expect(screen.getAllByText('Vérifier la classification PAD en interne')).toHaveLength(2);
  expect(screen.getByText('Revue PAD interne')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Examiner les sources et candidats PAD'}));
  expect(screen.getByTestId('review-section')).toHaveAttribute('open');expect(io.invoke).not.toHaveBeenCalled();
});
it('a mixed draft older than the ten latest outputs is not offered or counted as ready to send',async()=>{
  mixed();mount();await screen.findByText('Interne');
  expect(screen.queryByText('OLD PAD QUESTION')).not.toBeInTheDocument();
  expect(screen.queryByText(/Envoyer 1 clarification/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Marquer envoyé'})).not.toBeInTheDocument();
});
it.each(['sent','answered'])('a legitimate %s weight request remains in follow-up despite its old mixed source',async status=>{
  mixed(status);mount();await screen.findByText('Interne');
  await waitFor(()=>expect(screen.getByText(status==='sent' ? '1 clarification(s) en attente de réponse client' : '1 réponse(s) client à traiter')).toBeInTheDocument());
  expect(screen.queryByText('OLD PAD QUESTION')).not.toBeInTheDocument();
  expect(io.invoke).not.toHaveBeenCalled();
});
it('an unavailable source is not proof of a safe unsent draft',async()=>{
  mixed();db.case_timeline_events=[];mount();await screen.findByText('Interne');
  expect(screen.queryByText('OLD PAD QUESTION')).not.toBeInTheDocument();
  expect(screen.queryByText(/Envoyer 1 clarification/)).not.toBeInTheDocument();
});
it('a genuinely missing description retains its client action',async()=>{
  db.quote_gaps=[{id:'description',case_id:'c',gap_key:'cargo.description',status:'open',is_blocking:true,question_fr:'Quelle marchandise ?'}];
  mount();expect(await screen.findByRole('button',{name:'Générer brouillon client'})).toBeInTheDocument();
  expect(screen.getByText('Client')).toBeInTheDocument();expect(io.invoke).not.toHaveBeenCalled();
});
