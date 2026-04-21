/**
 * Lot 3D-1 — QQM source de vérité snapshot (helper pur).
 *
 * Empêche qu'un snapshot contenant des lignes TO_CONFIRM soit stocké comme `firm`.
 * Préserve `partial` et `provisional` venant de run-pricing (ex: DDP MISSING_CARGO_VALUE Lot 4).
 *
 * Module isolé (sans Deno.serve, sans import jsr/supabase) pour tests unitaires fiables.
 */

export type QQLevel = "firm" | "provisional" | "partial";
export type QQReason = { code: string; message: string; field?: string };
export type QQ = {
  level: QQLevel;
  reasons: QQReason[];
  firmTotalPolicy: "all_included" | "excludes_reserved_items";
};

export const RATE_PENDING_REASON: QQReason = {
  code: "RATE_PENDING_CONFIRMATION",
  message: "Au moins un poste tarifaire est en attente de confirmation (TO_CONFIRM).",
};

export function hasToConfirmLine(tariffLines: any[]): boolean {
  if (!Array.isArray(tariffLines)) return false;
  return tariffLines.some((l) => {
    const src = l?.source;
    if (typeof src === "string") return src === "TO_CONFIRM";
    if (src && typeof src === "object") return src.type === "TO_CONFIRM";
    return false;
  });
}

function mergeReason(reasons: QQReason[] | undefined, reason: QQReason): QQReason[] {
  const list = Array.isArray(reasons) ? [...reasons] : [];
  if (list.some((r) => r?.code === reason.code)) return list;
  list.push(reason);
  return list;
}

/**
 * Table de décision (Lot 3D-1) :
 *
 * | outputs.level | TO_CONFIRM ? | Résultat                                                                   |
 * |---------------|--------------|-----------------------------------------------------------------------------|
 * | partial       | non          | partial préservé                                                            |
 * | partial       | oui          | partial + merge RATE_PENDING_CONFIRMATION                                   |
 * | provisional   | non          | provisional préservé                                                        |
 * | provisional   | oui          | provisional + merge RATE_PENDING_CONFIRMATION + excludes_reserved_items     |
 * | firm          | non          | firm                                                                        |
 * | firm          | oui          | UPGRADE → provisional + RATE_PENDING_CONFIRMATION + excludes_reserved_items |
 * | absent/inval. | non          | firm                                                                        |
 * | absent/inval. | oui          | provisional + RATE_PENDING_CONFIRMATION + excludes_reserved_items           |
 */
export function resolveSnapshotQualification(
  outputsQQ: any,
  tariffLines: any[],
): QQ {
  const hasToConfirm = hasToConfirmLine(tariffLines);
  const incomingLevel: QQLevel | null =
    outputsQQ && typeof outputsQQ === "object" && ["firm", "provisional", "partial"].includes(outputsQQ.level)
      ? outputsQQ.level
      : null;
  const incomingReasons: QQReason[] = Array.isArray(outputsQQ?.reasons) ? outputsQQ.reasons : [];
  const incomingPolicy: "all_included" | "excludes_reserved_items" =
    outputsQQ?.firmTotalPolicy === "excludes_reserved_items" ? "excludes_reserved_items" : "all_included";

  if (incomingLevel === "partial") {
    return {
      level: "partial",
      reasons: hasToConfirm ? mergeReason(incomingReasons, RATE_PENDING_REASON) : incomingReasons,
      firmTotalPolicy: incomingPolicy,
    };
  }

  if (incomingLevel === "provisional") {
    return {
      level: "provisional",
      reasons: hasToConfirm ? mergeReason(incomingReasons, RATE_PENDING_REASON) : incomingReasons,
      firmTotalPolicy: hasToConfirm ? "excludes_reserved_items" : incomingPolicy,
    };
  }

  if (hasToConfirm) {
    return {
      level: "provisional",
      reasons: mergeReason(incomingReasons, RATE_PENDING_REASON),
      firmTotalPolicy: "excludes_reserved_items",
    };
  }

  return {
    level: "firm",
    reasons: [],
    firmTotalPolicy: "all_included",
  };
}
