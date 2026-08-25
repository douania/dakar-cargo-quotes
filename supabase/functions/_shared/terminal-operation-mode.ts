/**
 * Terminal operation mode — the ONE canonical fact that says which Dakar terminal
 * operator handles a maritime scope, and the fail-closed guard built on it.
 *
 * DOCTRINE (arbitrée 2026-08-25, cf. docs/CTO_DEVELOPMENT_ROADMAP.md §P0-E) :
 *
 *   - le droit de passage PAD est une redevance SÉPARÉE ; `PORT_DAKAR_HANDLING`
 *     n'est qu'un marqueur de périmètre PAD, jamais facturable
 *     (voir `pad-scope-blocker.ts`, doctrine inchangée par ce module) ;
 *   - LoLo / terminal à conteneurs                → DP World ;
 *   - RoRo ou ConRo — Y COMPRIS un conteneur FCL transporté par ce navire →
 *     Dakar Terminal ;
 *   - aucun montant Dakar Terminal automatique sans barème officiel ou pro forma
 *     validée : tant qu'aucune source tarifaire canonique n'existe, on BLOQUE ;
 *   - on ne déduit JAMAIS l'opérateur du seul transporteur (Grimaldi ≠ preuve de
 *     RoRo), ni du seul type de conteneur : seul le fait explicite fait foi.
 *
 * Ce module ne contient QUE la décision pure. Il ne connaît ni la base, ni les
 * tarifs, et n'introduit AUCUN mécanisme de source/tarif : il ne sait que dire
 * « je peux laisser passer le chemin DTHC existant » ou « je bloque ».
 *
 * Portée volontairement étroite : le garde ne s'arme que sur un périmètre
 * contenant `DTHC`. Aucun package aérien ni export du catalogue ne contient
 * cette clé (`EXPORT_SENEGAL` porte `THC_EXPORT`, distinct), donc ces flux ne
 * peuvent pas être bloqués par ce module — voir les tests dédiés.
 */

/** Shape of the fact rows the guard reads (a subset of `quote_facts`). */
export type TerminalScopeFact = {
  fact_key: string;
  value_json?: unknown;
  value_number?: unknown;
  value_text?: unknown;
};

/** La clé canonique. Saisissable via `set-case-fact` (allowlist) et l'UI CaseView. */
export const TERMINAL_OPERATION_MODE_FACT_KEY = "routing.terminal_operation_mode";

/** Les seules valeurs acceptées. Toute autre chaîne est INVALIDE, donc bloquante. */
export const TERMINAL_OPERATION_MODES = ["LOLO", "RORO", "CONRO"] as const;
export type TerminalOperationMode = (typeof TERMINAL_OPERATION_MODES)[number];

/** L'opérateur terminal que chaque mode désigne. Documentaire : aucun tarif ici. */
export const TERMINAL_OPERATOR_BY_MODE: Record<TerminalOperationMode, string> = {
  LOLO: "DP_WORLD",
  RORO: "DAKAR_TERMINAL",
  CONRO: "DAKAR_TERMINAL",
};

/**
 * Le service qui met un périmètre dans le champ « manutention terminal ».
 * `PORT_DAKAR_HANDLING` n'en fait volontairement PAS partie : c'est le marqueur
 * PAD, traité par `pad-scope-blocker.ts`, et le confondre avec le terminal est
 * exactement l'erreur que la doctrine ci-dessus corrige.
 */
export const TERMINAL_SCOPE_SERVICE_KEYS = new Set(["DTHC"]);

/** Codes de blocage STABLES : persistés dans `pricing_runs.outputs_json`. */
export const TERMINAL_OPERATION_MODE_REQUIRED = "TERMINAL_OPERATION_MODE_REQUIRED";
export const DAKAR_TERMINAL_RATE_REQUIRED = "DAKAR_TERMINAL_RATE_REQUIRED";

export const TERMINAL_OPERATION_MODE_REQUIRED_MESSAGE =
  "Mode d'opération terminal requis (LOLO, RORO ou CONRO) pour chiffrer la manutention terminal (DTHC) : LoLo relève de DP World, RoRo/ConRo de Dakar Terminal. L'opérateur ne peut pas être déduit du transporteur.";

export const DAKAR_TERMINAL_RATE_REQUIRED_MESSAGE =
  "Périmètre RoRo/ConRo : la manutention relève de Dakar Terminal, dont aucun barème officiel ni pro forma validée n'est disponible dans le référentiel. Le chiffrage est bloqué — aucun montant Dakar Terminal n'est inventé.";

/** Question opérateur du gap de clarification (build-case-puzzle). */
export const TERMINAL_OPERATION_MODE_GAP_QUESTION_FR =
  "Le navire/terminal traitant cet envoi opère-t-il en LoLo (terminal à conteneurs, DP World), en RoRo ou en ConRo (Dakar Terminal) ? Un conteneur FCL transporté par un navire RoRo/ConRo relève de Dakar Terminal. Merci de répondre par LOLO, RORO ou CONRO.";
export const TERMINAL_OPERATION_MODE_GAP_QUESTION_EN =
  "Is the vessel/terminal handling this shipment operating LoLo (container terminal, DP World), RoRo or ConRo (Dakar Terminal)? An FCL container carried by a RoRo/ConRo vessel is handled by Dakar Terminal. Please answer LOLO, RORO or CONRO.";

