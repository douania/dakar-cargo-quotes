import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {CaseUnderstandingPanel} from '../CaseUnderstandingPanel';
afterEach(cleanup);
const intent={id:'intent',event_type:'thread_intent_v1',actor_type:'ai',related_email_id:'email-test',created_at:'2026-10-27T17:22:26Z',event_data:{confidence:0.98,intent:{request_summary:'Arrivée confirmée à NBO',transport_mode_hypothesis:'air',incoterm_hypothesis:'DAP',shipment_scope_hypothesis:'quote_transport_only',operator_guidance:['Utiliser NBO à l’arrivée']}}};
const proof={id:'proof',event_type:'case_reasoning_v1',related_email_id:null,created_at:'2026-10-27T17:22:14Z',event_data:{kind:'location_evidence',proofs:[{status:'rejected',reason:'ambiguous_airport_role',rawValue:'NBO',sources:[{id:'email-test',kind:'email',sha256:'synthetic-hash'}]}]}};
it('projects an existing source-bound rejection without rewriting historical data or asserting an arrival',()=>{
 const events=[intent,proof],original=JSON.stringify(events);render(<CaseUnderstandingPanel events={events} openGapKeys={['routing.destination_city']} />);
 expect(screen.queryByText('Arrivée confirmée à NBO')).not.toBeInTheDocument();expect(screen.queryByText('Utiliser NBO à l’arrivée')).not.toBeInTheDocument();
 expect(screen.getByRole('note')).toHaveTextContent('Rôle de l’aéroport à confirmer');expect(screen.getByText('classification 98%')).toBeInTheDocument();
 expect(screen.getByText('Aérien')).toBeInTheDocument();expect(screen.getByText('DAP')).toBeInTheDocument();expect(JSON.stringify(events)).toBe(original);
});
it('does not borrow another email rejection or an obsolete rejection superseded by a confirmed review',()=>{
 const foreign={...proof,event_data:{...proof.event_data,proofs:[{...proof.event_data.proofs[0],sources:[{id:'foreign-email'}]}]}};
 const {unmount}=render(<CaseUnderstandingPanel events={[intent,foreign]} />);expect(screen.getByText('Arrivée confirmée à NBO')).toBeInTheDocument();unmount();
 const confirmed={...proof,id:'confirmed',created_at:'2026-10-27T18:00:00Z',event_data:{...proof.event_data,proofs:[{...proof.event_data.proofs[0],status:'accepted',reason:'explicit_transport_role'}]}};
 render(<CaseUnderstandingPanel events={[intent,proof,confirmed]} />);expect(screen.getByText('Arrivée confirmée à NBO')).toBeInTheDocument();expect(screen.queryByRole('note')).not.toBeInTheDocument();
});
it('shows server reservations even before a location-review event is available',()=>{
 const reserved={...intent,event_data:{...intent.event_data,intent:{...intent.event_data.intent,location_reservations:[{code:'NBO',reason:'ambiguous_airport_role'}]}}};
 render(<CaseUnderstandingPanel events={[reserved]} />);expect(screen.getByRole('note')).toBeVisible();expect(screen.queryByText('Arrivée confirmée à NBO')).not.toBeInTheDocument();
});

it('preserves operator decisions and confirmed current airport facts',()=>{
 const operator={...intent,actor_type:'operator'};
 const {unmount}=render(<CaseUnderstandingPanel events={[operator,proof]} />);
 expect(screen.getByText('Arrivée confirmée à NBO')).toBeInTheDocument();expect(screen.queryByRole('note')).not.toBeInTheDocument();unmount();
 render(<CaseUnderstandingPanel events={[intent,proof]} currentFacts={[{fact_key:'routing.destination_airport',value_text:'NBO',is_validated:true}]} />);
 expect(screen.queryByText('Arrivée confirmée à NBO')).not.toBeInTheDocument();expect(screen.getByRole('note')).toHaveTextContent('confirmé par l’opérateur');
});
it('does not erase the existing stale-route warning before checking raw model claims',()=>{
 const stale={...intent,event_data:{...intent.event_data,intent:{...intent.event_data.intent,request_summary:'Dakar to Peking via NBO'}}};
 render(<CaseUnderstandingPanel events={[stale,proof]} currentFacts={[
  {fact_key:'routing.origin_country',value_text:'Switzerland'},{fact_key:'routing.origin_port',value_text:'Corgemont Switzerland'},
  {fact_key:'routing.destination_country',value_text:'Senegal'},{fact_key:'routing.destination_city',value_text:'Dakar Senegal'}]} />);
 expect(screen.queryByText('Hypothèses IA')).not.toBeInTheDocument();expect(screen.queryByText('Dakar to Peking via NBO')).not.toBeInTheDocument();
 expect(screen.getByText(/ancien résumé automatique contredit/i)).toBeInTheDocument();
});

it('does not use a confirmed departure to certify an AI arrival at the same airport',()=>{
 render(<CaseUnderstandingPanel events={[intent,proof]} currentFacts={[{fact_key:'routing.origin_airport',value_text:'NBO',is_validated:true}]} />);
 expect(screen.queryByText('Arrivée confirmée à NBO')).not.toBeInTheDocument();expect(screen.getAllByText(/NBO comme aéroport de départ/).length).toBeGreaterThan(0);
});
it('ignores malformed proof JSON instead of crashing or manufacturing a reservation',()=>{
 const broken={...proof,event_data:{...proof.event_data,proofs:[null,{sources:[null]}]}};
 render(<CaseUnderstandingPanel events={[intent,broken]} />);expect(screen.getByText('Arrivée confirmée à NBO')).toBeInTheDocument();
});
