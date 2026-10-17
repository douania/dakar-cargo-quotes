import { describe,it,expect } from 'vitest';
import { validateCustomsDecision,customsResponse } from '../customsBasis';
const decision={source_attachment_ids:['00000001-1111-4111-8111-111111111111'],caf_xof:100000,valuation_basis:'SYNTHETIC retained CAF and currency evidence',hs_digits:'30049099',regime_code:'TEST',exemptions_reviewed:true,commitment:'estimated',note:'SYNTHETIC internal note'};
describe('Customs operator boundary',()=>{
 it('retains explicit amount and incomplete HS as estimated, without defaulting missing money',()=>{expect(validateCustomsDecision(decision).caf_xof).toBe(100000);expect(()=>validateCustomsDecision({...decision,caf_xof:null})).toThrow();expect(()=>validateCustomsDecision({...decision,commitment:'confirmed'})).toThrow();});
 it('refuses caller identity and an unreviewed exemption state',()=>{expect(()=>validateCustomsDecision({...decision,created_by:'forged'})).toThrow();expect(()=>validateCustomsDecision({...decision,exemptions_reviewed:false})).toThrow();});
 it('does not treat a 200 blocked response or an SDK failure as saved',async()=>{await expect(customsResponse({data:{status:'blocked'},error:null})).rejects.toThrow();await expect(customsResponse({data:null,error:{message:'private implementation detail'}})).rejects.not.toThrow('private implementation detail');});
});
