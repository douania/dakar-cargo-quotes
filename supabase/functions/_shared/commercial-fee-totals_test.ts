import {assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {computeCommercialTotals} from '../run-pricing/commercial-totals.ts';
import {commercialFeeTotals} from './commercial-fee-totals.ts';
Deno.test('commercial snapshot fee VAT matches the frozen pricing owner including zeros and rounding boundaries',()=>{
 for(const fees of [0,1,2,3,1.5,2.77,1000,200000,550000,999999999])for(const extra of [0,1,40000,150000]){
  const subtotal=fees+extra,expected=computeCommercialTotals({engineTotals:{honoraires:fees,ddp:subtotal},lines:[]});
  assertEquals(commercialFeeTotals(subtotal,fees),{honorairesTva:expected.honorairesTva,honorairesTtc:expected.honorairesTtc,totalPayable:expected.totalPayable});
 }
});