/**
 * Normalisation STRICTE : trim + majuscules, rien d'autre.
 *
 * `"roro"`, `" RoRo "` → `RORO`. En revanche `"RO-RO"`, `"RO RO"`, `"ROULIER"`,
 * `"LO/LO"` → `null`, donc bloquant. Deviner un synonyme reviendrait à choisir
 * un opérateur terminal à la place de l'opérateur humain : on préfère demander.
 * Toute valeur non textuelle (nombre, booléen, objet, tableau) → `null`.
 */
export function normalizeTerminalOperationMode(raw: unknown): TerminalOperationMode | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toUpperCase();
  return (TERMINAL_OPERATION_MODES as readonly string[]).includes(normalized)
    ? (normalized as TerminalOperationMode)
    : null;
}

/**
 * Validation/canonicalisation du payload manuel avant `supersede_fact`.
 *
 * Ce fait est textuel par doctrine. Accepter simultanément `value_number` ou
 * `value_json` créerait deux valeurs concurrentes dont la priorité dépendrait du
 * lecteur. On refuse donc tout payload ambigu et on stocke la valeur texte sous
 * sa forme canonique.
 */
export function normalizeTerminalOperationFactWrite(payload: {
  value_text?: unknown;
  value_number?: unknown;
  value_json?: unknown;
}): TerminalOperationMode | null {
  if (payload.value_number != null || payload.value_json != null) return null;
  return normalizeTerminalOperationMode(payload.value_text);
}

/** Ce périmètre a-t-il besoin de savoir QUI manutentionne ? */
export function scopeRequiresTerminalOperator(serviceKeys: string[]): boolean {
  return (serviceKeys ?? []).some((key) =>
    TERMINAL_SCOPE_SERVICE_KEYS.has(String(key ?? "").trim().toUpperCase())
  );
}

/**
 * Le mode déclaré par les faits, ou `null` s'il est absent OU invalide.
 *
 * Même doctrine de lecture que `pad-scope-blocker.readTextFactValue` : les RPC de
 * propagation réservent `value_json` aux métadonnées, donc un objet/tableau JSON
 * n'est jamais une valeur métier ; `value_number` est exclu — un mode numérique
 * n'est pas un mode. Volontairement dupliqué plutôt qu'importé pour laisser le
 * module PAD P0-E strictement inchangé.
 */
export function readTerminalOperationMode(
  facts: TerminalScopeFact[],
): TerminalOperationMode | null {
  const fact = (facts ?? []).find((f) => f?.fact_key === TERMINAL_OPERATION_MODE_FACT_KEY);
  if (!fact) return null;
  for (const raw of [fact.value_json, fact.value_text]) {
    const mode = normalizeTerminalOperationMode(raw);
    if (mode) return mode;
  }
  return null;
}

/**
 * LE garde. Fail-closed par construction, pur, non mutant, idempotent.
 *
 *   - DTHC hors périmètre                → `[]` : STRICTEMENT rien ne change ;
 *   - DTHC au périmètre, mode absent
 *     ou invalide                        → `[TERMINAL_OPERATION_MODE_REQUIRED]` ;
 *   - DTHC au périmètre, mode `LOLO`     → `[]` : le chemin DTHC existant reprend
 *     la main, avec son montant et sa source inchangés (DP World) ;
 *   - DTHC au périmètre, `RORO`/`CONRO`  → `[DAKAR_TERMINAL_RATE_REQUIRED]`, tant
 *     qu'aucune source tarifaire canonique prouvée n'existe pour Dakar Terminal.
 *
 * Le tableau retourné est toujours neuf : l'appelant peut le muter sans effet de
 * bord sur un appel suivant.
 */
export function resolveTerminalOperationBlockers(params: {
  facts: TerminalScopeFact[];
  effectiveServiceKeys: string[];
}): string[] {
  if (!scopeRequiresTerminalOperator(params.effectiveServiceKeys)) return [];

  const mode = readTerminalOperationMode(params.facts ?? []);
  if (mode === null) return [TERMINAL_OPERATION_MODE_REQUIRED];
  if (mode === "LOLO") return [];
  return [DAKAR_TERMINAL_RATE_REQUIRED];
}

/**
 * Faut-il ouvrir/maintenir le gap de clarification opérateur ?
 *
 * Uniquement quand le mode est ABSENT ou INVALIDE. Un périmètre RoRo/ConRo
 * correctement déclaré ne produit PAS de gap : le fait est renseigné et juste,
 * c'est la source tarifaire Dakar Terminal qui manque — un autre sujet, traité
 * par `DAKAR_TERMINAL_RATE_REQUIRED` côté chiffrage, pas par une question de plus
 * à l'opérateur.
 */
export function requiresTerminalOperationModeGap(params: {
  facts: TerminalScopeFact[];
  effectiveServiceKeys: string[];
}): boolean {
  return resolveTerminalOperationBlockers(params).includes(TERMINAL_OPERATION_MODE_REQUIRED);
}

/** Message opérateur associé au premier blocage retourné, pour `pricing_runs`. */
export function terminalOperationBlockerMessage(blockers: string[]): string {
  if ((blockers ?? []).includes(TERMINAL_OPERATION_MODE_REQUIRED)) {
    return TERMINAL_OPERATION_MODE_REQUIRED_MESSAGE;
  }
  if ((blockers ?? []).includes(DAKAR_TERMINAL_RATE_REQUIRED)) {
    return DAKAR_TERMINAL_RATE_REQUIRED_MESSAGE;
  }
  return "";
}
