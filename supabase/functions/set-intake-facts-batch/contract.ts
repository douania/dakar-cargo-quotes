/**
 * DCQ-P0-INTAKE-ATOMIC-BATCH — contrat PUR de set-intake-facts-batch.
 *
 * Aucun client Supabase, aucun réseau : ce module valide le corps de requête
 * AVANT l'appel RPC et traduit les erreurs SQL en codes Edge. L'autorité
 * finale reste public.set_intake_facts_batch (allowlist, typage, idempotence,
 * verrou, provenance) ; cette couche refuse AVANT la base et pour le MÊME
 * motif, avec un message actionnable.
 *
 * Invariants miroirs de la RPC — toute divergence est un bug :
 *   - allowlist FERMÉE des 11 faits produits par l'écran Intake ;
 *   - exactement UNE colonne de valeur par fait, jamais null ;
 *   - cargo.containers : chaque groupe porte EXACTEMENT {type, quantity},
 *     type non vide (type:null refusé), quantity entier 1..500 ;
 *   - source_type ∈ {email_body, attachment_extracted} — jamais manual_input :
 *     la confiance est décidée par le serveur SQL, jamais acceptée du client ;
 *   - clé d'idempotence obligatoire, bornée, namespacée 'intake:' ;
 *   - payload borné (20 faits, 64 KiB).
 */

import type { ErrorCode } from "../_shared/runtime.ts";

export const MAX_FACTS = 20;
export const MAX_PAYLOAD_BYTES = 65536;
export const MAX_SOURCE_EXCERPT = 500;
export const BATCH_KEY_PATTERN = /^intake:[A-Za-z0-9._:-]{8,120}$/;

export const INTAKE_SOURCE_TYPES = [
  "email_body",
  "attachment_extracted",
] as const;
export type IntakeSourceType = (typeof INTAKE_SOURCE_TYPES)[number];

export const SERVICE_MODES = [
  "SEA_FCL_IMPORT",
  "SEA_LCL_IMPORT",
  "SEA_BREAKBULK_IMPORT",
  "AIR_IMPORT",
  "ROAD_IMPORT",
  "MULTIMODAL_IMPORT",
] as const;

export const TRANSPORT_MODES = [
  "MARITIME",
  "AIR",
  "ROUTE",
  "MULTIMODAL",
] as const;

/** Colonne de valeur attendue par clé — allowlist FERMÉE. */
export const INTAKE_FACT_ALLOWLIST: Record<
  string,
  "value_text" | "value_number" | "value_json"
> = {
  "cargo.container_count": "value_number",
  "cargo.container_type": "value_text",
  "cargo.containers": "value_json",
  "cargo.weight_kg": "value_number",
  "cargo.description": "value_text",
  "service.mode": "value_text",
  "routing.transport_mode": "value_text",
  "routing.origin_port": "value_text",
  "routing.destination_port": "value_text",
  "routing.destination_city": "value_text",
  "routing.destination_country": "value_text",
};

