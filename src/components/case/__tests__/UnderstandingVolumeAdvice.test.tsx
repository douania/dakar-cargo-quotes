import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {CaseUnderstandingPanel} from '../CaseUnderstandingPanel';
afterEach(cleanup);
const intent={id:'intent',event_type:'thread_intent_v1',related_email_id:'qa-mail',created_at:'2026-10-28T10:00:00Z',event_data:{intent:{transport_mode_hypothesis:'air',incoterm_hypothesis:'DAP',shipment_scope_hypothesis:'unknown'}}};
const coherence={id:'coherence',event_type:'case_coherence_v1',related_email_id:'qa-mail',created_at:'2026-10-28T10:01:00Z',event_data:{summary:'1 fait(s) dérivable(s).',derived_candidates:[{fact_key:'cargo.volume_cbm',value_number:999,explanation_fr:'Obsolete volume 999'}],false_blocker_candidates:[{gap_key:'cargo.volume_cbm',message_fr:'Obsolete resolvable gap'}],warnings:[],contradiction_flags:[]}};
const dim=(value_text:string)=>({fact_key:'cargo.dimensions',value_text});
const pieces=(value_number:number)=>({fact_key:'cargo.pieces_count',value_number});
it('recalculates advice after facts change without modifying the old event',()=>{
 const events=[intent,coherence],original=JSON.stringify(events),{rerender}=render(<CaseUnderstandingPanel events={events} currentFacts={[dim('1 x 1 x 1 m'),pieces(1)]} openGapKeys={['cargo.volume_cbm']} />);
 expect(screen.queryByText('Obsolete volume 999')).not.toBeInTheDocument();expect(screen.getByText(/Volume total calculé.*1 m³/)).toBeInTheDocument();
 rerender(<CaseUnderstandingPanel events={events} currentFacts={[dim('1 x 1 x 1 m'),pieces(2)]} openGapKeys={['cargo.volume_cbm']} />);
 expect(screen.queryByText(/Volume total calculé/)).not.toBeInTheDocument();expect(screen.queryByText('Obsolete resolvable gap')).not.toBeInTheDocument();expect(screen.getByText(/Volume à confirmer/)).toBeInTheDocument();expect(JSON.stringify(events)).toBe(original);
});
it('preserves an operator volume and withdraws old volume candidates and false blockers',()=>{
 render(<CaseUnderstandingPanel events={[intent,coherence]} currentFacts={[dim('1 x 1 x 1 m'),pieces(1),{fact_key:'cargo.volume_cbm',value_number:7,source_type:'manual_input',is_validated:true}]} openGapKeys={[]} />);
 expect(screen.queryByText('Obsolete volume 999')).not.toBeInTheDocument();expect(screen.queryByText(/Volume total calculé/)).not.toBeInTheDocument();expect(screen.queryByText('Obsolete resolvable gap')).not.toBeInTheDocument();
});
it('does not show legacy derived summary when current facts are unavailable or conflicting',()=>{
 const {rerender}=render(<CaseUnderstandingPanel events={[coherence]} />);expect(screen.queryByText('1 fait(s) dérivable(s).')).not.toBeInTheDocument();
 rerender(<CaseUnderstandingPanel events={[coherence]} currentFacts={[dim('1 x 1 x 1 m'),pieces(2)]} />);expect(screen.queryByText('1 fait(s) dérivable(s).')).not.toBeInTheDocument();
});
