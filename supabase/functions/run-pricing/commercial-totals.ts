import { isLocalTransportDebours } from "../_shared/local-transport-debours.ts";

const SODATRA_VAT_RATE = 0.18;

const DEBOURS_ENRICHMENT_LAYERS = new Set([
  "enrichment_pad",
  "enrichment_terminal_storage",
  "enrichment_carrier_commission",
  "enrichment_carrier_charges",
]);

interface CommercialTotalsInput {
  engineTotals?: Record<string, unknown> | null;
  lines?: unknown[] | null;
}

export interface CommercialTotals {
  totalHt: number;
  totalTtc: number;
  subtotalBeforeSodatraVat: number;
  totalPayable: number;
  honorairesHt: number;
  honorairesTva: number;
  honorairesTtc: number;
  operationnel: number;
  border: number;
  terminal: number;
  deboursDouaniers: number;
  deboursEnrichment: number;
  deboursLegacy: number;
  deboursTotal: number;
  localTransportDeboursTtc: number;
  localTransportCommission: 0;
  dap: number;
  ddp: number;
  dapEngineRaw: unknown;
  ddpEngineRaw: unknown;
  enrichmentAmount: number;
}

function finiteAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizedSourceType(line: any): string {
  return String(line?.source?.type || "")
    .trim()
    .split("+")[0]
    .split(":")[0]
    .toUpperCase();
}

function isFirmPositiveLine(line: any): boolean {
  return normalizedSourceType(line) !== "TO_CONFIRM" &&
    finiteAmount(line?.amount) > 0;
}

function sumLines(lines: unknown[], predicate: (line: any) => boolean): number {
  return lines
    .filter((line) => predicate(line))
    .reduce<number>((sum, line: any) => sum + finiteAmount(line?.amount), 0);
}

/**
 * Computes the commercial totals used by run-pricing.
 *
 * `totalHt` is retained as a database compatibility field. Its precise meaning
 * is `subtotalBeforeSodatraVat`: it may contain supplier-TTC disbursements.
 * SODATRA VAT is applied only to SODATRA fees (`honoraires`).
 */
export function computeCommercialTotals({
  engineTotals,
  lines,
}: CommercialTotalsInput): CommercialTotals {
  const safeTotals = engineTotals || {};
  const safeLines = Array.isArray(lines) ? lines : [];

  const engineHonoraires = finiteAmount(safeTotals.honoraires);
  const engineDeboursDouaniers = finiteAmount(safeTotals.debours);
  const engineBorder = finiteAmount(safeTotals.border);
  const engineTerminal = finiteAmount(safeTotals.terminal);

  const engineLocalTransportFromLines = sumLines(
    safeLines,
    (line) =>
      isFirmPositiveLine(line) &&
      isLocalTransportDebours(line) &&
      line?.canonical?.origin_layer !== "package_enrichment",
  );
  const hasEngineLocalTransportTotal =
    safeTotals.local_transport_debours_ttc !== undefined &&
    safeTotals.local_transport_debours_ttc !== null &&
    Number.isFinite(Number(safeTotals.local_transport_debours_ttc));
  const engineLocalTransport = hasEngineLocalTransportTotal
    ? finiteAmount(safeTotals.local_transport_debours_ttc)
    : engineLocalTransportFromLines;

  // A package-enrichment line is created after quotation-engine has returned,
  // so it is the only local-transport amount that must be added to raw DAP/DDP.
  const packageLocalTransport = sumLines(
    safeLines,
    (line) =>
      isFirmPositiveLine(line) &&
      isLocalTransportDebours(line) &&
      line?.canonical?.origin_layer === "package_enrichment",
  );
  const localTransportDeboursTtc = engineLocalTransport + packageLocalTransport;

  const engineOperationnelRaw = finiteAmount(safeTotals.operationnel);
  // Compatibility with an older quotation-engine: it counted the direct local
  // transport inside operationnel and did not expose the dedicated total.
  const engineOperationnel = hasEngineLocalTransportTotal
    ? engineOperationnelRaw
    : Math.max(0, engineOperationnelRaw - engineLocalTransportFromLines);

  const rawDap = Number(safeTotals.dap);
  const rawDdp = Number(safeTotals.ddp);
  const hasRawDap = safeTotals.dap !== undefined && safeTotals.dap !== null &&
    Number.isFinite(rawDap);
  const hasRawDdp = safeTotals.ddp !== undefined && safeTotals.ddp !== null &&
    Number.isFinite(rawDdp);

  const engineDap = hasRawDap
    ? rawDap
    : engineOperationnel + engineHonoraires + engineBorder + engineTerminal +
      engineLocalTransport;
  const engineDdp = hasRawDdp ? rawDdp : engineDap + engineDeboursDouaniers;

  const enrichmentAmount = sumLines(
    safeLines,
    (line) =>
      isFirmPositiveLine(line) &&
      DEBOURS_ENRICHMENT_LAYERS.has(
        String(line?.canonical?.origin_layer || ""),
      ),
  );

  const dap = engineDap + packageLocalTransport;
  const ddp = engineDdp + packageLocalTransport;
  const honorairesTva = Math.round(engineHonoraires * SODATRA_VAT_RATE);
  const honorairesTtc = engineHonoraires + honorairesTva;
  const subtotalBeforeSodatraVat = ddp + enrichmentAmount;
  const totalPayable = subtotalBeforeSodatraVat + honorairesTva;
  const deboursLegacy = engineDeboursDouaniers + enrichmentAmount;
  const deboursTotal = deboursLegacy + localTransportDeboursTtc;

  return {
    totalHt: subtotalBeforeSodatraVat,
    totalTtc: totalPayable,
    subtotalBeforeSodatraVat,
    totalPayable,
    honorairesHt: engineHonoraires,
    honorairesTva,
    honorairesTtc,
    operationnel: engineOperationnel,
    border: engineBorder,
    terminal: engineTerminal,
    deboursDouaniers: engineDeboursDouaniers,
    deboursEnrichment: enrichmentAmount,
    deboursLegacy,
    deboursTotal,
    localTransportDeboursTtc,
    localTransportCommission: 0,
    dap,
    ddp,
    dapEngineRaw: safeTotals.dap ?? null,
    ddpEngineRaw: safeTotals.ddp ?? null,
    enrichmentAmount,
  };
}
