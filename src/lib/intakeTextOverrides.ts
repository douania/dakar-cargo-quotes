/**
 * Parsing du texte de la demande (overrides opérateur) pour l'intake.
 *
 * Extrait de src/pages/Intake.tsx (DCQ-P0-E) pour être testable directement.
 * Le contrat reste identique : `parseTextOverrides` renvoie un objet d'overrides
 * qui prime sur l'analyse IA du document.
 *
 * Principe directeur : FIDÉLITÉ ou RIEN.
 * - un dossier multi-types publie la liste réelle des groupes (jamais un type unique),
 * - une occurrence ambiguë (même type déclaré plusieurs fois) ne publie RIEN,
 * - un port déclaré (POD/POL) n'est JAMAIS promu en destination finale.
 *
 * @test-manual DCQ-P0-WHATSAPP-RFQ-INTAKE-GAPS — RFQ KAS0032026
 *   Input:
 *     "From Pune To Nhava Sheva port, to Dakar (Senegal) and further to Kaolack City
 *      Port of Discharge: Dakar Port, Senegal
 *      Final Place of Discharge of Containers: Kaolack Site, Senegal
 *      20 x 40' HC ..."
 *   Expected overrides:
 *     origin = "Pune"
 *     origin_port = "Nhava Sheva"
 *     pod = "Dakar Port, Senegal"
 *     destination = "Kaolack Site, Senegal"   (NOT Dakar)
 *     container_count = 20
 *     container_type  = "40' HC"
 *     requires_final_destination = true
 *
 * @test-manual Cas piège port-to-port pur:
 *   "Sea quote: Port of Discharge: Dakar Port. 1x40HC."
 *   → requires_final_destination=false, pod resolves route.destinations.
 *
 * @test-manual Cas piège inland sans extraction:
 *   "Door delivery required. Port of Discharge: Dakar Port."
 *   → requires_final_destination=true, destination=undefined.
 *   route.destinations gap MUST remain (Dakar must NOT mask Kaolack/inland).
 *
 * @test-manual DCQ-P0-E — dossier mixte 20'/40' avec livraison inland:
 *   "... Port de destination : Dakar. Livraison finale : Mbour, Sénégal.
 *    Conteneurs : 1 x 20 pieds Dry et 1 x 40 pieds Dry. ..."
 *   → containers = [{count:1,type:"20' Dry"},{count:1,type:"40' Dry"}]
 *     container_count = 2, container_type = undefined (mixte),
 *     pod = "Dakar", destination = "Mbour" (JAMAIS Dakar).
 */

export interface IntakeContainerGroup {
  /** Nombre de boîtes de ce type. Toujours > 0. */
  count: number;
  /** Type normalisé ("40' HC", "20' Dry", "40'") ou null si non déclaré. */
  type: string | null;
}

export interface IntakeTextOverrides {
  containers?: IntakeContainerGroup[];
  /** true = déclarations conteneurs contradictoires → rien n'est publié. */
  containers_ambiguous?: boolean;
  container_count?: number;
  /** Type legacy — renseigné UNIQUEMENT si le dossier est mono-type. */
  container_type?: string;
  origin?: string;
  origin_port?: string;
  pod?: string;
  destination?: string;
  requires_final_destination?: boolean;
  [key: string]: unknown;
}

export interface ContainerPlan {
  /** Groupes fidèles au texte. Vide si inconnu ou ambigu. */
  groups: IntakeContainerGroup[];
  /** Somme des counts. 0 si inconnu ou ambigu. */
  totalCount: number;
  /** Type legacy publiable — null dès que le dossier est mixte. */
  legacyType: string | null;
  /** true si au moins un groupe porte une taille conteneur (20/40/45). */
  isFcl: boolean;
  /** true = fail-closed, ne rien publier. */
  ambiguous: boolean;
}

export interface CanonicalIntakeContainer {
  type: string | null;
  quantity: number;
}

const FRENCH_NUMBERS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4,
  cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
};

