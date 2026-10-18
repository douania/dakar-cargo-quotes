import { describe, expect, it } from 'vitest';
import { groupEmailsByThread } from '@/lib/email/threadGroups';

const email = (id: string, thread_ref: string | null, extra = {}) => ({ id, thread_ref, thread_id: '<legacy@example.invalid>',
  subject: `Sujet ${id}`, from_address: `${id}@example.invalid`, received_at: '2026-10-18T09:00:00Z', extracted_data: {}, ...extra });

describe('groupement des demandes du tableau de bord', () => {
  it('keeps distinct canonical threads separate even when a legacy string was reused', () => {
    const groups = groupEmailsByThread([email('a', 'ref-a'), email('b', 'ref-b'), email('unproved', null)], {});
    expect(groups).toHaveLength(3);
    expect(groups.map(g => [g.rootEmailId, g.threadRef, g.messageCount])).toEqual([
      ['a', 'ref-a', 1], ['b', 'ref-b', 1], ['unproved', null, 1],
    ]);
  });

  it('opens the canonical ref found in a later email without changing the original root', () => {
    const groups = groupEmailsByThread([email('root', null), email('reply', 'ref-a', { received_at: '2026-10-18T10:00:00Z' })], {});
    expect(groups).toHaveLength(1); expect(groups[0].threadRef).toBe('ref-a');
    expect(groups[0].rootEmailId).toBe('root'); expect(groups[0].latestEmailId).toBe('reply');
  });

  it('deduplicates overlapping pages before counting messages and attachments', () => {
    const first = email('a', 'ref-a'), second = email('b', 'ref-a');
    const groups = groupEmailsByThread([first, second, first], { a: 2, b: 3 });
    expect(groups[0].messageCount).toBe(2); expect(groups[0].attachmentCount).toBe(5);
  });
});
