export type NextAction =
  | "awaiting_send"
  | "awaiting_response"
  | "response_to_analyze"
  | "facts_to_validate"
  | "ready"
  | "stale_followup"
  | "closed";

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  awaiting_send: "À envoyer",
  awaiting_response: "En attente réponse",
  response_to_analyze: "Réponse à analyser",
  facts_to_validate: "Faits à valider",
  ready: "Prêt",
  stale_followup: "À relancer",
  closed: "Clôturée",
};

export const NEXT_ACTION_COLORS: Record<NextAction, string> = {
  awaiting_send: "bg-muted text-muted-foreground",
  awaiting_response: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  response_to_analyze: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  facts_to_validate: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  ready: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  stale_followup: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  closed: "bg-muted text-muted-foreground",
};

const STALE_THRESHOLD_HOURS = 24;

export function getNextAction({
  status,
  responsesCount,
  proposedFactsCount,
  lastUpdateAt,
}: {
  status: string;
  responsesCount: number;
  proposedFactsCount: number;
  lastUpdateAt: string;
}): NextAction {
  // Terminal state
  if (status === "closed") return "closed";

  if (status === "draft") return "awaiting_send";

  if (status === "sent" && responsesCount === 0) {
    const hours = (Date.now() - new Date(lastUpdateAt).getTime()) / 36e5;
    if (hours > STALE_THRESHOLD_HOURS) return "stale_followup";
    return "awaiting_response";
  }

  if (status === "response_received") return "response_to_analyze";

  // After analysis: check if facts remain to validate
  if (status === "response_analyzed" || status === "partially_validated") {
    if (proposedFactsCount > 0) return "facts_to_validate";
    return "ready";
  }

  if (proposedFactsCount > 0) return "facts_to_validate";

  if (status === "facts_validated") return "ready";

  return "awaiting_response";
}
