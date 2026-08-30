import { describe, expect, it } from 'vitest';
import { isPricingRerun, shouldShowPricingPanel } from '../helpers';

describe('manual pricing recovery visibility', () => {
  it.each(['READY_TO_PRICE', 'ACK_READY_FOR_PRICING', 'PRICED_DRAFT', 'HUMAN_REVIEW', 'QUOTED_VERSIONED'])(
    'shows the panel for %s', (status) => {
      expect(shouldShowPricingPanel(status, false)).toBe(true);
    },
  );

  for (const provisional of [false, true]) {
    it.each(['SENT', 'ACCEPTED', 'REJECTED', 'ARCHIVED', 'PRICING_RUNNING'])(
      `keeps %s locked, including provisional DDP=${provisional}`, (status) => {
        expect(shouldShowPricingPanel(status, provisional)).toBe(false);
      },
    );
  }

  it.each(['NEED_INFO', 'FACTS_PARTIAL', 'INTAKE', 'UNKNOWN'])(
    'does not otherwise open %s', (status) => {
      expect(shouldShowPricingPanel(status, false)).toBe(false);
    },
  );

  it('preserves the upstream provisional DDP exception', () => {
    expect(shouldShowPricingPanel('NEED_INFO', true)).toBe(true);
  });

  it.each(['PRICED_DRAFT', 'HUMAN_REVIEW', 'QUOTED_VERSIONED'])(
    'uses explicit rerun copy for %s', (status) => {
      expect(isPricingRerun(status)).toBe(true);
    },
  );

  it.each(['READY_TO_PRICE', 'ACK_READY_FOR_PRICING', 'SENT', 'ACCEPTED', 'REJECTED', 'ARCHIVED'])(
    'does not mark %s as a rerun', (status) => {
      expect(isPricingRerun(status)).toBe(false);
    },
  );
});
