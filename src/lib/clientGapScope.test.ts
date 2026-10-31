import {expect,it} from 'vitest';
import {clientGapGuard,clientGapScope,sameClientGapScope,hasClientGapGuard} from '../../supabase/functions/_shared/client-gap-scope';
it('scope is canonical by identity, retains all open keys and does not mutate input',()=>{
 const gaps=[{id:'b',gap_key:'pricing.internal',is_blocking:true},{id:'a',gap_key:'cargo.weight_kg',is_blocking:false}];const before=JSON.stringify(gaps);
 expect(clientGapScope(gaps)).toEqual([{id:'a',key:'cargo.weight_kg',blocking:false},{id:'b',key:'pricing.internal',blocking:true}]);expect(JSON.stringify(gaps)).toBe(before);
});
it('missing/duplicate identities fail closed instead of inventing a scope',()=>{
 expect(()=>clientGapScope([{gap_key:'cargo.weight_kg'}])).toThrow('CLIENT_GAP_SCOPE_UNAVAILABLE');expect(()=>clientGapScope([{id:'a',gap_key:'x'},{id:'a',gap_key:'y'}])).toThrow();
});
it('same keys with new gap identity invalidate the previous receipt; a missing DB receipt is not protected',()=>{
 const guard=clientGapGuard([{id:'a',gap_key:'cargo.weight_kg',is_blocking:true}]);const data={client_gap_guard:guard,client_gap_fence_version:1};
 expect(hasClientGapGuard(data)).toBe(true);expect(sameClientGapScope(data,guard.scope)).toBe(true);expect(sameClientGapScope(data,[{id:'new',key:'cargo.weight_kg',blocking:true}])).toBe(false);expect(hasClientGapGuard({client_gap_guard:guard})).toBe(false);
});
