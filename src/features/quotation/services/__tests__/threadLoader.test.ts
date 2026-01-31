/**
 * Tests unitaires pour threadLoader.ts
 * Phase 4B.4 — NO UI, Supabase mocké
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mapRawEmailToThreadEmail,
  loadThreadEmailsByRef,
  loadThreadEmailsBySubject,
  loadThreadAttachments,
  buildCurrentEmail,
} from '../threadLoader';
import type { ThreadEmail } from '../../types';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  },
}));

// Helper to safely mock supabase.from with proper type casting
const mockSupabaseFrom = (mockFn: ReturnType<typeof vi.fn>) => {
  (supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockFn);
};

// Import après le mock
import { supabase } from '@/integrations/supabase/client';

describe('threadLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== mapRawEmailToThreadEmail ==========
  describe('mapRawEmailToThreadEmail', () => {
    it('should map raw email record to ThreadEmail', () => {
      const raw = {
        id: 'email-123',
        subject: 'Test Subject',
        from_address: 'sender@test.com',
        to_addresses: ['recipient@test.com'],
        cc_addresses: ['cc@test.com'],
        body_text: 'Test body',
        received_at: '2024-01-15T10:00:00Z',
        created_at: '2024-01-15T09:00:00Z',
        sent_at: '2024-01-15T10:00:00Z',
        extracted_data: { client: 'Test Client' },
        thread_ref: 'thread-456',
      };

      const result = mapRawEmailToThreadEmail(raw);

      expect(result).toEqual({
        id: 'email-123',
        subject: 'Test Subject',
        from_address: 'sender@test.com',
        to_addresses: ['recipient@test.com'],
        cc_addresses: ['cc@test.com'],
        body_text: 'Test body',
        received_at: '2024-01-15T10:00:00Z',
        sent_at: '2024-01-15T10:00:00Z',
        extracted_data: { client: 'Test Client' },
        thread_ref: 'thread-456',
      });
    });

    it('should use created_at as fallback when received_at is null', () => {
      const raw = {
        id: 'email-123',
        subject: null,
        from_address: 'sender@test.com',
        to_addresses: [],
        cc_addresses: null,
        body_text: null,
        received_at: null,
        created_at: '2024-01-15T09:00:00Z',
        sent_at: null,
        extracted_data: null,
        thread_ref: null,
      };

      const result = mapRawEmailToThreadEmail(raw);

      expect(result.received_at).toBe('2024-01-15T09:00:00Z');
      expect(result.cc_addresses).toBeUndefined();
    });

    it('should return empty string for received_at when both are null', () => {
      const raw = {
        id: 'email-123',
        subject: null,
        from_address: 'sender@test.com',
        to_addresses: [],
        cc_addresses: null,
        body_text: null,
        received_at: null,
        created_at: null,
        sent_at: null,
        extracted_data: null,
        thread_ref: null,
      };

      const result = mapRawEmailToThreadEmail(raw);

      expect(result.received_at).toBe('');
    });
  });

  // ========== buildCurrentEmail ==========
  describe('buildCurrentEmail', () => {
    const mockEmails: ThreadEmail[] = [
      {
        id: 'email-1',
        subject: 'First',
        from_address: 'a@test.com',
        body_text: 'Body 1',
        received_at: '2024-01-01T10:00:00Z',
        sent_at: '2024-01-01T10:00:00Z',
        extracted_data: null,
      },
      {
        id: 'email-2',
        subject: 'Second',
        from_address: 'b@test.com',
        body_text: 'Body 2',
        received_at: '2024-01-02T10:00:00Z',
        sent_at: '2024-01-02T10:00:00Z',
        extracted_data: null,
      },
      {
        id: 'email-3',
        subject: 'Third',
        from_address: 'c@test.com',
        body_text: 'Body 3',
        received_at: '2024-01-03T10:00:00Z',
        sent_at: '2024-01-03T10:00:00Z',
        extracted_data: null,
      },
    ];

    it('should find email by targetEmailId', () => {
      const result = buildCurrentEmail(mockEmails, 'email-2');

      expect(result.id).toBe('email-2');
      expect(result.subject).toBe('Second');
    });

    it('should return last email when targetEmailId not found', () => {
      const result = buildCurrentEmail(mockEmails, 'non-existent-id');

      expect(result.id).toBe('email-3');
      expect(result.subject).toBe('Third');
    });

    it('should return last email for empty targetEmailId', () => {
      const result = buildCurrentEmail(mockEmails, '');

      expect(result.id).toBe('email-3');
    });
  });

  // ========== loadThreadAttachments ==========
  describe('loadThreadAttachments', () => {
    it('should return empty array for empty emailIds', async () => {
      const result = await loadThreadAttachments([]);

      expect(result).toEqual([]);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('should call supabase with email IDs', async () => {
      const mockData = [
        { id: 'att-1', filename: 'doc.pdf', content_type: 'application/pdf', email_id: 'email-1' },
      ];

      const mockIn = vi.fn(() => Promise.resolve({ data: mockData, error: null }));
      const mockSelect = vi.fn(() => ({ in: mockIn }));
      const mockFrom = vi.fn(() => ({ select: mockSelect }));
      
      mockSupabaseFrom(mockFrom);

      const result = await loadThreadAttachments(['email-1', 'email-2']);

      expect(supabase.from).toHaveBeenCalledWith('email_attachments');
      expect(mockSelect).toHaveBeenCalledWith('id, filename, content_type, email_id');
      expect(mockIn).toHaveBeenCalledWith('email_id', ['email-1', 'email-2']);
      expect(result).toEqual(mockData);
    });

    it('should return empty array when supabase returns null', async () => {
      const mockIn = vi.fn(() => Promise.resolve({ data: null, error: null }));
      const mockSelect = vi.fn(() => ({ in: mockIn }));
      const mockFrom = vi.fn(() => ({ select: mockSelect }));
      
      mockSupabaseFrom(mockFrom);

      const result = await loadThreadAttachments(['email-1']);

      expect(result).toEqual([]);
    });
  });

  // ========== loadThreadEmailsByRef ==========
  describe('loadThreadEmailsByRef', () => {
    it('should return empty array when no data', async () => {
      const mockOrder = vi.fn(() => Promise.resolve({ data: [], error: null }));
      const mockEq = vi.fn(() => ({ order: mockOrder }));
      const mockSelect = vi.fn(() => ({ eq: mockEq }));
      const mockFrom = vi.fn(() => ({ select: mockSelect }));
      
      mockSupabaseFrom(mockFrom);

      const result = await loadThreadEmailsByRef('thread-123');

      expect(supabase.from).toHaveBeenCalledWith('emails');
      expect(mockEq).toHaveBeenCalledWith('thread_ref', 'thread-123');
      expect(result).toEqual([]);
    });

    it('should return mapped emails when data exists', async () => {
      const mockRawEmails = [
        {
          id: 'email-1',
          subject: 'Test',
          from_address: 'test@test.com',
          to_addresses: [],
          cc_addresses: null,
          body_text: 'Body',
          received_at: '2024-01-01T10:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          sent_at: '2024-01-01T10:00:00Z',
          extracted_data: null,
          thread_ref: 'thread-123',
        },
      ];

      const mockOrder = vi.fn(() => Promise.resolve({ data: mockRawEmails, error: null }));
      const mockEq = vi.fn(() => ({ order: mockOrder }));
      const mockSelect = vi.fn(() => ({ eq: mockEq }));
      const mockFrom = vi.fn(() => ({ select: mockSelect }));
      
      mockSupabaseFrom(mockFrom);

      const result = await loadThreadEmailsByRef('thread-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('email-1');
      expect(result[0].thread_ref).toBe('thread-123');
    });
  });

  // ========== loadThreadEmailsBySubject ==========
  describe('loadThreadEmailsBySubject', () => {
    it('should return empty array when no similar emails', async () => {
      const mockOrder = vi.fn(() => Promise.resolve({ data: [], error: null }));
      const mockSelect = vi.fn(() => ({ order: mockOrder }));
      const mockFrom = vi.fn(() => ({ select: mockSelect }));
      
      mockSupabaseFrom(mockFrom);

      const result = await loadThreadEmailsBySubject('RE: Some Subject');

      expect(result).toEqual([]);
    });

    it('should filter emails by normalized subject match', async () => {
      const mockRawEmails = [
        {
          id: 'email-1',
          subject: 'RE: Transport Request',
          from_address: 'a@test.com',
          to_addresses: [],
          cc_addresses: null,
          body_text: 'Body 1',
          received_at: '2024-01-01T10:00:00Z',
          created_at: '2024-01-01T09:00:00Z',
          sent_at: '2024-01-01T10:00:00Z',
          extracted_data: null,
          thread_ref: null,
        },
        {
          id: 'email-2',
          subject: 'FW: Transport Request',
          from_address: 'b@test.com',
          to_addresses: [],
          cc_addresses: null,
          body_text: 'Body 2',
          received_at: '2024-01-02T10:00:00Z',
          created_at: '2024-01-02T09:00:00Z',
          sent_at: '2024-01-02T10:00:00Z',
          extracted_data: null,
          thread_ref: null,
        },
        {
          id: 'email-3',
          subject: 'Completely Different Subject',
          from_address: 'c@test.com',
          to_addresses: [],
          cc_addresses: null,
          body_text: 'Body 3',
          received_at: '2024-01-03T10:00:00Z',
          created_at: '2024-01-03T09:00:00Z',
          sent_at: '2024-01-03T10:00:00Z',
          extracted_data: null,
          thread_ref: null,
        },
      ];

      const mockOrder = vi.fn(() => Promise.resolve({ data: mockRawEmails, error: null }));
      const mockSelect = vi.fn(() => ({ order: mockOrder }));
      const mockFrom = vi.fn(() => ({ select: mockSelect }));
      
      mockSupabaseFrom(mockFrom);

      const result = await loadThreadEmailsBySubject('Transport Request');

      // Should match emails 1 and 2, but not 3
      expect(result).toHaveLength(2);
      expect(result.map(e => e.id)).toContain('email-1');
      expect(result.map(e => e.id)).toContain('email-2');
      expect(result.map(e => e.id)).not.toContain('email-3');
    });

    it('should return empty array when supabase returns null', async () => {
      const mockOrder = vi.fn(() => Promise.resolve({ data: null, error: null }));
      const mockSelect = vi.fn(() => ({ order: mockOrder }));
      const mockFrom = vi.fn(() => ({ select: mockSelect }));
      
      mockSupabaseFrom(mockFrom);

      const result = await loadThreadEmailsBySubject('Any Subject');

      expect(result).toEqual([]);
    });
  });
});
