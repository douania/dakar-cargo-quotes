import { OPEN_POINT_LABELS } from "@/lib/quoteScenarios";

/**
 * Display only. Never use these texts in a request, a stored value, a PDF or an e-mail:
 * the original wording stays the reference and remains readable in full on demand.
 */
const SUMMARY_LIMIT = 180;
const SCOPE_PREFIX = /^Périmètre\s+([^:]{1,40}?)\s*:\s*/;
const OPEN_POINT_TOKEN = /\b[a-z]+(?:_[a-z]+)+\b/g;
/** Recorded unit bases (per_unit…) shown in words; exact tokens only. */
const UNIT_LABELS: Record<string, string> = {
  per_unit: "par unité", per_container: "par conteneur", per_container_kg: "kg par conteneur",
  per_day: "par jour", per_ton: "par tonne", per_tonne: "par tonne", per_kg: "par kg",
};
/** Points that name an unknown, excluded or still-to-confirm element come first in short lists. */
// "\b" does not see "à" as a word character, so "à confirmer" is matched without it.
const PRIORITY_RESERVATION = /\b(?:inconnue?s?|non compris|non inclus|exclue?s?|danger|IMO|manquante?s?|absente?s?)\b|(?:^|\s)à confirmer/i;

/** Exact known codes only; unknown wording is kept as recorded. */
export function readableReservationText(text: string): string {
  return text
    .replace(/\s*\(TO_CONFIRM\)/g, "")
    .replace(OPEN_POINT_TOKEN, token => OPEN_POINT_LABELS[token as keyof typeof OPEN_POINT_LABELS] ?? UNIT_LABELS[token] ?? token)
    .replace(/\b([Ll])ot lot-(\w+)/g, "$1ot $2")
    .replace(/\blot-(\w+)/g, "lot $1")
    .replace(/(\s—\s*à confirmer)(?:\s*—\s*à confirmer)+/g, "$1")
    .replace(/\.{2}(?=\s|$)/g, ".")
    .trim();
}

/** Long texts open on their first sentence (or a word-bounded excerpt); short ones are unchanged. */
export function shortenText(text: string): { summary: string; truncated: boolean } {
  if (text.length <= SUMMARY_LIMIT) return { summary: text, truncated: false };
  const sentence = /^(.{30,}?[.!?])\s/.exec(text)?.[1];
  if (sentence && sentence.length <= SUMMARY_LIMIT) return { summary: sentence, truncated: true };
  return { summary: `${text.slice(0, SUMMARY_LIMIT).replace(/\s+\S*$/, "")} …`, truncated: true };
}

/** Internal tariff keys such as SN_NORMAL_CONTAINER_KM_V1 or fee_rules:… are references, not prose. */
export function isMachineReference(text: string): boolean {
  const value = text.trim();
  return /^[A-Za-z0-9_.-]+(?::.*)?$/.test(value) && /_/.test(value.split(":")[0]);
}

function readableScope(scope: string): string {
  const value = scope.trim();
  if (value === "origin") return "origine";
  if (value === "destination") return "destination";
  const lot = /^lot[- ](\w+)$/i.exec(value);
  return lot ? `lot ${lot[1]}` : value;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Merges the same reservation repeated per lot or place into one line, translating known codes.
 * Order follows the first occurrence; a dossier-level reservation is never merged with a scoped one.
 */
export function readableReservations(texts: string[]): Array<{ key: string; text: string }> {
  const groups = new Map<string, { scopes: string[]; body: string }>();
  for (const raw of texts) {
    const text = readableReservationText(raw);
    if (!text) continue;
    const scoped = SCOPE_PREFIX.exec(text);
    const body = scoped ? text.slice(scoped[0].length) : text;
    const key = `${scoped ? "scoped" : "case"}:${body}`;
    const group = groups.get(key) ?? { scopes: [], body };
    if (scoped) {
      const scope = readableScope(scoped[1]);
      if (!group.scopes.includes(scope)) group.scopes.push(scope);
    }
    groups.set(key, group);
  }
  return Array.from(groups.entries()).map(([key, { scopes, body }]) => {
    const prefix = capitalize(scopes.join(", "));
    // "Lot 1 : Lot 1 : …" — the recorded text already names its own scope.
    const repeated = scopes.length === 1 && body.toLowerCase().startsWith(`${prefix.toLowerCase()} :`);
    return { key, text: scopes.length && !repeated ? `${prefix} : ${body}` : body };
  });
}

/** Display order only: unknown, excluded or to-confirm points first, otherwise the recorded order. */
export function prioritizeReservations<T extends { text: string }>(items: T[]): T[] {
  return [...items.filter(item => PRIORITY_RESERVATION.test(item.text)), ...items.filter(item => !PRIORITY_RESERVATION.test(item.text))];
}
