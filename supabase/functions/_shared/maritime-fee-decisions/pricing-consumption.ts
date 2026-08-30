// P1-B2 — consommation des décisions humaines maritimes par le pricing.
//
// DOCTRINE (GO CTO 2026-08-30, non négociable) :
//  1. La ligne PAD_DROIT_PASSAGE canonique officielle est SOUVERAINE. Une
//     décision ne peut que l'ATTESTER, jamais la remplacer, jamais la dupliquer.
//  2. PAD `confirm` = attestation UNIQUEMENT si la proposition est fraîche ET si
//     le montant décidé est EXACTEMENT celui de la ligne canonique.
//  3. PAD `adjust` / `reject` / `confirm` périmé ou divergent = pricing bloqué
//     fail-closed. `revoke` / absence = ligne canonique conservée, NON annotée.
//  4. `service.overrides.remove` est TOUJOURS prioritaire : aucune ligne P1-B2
//     n'est créée pour un service explicitement retiré du périmètre.
//  5. Aucune commission n'est FERME sans décision `confirm`/`adjust` courante et
//     fraîche — y compris celles qu'un template rendait fermes avant ce lot.
//  6. Seules trois correspondances carrier sont autorisées (audit read-only du
//     2026-08-30). ONE, MSC, MAERSK et tout autre carrier : fail-closed.
//
// Module PUR : aucune I/O, aucun Deno.env, aucune horloge, aucun aléa. Toute la
// décision est prise ici pour être testable sans runtime Supabase ; run-pricing
// ne fait qu'appliquer le plan retourné.

import type { CurrentProposalIdentity } from "./proposal-identity.ts";
import {
  readMaritimeFeeAttestation,
  verifySupplierInvoiceTtcAttestation,
} from "./attestation.ts";

// ---------------------------------------------------------------------------
// Codes de blocage stables + messages opérateur
// ---------------------------------------------------------------------------

export const MARITIME_FEE_DECISION_UNSUPPORTED_MAPPING =
  "MARITIME_FEE_DECISION_UNSUPPORTED_MAPPING";
export const MARITIME_FEE_DECISION_STALE = "MARITIME_FEE_DECISION_STALE";
export const MARITIME_FEE_DECISION_PAD_NOT_ATTESTABLE =
  "MARITIME_FEE_DECISION_PAD_NOT_ATTESTABLE";
export const MARITIME_FEE_DECISION_AMOUNT_MISMATCH =
  "MARITIME_FEE_DECISION_AMOUNT_MISMATCH";
export const MARITIME_FEE_DECISION_TARGET_LINE_MISSING =
  "MARITIME_FEE_DECISION_TARGET_LINE_MISSING";
export const MARITIME_FEE_DECISION_AMBIGUOUS_TARGET =
  "MARITIME_FEE_DECISION_AMBIGUOUS_TARGET";
export const MARITIME_FEE_DECISION_DUPLICATE_FIRM_LINE =
  "MARITIME_FEE_DECISION_DUPLICATE_FIRM_LINE";
export const MARITIME_FEE_DECISION_INCOHERENT =
  "MARITIME_FEE_DECISION_INCOHERENT";
export const MARITIME_FEE_DECISION_READ_FAILED =
  "MARITIME_FEE_DECISION_READ_FAILED";
export const MARITIME_FEE_DECISION_MULTI_LOT_UNSUPPORTED =
  "MARITIME_FEE_DECISION_MULTI_LOT_UNSUPPORTED";
export const MARITIME_FEE_DECISION_TTC_UNVERIFIED =
  "MARITIME_FEE_DECISION_TTC_UNVERIFIED";

