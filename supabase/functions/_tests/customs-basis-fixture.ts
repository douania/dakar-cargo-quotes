import {validateCustomsDecision,type CustomsContext} from '../_shared/customs-basis.ts';
import {HS_TAX_FIELDS,HS_TAX_BASIS_VERSION} from '../_shared/hs-tax-profile.ts';
export const syntheticId=(n:number)=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
export function syntheticCustoms() {
  const context:CustomsContext={scope:{request_type:'AIR_IMPORT',lot_count:0,package:'AIR_IMPORT_DDP',incoterm:'DDP'},facts:[],
    attachments:[{id:syntheticId(1),filename:'SYNTHETIC-FOC.pdf',extracted_data:{extracted_info:{document_type:'NON-COMMERCIAL INVOICE',payment_terms:'FOC',hs_code:'3004.9099',total_amount:321,total_currency:'EUR'}}}],
    profiles:['3004901000','3004902000','3004909000'].map(code_normalized=>({code_normalized,...Object.fromEntries(HS_TAX_FIELDS.map(k=>[k,0])),dd:4,rs:2,tva:7,bic:false,mercurialis:false,tax_profile_status:'verified',
      tax_evidence:{source_ref:'SYNTHETIC-NOT-A-REAL-TARIFF',basis_version:HS_TAX_BASIS_VERSION,verified_at:'2026-01-01',regime_codes:['TEST'],exemptions:'none'}})),
    regimes:[{code:'TEST',is_active:true,...Object.fromEntries(['dd','stx','rs','tin','tva','cosec','pcs','pcc','tpast','ta','hors_promad','hors_bic'].map(k=>[k,!k.startsWith('hors_')]))}]};
  const decision=validateCustomsDecision({source_attachment_ids:[syntheticId(1)],caf_xof:100000,valuation_basis:'SYNTHETIC explicit XOF retained value incl freight/insurance; not a real conversion',hs_digits:'3004909000',regime_code:'TEST',exemptions_reviewed:true,commitment:'estimated',note:'PRIVATE-SUPPLIER-COST-777'});
  const record={id:syntheticId(2),case_id:syntheticId(3),revision:1,context_hash:'a'.repeat(32),created_by:syntheticId(4),created_at:'2026-01-02T00:00:00Z',decision};
  return {context,decision,record};
}
