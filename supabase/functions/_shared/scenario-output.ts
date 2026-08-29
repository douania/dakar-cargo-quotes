/**
 * P1-A5 — lecture fail-closed d'un snapshot documentaire de scénario.
 *
 * Ce module est pur : aucune I/O, aucun pricing et aucune mutation. Il est
 * partagé par le PDF et le brouillon email afin que les deux sorties rendent
 * les mêmes hypothèses, réserves, exclusions et doubles totaux.
 */

type JsonRecord = Record<string, unknown>;

export interface ScenarioOutputContext {
  reference: string;
  title: string;
  revisionNo: number;
  runSeq: number;
  qualification: "provisional" | "partial";
  assumptions: string[];
  reservations: string[];
  exclusions: string[];
  firmTotalHt: number;
  firmTotalTtc: number;
  indicativeTotalHt: number;
  indicativeTotalTtc: number;
  currency: string;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function finiteNonNegative(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function unique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)));
}

function readAssumption(entry: unknown): string | null {
  const row = asRecord(entry);
  return nonEmptyString(row.statement) ?? nonEmptyString(row.assumed_fact_key);
}

function readReservation(entry: unknown): string | null {
  if (typeof entry === "string") return nonEmptyString(entry);
  const row = asRecord(entry);
  const code = nonEmptyString(row.code) ?? nonEmptyString(row.reason);
  const detail = nonEmptyString(row.message) ?? nonEmptyString(row.service_key) ??
    nonEmptyString(row.open_point_key);
  if (code && detail) return `${code} — ${detail}`;
  return code ?? detail;
}

function readExclusion(entry: unknown): string | null {
  if (typeof entry === "string") return nonEmptyString(entry);
  const row = asRecord(entry);
  const description = nonEmptyString(row.description) ?? nonEmptyString(row.service_code) ??
    nonEmptyString(row.category);
  const reason = nonEmptyString(row.reason);
  if (description && reason) return `${description} — ${reason}`;
  return description ?? reason;
}

export function isScenarioOutputSnapshot(snapshot: unknown): boolean {
  return asRecord(asRecord(snapshot).meta).source_kind === "scenario";
}

/**
 * Refuse toute forme ambiguë : un snapshot scénario n'est exploitable que si
 * sa qualification est non ferme et ses quatre totaux sont cohérents.
 */
export function readScenarioOutputContext(snapshot: unknown): ScenarioOutputContext | null {
  const root = asRecord(snapshot);
  const meta = asRecord(root.meta);
  if (meta.source_kind !== "scenario") return null;

  const scenario = asRecord(root.scenario);
  const totals = asRecord(root.totals);
  const qualificationBlock = asRecord(meta.quoteQualification);
  const qualification = qualificationBlock.level;
  if (qualification !== "provisional" && qualification !== "partial") return null;

  const reference = nonEmptyString(scenario.reference);
  const title = nonEmptyString(scenario.title);
  const revisionNo = Number(scenario.revision_no);
  const runSeq = Number(scenario.pricing_run_seq);
  const currency = nonEmptyString(totals.currency);
  const firmTotalHt = finiteNonNegative(totals.firm_total_ht);
  const firmTotalTtc = finiteNonNegative(totals.firm_total_ttc);
  const indicativeTotalHt = finiteNonNegative(totals.indicative_total_ht);
  const indicativeTotalTtc = finiteNonNegative(totals.indicative_total_ttc);

  if (
    !reference || !title || !Number.isInteger(revisionNo) || revisionNo < 1 ||
    !Number.isInteger(runSeq) || runSeq < 1 || !currency ||
    firmTotalHt === null || firmTotalTtc === null ||
    indicativeTotalHt === null || indicativeTotalTtc === null ||
    firmTotalHt > indicativeTotalHt || firmTotalTtc > indicativeTotalTtc
  ) return null;

  return {
    reference,
    title,
    revisionNo,
    runSeq,
    qualification,
    assumptions: unique(asArray(scenario.assumptions).map(readAssumption)),
    reservations: unique(asArray(scenario.reservations).map(readReservation)),
    exclusions: unique(asArray(scenario.exclusions).map(readExclusion)),
    firmTotalHt,
    firmTotalTtc,
    indicativeTotalHt,
    indicativeTotalTtc,
    currency,
  };
}

export function buildScenarioEmailSubject(context: ScenarioOutputContext): string {
  const label = context.qualification === "partial" ? "partielle" : "provisoire";
  return `Estimation de scénario SODATRA ${label} — ${context.reference}`;
}

export function buildScenarioEmailBody(
  snapshot: unknown,
  context: ScenarioOutputContext,
  hasPdf: boolean,
): string {
  const client = asRecord(asRecord(snapshot).client);
  const company = nonEmptyString(client.company);
  const amount = (value: number) => new Intl.NumberFormat("fr-FR").format(value);
  const parts = [company ? `Bonjour ${company},` : "Bonjour,", ""];

  parts.push(
    hasPdf
      ? `Veuillez trouver ci-joint l'estimation de scénario ${context.reference}.`
      : `Nous avons préparé l'estimation de scénario ${context.reference}. Le PDF sera transmis séparément.`,
    "Cette estimation est un document de travail non ferme et ne constitue pas une offre définitive.",
    "",
    `Scénario : ${context.title} (révision ${context.revisionNo}, calcul ${context.runSeq}).`,
    `Socle actuellement documenté HT : ${amount(context.firmTotalHt)} ${context.currency}.`,
    `Socle actuellement documenté TTC : ${amount(context.firmTotalTtc)} ${context.currency}.`,
    `Total indicatif du scénario HT : ${amount(context.indicativeTotalHt)} ${context.currency}.`,
    `Total indicatif du scénario TTC : ${amount(context.indicativeTotalTtc)} ${context.currency}.`,
  );

  const addList = (heading: string, values: string[]) => {
    if (values.length === 0) return;
    parts.push("", `${heading} :`, ...values.map((value) => `  - ${value}`));
  };
  addList("Hypothèses appliquées", context.assumptions);
  addList("Éléments sous réserve", context.reservations);
  addList("Éléments exclus du socle documenté", context.exclusions);

  parts.push(
    "",
    "Merci de confirmer ou corriger les hypothèses et éléments en réserve avant toute offre ferme.",
    "",
    "Cordialement,",
    "L'équipe SODATRA",
  );
  return parts.join("\n");
}
