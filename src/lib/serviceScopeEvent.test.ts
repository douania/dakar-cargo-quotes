import { describe, expect, it } from 'vitest';
import { parseServiceScopeEvent } from './serviceScopeEvent';
import { derivePartnerRequestScope } from './partnerRequestScope';
import { qualifyScope } from './scopeQualification';
describe('service scope event and partner propagation', () => {
  it.each([false, true, null])('reads flat and wrapped freight=%s identically', freight_scope => {
    const data = { freight_scope, customs_scope: true, freight_scope_basis: 'inferred_destination' };
    expect(parseServiceScopeEvent(data)).toEqual(parseServiceScopeEvent({ scope: data }));
    expect(parseServiceScopeEvent(data)?.freightScope).toBe(freight_scope);
  });
  it.each(['air', 'sea'])('never adds %s international freight from missing/null/false scope', mode => {
    for (const freightScope of [undefined, null, false]) expect(derivePartnerRequestScope({ facts: { 'routing.transport_mode': mode }, freightScope })).toEqual([]);
    expect(derivePartnerRequestScope({ facts: { 'routing.transport_mode': mode }, freightScope: true })).toHaveLength(1);
  });
  it('propagates producer interpretation to partner helper without claiming a formal exclusion', () => {
    const serviceScope = parseServiceScopeEvent({ freight_scope: false, freight_scope_basis: 'inferred_destination' })!;
    expect(derivePartnerRequestScope({ facts: { 'routing.transport_mode': 'air' }, freightScope: serviceScope.freightScope })).toEqual([]);
    const scope = qualifyScope({ serviceScope, facts: {}, caseStatus: 'NEED_INFO' });
    expect(scope.items.find(i => i.service === 'freight')?.reason).toContain('proposé');
    expect(scope.items.find(i => i.service === 'freight')?.reason).not.toContain('explicitement hors');
  });
  it('keeps string false and malformed events unknown', () => {
    expect(parseServiceScopeEvent({ freight_scope: 'false' })).toBeNull();
    expect(parseServiceScopeEvent(null)).toBeNull();
  });
});
