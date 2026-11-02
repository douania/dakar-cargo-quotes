import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PricingInputDiagnostics } from '../PricingInputDiagnostics';
import { explainPartialKgInputs, type PricingInputReport } from '../../../../supabase/functions/_shared/pricing-input-diagnostic';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function fixture():PricingInputReport {
 return explainPartialKgInputs({service_key:'TRUCKING',eligibility:{allowProvisional:true,packageKey:'AIR_IMPORT_DDP',requestType:'AIR_IMPORT',lotCount:0,serviceKeys:['CUSTOMS_DAKAR','TRUCKING'],
  scopeEvent:{actor_type:'operator',event_data:{schema_version:1,shipment_type:'import',freight_scope:false,customs_scope:true}}},
 selected_source:{schema_version:1,table:'synthetic',id:'source-a',validation_status:'unverified',selected_at:'2026-11-02',snapshot:{unit:'KG',service_key:'TRUCKING',source_reference:'Grille synthétique — non contractuelle'}},
 quantity_rule:{id:'rule-a',quantity_basis:'KG',requires_fact_key:'cargo.weight_kg'},facts:[{id:'weight-a',fact_key:'cargo.weight_kg',value_number:104,source_type:'scenario_assumption'}]});
}
describe('operator pricing input diagnostic',()=>{
 it('uses the real diagnostic and distinguishes an available assumption from a customer request',()=>{
  const fetchSpy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Network forbidden in local test'));
  render(<PricingInputDiagnostics report={fixture()}/>);
  expect(screen.getByRole('heading',{name:'Informations utiles au chiffrage'})).toBeInTheDocument();
  expect(screen.getByText('Hypothèse à relire')).toBeInTheDocument();expect(screen.getByText(/104 kg/)).toBeInTheDocument();
  expect(screen.getByText('À traiter avec : Décision opérateur')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/envoyer|enregistrer|calculer|demander/i})).not.toBeInTheDocument();expect(fetchSpy).not.toHaveBeenCalled();
 });
 it('preserves readable source details with keyboard disclosure',async()=>{
  const user=userEvent.setup();render(<PricingInputDiagnostics report={fixture()}/>);
  const trigger=screen.getByRole('button',{name:'Source et conditions'});trigger.focus();await user.keyboard('{Enter}');
  expect(trigger).toHaveAttribute('aria-expanded','true');expect(screen.getByText(/Grille synthétique/)).toBeVisible();
 });
 it('does not retain a prior report when loading, failed, empty or a new report arrives',()=>{
  const {rerender}=render(<PricingInputDiagnostics report={fixture()}/>);
  rerender(<PricingInputDiagnostics report={fixture()} status="loading"/>);expect(screen.getByRole('status')).toHaveTextContent('Vérification');expect(screen.queryByText(/104 kg/)).not.toBeInTheDocument();
  rerender(<PricingInputDiagnostics report={fixture()} status="error"/>);expect(screen.getByRole('alert')).toHaveTextContent('Diagnostic indisponible');expect(screen.queryByText(/104 kg/)).not.toBeInTheDocument();
  rerender(<PricingInputDiagnostics report={null}/>);expect(screen.getByText(/Aucune prestation qualifiée/)).toBeInTheDocument();
  const next=fixture();next.needs[0].observations[0].value_number=120;rerender(<PricingInputDiagnostics report={next}/>);
  expect(screen.getByText(/120 kg/)).toBeInTheDocument();expect(screen.queryByText(/104 kg/)).not.toBeInTheDocument();
 });
 it('escapes source content, keeps long Unicode text, and makes no quotation-readiness promise',async()=>{
  const user=userEvent.setup();
  const r=fixture(),text='Éligibilité — '.repeat(120)+'<script>alert(1)</script>';r.needs[0].source!.reference=text;
  const {container}=render(<PricingInputDiagnostics report={r}/>);
  await user.click(screen.getByRole('button',{name:'Source et conditions'}));
  expect(container.querySelector('script')).toBeNull();expect(container.textContent).toContain(text);
  expect(screen.getByRole('note')).toHaveTextContent('ne confirme ni le prix de vente');expect(screen.queryByText(/^Prêt à chiffrer$/)).not.toBeInTheDocument();
 });
});
