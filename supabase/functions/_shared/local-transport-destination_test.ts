import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLocalTransportDestinationIndex,
  CANONICAL_LOCAL_TRANSPORT_DESTINATIONS,
  LOCAL_TRANSPORT_CONTAINER_20,
  LOCAL_TRANSPORT_CONTAINER_40,
  LOCAL_TRANSPORT_TO_CONFIRM_CODE,
  type LocalTransportRateCandidate,
  normalizeLocalTransportContainerType,
  normalizeLocalTransportDestination,
  OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT,
  resolveCanonicalLocalTransportContainerType,
  resolveCanonicalLocalTransportDestination,
  resolveOfficialLocalTransportRate,
} from "./local-transport-destination.ts";

const TODAY = "2026-08-24";

function rate(
  over: Partial<LocalTransportRateCandidate> = {},
): LocalTransportRateCandidate {
  return {
    origin: "Dakar Port",
    destination: "KAOLACK",
    container_type: LOCAL_TRANSPORT_CONTAINER_20,
    cargo_category: "Dry",
    rate_amount: 290280,
    rate_currency: "XOF",
    is_active: true,
    evidence_level: "validated_internal",
    validity_start: null,
    validity_end: null,
    client_code: null,
    source_document: OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT,
    provider: null,
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════
// Normalisation
// ════════════════════════════════════════════════════════════════════

Deno.test("destination normalisation folds accents, case, punctuation and slash spacing", () => {
  assertEquals(
    normalizeLocalTransportDestination("  Thiès / Popoguine "),
    "THIES/POPOGUINE",
  );
  assertEquals(
    normalizeLocalTransportDestination("THIES/POPONGUINE"),
    "THIES/POPONGUINE",
  );
  assertEquals(
    normalizeLocalTransportDestination("THIES / POPONGUINE"),
    "THIES/POPONGUINE",
  );
  assertEquals(normalizeLocalTransportDestination("Mékhé"), "MEKHE");
  assertEquals(
    normalizeLocalTransportDestination("FORFAIT ZONE 1 <18 KM"),
    "FORFAIT ZONE 1 18 KM",
  );
  assertEquals(
    normalizeLocalTransportDestination("FORFAIT ZONE 2, SEIKHOTANE ET POUT"),
    "FORFAIT ZONE 2 SEIKHOTANE ET POUT",
  );
  assertEquals(normalizeLocalTransportDestination(null), "");
  assertEquals(normalizeLocalTransportDestination(42), "");
});

Deno.test("container normalisation strips apostrophes, spaces and case", () => {
  assertEquals(normalizeLocalTransportContainerType("20' Dry"), "20DRY");
  assertEquals(normalizeLocalTransportContainerType("40 ' dry"), "40DRY");
  assertEquals(normalizeLocalTransportContainerType("40HC"), "40HC");
  assertEquals(normalizeLocalTransportContainerType(undefined), "");
});

// ════════════════════════════════════════════════════════════════════
// Index de destinations
// ════════════════════════════════════════════════════════════════════

Deno.test("the canonical grid holds exactly 30 unique destinations", () => {
  assertEquals(CANONICAL_LOCAL_TRANSPORT_DESTINATIONS.length, 30);
  assertEquals(new Set(CANONICAL_LOCAL_TRANSPORT_DESTINATIONS).size, 30);
  assertEquals(
    new Set(
      CANONICAL_LOCAL_TRANSPORT_DESTINATIONS.map(
        normalizeLocalTransportDestination,
      ),
    ).size,
    30,
  );
});

Deno.test("the destination index carries no ambiguous key today", () => {
  const index = buildLocalTransportDestinationIndex();
  const ambiguous = [...index.entries()].filter(([, canonical]) =>
    canonical === null
  );
  assertEquals(ambiguous, []);
  // 30 full labels + 18 slash components + 4 explicit aliases.
  assertEquals(index.size, 52);
});

Deno.test("a key claimed by two canonical lines is marked ambiguous, never arbitrated", () => {
  // An alias pointing at a line other than the one already owning the key must
  // poison the key rather than let either side win.
  const poisoned = buildLocalTransportDestinationIndex({
    KAOLACK: "MBOUR", // collides with the canonical label "KAOLACK"
    BISSAU: "MBOUR", // collides with the component of "KIDIRA / BISSAU"
    DAKAR: "FORFAIT ZONE 1 <18 KM", // unchanged, must survive
  });
  assertEquals(poisoned.get("KAOLACK"), null);
  assertEquals(poisoned.get("BISSAU"), null);
  assertEquals(poisoned.get("DAKAR"), "FORFAIT ZONE 1 <18 KM");
  assertEquals(poisoned.get("MBOUR"), "MBOUR");
  // An alias repeating an existing mapping is idempotent, not a collision.
  const repeated = buildLocalTransportDestinationIndex({ KAOLACK: "KAOLACK" });
  assertEquals(repeated.get("KAOLACK"), "KAOLACK");
});

Deno.test("each of the 30 canonical labels resolves to itself", () => {
  for (const canonical of CANONICAL_LOCAL_TRANSPORT_DESTINATIONS) {
    assertEquals(
      resolveCanonicalLocalTransportDestination(canonical),
      { canonical, reason: null },
      `canonical label not self-resolving: ${canonical}`,
    );
  }
});

Deno.test("every slash component of a composite label maps to its canonical line", () => {
  const composites: Array<[string, string]> = [
    ["THIES", "THIES / POPONGUINE"],
    ["POPONGUINE", "THIES / POPONGUINE"],
    ["KEBEMER", "KEBEMER / FATICK"],
    ["FATICK", "KEBEMER / FATICK"],
    ["LOUGA", "LOUGA / TOUBA"],
    ["TOUBA", "LOUGA / TOUBA"],
    ["NIORO", "NIORO / ST LOUIS"],
    ["ST LOUIS", "NIORO / ST LOUIS"],
    ["DAGANA", "DAGANA / MAKA"],
    ["MAKA", "DAGANA / MAKA"],
    ["VELINGARA", "VELINGARA / GOUDIRI"],
    ["GOUDIRI", "VELINGARA / GOUDIRI"],
    ["ROSSO", "ROSSO / NIOKOLOKO"],
    ["NIOKOLOKO", "ROSSO / NIOKOLOKO"],
    ["KIDIRA", "KIDIRA / BISSAU"],
    ["BISSAU", "KIDIRA / BISSAU"],
    ["KOLDA", "KOLDA / MATAM"],
    ["MATAM", "KOLDA / MATAM"],
  ];
  for (const [component, canonical] of composites) {
    assertEquals(
      resolveCanonicalLocalTransportDestination(component).canonical,
      canonical,
      `component ${component} did not map to ${canonical}`,
    );
  }
  assertEquals(composites.length, 18);
});

Deno.test("case, accents and punctuation do not change the resolution", () => {
  for (
    const raw of [
      "kolda",
      "  Kolda  ",
      "KOLDA/MATAM",
      "Kolda / Matam",
      "kolda   /matam",
    ]
  ) {
    assertEquals(
      resolveCanonicalLocalTransportDestination(raw).canonical,
      "KOLDA / MATAM",
      `raw ${raw}`,
    );
  }
  assertEquals(
    resolveCanonicalLocalTransportDestination("Mékhé").canonical,
    "MEKHE",
  );
  assertEquals(
    resolveCanonicalLocalTransportDestination("forfait zone 1 <18 km")
      .canonical,
    "FORFAIT ZONE 1 <18 KM",
  );
});

Deno.test("only the explicitly approved zone aliases resolve", () => {
  assertEquals(
    resolveCanonicalLocalTransportDestination("Dakar").canonical,
    "FORFAIT ZONE 1 <18 KM",
  );
  for (const raw of ["Pout", "SEBIKHOTANE", "Seikhotane"]) {
    assertEquals(
      resolveCanonicalLocalTransportDestination(raw).canonical,
      "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
      `raw ${raw}`,
    );
  }
});

Deno.test("zone cities without an explicit business decision stay unknown", () => {
  for (
    const raw of [
      "Pikine",
      "Guédiawaye",
      "Rufisque",
      "Diamniadio",
      "Keur Massar",
      "Medina",
      "Almadies",
      "Plateau",
      "Parcelles Assainies",
      "Bargny",
    ]
  ) {
    assertEquals(
      resolveCanonicalLocalTransportDestination(raw),
      { canonical: null, reason: "DESTINATION_UNKNOWN" },
      `raw ${raw} must stay TO_CONFIRM`,
    );
  }
});

Deno.test("no substring, prefix or fuzzy match is ever performed", () => {
  for (
    const raw of [
      "KAO",
      "KAOLACK NORD",
      "MBOUR SALY",
      "ZIGUINCHOR VIA KAOLACK",
      "GRAND DAKAR",
      "DAKAR PLATEAU",
      "THIES NONE",
      "BISSAU GUINEE",
    ]
  ) {
    assertEquals(
      resolveCanonicalLocalTransportDestination(raw).canonical,
      null,
      `raw ${raw} must not match by substring`,
    );
  }
});

Deno.test("ZIGUINCHOR and ZIGUINCHOR VIA TAMBA stay two distinct exact lines", () => {
  assertEquals(
    resolveCanonicalLocalTransportDestination("ZIGUINCHOR").canonical,
    "ZIGUINCHOR",
  );
  assertEquals(
    resolveCanonicalLocalTransportDestination("Ziguinchor via Tamba").canonical,
    "ZIGUINCHOR VIA TAMBA",
  );
});

Deno.test("an empty or missing destination is reported as missing, not unknown", () => {
  assertEquals(
    resolveCanonicalLocalTransportDestination("").reason,
    "DESTINATION_MISSING",
  );
  assertEquals(
    resolveCanonicalLocalTransportDestination("   ").reason,
    "DESTINATION_MISSING",
  );
  assertEquals(
    resolveCanonicalLocalTransportDestination(null).reason,
    "DESTINATION_MISSING",
  );
});

// ════════════════════════════════════════════════════════════════════
// Conteneurs
// ════════════════════════════════════════════════════════════════════

Deno.test("dry 20 and dry 40 variants map to the exact DB spelling", () => {
  for (
    const raw of [
      "20",
      "20'",
      "20' Dry",
      "20DV",
      "20GP",
      "20DC",
      "20FT",
      "20ft dry",
      "20 STD",
    ]
  ) {
    assertEquals(
      resolveCanonicalLocalTransportContainerType(raw),
      LOCAL_TRANSPORT_CONTAINER_20,
      `raw ${raw}`,
    );
  }
  for (
    const raw of [
      "40",
      "40'",
      "40' Dry",
      "40DV",
      "40GP",
      "40DC",
      "40FT",
      "40HC",
      "40HQ",
      "40 hc dry",
    ]
  ) {
    assertEquals(
      resolveCanonicalLocalTransportContainerType(raw),
      LOCAL_TRANSPORT_CONTAINER_40,
      `raw ${raw}`,
    );
  }
});

Deno.test("the standard 'Dry Van' wording maps to the exact DB spelling", () => {
  // Régression : un runtime émettant la désignation ISO complète ("20' Dry Van")
  // était refusé en CONTAINER_UNSUPPORTED alors que la grille stocke "20' Dry".
  for (
    const raw of [
      "20' Dry Van",
      "20 Dry Van",
      "20' dry van",
      "20FT Dry Van",
      "20ft dry van",
    ]
  ) {
    assertEquals(
      resolveCanonicalLocalTransportContainerType(raw),
      LOCAL_TRANSPORT_CONTAINER_20,
      `raw ${raw}`,
    );
  }
  for (
    const raw of [
      "40' Dry Van",
      "40 Dry Van",
      "40' dry van",
      "40FT Dry Van",
      "40HC Dry Van",
    ]
  ) {
    assertEquals(
      resolveCanonicalLocalTransportContainerType(raw),
      LOCAL_TRANSPORT_CONTAINER_40,
      `raw ${raw}`,
    );
  }
});

Deno.test("the 'Van' wording never widens the grid to a special or unsized type", () => {
  for (
    const raw of [
      "Van",
      "Dry Van",
      "45' Dry Van",
      "20' Reefer Van",
      "20RF Dry Van",
      "20' Open Top Van",
      "20' Flat Rack Van",
      "20' Tank Van",
      "LCL Dry Van",
      "20' Dry Van Reefer",
    ]
  ) {
    assertEquals(
      resolveCanonicalLocalTransportContainerType(raw),
      null,
      `raw ${raw} must not resolve to a grid container`,
    );
  }
});

Deno.test("non-dry and out-of-grid equipment is never invented", () => {
  for (
    const raw of [
      "20RF",
      "40RF",
      "40NOR",
      "20OT",
      "40OT",
      "20FR",
      "40FR",
      "20TK",
      "45HC",
      "LCL",
      "LOW BED",
      "BREAKBULK",
      "",
      null,
    ]
  ) {
    assertEquals(
      resolveCanonicalLocalTransportContainerType(raw),
      null,
      `raw ${String(raw)} must not resolve to a grid container`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════
// Sélection fail-closed
// ════════════════════════════════════════════════════════════════════

Deno.test("exactly one eligible candidate resolves to the exact tariff", () => {
  const result = resolveOfficialLocalTransportRate(
    [rate(), rate({ destination: "MBOUR", rate_amount: 165200 })],
    {
      destination: "kaolack",
      containerType: "20DV",
      clientCode: null,
      asOfDate: TODAY,
    },
  );
  assertEquals(result.status, "RESOLVED");
  if (result.status !== "RESOLVED") return;
  assertEquals(result.amount, 290280);
  assertEquals(result.currency, "XOF");
  assertEquals(result.canonicalDestination, "KAOLACK");
  assertEquals(result.canonicalContainerType, LOCAL_TRANSPORT_CONTAINER_20);
});

Deno.test("a composite component resolves onto the composite row", () => {
  const result = resolveOfficialLocalTransportRate(
    [rate({ destination: "KIDIRA / BISSAU", rate_amount: 834260 })],
    {
      destination: "Bissau",
      containerType: "20' Dry",
      clientCode: null,
      asOfDate: TODAY,
    },
  );
  assertEquals(result.status, "RESOLVED");
  if (result.status !== "RESOLVED") return;
  assertEquals(result.amount, 834260);
});

Deno.test("a MBOUR 20' Dry tariff is served verbatim from a Dry Van runtime input", () => {
  // Montant officiel MBOUR 20P du barème stagé (migration 20260823130000).
  const mbour = rate({ destination: "MBOUR", rate_amount: 165200 });
  const result = resolveOfficialLocalTransportRate([mbour, rate()], {
    destination: "Mbour",
    containerType: "20' Dry Van",
    clientCode: null,
    asOfDate: TODAY,
  });
  assertEquals(result.status, "RESOLVED");
  if (result.status !== "RESOLVED") return;
  assertEquals(result.canonicalDestination, "MBOUR");
  assertEquals(result.canonicalContainerType, LOCAL_TRANSPORT_CONTAINER_20);
  assertEquals(result.amount, 165200);
  assertEquals(result.currency, "XOF");
  // Le montant vient de la ligne officielle elle-même, pas d'un repli.
  assertEquals(result.rate, mbour);
  assertEquals(
    result.rate.source_document,
    OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT,
  );

  // Le même dossier avec un équipement hors barème reste fail-closed.
  const special = resolveOfficialLocalTransportRate([mbour, rate()], {
    destination: "Mbour",
    containerType: "20' Reefer Van",
    clientCode: null,
    asOfDate: TODAY,
  });
  assertEquals(special.status, "TO_CONFIRM");
  if (special.status !== "TO_CONFIRM") return;
  assertEquals(special.reason, "CONTAINER_UNSUPPORTED");
  assertEquals(special.amount, null);
});

Deno.test("zero candidate yields TO_CONFIRM with a null amount", () => {
  const result = resolveOfficialLocalTransportRate([rate()], {
    destination: "KAOLACK",
    containerType: "40' Dry",
    clientCode: null,
    asOfDate: TODAY,
  });
  assertEquals(result.status, "TO_CONFIRM");
  if (result.status !== "TO_CONFIRM") return;
  assertEquals(result.reason, "NO_MATCHING_RATE");
  assertEquals(result.amount, null);
  assertEquals(result.code, LOCAL_TRANSPORT_TO_CONFIRM_CODE);
});

Deno.test("two competing candidates never pick a winner", () => {
  const result = resolveOfficialLocalTransportRate(
    [rate(), rate({ rate_amount: 999999, source_document: "AUTRE_BAREME" })],
    {
      destination: "KAOLACK",
      containerType: "20' Dry",
      clientCode: null,
      asOfDate: TODAY,
    },
  );
  assertEquals(result.status, "TO_CONFIRM");
  if (result.status !== "TO_CONFIRM") return;
  assertEquals(result.reason, "AMBIGUOUS_RATE");
  assertEquals(result.matchCount, 2);
});

Deno.test("a duplicate written with another spelling is still detected as ambiguous", () => {
  const result = resolveOfficialLocalTransportRate(
    [
      rate({ destination: "KIDIRA / BISSAU", rate_amount: 834260 }),
      rate({ destination: "KIDIRA/BISSAU", rate_amount: 700000 }),
    ],
    {
      destination: "KIDIRA",
      containerType: "20' Dry",
      clientCode: null,
      asOfDate: TODAY,
    },
  );
  assertEquals(result.status, "TO_CONFIRM");
  if (result.status !== "TO_CONFIRM") return;
  assertEquals(result.reason, "AMBIGUOUS_RATE");
});

Deno.test("unknown, ambiguous or missing input short-circuits before any row is read", () => {
  const unknown = resolveOfficialLocalTransportRate([rate()], {
    destination: "Rufisque",
    containerType: "20' Dry",
    asOfDate: TODAY,
  });
  assertEquals(unknown.status, "TO_CONFIRM");
  if (unknown.status === "TO_CONFIRM") {
    assertEquals(unknown.reason, "DESTINATION_UNKNOWN");
  }

  const missing = resolveOfficialLocalTransportRate([rate()], {
    destination: "",
    containerType: "20' Dry",
    asOfDate: TODAY,
  });
  if (missing.status === "TO_CONFIRM") {
    assertEquals(missing.reason, "DESTINATION_MISSING");
  }

  const noContainer = resolveOfficialLocalTransportRate([rate()], {
    destination: "KAOLACK",
    containerType: null,
    asOfDate: TODAY,
  });
  if (noContainer.status === "TO_CONFIRM") {
    assertEquals(noContainer.reason, "CONTAINER_MISSING");
  }

  const badContainer = resolveOfficialLocalTransportRate([rate()], {
    destination: "KAOLACK",
    containerType: "40RF",
    asOfDate: TODAY,
  });
  if (badContainer.status === "TO_CONFIRM") {
    assertEquals(badContainer.reason, "CONTAINER_UNSUPPORTED");
  }
});

Deno.test("inactive rows and non-whitelisted evidence levels are invisible", () => {
  for (
    const over of [
      { is_active: false },
      { evidence_level: "to_confirm" },
      { evidence_level: "client_override" },
      { evidence_level: "observed" },
      { evidence_level: "historical_only" },
      { evidence_level: null },
    ] as Array<Partial<LocalTransportRateCandidate>>
  ) {
    const result = resolveOfficialLocalTransportRate([rate(over)], {
      destination: "KAOLACK",
      containerType: "20' Dry",
      clientCode: null,
      asOfDate: TODAY,
    });
    assertEquals(result.status, "TO_CONFIRM", JSON.stringify(over));
  }
  const official = resolveOfficialLocalTransportRate([
    rate({ evidence_level: "official" }),
  ], {
    destination: "KAOLACK",
    containerType: "20' Dry",
    clientCode: null,
    asOfDate: TODAY,
  });
  assertEquals(official.status, "RESOLVED");
});

Deno.test("the validity window is honoured, and an unknown date is fail-closed", () => {
  const live = rate({ validity_start: "2026-03-30", validity_end: null });
  assertEquals(
    resolveOfficialLocalTransportRate([live], {
      destination: "KAOLACK",
      containerType: "20' Dry",
      asOfDate: TODAY,
    }).status,
    "RESOLVED",
  );
  assertEquals(
    resolveOfficialLocalTransportRate([live], {
      destination: "KAOLACK",
      containerType: "20' Dry",
      asOfDate: "2026-01-01",
    }).status,
    "TO_CONFIRM",
  );
  assertEquals(
    resolveOfficialLocalTransportRate([rate({ validity_end: "2026-01-31" })], {
      destination: "KAOLACK",
      containerType: "20' Dry",
      asOfDate: TODAY,
    }).status,
    "TO_CONFIRM",
  );
  // A bounded row without an evaluation date must not be served.
  assertEquals(
    resolveOfficialLocalTransportRate([live], {
      destination: "KAOLACK",
      containerType: "20' Dry",
      asOfDate: null,
    }).status,
    "TO_CONFIRM",
  );
  // An unbounded row does not need one.
  assertEquals(
    resolveOfficialLocalTransportRate([rate()], {
      destination: "KAOLACK",
      containerType: "20' Dry",
      asOfDate: null,
    }).status,
    "RESOLVED",
  );
});

Deno.test("client scoping never leaks a client-specific tariff to a generic case", () => {
  const aksa = rate({ client_code: "AKSA_ENERGY", rate_amount: 111111 });
  const generic = rate();

  const noClient = resolveOfficialLocalTransportRate([aksa], {
    destination: "KAOLACK",
    containerType: "20' Dry",
    clientCode: null,
    asOfDate: TODAY,
  });
  assertEquals(noClient.status, "TO_CONFIRM");

  const scoped = resolveOfficialLocalTransportRate([aksa, generic], {
    destination: "KAOLACK",
    containerType: "20' Dry",
    clientCode: "AKSA_ENERGY",
    asOfDate: TODAY,
  });
  assertEquals(scoped.status, "RESOLVED");
  if (scoped.status === "RESOLVED") assertEquals(scoped.amount, 111111);

  const otherClient = resolveOfficialLocalTransportRate([aksa, generic], {
    destination: "KAOLACK",
    containerType: "20' Dry",
    clientCode: "SOMEONE_ELSE",
    asOfDate: TODAY,
  });
  assertEquals(otherClient.status, "RESOLVED");
  if (otherClient.status === "RESOLVED") {
    assertEquals(otherClient.amount, 290280);
  }
});

Deno.test("optional origin and cargo filters narrow without inventing", () => {
  const result = resolveOfficialLocalTransportRate([
    rate({ origin: "Dakar Port" }),
  ], {
    destination: "KAOLACK",
    containerType: "20' Dry",
    asOfDate: TODAY,
    origin: "Dakar Port",
    cargoCategory: "Dry",
  });
  assertEquals(result.status, "RESOLVED");

  const wrongCargo = resolveOfficialLocalTransportRate([
    rate({ cargo_category: "Reefer" }),
  ], {
    destination: "KAOLACK",
    containerType: "20' Dry",
    asOfDate: TODAY,
    cargoCategory: "Dry",
  });
  assertEquals(wrongCargo.status, "TO_CONFIRM");
});

Deno.test("an unusable amount is refused instead of being served", () => {
  for (const amount of [0, -1, null, "abc", Number.NaN]) {
    const result = resolveOfficialLocalTransportRate(
      [rate({ rate_amount: amount as number | string | null })],
      { destination: "KAOLACK", containerType: "20' Dry", asOfDate: TODAY },
    );
    assertEquals(result.status, "TO_CONFIRM", `amount ${String(amount)}`);
    if (result.status === "TO_CONFIRM") {
      assertEquals(result.reason, "INVALID_RATE_AMOUNT");
    }
  }
});

Deno.test("an empty or missing rate set is TO_CONFIRM, never a crash", () => {
  for (const rates of [[], null, undefined]) {
    const result = resolveOfficialLocalTransportRate(rates, {
      destination: "KAOLACK",
      containerType: "20' Dry",
      asOfDate: TODAY,
    });
    assertEquals(result.status, "TO_CONFIRM");
  }
});

Deno.test("currency falls back to XOF only when the row carries none", () => {
  const blank = resolveOfficialLocalTransportRate([
    rate({ rate_currency: "  " }),
  ], {
    destination: "KAOLACK",
    containerType: "20' Dry",
    asOfDate: TODAY,
  });
  if (blank.status === "RESOLVED") assertEquals(blank.currency, "XOF");

  const explicit = resolveOfficialLocalTransportRate([
    rate({ rate_currency: "FCFA" }),
  ], {
    destination: "KAOLACK",
    containerType: "20' Dry",
    asOfDate: TODAY,
  });
  if (explicit.status === "RESOLVED") assertEquals(explicit.currency, "FCFA");
});

// ════════════════════════════════════════════════════════════════════
// Cohérence helper <-> barème stagé, et contrôle kilométrique.
//
// La formule kilométrique est un CONTROLE, jamais une source de montant :
// elle n'existe que dans ce test et dans la migration de promotion.
// ════════════════════════════════════════════════════════════════════

interface GridEntry {
  raw_label: string;
  destination: string;
  distance_km: number;
  tc20: number;
  fee20: number;
  vat20: number;
  total20: number;
  tc40: number;
  fee40: number;
  vat40: number;
  total40: number;
}

function readStagedGrid(): GridEntry[] {
  const sql = Deno.readTextFileSync(
    new URL(
      "../../migrations/20260823130000_stage_official_local_transport_debours.sql",
      import.meta.url,
    ),
  );
  const match = sql.match(/v_grid jsonb := '(\[[\s\S]*?\])'::jsonb;/);
  assert(
    match,
    "the staged grid literal could not be located in the migration",
  );
  return JSON.parse(match![1]) as GridEntry[];
}

const KM_EXCEPTIONS_20: Readonly<Record<string, number>> = {
  "ZONE": -5000,
  "BIGNONA": 2000,
  "ZIGUINCHOR": 6000,
  "CAP SKIRING": 27000,
};
const KM_EXCEPTIONS_40: Readonly<Record<string, number>> = {
  "BIGNONA": 74000,
  "ZIGUINCHOR": 23000,
  "CAP SKIRING": 99000,
};

Deno.test("the helper's 30 canonical labels are exactly the staged grid destinations", () => {
  const grid = readStagedGrid();
  assertEquals(grid.length, 30);
  assertEquals(
    grid.map((e) => e.destination).sort(),
    [...CANONICAL_LOCAL_TRANSPORT_DESTINATIONS].sort(),
  );
});

Deno.test("every staged destination is resolvable, and resolves to itself", () => {
  for (const entry of readStagedGrid()) {
    assertEquals(
      resolveCanonicalLocalTransportDestination(entry.destination).canonical,
      entry.destination,
    );
  }
});

Deno.test("kilometric coherence control: 57k + 1k/km (20P) and 69k + 2k/km (40P)", () => {
  for (const entry of readStagedGrid()) {
    const expected20 = 57000 + 1000 * entry.distance_km +
      (KM_EXCEPTIONS_20[entry.raw_label] ?? 0);
    const expected40 = 69000 + 2000 * entry.distance_km +
      (KM_EXCEPTIONS_40[entry.raw_label] ?? 0);
    assertEquals(
      entry.tc20,
      expected20,
      `20P transport mismatch on ${entry.raw_label}`,
    );
    assertEquals(
      entry.tc40,
      expected40,
      `40P transport mismatch on ${entry.raw_label}`,
    );
  }
});

Deno.test("TTC totals are the sum of transport + file fee + 18% VAT", () => {
  for (const entry of readStagedGrid()) {
    assertEquals(
      entry.vat20,
      Math.round((entry.tc20 + entry.fee20) * 0.18),
      entry.raw_label,
    );
    assertEquals(
      entry.vat40,
      Math.round((entry.tc40 + entry.fee40) * 0.18),
      entry.raw_label,
    );
    assertEquals(
      entry.total20,
      entry.tc20 + entry.fee20 + entry.vat20,
      entry.raw_label,
    );
    assertEquals(
      entry.total40,
      entry.tc40 + entry.fee40 + entry.vat40,
      entry.raw_label,
    );
  }
});
