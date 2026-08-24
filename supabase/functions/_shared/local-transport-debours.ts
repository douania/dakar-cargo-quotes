export const LOCAL_TRANSPORT_DEBOURS_CLASSIFICATION = "DEBOURS_TIERS" as const;

export interface LocalTransportDeboursAccounting {
  classification: typeof LOCAL_TRANSPORT_DEBOURS_CLASSIFICATION;
  amount_basis: "SUPPLIER_TTC";
  incoterm_inclusion: readonly ["DAP", "DDP"];
  sodatra_vat_applicable: false;
  commission_eligible: false;
}

export const LOCAL_TRANSPORT_DEBOURS_ACCOUNTING:
  LocalTransportDeboursAccounting = Object.freeze({
    classification: LOCAL_TRANSPORT_DEBOURS_CLASSIFICATION,
    amount_basis: "SUPPLIER_TTC",
    incoterm_inclusion: Object.freeze(["DAP", "DDP"]) as readonly [
      "DAP",
      "DDP",
    ],
    sodatra_vat_applicable: false,
    commission_eligible: false,
  });

export function withLocalTransportDebours<T extends Record<string, unknown>>(
  line: T,
): T & { accounting: LocalTransportDeboursAccounting } {
  return {
    ...line,
    accounting: LOCAL_TRANSPORT_DEBOURS_ACCOUNTING,
  };
}

export function isLocalTransportDebours(line: unknown): boolean {
  if (!line || typeof line !== "object") return false;

  const accounting =
    (line as { accounting?: { classification?: unknown } }).accounting;
  return accounting?.classification === LOCAL_TRANSPORT_DEBOURS_CLASSIFICATION;
}

export function isLocalTransportRateSource(value: unknown): boolean {
  return typeof value === "string" &&
    value.trim().toLowerCase().startsWith("local_transport_rate");
}
