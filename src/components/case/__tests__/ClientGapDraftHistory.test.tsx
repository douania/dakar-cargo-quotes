import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ClientGapDraftHistory} from '../ClientGapDraftHistory';
import {isConfirmedClientGapDraftResponse} from '@/lib/padGapReview';
const weight='cargo.weight_kg';
const event=(data:Record<string,unknown>,case_id='a')=>({id:'source',case_id,event_type:'output_generated',created_at:'2026-10-30T10:00:00Z',event_data:{kind:'reply_draft_v1',requested_gap_keys:[weight],draft_reply:{subject:'Essai synthétique',body:'Unicode conservé : éèà 🚢 中文'},...data}});
afterEach(cleanup);
it('keeps a tabbable readonly disclosure without a send/copy control; native Enter verified in Edge',async()=>{
 const e=event({});const {container}=render(<ClientGapDraftHistory caseId="a" events={[e]} currentKeys={[weight]}/>);
 const summary=screen.getByText('Brouillons antérieurs chargés (1)');await userEvent.tab();expect(summary).toHaveFocus();// jsdom does not implement native summary Enter activation; real Edge proof covers it.
 await userEvent.click(summary);
 expect(summary.closest('details')).toHaveAttribute('open');
 expect(container.querySelector('pre')?.textContent).toBe('Unicode conservé : éèà 🚢 中文');expect(screen.queryByRole('button')).not.toBeInTheDocument();
 expect(screen.getByText(/lecture seule/)).toBeInTheDocument();
});
it('does not expose another case or an invalid body and deduplicates loaded source IDs',()=>{
 const e=event({});render(<ClientGapDraftHistory caseId="a" events={[event({},'other'),{...e,id:'bad',event_data:{kind:'reply_draft_v1',requested_gap_keys:[weight],draft_reply:{body:42}}},e,e]} currentKeys={[weight]}/>);
 expect(screen.getByText('Brouillons antérieurs chargés (1)')).toBeInTheDocument();
});
it('does not archive a confirmed current protected draft, but preserves it when scope changes',()=>{
 const e=event({client_question_policy_version:4,client_gap_fence_version:1,client_gap_guard:{version:1,scope:[{id:'gap',key:weight,blocking:true}]}});
 const view=render(<ClientGapDraftHistory caseId="a" events={[e]} currentKeys={[weight]}/>);expect(screen.queryByText(/antérieurs chargés/)).not.toBeInTheDocument();
 view.rerender(<ClientGapDraftHistory caseId="a" events={[e]} currentKeys={[]}/>);expect(screen.getByText(/antérieurs chargés/)).toBeInTheDocument();
});
it('long Unicode body is not truncated or converted into markup; invalid date remains explicit',()=>{
 const body=('é中文🚢'.repeat(500))+'<script>synthetic</script>';const e=event({draft_reply:{subject:'Long texte synthétique',body}});e.created_at='invalid';
 const {container}=render(<ClientGapDraftHistory caseId="a" events={[e]} currentKeys={[weight]}/>);
 expect(container.querySelector('pre')?.textContent).toBe(body);expect(container.querySelector('script')).toBeNull();expect(screen.getByText('Date non disponible')).toBeInTheDocument();
});
it('never labels an old, absent or unconfirmed server receipt as a current protected success',()=>{
 for(const result of [null,{ok:true},{ok:true,client_question_policy_version:3,client_gap_fence_version:1},{ok:true,client_question_policy_version:4},{ok:false,client_question_policy_version:4,client_gap_fence_version:1}])expect(isConfirmedClientGapDraftResponse(result)).toBe(false);
 expect(isConfirmedClientGapDraftResponse({ok:true,client_question_policy_version:4,client_gap_fence_version:1})).toBe(true);
});
