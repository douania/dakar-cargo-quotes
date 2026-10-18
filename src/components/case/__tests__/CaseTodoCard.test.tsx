import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {CaseTodoCard} from '../CaseTodoCard';
import type {GuidedQuoteSummary} from '@/pages/case-view/presentation';

afterEach(cleanup);
describe('saved quote amount in the todo summary',()=>{
 for(const amount of [0,618.5])it(`preserves the saved amount ${amount} at the same display precision as version/PDF/draft`,()=>{
  const quote:GuidedQuoteSummary={versionNumber:2,amount:{amount,currency:'XOF'},qualification:'Total partiel',qualificationLevel:'partial',reservations:[],pendingItems:['Douane à confirmer'],projection:null};
  render(<CaseTodoCard status="QUOTED_VERSIONED" action={null} quote={quote} loading={false} error={false} missingItems={[]} missingLoading={false} missingError={false} preparation={null} onAction={vi.fn()} onOpen={vi.fn()}/>);
  expect(screen.getByText(new RegExp('^'+new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(amount).replace(',','[,]')+'\\s'))).toBeInTheDocument();
  expect(screen.getByText('Douane à confirmer')).toBeInTheDocument();
 });
});
