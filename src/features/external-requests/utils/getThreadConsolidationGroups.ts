/**
 * P4.D — Thread Consolidation
 * Pure function: groups thread emails into readable blocks
 * by direction (partner/us) + normalized subject.
 * No side effects, no DB writes, no interpretation.
 */

export interface ThreadConsolidationEmail {
  emailId: string;
  subjectShort: string;
  fromShort: string;
  receivedAt: string | null;
  isUsed: boolean;
  isSuggested: boolean;
  isPartner: boolean;
}

export interface ThreadConsolidationGroup {
  groupKey: string;
  label: string;
  emailCount: number;
  latestAt: string | null;
  hasUsed: boolean;
  hasSuggested: boolean;
  emails: ThreadConsolidationEmail[];
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

function normalizeSubject(subject: string | null): string {
  if (!subject) return "(sans sujet)";
  return subject
    .toLowerCase()
    .trim()
    .replace(/^(re|fw|fwd):\s*/gi, "")
    .replace(/^(re|fw|fwd):\s*/gi, "")
    .trim() || "(sans sujet)";
}

function buildDisplaySubject(subject: string | null): string {
  if (!subject) return "(sans sujet)";
  const cleaned = subject
    .replace(/^(re|fw|fwd):\s*/gi, "")
    .replace(/^(re|fw|fwd):\s*/gi, "")
    .trim();
  if (!cleaned) return "(sans sujet)";
  return cleaned.length > 45 ? cleaned.slice(0, 45) + "…" : cleaned;
}

export function getThreadConsolidationGroups(
  request: RequestInput,
  threadEmails: ThreadEmailInput[],
  usedEmailIds: string[],
  suggestedEmailId: string | null,
): ThreadConsolidationGroup[] {
  const partnerNorm = request.partner_email?.trim().toLowerCase() ?? null;
  const usedSet = new Set(usedEmailIds);

  // Build enriched list
  const enriched: (ThreadConsolidationEmail & { direction: "partner" | "us"; normalizedSubject: string; displaySubject: string })[] =
    threadEmails.map((email) => {
      const fromRaw = email.from_address || "";
      const fromNorm = fromRaw.trim().toLowerCase();
      const isPartner = partnerNorm != null && fromNorm === partnerNorm;

      return {
        emailId: email.id,
        subjectShort: buildDisplaySubject(email.subject),
        fromShort: fromRaw.split("@")[0] || "expéditeur inconnu",
        receivedAt: email.received_at,
        isUsed: usedSet.has(email.id),
        isSuggested: email.id === suggestedEmailId,
        isPartner,
        direction: isPartner ? "partner" as const : "us" as const,
        normalizedSubject: normalizeSubject(email.subject),
        displaySubject: buildDisplaySubject(email.subject),
      };
    });

  // Group by direction + normalizedSubject
  const groupMap = new Map<string, typeof enriched>();
  for (const item of enriched) {
    const key = `${item.direction}::${item.normalizedSubject}`;
    const list = groupMap.get(key) || [];
    list.push(item);
    groupMap.set(key, list);
  }

  // Build groups
  const groups: ThreadConsolidationGroup[] = [];
  for (const [key, items] of groupMap) {
    // Sort within group: received_at DESC, nulls last
    items.sort((a, b) => {
      const tsA = safeTimestamp(a.receivedAt);
      const tsB = safeTimestamp(b.receivedAt);
      if (tsA == null && tsB == null) return 0;
      if (tsA == null) return 1;
      if (tsB == null) return -1;
      return tsB - tsA;
    });

    const direction = items[0].direction;
    const dirLabel = direction === "partner" ? "Partenaire" : "Nous";
    const displaySubject = items[0].displaySubject;

    const hasUsed = items.some((i) => i.isUsed);
    const hasSuggested = items.some((i) => i.isSuggested);

    // Latest valid date
    let latestAt: string | null = null;
    for (const item of items) {
      if (safeTimestamp(item.receivedAt) != null) {
        latestAt = item.receivedAt;
        break; // already sorted DESC
      }
    }

    groups.push({
      groupKey: key,
      label: `${dirLabel} · ${displaySubject}`,
      emailCount: items.length,
      latestAt,
      hasUsed,
      hasSuggested,
      emails: items.map(({ emailId, subjectShort, fromShort, receivedAt, isUsed, isSuggested, isPartner }) => ({
        emailId, subjectShort, fromShort, receivedAt, isUsed, isSuggested, isPartner,
      })),
    });
  }

  // Sort groups: hasSuggested first, then latestAt DESC, then emailCount DESC
  groups.sort((a, b) => {
    if (a.hasSuggested !== b.hasSuggested) return a.hasSuggested ? -1 : 1;
    const tsA = safeTimestamp(a.latestAt);
    const tsB = safeTimestamp(b.latestAt);
    if (tsA != null && tsB != null && tsA !== tsB) return tsB - tsA;
    if (tsA == null && tsB != null) return 1;
    if (tsA != null && tsB == null) return -1;
    return b.emailCount - a.emailCount;
  });

  return groups;
}