// Apostrophe class: simple, typographic ’, prime ′, double-quote
const APOS = `['\\u2019\\u2032"]`;

/** Qualificatifs d'équipement reconnus → forme canonique publiée. */
const CONTAINER_QUALIFIERS: Record<string, string> = {
  HC: "HC",
  DV: "DV",
  OT: "OT",
  FR: "FR",
  GP: "GP",
  DRY: "Dry",
};

const QUALIFIER_ALTERNATION = Object.keys(CONTAINER_QUALIFIERS).join("|");

/**
 * Groupe conteneur explicite : quantité + connecteur + taille (+ unité, apostrophe, type).
 * Couvre "1 conteneur 40'", "1 x 40HC", "20 x 40’ HC", "1 x 20 pieds Dry"
 * et la variante naturelle "1 x conteneur 20 pieds Dry" observée en recette.
 * La taille est OBLIGATOIRE ici : les mentions sans taille retombent sur le
 * parsing "compte seul" plus bas, qui ne publie aucun type.
 */
const CONTAINER_GROUP_PATTERN = new RegExp(
  `(\\d{1,4})\\s*(?:seul\\s+)?(?:conteneurs?|containers?|(?:x|\\u00d7|\\*)\\s*(?:conteneurs?|containers?)?)\\s*` +
    `(20|40|45)(?!\\d)\\s*(?:pieds?|feet|foot|ft\\.?)?\\s*${APOS}?\\s*[-\\u2013]?\\s*` +
    `(?:(${QUALIFIER_ALTERNATION})(?![A-Za-z]))?`,
  "gi",
);

/**
 * Déclaration de volume nue : "2 conteneurs", "3 containers".
 * Sert à recouper le total annoncé avec le détail extrait.
 */
const BARE_COUNT_PATTERN = /(\d{1,4})\s*(?:seul\s+)?(?:conteneurs?|containers?)\b/gi;

/** Trim + drop trailing punctuation .,;: + cap length */
export function cleanCaptured(value: string, max = 80): string {
  return value.trim().replace(/[.,;:]+$/, "").trim().slice(0, max);
}

/** "40" + "HC" → "40' HC" ; "20" + "" → "20'" */
function formatContainerType(size: string, qualifierRaw: string | undefined): string {
  const qualifier = qualifierRaw ? CONTAINER_QUALIFIERS[qualifierRaw.toUpperCase()] : "";
  return size + "'" + (qualifier ? " " + qualifier : "");
}

/** Taille conteneur portée par un type ("40' HC" → "40"), sinon null. */
function containerSizeOf(type: string | null | undefined): string | null {
  if (!type) return null;
  const m = String(type).match(/(20|40|45)/);
  return m ? m[1] : null;
}

/**
 * Scan global des groupes conteneurs explicites.
 * @returns null si aucun groupe explicite (le parsing "compte seul" prend le relais).
 */
function parseContainerGroups(
  normalized: string,
): { groups: IntakeContainerGroup[]; ambiguous: boolean } | null {
  const re = new RegExp(CONTAINER_GROUP_PATTERN.source, CONTAINER_GROUP_PATTERN.flags);
  const groups: IntakeContainerGroup[] = [];
  // Index de départ de chaque groupe détaillé, pour distinguer plus bas une
  // déclaration de volume nue d'un groupe déjà pris en compte.
  const groupStarts = new Set<number>();
  let m: RegExpExecArray | null;

  while ((m = re.exec(normalized)) !== null) {
    // Garde-fou : un match vide ferait boucler exec indéfiniment.
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    groupStarts.add(m.index);
    groups.push({
      count: parseInt(m[1], 10),
      type: formatContainerType(m[2], m[3]),
    });
  }

  if (groups.length === 0) return null;

  // Fail-closed : quantité invalide → on ne publie rien.
  for (const g of groups) {
    if (!Number.isFinite(g.count) || g.count <= 0) {
      return { groups: [], ambiguous: true };
    }
  }

  // Fail-closed : un même type déclaré plusieurs fois est ambigu (cumul ou
  // redite ?). Sommer risquerait un double comptage → on ne publie rien et
  // la question reste posée à l'opérateur.
  const seen = new Set<string>();
  for (const g of groups) {
    const key = g.type ?? "";
    if (seen.has(key)) return { groups: [], ambiguous: true };
    seen.add(key);
  }

  // Fail-closed : un volume annoncé ("2 conteneurs, dont 1 x 40HC") qui
  // contredit le détail extrait signale une extraction incomplète — publier le
  // seul détail sous-compterait le dossier.
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const bare = new RegExp(BARE_COUNT_PATTERN.source, BARE_COUNT_PATTERN.flags);
  let b: RegExpExecArray | null;
  while ((b = bare.exec(normalized)) !== null) {
    if (b[0].length === 0) {
      bare.lastIndex += 1;
      continue;
    }
    // Même position qu'un groupe détaillé → c'est ce groupe, pas un total.
    if (groupStarts.has(b.index)) continue;
    if (parseInt(b[1], 10) !== total) return { groups: [], ambiguous: true };
  }

  return { groups, ambiguous: false };
}

