import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { describe,it,expect,vi,beforeEach } from 'vitest';
import { CustomsBasisReview } from '../CustomsBasisReview';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke}}}));
const document={document_index:0,document_type:'commercial_invoice',document_date:'2026-10-07',reference:'SYNTHETIC-LOT-A',page_range:'1',nonCommercial:true,hsDeclared:'3004.9099',money:[{kind:'total',amount:321,currency:'EUR'}]};
const state={context_hash:'a'.repeat(32),head:null,can_write:true,excluded_attachments:10,source_groups:[{reference:'SYNTHETIC-LOT-A',attachment_ids:['00000001-1111-4111-8111-111111111111'],hs_declared:'30049099',recommended:true}],proposals:[{attachment_id:'00000001-1111-4111-8111-111111111111',filename:'SYNTHETIC-FOC.pdf',email_id:'SYNTHETIC-EMAIL-A',email_sent_at:'2026-10-08T12:24:54Z',email_received_at:'2026-10-09T11:50:54Z',email_subject:'SYNTHETIC envoi A',email_excerpt:'SYNTHETIC request own text',can_select:true,reasons:['Facture FOC déclarative, distincte de la valeur douanière.'],issues:[],documents:[document],...document}],regimes:[],assessment:null};
beforeEach(()=>{invoke.mockReset();vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});});
describe('Customs grouped review',()=>{
 it('reads only on request, displays declared FOC/HS8 and leaves the retained CAF blank',async()=>{
  invoke.mockResolvedValue({data:state,error:null});render(<CustomsBasisReview caseId="fixture" isLocked={false} onCalculated={vi.fn()}/>);expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));await screen.findByText('SYNTHETIC-FOC.pdf');
  expect(screen.getByLabelText('CAF retenue, fret et assurance compris (FCFA)')).toHaveValue('');expect(screen.getByLabelText('Code HS retenu pour cette base')).toHaveValue('');
  expect(screen.getByLabelText('SYNTHETIC-FOC.pdf')).not.toBeChecked();expect(screen.getByText('Reprendre ce HS déclaré')).toBeDisabled();
  expect(screen.getByText('Retenir les bases douanières')).toBeDisabled();expect(screen.getByText('Calculer avec ces bases')).toBeDisabled();expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByLabelText('SYNTHETIC-FOC.pdf'));fireEvent.click(screen.getByText('Reprendre ce HS déclaré'));expect(screen.getByLabelText('Code HS retenu pour cette base')).toHaveValue('30049099');expect(invoke).toHaveBeenCalledTimes(1);
 });
 it('preserves typed values after read failure, does not show success and never calculates',async()=>{
  invoke.mockResolvedValueOnce({data:state,error:null}).mockResolvedValueOnce({data:null,error:{message:'unavailable'}});
  render(<CustomsBasisReview caseId="fixture" isLocked={false} onCalculated={vi.fn()}/>);fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));await screen.findByText('SYNTHETIC-FOC.pdf');
  fireEvent.change(screen.getByLabelText('CAF retenue, fret et assurance compris (FCFA)'),{target:{value:'123456'}});fireEvent.click(screen.getByText('Relire les pièces et les décisions'));
  await screen.findByRole('alert');expect(screen.getByLabelText('CAF retenue, fret et assurance compris (FCFA)')).toHaveValue('123456');expect(invoke.mock.calls.every(c=>c[0]==='manage-customs-basis')).toBe(true);
 });
 it('locks mutation for readers and ignores a late response after unmount',async()=>{
  let complete:(r:unknown)=>void=()=>{};invoke.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  const view=render(<CustomsBasisReview caseId="fixture" isLocked onCalculated={vi.fn()}/>);fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));view.unmount();complete({data:state,error:null});
  await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1));
 });
 it('retries the same uncertain save ID and never announces a blocked 200 pricing response as success',async()=>{
  const decision={source_attachment_ids:[state.proposals[0].attachment_id],caf_xof:100000,valuation_basis:'SYNTHETIC valuation and FX source',hs_digits:'30049099',regime_code:'TEST',exemptions_reviewed:true,commitment:'estimated',note:'SYNTHETIC internal note'};
  const head={id:'00000002-1111-4111-8111-111111111111',context_hash:state.context_hash,decision};
  const read={...state,head,regimes:[{code:'TEST',name:'Synthetic'}]},onCalculated=vi.fn();
  const basis={...head,case_id:'fixture',assessment:{eligible:true,reason:'Synthetic profile verified'}};
  invoke.mockResolvedValueOnce({data:read,error:null}).mockResolvedValueOnce({data:null,error:{message:'uncertain network result'}})
    .mockResolvedValueOnce({data:{basis},error:null}).mockResolvedValueOnce({data:read,error:null}).mockResolvedValueOnce({data:{pricing_blockers:['CONTEXT_CHANGED']},error:null});
  render(<CustomsBasisReview caseId="fixture" isLocked={false} onCalculated={onCalculated}/>);fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));await screen.findByText('SYNTHETIC-FOC.pdf');
  fireEvent.click(screen.getByLabelText(/J’ai revu la valeur/));fireEvent.click(screen.getByText('Retenir les bases douanières'));await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Retenir les bases douanières'));await screen.findByText(/Bases enregistrées et relues/);
  expect(invoke.mock.calls[1][1].body.id).toBe(invoke.mock.calls[2][1].body.id);
  fireEvent.click(screen.getByText('Calculer avec ces bases'));await screen.findByRole('alert');expect(onCalculated).not.toHaveBeenCalled();expect(screen.queryByText(/Calcul enregistré/)).not.toBeInTheDocument();
 });
 it('rereads a saved current decision after refresh without a second adoption, and disables it when typed bases change',async()=>{
  const decision={source_attachment_ids:[state.proposals[0].attachment_id],caf_xof:100000,valuation_basis:'SYNTHETIC valuation and FX source',hs_digits:'30049099',regime_code:'TEST',exemptions_reviewed:true,commitment:'estimated',note:'SYNTHETIC internal note'};
  const head={id:'00000002-1111-4111-8111-111111111111',context_hash:state.context_hash,decision};const basis={...head,case_id:'fixture',assessment:{eligible:true,reason:'SYNTHETIC'}};
  invoke.mockResolvedValue({data:{...state,head,basis,regimes:[{code:'TEST',name:'Synthetic'}]},error:null});
  render(<CustomsBasisReview caseId="fixture" isLocked={false} onCalculated={vi.fn()}/>);fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));await screen.findByText('SYNTHETIC-FOC.pdf');
  expect(screen.getByText('Calculer avec ces bases')).toBeEnabled();fireEvent.change(screen.getByLabelText('CAF retenue, fret et assurance compris (FCFA)'),{target:{value:'2'}});
  expect(screen.getByText('Calculer avec ces bases')).toBeDisabled();fireEvent.click(screen.getByText('Relire les pièces et les décisions'));await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Calculer avec ces bases')).toBeDisabled();expect(screen.getByLabelText('CAF retenue, fret et assurance compris (FCFA)')).toHaveValue('2');
 });
 it('refreshes visible clean fields to the same concurrent decision used for calculation',async()=>{
  const decision={source_attachment_ids:[state.proposals[0].attachment_id],caf_xof:100000,valuation_basis:'SYNTHETIC valuation and FX source',hs_digits:'30049099',regime_code:'TEST',exemptions_reviewed:true,commitment:'estimated',note:'SYNTHETIC internal note'};
  const make=(id:string,caf:number)=>{const head={id,context_hash:state.context_hash,decision:{...decision,caf_xof:caf}};return{...state,head,basis:{...head,case_id:'fixture',assessment:{eligible:true,reason:'SYNTHETIC'}},regimes:[{code:'TEST',name:'Synthetic'}]};};
  const a=make('00000002-1111-4111-8111-111111111111',100000),b=make('00000003-1111-4111-8111-111111111111',200000);
  invoke.mockResolvedValueOnce({data:a,error:null}).mockResolvedValueOnce({data:b,error:null}).mockResolvedValueOnce({data:{pricing_run_id:'SYNTHETIC-RUN'},error:null});
  render(<CustomsBasisReview caseId="fixture" isLocked={false} onCalculated={vi.fn()}/>);fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));await screen.findByText('SYNTHETIC-FOC.pdf');
  fireEvent.click(screen.getByText('Relire les pièces et les décisions'));await waitFor(()=>expect(screen.getByLabelText('CAF retenue, fret et assurance compris (FCFA)')).toHaveValue('200000'));
  fireEvent.click(screen.getByText('Calculer avec ces bases'));await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(3));expect(invoke.mock.calls[2][1].body.customs_basis_id).toBe(b.head.id);
 });
 it('identifies the document, its own email/date/context and exclusions without implying current authority',async()=>{
  invoke.mockResolvedValue({data:state,error:null});render(<CustomsBasisReview caseId="fixture" isLocked={false} onCalculated={vi.fn()}/>);
  fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));await screen.findByText('SYNTHETIC-FOC.pdf');
  expect(screen.getByText(/date documentaire : 2026-10-07/)).toHaveTextContent('SYNTHETIC-LOT-A');expect(screen.getByText(/Courriel : SYNTHETIC envoi A/)).toHaveTextContent('08/10/2026');
  expect(screen.getByText(/Source courriel : SYNTHETIC-EMAIL-A/)).toBeInTheDocument();expect(screen.getByText('SYNTHETIC request own text')).toBeInTheDocument();
  expect(screen.getByText(/10 pièce\(s\)/)).toBeInTheDocument();expect(screen.getByText(/une pièce ancienne n'est pas automatiquement remplacée/)).toBeInTheDocument();
 });
 it('shows every composite document and contradiction, disables ambiguous source selection and HS copying',async()=>{
  const p={...state.proposals[0],can_select:false,issues:['Références documentaires différentes : vérifier le même envoi.'],documents:[document,{...document,document_index:1,reference:'SYNTHETIC-LOT-B',money:[{kind:'total',amount:999,currency:'USD'}]}]};
  invoke.mockResolvedValue({data:{...state,proposals:[p],source_groups:[]},error:null});render(<CustomsBasisReview caseId="fixture" isLocked={false} onCalculated={vi.fn()}/>);
  fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));await screen.findByText('SYNTHETIC-FOC.pdf');
  expect(screen.getByText(/référence : SYNTHETIC-LOT-A/)).toBeInTheDocument();expect(screen.getByText(/référence : SYNTHETIC-LOT-B/)).toBeInTheDocument();
  expect(screen.getByLabelText('SYNTHETIC-FOC.pdf')).toBeDisabled();expect(screen.getByText(/Références documentaires différentes/)).toBeInTheDocument();
  expect(screen.getAllByText('Reprendre ce HS déclaré').every(b=>b.hasAttribute('disabled'))).toBe(true);expect(screen.getByLabelText('Code HS retenu pour cette base')).toHaveValue('');
 });
 it('shows an actionable empty state without selecting or calculating from email citations',async()=>{
  invoke.mockResolvedValue({data:{...state,proposals:[],source_groups:[]},error:null});render(<CustomsBasisReview caseId="fixture" isLocked={false} onCalculated={vi.fn()}/>);
  fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));await screen.findByText(/Aucune proposition documentaire exploitable/);
  expect(screen.getByText('Calculer avec ces bases')).toBeDisabled();expect(screen.getByLabelText('CAF retenue, fret et assurance compris (FCFA)')).toHaveValue('');expect(invoke).toHaveBeenCalledTimes(1);
 });
 it('prepares proposed sources and documentary HS in one explicit action, preserves typed valuation and never adopts or attests',async()=>{
  invoke.mockResolvedValue({data:state,error:null});render(<CustomsBasisReview caseId="fixture" isLocked={false} onCalculated={vi.fn()}/>);
  fireEvent.click(screen.getByText('Lire les propositions depuis les pièces'));await screen.findByText('SYNTHETIC-FOC.pdf');
  fireEvent.change(screen.getByLabelText('CAF retenue, fret et assurance compris (FCFA)'),{target:{value:'123456'}});
  fireEvent.change(screen.getByLabelText('Justification interne de la valeur FOC et de la conversion en FCFA'),{target:{value:'SYNTHETIC retained valuation'}});
  fireEvent.change(screen.getByLabelText('Note interne de la décision'),{target:{value:'SYNTHETIC retained note'}});fireEvent.click(screen.getByLabelText(/J[’']ai revu la valeur/));
  fireEvent.click(screen.getByText('Préparer avec ces pièces proposées'));
  expect(screen.getByLabelText('SYNTHETIC-FOC.pdf')).toBeChecked();expect(screen.getByLabelText('Code HS retenu pour cette base')).toHaveValue('30049099');
  expect(screen.getByLabelText('CAF retenue, fret et assurance compris (FCFA)')).toHaveValue('123456');expect(screen.getByLabelText('Justification interne de la valeur FOC et de la conversion en FCFA')).toHaveValue('SYNTHETIC retained valuation');expect(screen.getByLabelText('Note interne de la décision')).toHaveValue('SYNTHETIC retained note');
  expect(screen.getByLabelText(/J[’']ai revu la valeur/)).not.toBeChecked();expect(screen.getByText('Retenir les bases douanières')).toBeDisabled();expect(screen.getByText('Calculer avec ces bases')).toBeDisabled();expect(invoke).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Motifs de proposition pour SYNTHETIC-FOC.pdf')).toHaveTextContent('distincte de la valeur douanière');
 });
});