/** Message opérateur stable par code — jamais de montant inventé dans le texte. */
export const MARITIME_FEE_DECISION_BLOCKER_MESSAGES: Record<string, string> = {
  [MARITIME_FEE_DECISION_TTC_UNVERIFIED]:
    "Le montant TTC de ce frais sur la facture fournisseur n'est pas attesté ou sa preuve est incohérente. Vérifiez la pièce et enregistrez une nouvelle décision, TVA fournisseur incluse, sans majoration automatique.",
  [MARITIME_FEE_DECISION_UNSUPPORTED_MAPPING]:
    "Une décision humaine porte sur un frais maritime qui n'a aucune correspondance de facturation autorisée (compagnie hors périmètre validé, base de calcul absente ou en conflit). Révoquez la décision ou faites valider la correspondance avant de chiffrer.",
  [MARITIME_FEE_DECISION_STALE]:
    "Une décision humaine a été prise sur une proposition qui ne correspond plus aux faits actuels du dossier. Rejouez la proposition et confirmez-la à nouveau avant de chiffrer.",
  [MARITIME_FEE_DECISION_PAD_NOT_ATTESTABLE]:
    "La taxe de port PAD ne peut être ni ajustée ni rejetée : le barème officiel fait foi. Révoquez la décision pour revenir au barème, ou corrigez la catégorie/le tonnage du dossier.",
  [MARITIME_FEE_DECISION_AMOUNT_MISMATCH]:
    "Le montant confirmé pour la taxe de port PAD diffère de la ligne officielle calculée par le moteur. Aucune attestation n'est possible : révoquez puis reconfirmez sur la proposition à jour.",
  [MARITIME_FEE_DECISION_TARGET_LINE_MISSING]:
    "Une décision humaine attend une ligne de frais que ce chiffrage ne produit pas. Révoquez la décision ou complétez les faits du dossier avant de chiffrer.",
  [MARITIME_FEE_DECISION_AMBIGUOUS_TARGET]:
    "Plusieurs lignes de chiffrage portent le même frais maritime décidé : l'attestation est ambiguë. Signalez l'anomalie avant de chiffrer.",
  [MARITIME_FEE_DECISION_DUPLICATE_FIRM_LINE]:
    "Un frais maritime décidé existe déjà en ligne ferme issue d'une autre source : le remplacer fausserait les totaux. Signalez l'anomalie avant de chiffrer.",
  [MARITIME_FEE_DECISION_INCOHERENT]:
    "Une décision humaine maritime est incohérente avec le dossier courant (compagnie, devise ou montant). Révoquez-la avant de chiffrer.",
  [MARITIME_FEE_DECISION_READ_FAILED]:
    "Le registre des décisions maritimes est illisible : impossible de garantir qu'aucun frais décidé n'est oublié ou compté deux fois. Réessayez, puis signalez l'incident.",
  [MARITIME_FEE_DECISION_MULTI_LOT_UNSUPPORTED]:
    "Ce dossier est multi-lot et porte une décision maritime active : aucun lot ne peut se voir attribuer ce frais sans ambiguïté. Révoquez la décision ou traitez les lots séparément.",
};

// ---------------------------------------------------------------------------
// Correspondances AUTORISÉES (audit read-only vérifié le 2026-08-30)
// ---------------------------------------------------------------------------

export type MaritimeFeeKind = "pad" | "commission";

export interface MaritimeFeeMapping {
  decisionKey: string;
  kind: MaritimeFeeKind;
  /** service_key canonique EXACT de la ligne de chiffrage visée. */
  serviceKey: string;
  dedupGroup: string;
  /** Compagnie normalisée (`normalizeCarrierCode`) — null pour le PAD. */
  carrierCode: string | null;
  /** charge_code du template de facturation — null pour le PAD. */
  chargeCode: string | null;
  proposalId: string;
  proposalCategory: string;
  label: string;
}

/**
 * Table CLOSE des frais consommables. Tout ce qui n'y figure pas est
 * fail-closed :
 *  - ONE / COLL : base_reference NULL + preuve `to_confirm` — aucune base de
 *    calcul opposable, donc aucune consommation monétaire ;
 *  - MSC : le template HTF PER_CNT 3283 XOF entre en conflit direct avec la
 *    proposition 2,8 % du PAD — deux vérités, donc aucune ;
 *  - MAERSK : aucune commission proposée.
 * Ajouter une entrée ici EXIGE un nouvel audit du template correspondant.
 */
export const SUPPORTED_MARITIME_FEE_MAPPINGS: readonly MaritimeFeeMapping[] = [
  {
    decisionKey: "PAD_DROIT_PASSAGE",
    kind: "pad",
    serviceKey: "PAD_DROIT_PASSAGE",
    dedupGroup: "PAD_DROIT_PASSAGE",
    carrierCode: null,
    chargeCode: null,
    proposalId: "pad-taxe-de-port",
    proposalCategory: "taxe_de_port",
    label: "Droit de passage PAD",
  },
  {
    decisionKey: "CARRIER_DEBOURS_COMMISSION:CMA_CGM",
    kind: "commission",
    serviceKey: "CMA_CGM_COMM",
    dedupGroup: "CMA_CGM_COMM",
    carrierCode: "CMA_CGM",
    chargeCode: "COMM",
    proposalId: "commission-debours",
    proposalCategory: "commission_debours",
    label: "Commission sur débours CMA CGM",
  },
  {
    decisionKey: "CARRIER_DEBOURS_COMMISSION:GRIMALDI",
    kind: "commission",
    serviceKey: "GRIMALDI_COMM",
    dedupGroup: "GRIMALDI_COMM",
    carrierCode: "GRIMALDI",
    chargeCode: "COMM",
    proposalId: "commission-debours",
    proposalCategory: "commission_debours",
    label: "Commission sur débours GRIMALDI",
  },
  {
    decisionKey: "CARRIER_DEBOURS_COMMISSION:HAPAG_LLOYD",
    kind: "commission",
    serviceKey: "HAPAG_LLOYD_COLL",
    dedupGroup: "HAPAG_LLOYD_COLL",
    carrierCode: "HAPAG_LLOYD",
    chargeCode: "COLL",
    proposalId: "commission-debours",
    proposalCategory: "commission_debours",
    label: "Collection fee HAPAG-LLOYD",
  },
] as const;

