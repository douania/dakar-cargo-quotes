/**
 * P4.B — Thread Context Compression
 * Pure function: derives a compact summary of thread context
 * relative to a partner request. No side effects, no DB writes.
 */

export interface ThreadContextSummary {
  totalEmails: number;
  emailsAfterSend: number;
  analyzedCount: number;
  unanalyzedAfterSend: number;
  lastPartnerEmailAt: string | null;
  hasUnanswered: boolean;
  silenceDays: number | null;
}

interface RequestInput {
  partner_email: string | null;
  sent_at: string | null;
}

interface ThreadEmailInput {
  id: string;
  from_address: string;
  received_at: string | null;
}

function safeTimestamp(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ts = new Date(dateStr).getTime();
  return isNaN(ts) ? null : ts;
}

export function getThreadContextSummary(
  request: RequestInput,
  threadEmails: ThreadEmailInput[],
  usedEmailIds: string[],
): ThreadContextSummary {
  const sentTs = safeTimestamp(request.sent_at);
  const usedSet = new Set(usedEmailIds);
  const partnerNorm = request.partner_email?.trim().toLowerCase() ?? null;

  let emailsAfterSend = 0;
  let analyzedCount = 0;
  let unanalyzedAfterSend = 0;
  let lastPartnerTs: number | null = null;
  let lastPartnerAt: string | null = null;

  for (const email of threadEmails) {
    const fromRaw = email.from_address || "";
    const fromNorm = fromRaw.trim().toLowerCase();
    const receivedTs = safeTimestamp(email.received_at);
    const isUsed = usedSet.has(email.id);
    const isAfterSend = sentTs != null && receivedTs != null && receivedTs >= sentTs;

    if (isUsed) analyzedCount++;

    if (isAfterSend) {
      emailsAfterSend++;
      if (!isUsed) unanalyzedAfterSend++;
    }

    // Track last partner email
    if (partnerNorm != null && fromNorm === partnerNorm && receivedTs != null) {
      if (lastPartnerTs == null || receivedTs > lastPartnerTs) {
        lastPartnerTs = receivedTs;
        lastPartnerAt = email.received_at;
      }
    }
  }

  const silenceDays = lastPartnerTs != null
    ? Math.floor((Date.now() - lastPartnerTs) / 86400000)
    : null;

  return {
    totalEmails: threadEmails.length,
    emailsAfterSend,
    analyzedCount,
    unanalyzedAfterSend,
    lastPartnerEmailAt: lastPartnerAt,
    hasUnanswered: unanalyzedAfterSend > 0,
    silenceDays,
  };
}
