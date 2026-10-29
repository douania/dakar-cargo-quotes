import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {CaseUnderstandingPanel} from '../CaseUnderstandingPanel';

afterEach(cleanup);
const summary='Livraison de 3 cartons (75 kg total) de blocs synthétiques.';
const intent={id:'intent',event_type:'thread_intent_v1',actor_type:'ai',related_email_id:'synthetic-email',created_at:'2026-10-29T10:00:00Z',event_data:{confidence:0.95,intent:{request_summary:summary,transport_mode_hypothesis:'air',incoterm_hypothesis:'DAP',shipment_scope_hypothesis:'quote_transport_only',operator_guidance:['Prévoir le transport de 75 kg au total.','Demander l’origine de l’expédition.']}}};
const proposal={fact_key:'cargo.weight_kg',proposed_value:75,source_type:'ai_extraction',source_email_id:'synthetic-email',reason:'PER_UNIT_WEIGHT_NOT_TOTAL',body_sha256:'a'.repeat(64),unit_declarations:[{kg:25,excerpt:'Gross weight: 25kg/carton'}]};
const review={id:'weight-review',event_type:'case_reasoning_v1',actor_type:'system',related_email_id:null,created_at:'2026-10-29T10:01:00Z',event_data:{kind:'cargo_weight_scope_rejections',version:1,proposals:[proposal]}};
it('reserves a rejected total in the AI summary and guidance, without losing other information or changing history',()=>{
 const events=[intent,review],before=JSON.stringify(events);
 render(<CaseUnderstandingPanel events={events} openGapKeys={['cargo.weight_kg']} currentFacts={[]} />);
 expect(screen.queryByText(summary)).not.toBeInTheDocument();
 expect(screen.queryByText('Prévoir le transport de 75 kg au total.')).not.toBeInTheDocument();
 expect(screen.getByRole('note')).toHaveTextContent('proposition de poids total');
 expect(screen.getByText('Aérien')).toBeVisible();expect(screen.getByText('DAP')).toBeVisible();
 expect(screen.getByText('Transport seul')).toBeVisible();expect(screen.getByText('classification 95%')).toBeVisible();
 expect(screen.getByText(/Demander l’origine/)).toBeVisible();expect(JSON.stringify(events)).toBe(before);
});
it.each(['manual_input','operator','operator_correction'])('keeps the %s decision without certifying the old AI summary',source_type=>{
 const facts=[{fact_key:'cargo.weight_kg',value_number:82.5,source_type,is_validated:false}],before=JSON.stringify(facts);
 render(<CaseUnderstandingPanel events={[intent,review]} currentFacts={facts} />);
 expect(screen.queryByText(summary)).not.toBeInTheDocument();
 expect(screen.getByRole('note')).toHaveTextContent('décision opérateur');
 expect(JSON.stringify(facts)).toBe(before);
});
it('keeps a validated fact, but not an unvalidated extraction, as the retained decision',()=>{
 const {rerender}=render(<CaseUnderstandingPanel events={[intent,review]} currentFacts={[{fact_key:'cargo.weight_kg',value_number:75,source_type:'ai_extraction',is_validated:true}]} />);
 expect(screen.getByRole('note')).toHaveTextContent('décision opérateur');
 rerender(<CaseUnderstandingPanel events={[intent,review]} currentFacts={[{fact_key:'cargo.weight_kg',value_number:75,source_type:'ai_extraction',is_validated:false}]} />);
 expect(screen.getByRole('note')).toHaveTextContent('Consultez les faits');
});
it('updates the reservation after an operator correction and preserves it across source-analysis replay',()=>{
 const {rerender}=render(<CaseUnderstandingPanel events={[intent,review]} currentFacts={[]} />);
 expect(screen.getByRole('note')).not.toHaveTextContent('décision opérateur');
 rerender(<CaseUnderstandingPanel events={[{...intent,id:'replay',created_at:'2026-10-29T11:00:00Z'},review]} currentFacts={[{fact_key:'cargo.weight_kg',value_number:75,source_type:'manual_input'}]} />);
 expect(screen.queryByText(summary)).not.toBeInTheDocument();expect(screen.getByRole('note')).toHaveTextContent('décision opérateur');
});
it('does not borrow a rejection from another email, including when the intent source is missing',()=>{
 const foreign={...review,event_data:{...review.event_data,proposals:[{...proposal,source_email_id:'other-email'}]}};
 const {rerender}=render(<CaseUnderstandingPanel events={[intent,foreign]} />);
 expect(screen.getByText(summary)).toBeVisible();
 rerender(<CaseUnderstandingPanel events={[{...intent,related_email_id:null},review]} />);expect(screen.getByText(summary)).toBeVisible();
});
it('preserves human-authored intentions and ordinary explicit totals without a rejected proposal',()=>{
 const {rerender}=render(<CaseUnderstandingPanel events={[{...intent,actor_type:'operator'},review]} />);
 expect(screen.getByText(summary)).toBeVisible();expect(screen.queryByRole('note')).not.toBeInTheDocument();
 rerender(<CaseUnderstandingPanel events={[intent]} currentFacts={[{fact_key:'cargo.weight_kg',value_number:75,source_type:'email_body'}]} />);
 expect(screen.getByText(summary)).toBeVisible();
});
it.each([null,{}, {kind:'cargo_weight_scope_rejections',version:1,proposals:[null,{}, {...proposal,reason:'UNKNOWN'}, {...proposal,fact_key:'cargo.value'}, {...proposal,proposed_value:0}]}])('ignores malformed or unrelated rejection data %j',event_data=>{
 render(<CaseUnderstandingPanel events={[intent,{...review,event_data}]} />);expect(screen.getByText(summary)).toBeVisible();
});
it('does not treat a human journal entry or an unsupported contract version as a system rejection',()=>{
 const {rerender}=render(<CaseUnderstandingPanel events={[intent,{...review,actor_type:'operator'}]} />);expect(screen.getByText(summary)).toBeVisible();
 rerender(<CaseUnderstandingPanel events={[intent,{...review,event_data:{...review.event_data,version:2}}]} />);expect(screen.getByText(summary)).toBeVisible();
});

it.each(['75kg','75kgs','0.075t','0,075 tonne','0.075 tons'])('does not leak a compact or alternate weight unit %s through AI guidance',weight=>{
 const line=`Prévoir le transport de ${weight} au total.`;
 const compact={...intent,event_data:{...intent.event_data,intent:{...intent.event_data.intent,operator_guidance:[line,'Demander l’origine de l’expédition.']}}};
 render(<CaseUnderstandingPanel events={[compact,review]} />);
 expect(screen.queryByText(line)).not.toBeInTheDocument();expect(screen.getByText(/Demander l’origine/)).toBeVisible();
});
