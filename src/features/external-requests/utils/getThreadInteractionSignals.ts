/**
 * P4.C — Thread Interaction Patterns
 * Pure function: detects conversation direction and back-and-forth
 * patterns in thread emails relative to a partner request.
 * Strictly descriptive — no interpretive labels.
 */

export interface ThreadInteractionSignals {
  lastMessageFrom: "partner" | "us" | "unknown";
  partnerMessagesAfterSend: number;
  ourMessagesAfterSend: number;
  hasBackAndForth: boolean;
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

export function getThreadInteractionSignals(
  request: RequestInput,
  threadEmails: ThreadEmailInput[],
): ThreadInteractionSignals {
  const sentTs = safeTimestamp(request.sent_at);
  const partnerNorm = request.partner_email?.trim().toLowerCase() ?? null;

  // Filter to post-send emails with valid dates
  const postSend: { direction: "partner" | "us"; ts: number }[] = [];

  for (const email of threadEmails) {
    const receivedTs = safeTimestamp(email.received_at);
    if (sentTs == null || receivedTs == null || receivedTs < sentTs) continue;

    const fromRaw = email.from_address || "";
    const fromNorm = fromRaw.trim().toLowerCase();
    const isPartner = partnerNorm != null && fromNorm === partnerNorm;

    postSend.push({
      direction: isPartner ? "partner" : "us",
      ts: receivedTs,
    });
  }

  // Sort ascending by timestamp
  postSend.sort((a, b) => a.ts - b.ts);

  // Counts
  let partnerMessagesAfterSend = 0;
  let ourMessagesAfterSend = 0;
  for (const entry of postSend) {
    if (entry.direction === "partner") partnerMessagesAfterSend++;
    else ourMessagesAfterSend++;
  }

  // Last message direction
  const lastMessageFrom: "partner" | "us" | "unknown" =
    postSend.length > 0 ? postSend[postSend.length - 1].direction : "unknown";

  // Back-and-forth: at least one direction change
  let hasBackAndForth = false;
  for (let i = 1; i < postSend.length; i++) {
    if (postSend[i].direction !== postSend[i - 1].direction) {
      hasBackAndForth = true;
      break;
    }
  }

  return {
    lastMessageFrom,
    partnerMessagesAfterSend,
    ourMessagesAfterSend,
    hasBackAndForth,
  };
}