const MAPPING_BY_KEY = new Map(
  SUPPORTED_MARITIME_FEE_MAPPINGS.map((m) => [m.decisionKey, m]),
);

export function resolveMaritimeFeeMapping(
  decisionKey: unknown,
): MaritimeFeeMapping | null {
  return MAPPING_BY_KEY.get(String(decisionKey ?? "")) ?? null;
}

// ---------------------------------------------------------------------------
// Types d'entrée
// ---------------------------------------------------------------------------

export type MaritimeDecisionAction = "confirm" | "adjust" | "reject" | "revoke";

/** Vue minimale d'une ligne du registre — strictement ce que le pricing lit. */
export interface MaritimeFeeDecisionRow {
  id: string;
  decision_key: string;
  proposal_id: string;
  proposal_category: string;
  decision_action: MaritimeDecisionAction;
  suggested_amount_xof: number | null;
  decided_amount_xof: number | null;
  currency: string;
  evidence_level: string;
  source_reference: string;
  decision_source: string;
  justification: string;
  proposal_fingerprint: string;
  input_snapshot_hash: string;
  proposal_snapshot?: unknown;
  decision_version: number;
  decided_by: string;
  created_at: string;
}

/** Vue minimale d'une ligne de chiffrage — seulement ce que ce module lit. */
export interface PricingLineView {
  id?: unknown;
  category?: unknown;
  amount?: unknown;
  source?: { type?: unknown; [k: string]: unknown } | null;
  canonical?:
    | {
      service_key?: string | null;
      dedup_group?: string | null;
      origin_layer?: string;
      [k: string]: unknown;
    }
    | null;
  [k: string]: unknown;
}

export interface MaritimeFeeConsumptionInput {
  /** Historique COMPLET du dossier (toutes versions, toutes clés). */
  decisions: MaritimeFeeDecisionRow[];
  /** Identités recalculées sur les faits COURANTS (fraîcheur). */
  identities: CurrentProposalIdentity[];
  /** Lignes de chiffrage APRÈS tous les enrichissements. */
  lines: PricingLineView[];
  /** `service.overrides.remove` résolu (add gagne) — veto absolu. */
  removedServiceKeys?: Set<string> | null;
  /** Compagnie du dossier, déjà normalisée par run-pricing. */
  carrierCode?: string | null;
  /** Un registre indisponible bloque, même s'il s'agit d'un cache de schéma. */
  registryAvailable?: boolean;
}

export type MaritimeFeeConsumptionState =
  /** PAD : ligne canonique annotée par une confirmation exacte et fraîche. */
  | "attested"
  /** Commission : ligne ferme unique au montant décidé. */
  | "firm"
  /** Décision `reject` : frais explicitement exclu, non compté. */
  | "excluded"
  /** Aucune décision exploitable : frais visible mais non ferme, non compté. */
  | "not_firm"
  /** PAD sans décision : ligne canonique intacte et non annotée. */
  | "canonical_unattested"
  /** Service retiré du périmètre par l'opérateur : rien n'est produit. */
  | "excluded_by_scope_override";

export interface MaritimeFeeConsumptionEntry {
  decision_key: string;
  service_key: string;
  kind: MaritimeFeeKind;
  state: MaritimeFeeConsumptionState;
  amount_xof: number | null;
  currency: "XOF";
  reason: string;
  decision: {
    id: string;
    version: number;
    action: MaritimeDecisionAction;
    decided_by: string;
    decided_at: string;
    decision_source: string;
    justification: string;
    proposal_fingerprint: string;
    input_snapshot_hash: string;
    evidence_level: string;
    source_reference: string;
    supplier_invoice_attestation: Record<string, unknown> | null;
  } | null;
}

export interface MaritimeFeeConsumptionResult {
  blockers: string[];
  /** Détail opérateur, aligné 1-1 avec `blockers` par code. */
  blocker_details: Array<{ code: string; decision_key: string; detail: string }>;
  message: string | null;
  entries: MaritimeFeeConsumptionEntry[];
  /** Lignes résultantes. Inchangées dès qu'un blocker existe. */
  lines: PricingLineView[];
}

