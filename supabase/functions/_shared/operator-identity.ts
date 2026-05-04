/**
 * Operator Identity Module
 * 
 * Centralizes operator company detection for lateral guard paths
 * (analyze-reply-event, validate-partner-fact).
 * 
 * Current mono-operator deployment: SODATRA.
 * Future multi-company rollout should replace this static configuration
 * with workspace/operator configuration (see docs/DEFERRED_BACKLOG.md — MULTI-TENANT-OPERATOR-CONFIG).
 */

export const OPERATOR_DOMAINS: readonly string[] = ["sodatra.sn", "sodatra.com"];

export const OPERATOR_COMPANY_NAME_BLOCKLIST: readonly string[] = [
  "sodatra",
  "sodatra transit",
  "sodatra transit logistique",
  "sodatra transit logistique et immobilier",
  "sodatra shipping",
  "sodatra shipping & logistics",
  "sodatra shipping and logistics",
];

/**
 * Normalize a company name for comparison:
 * lowercase, trim, collapse whitespace, strip trailing punctuation.
 */
export function normalizeCompanyName(value: unknown): string {
  if (value == null) return "";
  const str = typeof value === "string" ? value : String(value);
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

/**
 * Returns true if the email address belongs to an operator domain.
 */
export function isOperatorEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return OPERATOR_DOMAINS.includes(domain);
}

/**
 * Returns true if the given value matches a known operator company name.
 */
export function isOperatorCompanyName(value: unknown): boolean {
  const normalized = normalizeCompanyName(value);
  if (!normalized) return false;

  return OPERATOR_COMPANY_NAME_BLOCKLIST.some((blocked) => {
    const b = normalizeCompanyName(blocked);
    return normalized === b || normalized.includes(b);
  });
}