const TEXT_BOUNDS: Record<string, number> = {
  "cargo.container_type": 32,
  "cargo.description": 2000,
  "routing.origin_port": 120,
  "routing.destination_port": 120,
  "routing.destination_city": 120,
  "routing.destination_country": 120,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ContractError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface IntakeBatchFact {
  fact_key: string;
  value_text?: string;
  value_number?: number;
  value_json?: unknown;
}

export interface IntakeBatchCommand {
  case_id: string;
  batch_key: string;
  source_type: IntakeSourceType;
  source_excerpt: string | null;
  workflow_key: string | null;
  facts: IntakeBatchFact[];
}

function fail(message: string): never {
  throw new ContractError("VALIDATION_FAILED", message);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateFact(raw: unknown, seen: Set<string>): IntakeBatchFact {
  if (!isPlainObject(raw)) fail("Chaque fait doit être un objet");
  const keys = Object.keys(raw);
  for (const k of keys) {
    if (!["fact_key", "value_text", "value_number", "value_json"].includes(k)) {
      // Refuse notamment toute tentative de fixer confidence/source_type par fait.
      fail(`Clé inattendue '${k}' dans un fait`);
    }
  }
  const factKey = raw.fact_key;
  if (typeof factKey !== "string") fail("fact_key est requis");
  const column = INTAKE_FACT_ALLOWLIST[factKey];
  if (!column) fail(`fact_key '${factKey}' n'est pas autorisé par l'intake`);
  if (seen.has(factKey)) fail(`fact_key '${factKey}' est dupliqué dans le lot`);
  seen.add(factKey);

  const provided = (["value_text", "value_number", "value_json"] as const)
    .filter((c) => c in raw);
  for (const c of provided) {
    if (raw[c] === null || raw[c] === undefined) {
      fail(`${factKey}: ${c} ne doit jamais être null`);
    }
  }
  if (provided.length !== 1 || provided[0] !== column) {
    fail(`${factKey}: exactement une colonne de valeur attendue (${column})`);
  }

  if (column === "value_number") {
    const n = raw.value_number;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
      fail(`${factKey}: nombre fini strictement positif requis`);
    }
    if (
      factKey === "cargo.container_count" && (!Number.isInteger(n) || n > 500)
    ) {
      fail("cargo.container_count: entier entre 1 et 500 requis");
    }
    if (factKey === "cargo.weight_kg" && n > 100000000) {
      fail("cargo.weight_kg: valeur hors borne (max 100 000 000 kg)");
    }
    return { fact_key: factKey, value_number: n };
  }

  if (column === "value_text") {
    const t = raw.value_text;
    if (typeof t !== "string" || t.trim().length === 0) {
      fail(`${factKey}: chaîne non vide requise`);
    }
    if (
      factKey === "service.mode" &&
      !(SERVICE_MODES as readonly string[]).includes(t)
    ) {
      fail(`service.mode: valeur '${t}' hors liste fermée`);
    }
    if (
      factKey === "routing.transport_mode" &&
      !(TRANSPORT_MODES as readonly string[]).includes(t)
    ) {
      fail(`routing.transport_mode: valeur '${t}' hors liste fermée`);
    }
    const bound = TEXT_BOUNDS[factKey];
    if (bound !== undefined && t.length > bound) {
      fail(`${factKey}: longueur maximale ${bound} dépassée`);
    }
    return { fact_key: factKey, value_text: t };
  }

  // cargo.containers — contrat canonique fermé {type, quantity}.
  const arr = raw.value_json;
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > 50) {
    fail("cargo.containers: tableau de 1 à 50 groupes requis");
  }
  for (const elem of arr) {
    if (!isPlainObject(elem)) {
      fail("cargo.containers: chaque groupe doit être un objet");
    }
    const elemKeys = Object.keys(elem).sort();
    if (
      elemKeys.length !== 2 || elemKeys[0] !== "quantity" ||
      elemKeys[1] !== "type"
    ) {
      fail("cargo.containers: chaque groupe porte exactement {type, quantity}");
    }
    const qty = elem.quantity;
    if (
      typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 500
    ) {
      fail("cargo.containers: quantity doit être un entier entre 1 et 500");
    }
    const type = elem.type;
    if (
      typeof type !== "string" || type.trim().length === 0 || type.length > 32
    ) {
      fail(
        "cargo.containers: type doit être une chaîne non vide ≤ 32 caractères (type:null refusé)",
      );
    }
  }
  return { fact_key: factKey, value_json: arr };
}

/**
 * Valide et normalise le corps de requête. Jette ContractError sinon.
 */