/**
 * Consolide overrides texte + analyse document en un plan conteneurs unique.
 * Priorité : groupes extraits du texte > compte/type texte > analyse document.
 */
export function resolveContainerPlan(
  overrides: Record<string, unknown> | null | undefined,
  analysis: Record<string, unknown> | null | undefined,
): ContainerPlan {
  const o = overrides || {};
  const a = analysis || {};
  const empty: ContainerPlan = {
    groups: [],
    totalCount: 0,
    legacyType: null,
    isFcl: false,
    ambiguous: false,
  };

  // Texte ambigu → fail-closed, y compris face à une valeur document :
  // arbitrer entre les deux serait deviner.
  if (o.containers_ambiguous) return { ...empty, ambiguous: true };

  const textGroups: IntakeContainerGroup[] = Array.isArray(o.containers) ? o.containers : [];
  if (textGroups.length > 0) {
    const totalCount = textGroups.reduce((sum, g) => sum + (Number(g.count) || 0), 0);
    const distinctTypes = new Set(textGroups.map((g) => g.type).filter(Boolean) as string[]);
    return {
      groups: textGroups.map((g) => ({ count: Number(g.count), type: g.type ?? null })),
      totalCount,
      // Un dossier mixte n'a pas de type legacy honnête.
      legacyType: textGroups.length === 1 && distinctTypes.size === 1 ? textGroups[0].type : null,
      isFcl: textGroups.some((g) => containerSizeOf(g.type) !== null),
      ambiguous: false,
    };
  }

  const count = Number(o.container_count ?? a.container_count) || 0;
  const type = String(o.container_type ?? a.container_type ?? "").trim();
  if (count >= 1) {
    return {
      groups: [{ count, type: type || null }],
      totalCount: count,
      legacyType: type || null,
      isFcl: containerSizeOf(type) !== null,
      ambiguous: false,
    };
  }

  return empty;
}

/** "1 × 20' Dry, 1 × 40' Dry" — libellé opérateur fidèle au plan. */
export function describeContainerPlan(plan: ContainerPlan): string {
  return plan.groups
    .map((g) => `${g.count} × ${g.type ?? "type non précisé"}`)
    .join(", ");
}

/** Contrat canonique consommé par build-case-puzzle et run-pricing. */
export function toCanonicalContainers(plan: ContainerPlan): CanonicalIntakeContainer[] {
  return plan.groups.map((group) => ({
    type: group.type,
    quantity: group.count,
  }));
}

/**
 * Parse operator text overrides.
 */
