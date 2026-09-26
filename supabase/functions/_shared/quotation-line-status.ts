/**
 * MULTI-LOT-TERMINAL-1 (GO CTO 2026-09-26) — one reading of "amount not established" for a
 * quotation line, shared by the version snapshot and the PDF. A line to confirm (TO_CONFIRM
 * source, case and suffix tolerant, or a DDP reserve line) is never a free line, whatever the
 * numeric amount a storage layer had to give it. Pure module: no I/O.
 */

type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === "object" && v !== null && !Array.isArray(v);

/** Same normalisation as run-pricing's totals (`to_confirm+note` counts as TO_CONFIRM). */
export function isToConfirmLine(line: unknown): boolean {
  if (!isRecord(line)) return false;
  const raw = typeof line.source === "string" ? line.source : isRecord(line.source) ? line.source.type : null;
  const type = String(raw ?? "").trim().split("+")[0].split(":")[0].toUpperCase();
  return type === "TO_CONFIRM" || line.type === "provisional_reserve" ||
    String(line.category ?? "").toUpperCase() === "CUSTOMS_RESERVE";
}

/**
 * `quotation_version_lines.breakdown` for a stored version line. The table requires a numeric
 * amount (0 for a line to confirm); this existing JSON field keeps the line distinct from a
 * genuinely free one after save and re-read. A priced line keeps its breakdown unchanged; for a
 * line to confirm the marker is merged into an existing object, or wraps any other existing value.
 */
export function versionLineBreakdown(line: unknown, existing: unknown): unknown {
  if (!isToConfirmLine(line)) return existing ?? null;
  const marker = { pricing_status: "to_confirm", amount_known: false };
  if (isRecord(existing)) return { ...existing, ...marker };
  return { ...marker, source: (line as AnyRecord).source ?? null, ...(existing == null ? {} : { details: existing }) };
}

/** Lot subtotal label: explicit when the lot still holds lines to confirm. */
export function lotSubtotalLabel(formattedTotal: string, currency: string, lines: readonly unknown[]): string {
  const pending = (Array.isArray(lines) ? lines : []).filter(isToConfirmLine).length;
  return pending > 0
    ? `Sous-total hors ${pending} poste${pending > 1 ? "s" : ""} à confirmer : ${formattedTotal} ${currency}`
    : `Sous-total: ${formattedTotal} ${currency}`;
}