export function validateIntakeBatchCommand(raw: unknown): IntakeBatchCommand {
  if (!isPlainObject(raw)) fail("Corps JSON objet requis");
  const allowedTop = new Set([
    "case_id",
    "batch_key",
    "source_type",
    "source_excerpt",
    "workflow_key",
    "facts",
  ]);
  for (const k of Object.keys(raw)) {
    // confidence, source_email_id, etc. : refusés — le serveur SQL décide.
    if (!allowedTop.has(k)) fail(`Clé inattendue '${k}' dans la requête`);
  }

  const caseId = raw.case_id;
  if (typeof caseId !== "string" || !UUID_PATTERN.test(caseId)) {
    fail("case_id: UUID requis");
  }
  const batchKey = raw.batch_key;
  if (
    typeof batchKey !== "string" ||
    batchKey.length < 16 ||
    batchKey.length > 128 ||
    !BATCH_KEY_PATTERN.test(batchKey)
  ) {
    fail(
      "batch_key: clé d'idempotence namespacée 'intake:' de 16 à 128 caractères requise",
    );
  }
  const sourceType = raw.source_type;
  if (
    typeof sourceType !== "string" ||
    !(INTAKE_SOURCE_TYPES as readonly string[]).includes(sourceType)
  ) {
    fail("source_type: 'email_body' ou 'attachment_extracted' requis");
  }
  let excerpt: string | null = null;
  if (raw.source_excerpt !== undefined && raw.source_excerpt !== null) {
    if (
      typeof raw.source_excerpt !== "string" ||
      raw.source_excerpt.trim().length === 0 ||
      raw.source_excerpt.length > MAX_SOURCE_EXCERPT
    ) {
      fail(
        `source_excerpt: chaîne non vide de 1 à ${MAX_SOURCE_EXCERPT} caractères ou null requis`,
      );
    }
    excerpt = raw.source_excerpt;
  }
  let workflowKey: string | null = null;
  if (raw.workflow_key !== undefined && raw.workflow_key !== null) {
    if (typeof raw.workflow_key !== "string" || raw.workflow_key.length > 64) {
      fail("workflow_key: chaîne ≤ 64 caractères ou absent");
    }
    workflowKey = raw.workflow_key;
  }

  const factsRaw = raw.facts;
  if (!Array.isArray(factsRaw)) fail("facts: tableau requis");
  if (factsRaw.length > MAX_FACTS) {
    fail(`facts: maximum ${MAX_FACTS} faits par lot`);
  }

  const seen = new Set<string>();
  const facts: IntakeBatchFact[] = factsRaw.map((f) => validateFact(f, seen));

  // Cohérence interne du lot : le détail conteneurs doit recouper le compte.
  const countFact = facts.find((f) => f.fact_key === "cargo.container_count");
  const containersFact = facts.find((f) => f.fact_key === "cargo.containers");
  if (countFact && containersFact) {
    const sum = (containersFact.value_json as Array<{ quantity: number }>)
      .reduce((acc, g) => acc + g.quantity, 0);
    if (sum !== countFact.value_number) {
      fail("cargo.containers contredit cargo.container_count — lot refusé");
    }
  }

  const command: IntakeBatchCommand = {
    case_id: caseId,
    batch_key: batchKey,
    source_type: sourceType as IntakeSourceType,
    source_excerpt: excerpt,
    workflow_key: workflowKey,
    facts,
  };

  const bytes = new TextEncoder().encode(JSON.stringify(command)).length;
  if (bytes > MAX_PAYLOAD_BYTES) fail("Payload excessif (max 64 KiB)");

  return command;
}

/** Arguments RPC — noms alignés sur public.set_intake_facts_batch. */
export function buildRpcArgs(
  command: IntakeBatchCommand,
): Record<string, unknown> {
  return {
    p_case_id: command.case_id,
    p_batch_key: command.batch_key,
    p_source_type: command.source_type,
    p_source_excerpt: command.source_excerpt,
    p_workflow_key: command.workflow_key,
    p_facts: command.facts,
  };
}

/** Traduit un message d'erreur RPC SQL (SIFB_*) en erreur Edge typée. */
export function mapSifbRpcError(message: string): ContractError {
  if (message.includes("SIFB_AUTH_REQUIRED")) {
    return new ContractError("AUTH_INVALID_JWT", "Session utilisateur requise");
  }
  if (message.includes("SIFB_CASE_ACCESS_DENIED")) {
    return new ContractError(
      "FORBIDDEN_OWNER",
      "Dossier existant sans droit d'écriture",
    );
  }
  if (message.includes("SIFB_IDEMPOTENCY_CONFLICT")) {
    return new ContractError(
      "CONFLICT_INVALID_STATE",
      "Clé d'idempotence déjà utilisée avec un payload différent — lot refusé",
    );
  }
  if (message.includes("SIFB_")) {
    return new ContractError(
      "VALIDATION_FAILED",
      `Lot refusé par la base: ${message}`,
    );
  }
  return new ContractError(
    "UPSTREAM_DB_ERROR",
    "Écriture atomique du lot indisponible",
  );
}
