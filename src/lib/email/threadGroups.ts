import type { ThreadGroup, MergedExtractedData } from '@/components/QuotationThreadCard';

export interface RawEmail {
  id: string;
  subject: string;
  from_address: string;
  received_at: string;
  sent_at?: string | null;
  created_at?: string | null;
  extracted_data: unknown;
  thread_id?: string;
  thread_ref?: string | null;
  body_text?: string | null;
  attachmentCount?: number;
}

// ── Whitelist merge of extracted_data (A3: field-by-field, no generic spread) ──
const MERGE_FIELDS: (keyof MergedExtractedData)[] = [
  'client', 'company', 'cargo', 'origin', 'destination',
  'incoterm', 'container_type', 'weight', 'urgency',
];

function mergeExtractedData(emails: RawEmail[]): MergedExtractedData {
  const result: MergedExtractedData = {};
  // oldest-first so latest non-empty wins
  const sorted = [...emails].sort(
    (a, b) => new Date(emailEventAt(a)).getTime() - new Date(emailEventAt(b)).getTime()
  );
  for (const email of sorted) {
    const ed = email.extracted_data;
    if (!ed || typeof ed !== 'object') continue;
    for (const key of MERGE_FIELDS) {
      const val = (ed as Record<string, unknown>)[key];
      if (typeof val === 'string' && val.trim()) {
        result[key] = val.trim();
      } else if (typeof val === 'number' && Number.isFinite(val)) {
        result[key] = String(val);
      }
    }
  }
  return result;
}

// A4: normalised event date
function emailEventAt(e: RawEmail): string {
  return e.received_at || e.sent_at || e.created_at || new Date(0).toISOString();
}

// ── Group emails by thread (2-pass: canonical key resolves mixed thread_ref/thread_id) ──
export function groupEmailsByThread(
  emails: RawEmail[],
  attachmentCounts: Record<string, number>,
): ThreadGroup[] {
  const uniqueEmails = [...new Map(emails.map(email => [email.id, email])).values()];
  const refsByLegacyId = new Map<string, Set<string>>();
  for (const email of uniqueEmails) {
    if (email.thread_id && email.thread_ref) {
      const refs = refsByLegacyId.get(email.thread_id) || new Set<string>();
      refs.add(email.thread_ref);
      refsByLegacyId.set(email.thread_id, refs);
    }
  }

  const groups = new Map<string, RawEmail[]>();
  for (const email of uniqueEmails) {
    const refs = email.thread_id ? refsByLegacyId.get(email.thread_id) : undefined;
    const resolvedRef = email.thread_ref || (refs?.size === 1 ? [...refs][0] : null);
    const key = resolvedRef ? 'ref:' + resolvedRef
      : email.thread_id && !refs?.size ? 'legacy:' + email.thread_id : 'email:' + email.id;
    const arr = groups.get(key) || [];
    arr.push(email);
    groups.set(key, arr);
  }

  const result: ThreadGroup[] = [];
  for (const [groupKey, msgs] of groups) {
    // sort by event date ascending
    msgs.sort((a, b) => new Date(emailEventAt(a)).getTime() - new Date(emailEventAt(b)).getTime() || a.id.localeCompare(b.id));
    const root = msgs[0];
    const latest = msgs[msgs.length - 1];
    const totalAtt = msgs.reduce((sum, m) => sum + (attachmentCounts[m.id] || 0), 0);

    result.push({
      groupKey,
      rootEmailId: root.id,
      latestEmailId: latest.id,
      threadRef: msgs.find(message => message.thread_ref)?.thread_ref || null,
      threadId: root.thread_id || null,
      subject: root.subject || latest.subject || 'Sans sujet',
      from_address: root.from_address,
      lastActivityAt: emailEventAt(latest),
      rootReceivedAt: emailEventAt(root),
      messageCount: msgs.length,
      attachmentCount: totalAtt,
      mergedExtractedData: mergeExtractedData(msgs),
      latestBodyText: latest.body_text || null,
    });
  }
  return result;
}