// ---------------------------------------------------------------------------
// Helpers purs
// ---------------------------------------------------------------------------

function upper(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizedSourceType(line: PricingLineView): string {
  return upper(line?.source?.type).split("+")[0].split(":")[0];
}

/** Montant qui pèse réellement dans les totaux (miroir de `commercial-totals`). */
function isFirmPositiveLine(line: PricingLineView): boolean {
  const amount = Number(line?.amount);
  return normalizedSourceType(line) !== "TO_CONFIRM" &&
    Number.isFinite(amount) && amount > 0;
}

function isPositiveXofInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Cette ligne porte-t-elle LE MÊME frais que le mapping ?
 *
 * Quatre reconnaissances complémentaires, volontairement redondantes : le même
 * frais peut arriver par le service_key canonique (enrichissements), par la
 * `category` brute, ou par l'identifiant structurel `carrier_<code>_N` du
 * quotation-engine (dont le service_key canonique est `null`). En rater une,
 * c'est laisser deux lignes pour un seul frais.
 */
function isSameFeeLine(
  line: PricingLineView,
  mapping: MaritimeFeeMapping,
  carrierCode: string,
): boolean {
  const serviceKey = line?.canonical?.service_key;
  if (typeof serviceKey === "string" && upper(serviceKey) === mapping.serviceKey) {
    return true;
  }
  if (mapping.kind === "pad") {
    // Le PAD ne se reconnaît QUE par son service_key canonique : la ligne
    // officielle et le placeholder TO_CONFIRM le portent tous deux, et aucune
    // autre couche n'a le droit d'émettre PAD_DROIT_PASSAGE.
    return false;
  }
  const dedupGroup = line?.canonical?.dedup_group;
  if (typeof dedupGroup === "string" && upper(dedupGroup) === mapping.dedupGroup) {
    return true;
  }
  if (upper(line?.category) === mapping.serviceKey) return true;
  // Ligne STRUCTURELLE du moteur (`carrier_<code>_N`, service_key canonique
  // `null`). Cet identifiant ne porte PAS la compagnie : CMA CGM et Grimaldi
  // partagent le charge_code COMM. On ne l'accepte donc que si le dossier porte
  // bien la compagnie du mapping, sinon la commission d'un transporteur
  // capturerait la ligne d'un autre.
  if (mapping.chargeCode && carrierCode && carrierCode === mapping.carrierCode) {
    if (upper(line?.id).startsWith(`CARRIER_${mapping.chargeCode}_`)) return true;
  }
  return false;
}

/** Version courante d'une clé : la plus haute `decision_version`. */
export function selectCurrentMaritimeDecisions(
  rows: MaritimeFeeDecisionRow[],
): Map<string, MaritimeFeeDecisionRow> {
  const current = new Map<string, MaritimeFeeDecisionRow>();
  for (const row of rows ?? []) {
    if (!row || typeof row.decision_key !== "string") continue;
    const previous = current.get(row.decision_key);
    if (
      !previous ||
      Number(row.decision_version) > Number(previous.decision_version) ||
      // Départage stable si deux lignes portaient la même version (interdit par
      // la contrainte SQL, mais on ne dépend jamais de l'ordre du SELECT).
      (Number(row.decision_version) === Number(previous.decision_version) &&
        String(row.id) > String(previous.id))
    ) {
      current.set(row.decision_key, row);
    }
  }
  return current;
}

/** Une décision courante non révoquée engage le dossier. */
export function hasActiveMaritimeDecision(
  rows: MaritimeFeeDecisionRow[],
): boolean {
  for (const row of selectCurrentMaritimeDecisions(rows).values()) {
    if (row.decision_action !== "revoke") return true;
  }
  return false;
}

function decisionEnvelope(
  row: MaritimeFeeDecisionRow,
): MaritimeFeeConsumptionEntry["decision"] {
  return {
    id: String(row.id),
    version: Number(row.decision_version),
    action: row.decision_action,
    decided_by: String(row.decided_by),
    decided_at: String(row.created_at),
    decision_source: String(row.decision_source),
    justification: String(row.justification),
    proposal_fingerprint: String(row.proposal_fingerprint),
    input_snapshot_hash: String(row.input_snapshot_hash),
    evidence_level: String(row.evidence_level),
    source_reference: String(row.source_reference),
    supplier_invoice_attestation: readMaritimeFeeAttestation(row.proposal_snapshot),
  };
}

/** Bloc de provenance apposé sur toute ligne touchée par ce lot. */
function provenanceBlock(
  entry: MaritimeFeeConsumptionEntry,
): Record<string, unknown> {
  return {
    lot: "P1-B2",
    decision_key: entry.decision_key,
    service_key: entry.service_key,
    state: entry.state,
    amount_xof: entry.amount_xof,
    currency: entry.currency,
    reason: entry.reason,
    decision: entry.decision,
  };
}

// ---------------------------------------------------------------------------
// Construction du plan de consommation
// ---------------------------------------------------------------------------

/**
 * Décide, pour chaque frais maritime consommable, ce que devient la ligne de
 * chiffrage — et bloque plutôt que de deviner.
 *
 * Ordre de résolution (déterministe, indépendant de l'ordre du SELECT) :
 *   1. toute décision courante non révoquée SANS correspondance autorisée bloque ;
 *   2. chaque correspondance autorisée est ensuite résolue dans l'ordre fixe de
 *      `SUPPORTED_MARITIME_FEE_MAPPINGS` ;
 *   3. dès qu'un blocker existe, les lignes sont rendues INCHANGÉES : un run
 *      bloqué ne doit jamais laisser un chiffrage à moitié consommé.
 */
export function buildMaritimeFeeConsumption(
  input: MaritimeFeeConsumptionInput,
): MaritimeFeeConsumptionResult {
  const rows = Array.isArray(input.decisions) ? input.decisions : [];
  const sourceLines = Array.isArray(input.lines) ? input.lines : [];
  const removedServiceKeys = input.removedServiceKeys instanceof Set
    ? input.removedServiceKeys
    : new Set<string>();
  const registryAvailable = input.registryAvailable !== false;
  const carrierCode = upper(input.carrierCode);

  if (!registryAvailable) return {
    blockers: [MARITIME_FEE_DECISION_READ_FAILED],
    blocker_details: [{code: MARITIME_FEE_DECISION_READ_FAILED, decision_key: "",
      detail: "Le registre des décisions n'est pas disponible."}],
    message: MARITIME_FEE_DECISION_BLOCKER_MESSAGES[MARITIME_FEE_DECISION_READ_FAILED],
    entries: [], lines: sourceLines,
  };

  const current = registryAvailable
    ? selectCurrentMaritimeDecisions(rows)
    : new Map<string, MaritimeFeeDecisionRow>();
  const identityByKey = new Map(
    (input.identities ?? []).map((identity) => [
      identity.decisionKey,
      identity,
    ]),
  );

  const blockers: string[] = [];
  const blockerDetails: MaritimeFeeConsumptionResult["blocker_details"] = [];
  const entries: MaritimeFeeConsumptionEntry[] = [];
  let lines = [...sourceLines];

  const block = (code: string, decisionKey: string, detail: string): void => {
    if (!blockers.includes(code)) blockers.push(code);
    blockerDetails.push({ code, decision_key: decisionKey, detail });
  };

  // (1) Décisions courantes hors table close = fail-closed, avant tout calcul.
  // Trié pour que deux runs identiques produisent le même ordre de détails.
  for (const key of [...current.keys()].sort()) {
    const row = current.get(key)!;
    if (row.decision_action === "revoke") continue;
    if (resolveMaritimeFeeMapping(key)) continue;
    block(
      MARITIME_FEE_DECISION_UNSUPPORTED_MAPPING,
      key,
      `Décision ${row.decision_action} v${row.decision_version} sur « ${key} » : aucune correspondance de facturation autorisée.`,
    );
  }

  // (2) Résolution frais par frais, dans l'ordre canonique de la table close.
  for (const mapping of SUPPORTED_MARITIME_FEE_MAPPINGS) {
    const row = current.get(mapping.decisionKey) ?? null;
    const active = row && row.decision_action !== "revoke" ? row : null;
    const matched = lines.filter((line) => isSameFeeLine(line, mapping, carrierCode));

    const explicitlyRemoved = removedServiceKeys.has(mapping.serviceKey) ||
      (mapping.kind === "pad" && removedServiceKeys.has("PORT_DAKAR_HANDLING"));
    // Une ligne structurelle ferme pèse déjà dans engineTotals. La remettre à
    // zéro ou la retirer sans compensation laisserait un total caché. Ce lot
    // n'altère pas les totaux FROZEN du moteur : il bloque tous ces chemins,
    // y compris absence, révocation, rejet et retrait du périmètre.
    if ((mapping.kind === "commission" || explicitlyRemoved) && matched.some(
      (line) => isFirmPositiveLine(line) &&
        line.canonical?.origin_layer === "engine_structural",
    )) {
      block(MARITIME_FEE_DECISION_DUPLICATE_FIRM_LINE, mapping.decisionKey,
        "Ligne structurelle ferme déjà comprise dans les totaux moteur : transformation refusée.");
      continue;
    }

    // Veto absolu du périmètre : l'opérateur a retiré ce service.
    if (explicitlyRemoved) {
      lines = lines.filter((line) => !isSameFeeLine(line, mapping, carrierCode));
      if (active || matched.length > 0) {
        entries.push({
          decision_key: mapping.decisionKey,
          service_key: mapping.serviceKey,
          kind: mapping.kind,
          state: "excluded_by_scope_override",
          amount_xof: null,
          currency: "XOF",
          reason:
            "Service retiré du périmètre par service.overrides.remove : la décision humaine reste sans effet sur ce chiffrage.",
          decision: active ? decisionEnvelope(active) : null,
        });
      }
      continue;
    }

    if (active && (active.proposal_id !== mapping.proposalId ||
      active.proposal_category !== mapping.proposalCategory)) {
      block(MARITIME_FEE_DECISION_INCOHERENT, mapping.decisionKey,
        "L'identité de proposition ne correspond pas au frais décidé.");
      continue;
    }

    // ─── PAD : la ligne canonique est souveraine ───────────────────────────
    if (mapping.kind === "pad") {
      if (!active) {
        if (matched.length > 0) {
          entries.push({
            decision_key: mapping.decisionKey,
            service_key: mapping.serviceKey,
            kind: mapping.kind,
            state: "canonical_unattested",
            amount_xof: null,
            currency: "XOF",
            reason: row
              ? "Décision révoquée : la ligne PAD officielle est conservée, sans attestation humaine."
              : "Aucune décision humaine : la ligne PAD officielle est conservée, sans attestation humaine.",
            decision: row ? decisionEnvelope(row) : null,
          });
        }
        continue;
      }

      if (active.decision_action !== "confirm") {
        block(
          MARITIME_FEE_DECISION_PAD_NOT_ATTESTABLE,
          mapping.decisionKey,
          `Décision ${active.decision_action} v${active.decision_version} sur la taxe de port PAD : seul le barème officiel fait foi.`,
        );
        continue;
      }

      const staleDetail = freshnessFailure(active, identityByKey.get(mapping.decisionKey));
      if (staleDetail) {
        block(MARITIME_FEE_DECISION_STALE, mapping.decisionKey, staleDetail);
        continue;
      }
      if (upper(active.currency) !== "XOF") {
        block(
          MARITIME_FEE_DECISION_INCOHERENT,
          mapping.decisionKey,
          `Devise « ${active.currency} » sur la décision PAD v${active.decision_version} : seul le FCFA (XOF) est consommable.`,
        );
        continue;
      }
      if (!isPositiveXofInteger(active.decided_amount_xof)) {
        block(
          MARITIME_FEE_DECISION_INCOHERENT,
          mapping.decisionKey,
          `Montant confirmé non exploitable sur la décision PAD v${active.decision_version} (entier FCFA strictement positif attendu).`,
        );
        continue;
      }
      if (matched.length === 0) {
        block(
          MARITIME_FEE_DECISION_TARGET_LINE_MISSING,
          mapping.decisionKey,
          `Décision PAD confirmée v${active.decision_version} mais ce chiffrage ne produit aucune ligne PAD_DROIT_PASSAGE.`,
        );
        continue;
      }
      if (matched.length > 1) {
        block(
          MARITIME_FEE_DECISION_AMBIGUOUS_TARGET,
          mapping.decisionKey,
          `${matched.length} lignes PAD_DROIT_PASSAGE présentes : l'attestation ne peut pas désigner la ligne officielle.`,
        );
        continue;
      }

      const target = matched[0];
      const targetAmount = Number(target?.amount);
      if (
        !isFirmPositiveLine(target) ||
        targetAmount !== active.decided_amount_xof
      ) {
        block(
          MARITIME_FEE_DECISION_AMOUNT_MISMATCH,
          mapping.decisionKey,
          `Montant confirmé ${active.decided_amount_xof} FCFA contre ligne PAD officielle ${
            Number.isFinite(targetAmount) ? Math.round(targetAmount) : "indisponible"
          } FCFA.`,
        );
        continue;
      }

      const entry: MaritimeFeeConsumptionEntry = {
        decision_key: mapping.decisionKey,
        service_key: mapping.serviceKey,
        kind: mapping.kind,
        state: "attested",
        amount_xof: active.decided_amount_xof,
        currency: "XOF",
        reason:
          "Confirmation humaine fraîche et strictement égale à la ligne PAD officielle : attestation apposée, montant inchangé.",
        decision: decisionEnvelope(active),
      };
      entries.push(entry);
      // ANNOTATION SEULE : ni `amount`, ni `canonical`, ni `source` ne bougent.
      lines = lines.map((line) =>
        line === target
          ? { ...line, maritime_fee_decision: provenanceBlock(entry) }
          : line
      );
      continue;
    }

    // ─── Commissions : jamais fermes sans décision fraîche ─────────────────
    if (!active) {
      const entry: MaritimeFeeConsumptionEntry = {
        decision_key: mapping.decisionKey,
        service_key: mapping.serviceKey,
        kind: mapping.kind,
        state: "not_firm",
        amount_xof: null,
        currency: "XOF",
        reason: row
          ? "Décision révoquée : commission remise à l'état non ferme, non comptée."
          : "Aucune décision humaine courante : commission non ferme, non comptée.",
        decision: row ? decisionEnvelope(row) : null,
      };
      if (matched.length > 0) {
        entries.push(entry);
        lines = lines.map((line) =>
          isSameFeeLine(line, mapping, carrierCode) ? applyNonFirm(line, entry) : line
        );
      }
      continue;
    }

    if (mapping.carrierCode && carrierCode && carrierCode !== mapping.carrierCode) {
      block(
        MARITIME_FEE_DECISION_INCOHERENT,
        mapping.decisionKey,
        `Décision ${active.decision_action} v${active.decision_version} pour ${mapping.carrierCode} alors que le dossier porte la compagnie ${carrierCode}.`,
      );
      continue;
    }

    const staleDetail = freshnessFailure(active, identityByKey.get(mapping.decisionKey));
    if (staleDetail) {
      block(MARITIME_FEE_DECISION_STALE, mapping.decisionKey, staleDetail);
      continue;
    }
    if (upper(active.currency) !== "XOF") {
      block(
        MARITIME_FEE_DECISION_INCOHERENT,
        mapping.decisionKey,
        `Devise « ${active.currency} » sur la décision ${mapping.decisionKey} v${active.decision_version} : seul le FCFA (XOF) est consommable.`,
      );
      continue;
    }

    if (active.decision_action === "reject") {
      const entry: MaritimeFeeConsumptionEntry = {
        decision_key: mapping.decisionKey,
        service_key: mapping.serviceKey,
        kind: mapping.kind,
        state: "excluded",
        amount_xof: null,
        currency: "XOF",
        reason:
          "Frais explicitement rejeté par décision humaine : exclu du chiffrage, non compté.",
        decision: decisionEnvelope(active),
      };
      entries.push(entry);
      if (matched.length > 0) {
        lines = lines.map((line) =>
          isSameFeeLine(line, mapping, carrierCode) ? applyNonFirm(line, entry) : line
        );
      }
      continue;
    }

    // confirm / adjust : une seule ligne ferme, au montant décidé.
    if (active.decision_action !== "confirm" && active.decision_action !== "adjust") {
      block(MARITIME_FEE_DECISION_INCOHERENT, mapping.decisionKey, "Action monétaire inconnue.");
      continue;
    }
    if (!isPositiveXofInteger(active.decided_amount_xof)) {
      block(
        MARITIME_FEE_DECISION_INCOHERENT,
        mapping.decisionKey,
        `Montant décidé non exploitable sur ${mapping.decisionKey} v${active.decision_version} (entier FCFA strictement positif attendu).`,
      );
      continue;
    }

    const attestationFailure = verifySupplierInvoiceTtcAttestation({
      proposalSnapshot: active.proposal_snapshot,
      action: active.decision_action,
      decidedAmountXof: active.decided_amount_xof,
      decisionSource: active.decision_source,
      decisionKey: mapping.decisionKey,
      decisionVersion: active.decision_version,
    });
    if (attestationFailure) {
      block(MARITIME_FEE_DECISION_TTC_UNVERIFIED, mapping.decisionKey, attestationFailure);
      continue;
    }

    const entry: MaritimeFeeConsumptionEntry = {
      decision_key: mapping.decisionKey,
      service_key: mapping.serviceKey,
      kind: mapping.kind,
      state: "firm",
      amount_xof: active.decided_amount_xof,
      currency: "XOF",
      reason: active.decision_action === "confirm"
        ? "Proposition confirmée telle quelle par décision humaine fraîche."
        : "Montant arrêté par ajustement humain sur une proposition fraîche.",
      decision: decisionEnvelope(active),
    };
    entries.push(entry);
    lines = [
      ...lines.filter((line) => !isSameFeeLine(line, mapping, carrierCode)),
      buildDecidedCommissionLine(mapping, entry),
    ];
  }

  if (blockers.length > 0) {
    return {
      blockers,
      blocker_details: blockerDetails,
      message: buildBlockerMessage(blockers),
      entries,
      lines: sourceLines,
    };
  }

  return {
    blockers: [],
    blocker_details: [],
    message: null,
    entries,
    lines,
  };
}

function freshnessFailure(
  row: MaritimeFeeDecisionRow,
  identity: CurrentProposalIdentity | undefined,
): string | null {
  if (!identity) {
    return `Décision ${row.decision_action} v${row.decision_version} sur « ${row.decision_key} » : les faits actuels ne produisent plus cette proposition.`;
  }
  if (identity.fingerprint !== row.proposal_fingerprint) {
    return `Décision ${row.decision_action} v${row.decision_version} sur « ${row.decision_key} » : empreinte de proposition périmée (les faits du dossier ont changé depuis la décision).`;
  }
  return null;
}

/**
 * Applique un état NON FERME à une ligne existante.
 *
 * Une ligne DÉJÀ non ferme (montant nul ou source TO_CONFIRM) n'est pas
 * réécrite : elle est seulement annotée. La neutraliser ferait perdre le motif
 * d'origine du moteur (« PERCENTAGE — base de calcul requise », etc.) sans
 * changer un centime. Seul un frais explicitement REJETÉ est toujours réécrit,
 * pour que l'exclusion humaine soit lisible sur la ligne elle-même.
 */
function applyNonFirm(
  line: PricingLineView,
  entry: MaritimeFeeConsumptionEntry,
): PricingLineView {
  if (entry.state !== "excluded" && !isFirmPositiveLine(line)) {
    return { ...line, maritime_fee_decision: provenanceBlock(entry) };
  }
  return neutralizeLine(line, entry);
}

/**
 * Rend une ligne NON FERME sans la faire disparaître : le montant tombe à 0 et
 * la source passe TO_CONFIRM (seuls critères lus par `computeCommercialTotals`),
 * mais la ligne reste visible et auditable, avec le motif de la décision.
 */
function neutralizeLine(
  line: PricingLineView,
  entry: MaritimeFeeConsumptionEntry,
): PricingLineView {
  const previousAmount = Number(line?.amount);
  return {
    ...line,
    amount: 0,
    isEditable: false,
    source: {
      ...(line?.source ?? {}),
      type: "TO_CONFIRM",
      confidence: 0,
      reference: entry.state === "excluded"
        ? `Frais rejeté par décision humaine ${entry.decision_key} v${entry.decision?.version ?? "?"}`
        : `Décision humaine requise (${entry.decision_key}) avant tout montant ferme`,
    },
    maritime_fee_decision: {
      ...provenanceBlock(entry),
      neutralized_amount_xof: Number.isFinite(previousAmount) &&
          previousAmount !== 0
        ? Math.round(previousAmount)
        : null,
    },
  };
}

/** LA ligne ferme d'un frais décidé — exactement une par frais, par construction. */
function buildDecidedCommissionLine(
  mapping: MaritimeFeeMapping,
  entry: MaritimeFeeConsumptionEntry,
): PricingLineView {
  const amount = entry.amount_xof as number;
  const version = entry.decision?.version ?? 0;
  return {
    category: mapping.serviceKey,
    label: mapping.label,
    description:
      `${mapping.label} — débours fournisseur TVA incluse, montant attesté ${entry.decision?.action} ` +
      `(${mapping.decisionKey} v${version})`,
    amount,
    amount_basis: "supplier_invoice_ttc",
    currency: "XOF",
    unit: "forfait",
    quantity: 1,
    unitPrice: amount,
    source: {
      // Type existant du pipeline : toute valeur inconnue serait traitée comme
      // « non à confirmer » de la même façon, sans bénéfice, avec un risque
      // d'énumération non gérée en aval. La provenance humaine est portée par
      // `reference`, `canonical` et le bloc `maritime_fee_decision`.
      type: "CALCULATED",
      reference:
        `maritime_fee_decisions:${mapping.decisionKey}#v${version} — pièce : ${entry.decision?.decision_source ?? ""} — barème : ${entry.decision?.source_reference ?? ""}`
          .trim(),
      confidence: 1,
      table: "maritime_fee_decisions",
    },
    isEditable: false,
    canonical: {
      service_key: mapping.serviceKey,
      dedup_group: mapping.dedupGroup,
      // Couche d'enrichissement EXISTANTE et déjà comptée par
      // `computeCommercialTotals`. Inventer une couche ici sortirait la ligne
      // des totaux en silence : sous-facturation invisible.
      origin_layer: "enrichment_carrier_commission",
      source_system: "maritime_fee_decisions",
      source_table: "maritime_fee_decisions",
      pricing_method: "human_decision",
    },
    maritime_fee_decision: provenanceBlock(entry),
  };
}

function buildBlockerMessage(blockers: string[]): string {
  return blockers
    .map((code) =>
      MARITIME_FEE_DECISION_BLOCKER_MESSAGES[code] ??
        "Décision maritime non consommable : chiffrage bloqué."
    )
    .join(" ");
}
