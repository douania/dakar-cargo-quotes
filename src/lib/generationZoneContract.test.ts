import { describe, it, expect } from 'vitest';
import { readServerGenerationPricing, selectGenerationFees, generationErrorMessage, OPTIONAL_ZONE_REPLY_CONTRACT } from './generationZoneContract';
import { OPTIONAL_ZONE_REPLY_CONTRACT as SERVER_CONTRACT } from '../../supabase/functions/_shared/zone-reply-contract';
const fee = (factor?: number) => ({ fees: [{key:'synthetic',label:'Fixture',suggested_amount:120,min_amount:0,max_amount:500,unit:'dossier',formula:'Test',is_editable:true,factors_applied:[]}], total_suggested:120,complexity_factor:factor,complexity_reasons:[],transport_mode:'maritime',can_calculate_commission:false });
const payload=(status='unknown',factor?:number)=>({sodatra_fees:fee(factor),quotation_metadata:{zone_resolution:{status,source:'delivery_zones'},zone:status==='matched'?{multiplier:factor}:null}});
describe('fresh generation contract',()=>{
 it('shares the exact capability value with the backend',()=>expect(OPTIONAL_ZONE_REPLY_CONTRACT).toBe(SERVER_CONTRACT));
 it('never replaces unknown server fees with local Dakar defaults',()=>{
   const source=payload(),before=JSON.stringify(source);const server=readServerGenerationPricing(source)!;
   expect(selectGenerationFees(server,fee(1))).toBe(server.fees);expect(server.fees.complexity_factor).toBeUndefined();expect(server.fees.total_suggested).toBe(120);expect(JSON.stringify(source)).toBe(before);
 });
 it('preserves known server amounts and factor',()=>{const s=readServerGenerationPricing(payload('matched',1.3))!;expect(s.fees.complexity_factor).toBe(1.3);expect(s.fees.fees[0].suggested_amount).toBe(120);});
 it('does not trust an unversioned old-engine factor for a fresh reply',()=>{const p={sodatra_fees:fee(1.3),quotation_metadata:{zone:{multiplier:1.3}}};expect(readServerGenerationPricing(p)!.fees.complexity_factor).toBeUndefined();});
 it('keeps historical/local values when no fresh server pricing exists',()=>{const old=fee(1.3);expect(selectGenerationFees(undefined,old)).toBe(old);});
 it('rejects missing or malformed fresh fees rather than silently calculating local prices',()=>{expect(()=>readServerGenerationPricing({can_quote_now:true,extracted_data:{destination:'Ville inconnue'}})).toThrow(/incomplets/);expect(()=>readServerGenerationPricing({quotation_metadata:null})).toThrow(/incomplets/);});
 it('extracts a structured refusal and leaves the original response body readable',async()=>{const r=Response.json({ok:false,error:{code:'ZONE_CONFIRMATION_REQUIRED',message:'Zone indéterminée'}});expect(await generationErrorMessage({context:r})).toBe('Zone indéterminée');expect(await r.json()).toHaveProperty('ok',false);});
 it('does not expose arbitrary errors/private payloads through its compatibility mapping',async()=>{const e=Object.assign(new Error('Generic'),{context:Response.json({error:{code:'PRIVATE',message:'hidden'}})});expect(await generationErrorMessage(e)).toBe('Generic');});
});
