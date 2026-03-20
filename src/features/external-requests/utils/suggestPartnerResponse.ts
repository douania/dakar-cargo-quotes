export type SuggestionConfidence = "high" | "medium" | "low" | "none";

export interface SuggestedResponse {
  bestEmailId: string | null;
  score: number;
  confidence: SuggestionConfidence;
  reasons: string[];
}

interface RequestInput {
  partner_name: string;
  partner_email: string | null;
  sent_at: string | null;
  purpose: string;
  purpose_detail: string | null;
}

interface EmailInput {
  id: string;
  subject: string | null;
  from_address: string;
  received_at: string | null;
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9àâäéèêëïîôùûüÿçœæ\s]/g, "");
}

function extractKeywords(text: string | null | undefined): string[] {
  if (!text) return [];
  return normalize(text)
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

const REPLY_MARKERS = /^(re|fw|fwd|tr)\s*:/i;

export function suggestPartnerResponse(
  request: RequestInput,
  threadEmails: EmailInput[],
  usedEmailIds: string[],
): SuggestedResponse {
  const usedSet = new Set(usedEmailIds);
  const sentTime = request.sent_at ? new Date(request.sent_at).getTime() : null;

  const purposeKeywords = new Set([
    ...extractKeywords(request.purpose),
    ...extractKeywords(request.purpose_detail),
  ]);

  const normalizedPartnerName = normalize(request.partner_name);
  const nameFragments = normalizedPartnerName
    .split(/\s+/)
    .filter((f) => f.length > 2);

  let bestScore = 0;
  let bestId: string | null = null;
  let bestReasons: string[] = [];

  for (const email of threadEmails) {
    if (usedSet.has(email.id)) continue;

    const receivedTime = email.received_at
      ? new Date(email.received_at).getTime()
      : null;

    // Exclude emails received before request was sent
    if (sentTime && receivedTime && receivedTime < sentTime) continue;

    let score = 0;
    const reasons: string[] = [];
    const fromLower = email.from_address.toLowerCase();

    // Exact email match
    if (
      request.partner_email &&
      fromLower === request.partner_email.toLowerCase()
    ) {
      score += 70;
      reasons.push("Email partenaire identique");
    }

    // Partner name fragment in from_address
    if (
      nameFragments.length > 0 &&
      nameFragments.some((f) => fromLower.includes(f))
    ) {
      score += 25;
      reasons.push("Nom partenaire reconnu");
    }

    // Received after sent
    if (sentTime && receivedTime && receivedTime >= sentTime) {
      score += 15;
      reasons.push("Reçu après envoi");
    }

    // Reply markers in subject
    const subject = email.subject || "";
    if (REPLY_MARKERS.test(subject)) {
      score += 5;
      reasons.push("Marqueur de réponse");
    }

    // Keyword overlap with purpose
    if (purposeKeywords.size > 0) {
      const subjectWords = extractKeywords(subject);
      const overlap = subjectWords.some((w) => purposeKeywords.has(w));
      if (overlap) {
        score += 10;
        reasons.push("Sujet lié à la demande");
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = email.id;
      bestReasons = reasons;
    }
  }

  let confidence: SuggestionConfidence = "none";
  if (bestScore >= 70) confidence = "high";
  else if (bestScore >= 40) confidence = "medium";
  else if (bestScore >= 20) confidence = "low";

  return {
    bestEmailId: bestId,
    score: bestScore,
    confidence,
    reasons: bestReasons,
  };
}