export function parseTextOverrides(inputText: string): IntakeTextOverrides {
  const overrides: IntakeTextOverrides = {};
  // Normalize CRLF → LF for robust regex separators (WhatsApp / Gmail / Windows)
  const normalized = (inputText || "").replace(/\r\n/g, "\n");

  // ── CONTENEURS ───────────────────────────────────────────────────────
  // Pattern 1 : groupes explicites quantité + taille, potentiellement multiples
  // ("1 x 20 pieds Dry et 1 x 40 pieds Dry").
  const parsedGroups = parseContainerGroups(normalized);
  if (parsedGroups) {
    if (parsedGroups.ambiguous) {
      overrides.containers_ambiguous = true;
    } else {
      overrides.containers = parsedGroups.groups;
      overrides.container_count = parsedGroups.groups.reduce((sum, g) => sum + g.count, 0);
      const distinctTypes = new Set(parsedGroups.groups.map((g) => g.type).filter(Boolean) as string[]);
      // Type legacy publié uniquement pour un dossier mono-type.
      if (parsedGroups.groups.length === 1 && distinctTypes.size === 1) {
        overrides.container_type = parsedGroups.groups[0].type as string;
      }
    }
  }

  // Pattern 2 : quantité sans taille — "1 conteneur", "2 containers".
  if (overrides.container_count == null && !overrides.containers_ambiguous) {
    const countOnly = normalized.match(
      new RegExp(`(\\d+)\\s*(?:seul\\s+)?(?:conteneur|container|x)\\s*(\\d{2})?${APOS}?\\s*(HC|DV|OT|FR|GP)?`, "i"),
    );
    if (countOnly) {
      const count = parseInt(countOnly[1], 10);
      overrides.container_count = count;
      if (countOnly[2]) {
        const type = formatContainerType(countOnly[2], countOnly[3]);
        overrides.container_type = type;
        overrides.containers = [{ count, type }];
      }
    }
  }

  // Pattern 3 : nombres en toutes lettres — "un des huit conteneurs 40'"
  if (overrides.container_count == null && !overrides.containers_ambiguous) {
    const wordPattern = new RegExp(
      `(?:^|\\s)(${Object.keys(FRENCH_NUMBERS).join("|")})\\s+(?:seul\\s+|des\\s+\\w+\\s+)?(?:conteneur|container)s?\\s*(\\d{2})?${APOS}?\\s*(HC|DV|OT|FR|GP)?`,
      "i",
    );
    const wordMatch = normalized.match(wordPattern);
    if (wordMatch) {
      const count = FRENCH_NUMBERS[wordMatch[1].toLowerCase()] ?? 1;
      overrides.container_count = count;
      if (wordMatch[2]) {
        const type = formatContainerType(wordMatch[2], wordMatch[3]);
        overrides.container_type = type;
        overrides.containers = [{ count, type }];
      }
    }
  }

  // ── ORIGIN (city) ─────────────────────────────────────────────────────
  const originPatterns = [
    /From\s+([A-Za-z][\w\s-]+?)\s+(?:To|to|→|-)/,
    /Origin(?:e)?\s*[:-]\s*([A-Za-zÀ-ÿ0-9 -]+?)(?:[.,;\n]|$)/i,
    /Départ\s+(?:de|:)\s*([A-Za-zÀ-ÿ0-9 -]+?)(?:[.,;\n]|$)/i,
    /Pickup\s+(?:from|at|location)\s*[:-]?\s*([A-Za-zÀ-ÿ0-9 -]+?)(?:[.,;\n]|$)/i,
  ];
  for (const pat of originPatterns) {
    const m = normalized.match(pat);
    if (m && m[1]) {
      overrides.origin = cleanCaptured(m[1]);
      break;
    }
  }

  // ── ORIGIN PORT / POL ────────────────────────────────────────────────
  const polPatterns = [
    /(?:To|to|via)\s+([A-Za-z][\w\s-]+?)\s+(?:port|Port)\b/,
    /(?:POL|Port\s+of\s+Loading)\s*[:-]\s*([A-Za-zÀ-ÿ0-9 ,-]+?)(?:[.;\n]|$)/i,
    new RegExp(
      `\\bPort\\s+d${APOS}?\\s*(?:origine|embarquement|chargement)\\s*[:-]\\s*([A-Za-zÀ-ÿ0-9 ,-]+?)(?:[.;\\n]|$)`,
      "i",
    ),
  ];
  for (const pat of polPatterns) {
    const m = normalized.match(pat);
    if (m && m[1]) {
      overrides.origin_port = cleanCaptured(m[1]);
      break;
    }
  }

  // ── POD (Port of Discharge) ──────────────────────────────────────────
  const podPatterns = [
    /(?:POD|Port\s+of\s+Discharge)\s*[:-]\s*([A-Za-zÀ-ÿ0-9 ,-]+?)(?:[.;\n]|$)/i,
    /\bPort\s+(?:de\s+)?(?:destination|d[ée]chargement)\s*[:-]\s*([A-Za-zÀ-ÿ0-9 ,-]+?)(?:[.;\n]|$)/i,
  ];
  for (const pat of podPatterns) {
    const m = normalized.match(pat);
    if (m && m[1]) {
      overrides.pod = cleanCaptured(m[1]);
      break;
    }
  }

  // ── FINAL DESTINATION ────────────────────────────────────────────────
  // Un port déclaré n'est PAS un lieu de livraison finale : on masque ces
  // segments avant toute recherche de destination, sinon "Port de destination :
  // Dakar" serait promu destination_city et masquerait Mbour/Kaolack.
  const destinationScope = normalized.replace(
    new RegExp(
      `\\bport\\s+(?:of\\s+|de\\s+|d${APOS}\\s*)?` +
        `(?:discharge|destination|d[ée]chargement|loading|chargement|origine|embarquement)` +
        `[^\\n]*?(?=[.;\\n]|$)`,
      "gi",
    ),
    " ",
  );

  const finalDestPatterns = [
    /Final\s+Place\s+of\s+Discharge[^:\n]*[:-]\s*([A-Za-zÀ-ÿ0-9 ,-]+?)(?:[.;\n]|$)/i,
    /further\s+to\s+([A-Za-zÀ-ÿ0-9 -]+?(?:\s+(?:City|Site|Town))?)(?:[.,;\n]|$)/i,
    /Deliveries?\s+up\s+to\s+([A-Za-zÀ-ÿ0-9 -]+?)(?:[.,;\n]|$)/i,
    /Final\s+destination\s*[:-]\s*([A-Za-zÀ-ÿ0-9 ,-]+?)(?:[.,;\n]|$)/i,
    // FR — "Livraison finale : Mbour, Sénégal" → Mbour (la virgule borne la ville)
    /(?:Livraison|Destination|Lieu\s+de\s+livraison)\s+finale?\s*[:-]\s*([A-Za-zÀ-ÿ0-9 -]+?)(?:[.,;\n]|$)/i,
  ];
  for (const pat of finalDestPatterns) {
    const m = destinationScope.match(pat);
    if (m && m[1]) {
      overrides.destination = cleanCaptured(m[1]);
      break;
    }
  }

  // FR fallback patterns (kept as before)
  if (!overrides.destination) {
    const destPatterns = [
      /Lieu\s+de\s+Livraison[^:\n]*:\s*([A-Za-zÀ-ÿ0-9 -]+?)(?:[.,;\n]|$)/i,
      /(?:livraison|livrer|destination|lieu)\s*(?:a|à|:)\s*([A-Za-zÀ-ÿ0-9 -]+?)(?:[.,;\n]|$)/i,
      /(?:site|chantier)\s*(?:a|à|de|:)\s*([A-Za-zÀ-ÿ0-9 -]+?)(?:[.,;\n]|$)/i,
    ];
    for (const pat of destPatterns) {
      const match = destinationScope.match(pat);
      if (match && match[1]) {
        overrides.destination = cleanCaptured(match[1]);
        break;
      }
    }
  }

  // ── GUARD: requires_final_destination ────────────────────────────────
  // If text mentions an inland delivery cue, POD/IA destination must NOT mask the gap.
  overrides.requires_final_destination =
    /final\s+place|further\s+to|deliveries?\s+up\s+to|door|site|chantier|livraison/i.test(normalized);

  return overrides;
}
