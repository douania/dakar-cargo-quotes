/**
 * P4.A — Thread Timeline Intelligence
 * Pure function: enriches thread emails with contextual signals
 * for operator-guided selection. No side effects, no DB writes.
 */

export interface ThreadEmailSignal {
  emailId: string;
  fromShort: string;
  subjectShort: string;
  receivedAt: string | null;
  isAfterSent: boolean;
  isUsed: boolean;
  isSuggested: boolean;
  isPartnerMatch: boolean;
  isMostRecent: boolean;
  priority: number;
  tags: string[];
}

interface RequestInput {
  partner_email: string | null;
  sent_at: string | null;
}

interface ThreadEmailInput {
  id: string;
  subject: string | null;
  from_address: string;
  received_at: string | null;
}

function safeTimestamp(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ts = new Date(dateStr).getTime();
  return isNaN(ts) ? null : ts;
}

export function getThreadEmailSignals(
  request: RequestInput,
  threadEmails: ThreadEmailInput[],
  usedEmailIds: string[],
  suggestedEmailId: string | null,
): ThreadEmailSignal[] {
  const sentTs = safeTimestamp(request.sent_at);
  const usedSet = new Set(usedEmailIds);
  const partnerNorm = request.partner_email?.trim().toLowerCase() ?? null;

  // Find max valid received_at for isMostRecent
  let maxValidTs: number | null = null;
  let maxValidId: string | null = null;
  for (const email of threadEmails) {
    const ts = safeTimestamp(email.received_at);
    if (ts != null && (maxValidTs == null || ts > maxValidTs)) {
      maxValidTs = ts;
      maxValidId = email.id;
    }
  }

  const enriched: ThreadEmailSignal[] = threadEmails.map((email) => {
    const receivedTs = safeTimestamp(email.received_at);
    const fromNorm = email.from_address.trim().toLowerCase();

    const isAfterSent = sentTs != null && receivedTs != null && receivedTs >= sentTs;
    const isUsed = usedSet.has(email.id);
    const isSuggested = email.id === suggestedEmailId;
    const isPartnerMatch = partnerNorm != null && fromNorm === partnerNorm;
    const isMostRecent = maxValidId === email.id && maxValidTs != null;

    // Priority score (visual sorting only)
    let priority = 0;
    if (isSuggested) priority += 40;
    if (isAfterSent) priority += 25;
    if (isPartnerMatch) priority += 20;
    if (isUsed) priority -= 50;

    // Tags — descriptive only
    const tags: string[] = [];
    if (isSuggested) tags.push("Suggéré");
    if (isAfterSent) tags.push("Après envoi");
    if (isPartnerMatch) tags.push("Partenaire");
    if (isUsed) tags.push("Déjà analysé");
    if (isMostRecent) tags.push("Récent");

    // Safe fallbacks
    const fromShort = email.from_address.split("@")[0] || "expéditeur inconnu";
    const rawSubject = email.subject || "(sans sujet)";
    const subjectShort = rawSubject.length > 50 ? rawSubject.slice(0, 50) + "…" : rawSubject;

    return {
      emailId: email.id,
      fromShort,
      subjectShort,
      receivedAt: email.received_at,
      isAfterSent,
      isUsed,
      isSuggested,
      isPartnerMatch,
      isMostRecent,
      priority,
      tags,
    };
  });

  // Sort: priority desc, then receivedTs desc (nulls last)
  enriched.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const tsA = safeTimestamp(a.receivedAt);
    const tsB = safeTimestamp(b.receivedAt);
    if (tsA == null && tsB == null) return 0;
    if (tsA == null) return 1;
    if (tsB == null) return -1;
    return tsB - tsA;
  });

  return enriched.slice(0, 5);
}
