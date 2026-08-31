import { describe, expect, it } from "vitest";
import {
  addAssertion,
  ASSERTION_FIELD_KEYS,
  buildAssertion,
  type BuildAssertionContext,
  describeAssertion,
  getEligibleSources,
  isDuplicateAssertion,
  loadDraftFromRevisionAssertions,
  MAX_DRAFT_ASSERTIONS,
  removeAssertion,
} from "./finalRequestAssertions";

const CLIENT_SOURCE = {
  id: "src-1",
  kind: "email",
  authorRole: "client",
  roleVerified: true,
  contentClass: "current",
  sentAt: "2026-08-30T10:00:00Z",
  text: "Le poids est de 1200 kg et 3.5 CBM. Merci de confirmer 20GP.",
};

function ctxFrom(sources = [CLIENT_SOURCE], lotIds: string[] = [], quotationVersionIds: string[] = []): BuildAssertionContext {
  return { sources: getEligibleSources(sources), lotIds, quotationVersionIds };
}

describe("getEligibleSources", () => {
  it("n'accepte que authorRole=client, roleVerified=true, contentClass=current, sentAt et text non vides", () => {
    const sources = [
      CLIENT_SOURCE,
      { ...CLIENT_SOURCE, id: "src-partner", authorRole: "partner" },
      { ...CLIENT_SOURCE, id: "src-unverified", roleVerified: false },
      { ...CLIENT_SOURCE, id: "src-historical", contentClass: "historical" },
      { ...CLIENT_SOURCE, id: "src-no-date", sentAt: null },
      { ...CLIENT_SOURCE, id: "src-empty-text", text: "" },
    ];
    const eligible = getEligibleSources(sources);
    expect(eligible.map((s) => s.id)).toEqual(["src-1"]);
  });

  it("est fail-closed sur une entrée non tableau", () => {
    expect(getEligibleSources(undefined)).toEqual([]);
    expect(getEligibleSources(null)).toEqual([]);
  });

  it("refuse identifiant, kind, date et taille hors contrat C1", () => {
    const sources = [
      { ...CLIENT_SOURCE, id: "source invalide" },
      { ...CLIENT_SOURCE, id: "src-kind", kind: "attachment" },
      { ...CLIENT_SOURCE, id: "src-date", sentAt: "hier" },
      { ...CLIENT_SOURCE, id: "src-long", text: "x".repeat(20001) },
    ];
    expect(getEligibleSources(sources)).toEqual([]);
  });
});

describe("buildAssertion — clés fermées et scope", () => {
  it("construit une assertion set avec uniquement les clés du contrat C1", () => {
    const ctx = ctxFrom();
    const result = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "cargo.weight_kg",
      rawValue: "1200",
      excerpt: "Le poids est de 1200 kg",
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(Object.keys(result.value).sort()).toEqual(
      ["excerpt", "field", "id", "operation", "scope", "sourceId", "value"].sort(),
    );
    expect(result.value).toMatchObject({ value: 1200 });
    expect(result.value.scope).toBe("case");
  });

  it("refuse un sourceId qui n'est pas une source éligible", () => {
    const ctx = ctxFrom();
    const result = buildAssertion({
      sourceId: "not-eligible",
      operation: "set",
      scopeKind: "case",
      field: "cargo.weight_kg",
      rawValue: "1200",
      excerpt: "1200",
    }, ctx);
    expect(result.ok).toBe(false);
  });

  it("refuse à l'exécution une clé monétaire hors vocabulaire", () => {
    const result = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "pricing.amount" as never,
      rawValue: "1000",
      excerpt: "1200 kg",
    }, ctxFrom());
    expect(result.ok).toBe(false);
  });

  it("exige un lot pour lot.in_scope", () => {
    const ctx = ctxFrom([CLIENT_SOURCE], ["lot-1"]);
    const caseScoped = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "lot.in_scope",
      rawValue: "true",
      excerpt: "1200",
    }, ctx);
    expect(caseScoped.ok).toBe(false);

    const lotScoped = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "lot",
      lotId: "lot-1",
      field: "lot.in_scope",
      rawValue: "true",
      excerpt: "1200",
    }, ctx);
    expect(lotScoped.ok).toBe(true);
  });

  it("refuse un lotId hors capture", () => {
    const ctx = ctxFrom([CLIENT_SOURCE], ["lot-1"]);
    const result = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "lot",
      lotId: "lot-unknown",
      field: "cargo.weight_kg",
      rawValue: "10",
      excerpt: "1200",
    }, ctx);
    expect(result.ok).toBe(false);
  });

  it("exige le scope dossier pour cancel_request/resume_request/accept_quote/reject_quote", () => {
    const ctx = ctxFrom([CLIENT_SOURCE], ["lot-1"], ["qv-1"]);
    const badCancel = buildAssertion({
      sourceId: "src-1",
      operation: "cancel_request",
      scopeKind: "lot",
      lotId: "lot-1",
      excerpt: "1200",
    }, ctx);
    expect(badCancel.ok).toBe(false);

    const goodCancel = buildAssertion({
      sourceId: "src-1",
      operation: "cancel_request",
      scopeKind: "case",
      excerpt: "1200",
    }, ctx);
    expect(goodCancel.ok).toBe(true);
  });
});

describe("buildAssertion — types de valeur", () => {
  const numberCtx = ctxFrom();

  it("parse un nombre décimal avec point ou virgule", () => {
    const withDot = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "cargo.volume_cbm",
      rawValue: "3.5",
      excerpt: "3.5 CBM",
    }, numberCtx);
    expect(withDot.ok).toBe(true);
    if (withDot.ok) expect(withDot.value).toMatchObject({ value: 3.5 });

    const withComma = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "cargo.weight_kg",
      rawValue: "1200,5",
      excerpt: "1200 kg",
    }, numberCtx);
    expect(withComma.ok).toBe(true);
    if (withComma.ok) expect(withComma.value).toMatchObject({ value: 1200.5 });
  });

  it("refuse notation exponentielle et séparateur de milliers", () => {
    for (const raw of ["1e5", "1,000.5", "1 200", "-5", "abc", ""]) {
      const result = buildAssertion({
        sourceId: "src-1",
        operation: "set",
        scopeKind: "case",
        field: "cargo.weight_kg",
        rawValue: raw,
        excerpt: "1200 kg",
      }, numberCtx);
      expect(result.ok, `raw=${raw}`).toBe(false);
    }
  });

  it("exige un entier positif pour cargo.pieces_count", () => {
    const bad = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "cargo.pieces_count",
      rawValue: "3.5",
      excerpt: "1200 kg",
    }, numberCtx);
    expect(bad.ok).toBe(false);

    const good = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "cargo.pieces_count",
      rawValue: "42",
      excerpt: "1200 kg",
    }, numberCtx);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value).toMatchObject({ value: 42 });
  });

  it("exige un booléen strict pour les champs service.*", () => {
    const bad = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "service.TRUCKING",
      rawValue: "yes",
      excerpt: "1200 kg",
    }, numberCtx);
    expect(bad.ok).toBe(false);

    const good = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "service.TRUCKING",
      rawValue: "true",
      excerpt: "1200 kg",
    }, numberCtx);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value).toMatchObject({ value: true });
  });

  it("exige une valeur d'enum fermée pour routing.incoterm", () => {
    const bad = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "routing.incoterm",
      rawValue: "TOTALLY_MADE_UP",
      excerpt: "1200 kg",
    }, numberCtx);
    expect(bad.ok).toBe(false);

    const good = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "routing.incoterm",
      rawValue: "FOB",
      excerpt: "1200 kg",
    }, numberCtx);
    expect(good.ok).toBe(true);
  });
});

describe("buildAssertion — extrait verbatim", () => {
  const ctx = ctxFrom();

  it("refuse un extrait absent du texte capturé", () => {
    const result = buildAssertion({
      sourceId: "src-1",
      operation: "acknowledge",
      scopeKind: "case",
      excerpt: "texte qui n'existe pas dans la source",
    }, ctx);
    expect(result.ok).toBe(false);
  });

  it("refuse un extrait vide ou trop long", () => {
    const empty = buildAssertion({
      sourceId: "src-1",
      operation: "acknowledge",
      scopeKind: "case",
      excerpt: "   ",
    }, ctx);
    expect(empty.ok).toBe(false);

    const tooLong = buildAssertion({
      sourceId: "src-1",
      operation: "acknowledge",
      scopeKind: "case",
      excerpt: "a".repeat(2001),
    }, ctx);
    expect(tooLong.ok).toBe(false);
  });

  it("accepte un extrait présent exactement", () => {
    const result = buildAssertion({
      sourceId: "src-1",
      operation: "acknowledge",
      scopeKind: "case",
      excerpt: "Le poids est de 1200 kg",
    }, ctx);
    expect(result.ok).toBe(true);
  });
});

describe("buildAssertion — versions de devis", () => {
  it("refuse une version de devis hors capture", () => {
    const ctx = ctxFrom([CLIENT_SOURCE], [], ["qv-1"]);
    const result = buildAssertion({
      sourceId: "src-1",
      operation: "accept_quote",
      scopeKind: "case",
      quotationVersionId: "qv-unknown",
      excerpt: "1200 kg",
    }, ctx);
    expect(result.ok).toBe(false);
  });

  it("accepte une version de devis appartenant à la capture", () => {
    const ctx = ctxFrom([CLIENT_SOURCE], [], ["qv-1"]);
    const result = buildAssertion({
      sourceId: "src-1",
      operation: "accept_quote",
      scopeKind: "case",
      quotationVersionId: "qv-1",
      excerpt: "1200 kg",
    }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(
        ["excerpt", "id", "operation", "quotationVersionId", "scope", "sourceId"].sort(),
      );
    }
  });
});

describe("vocabulaire des champs — aucune clé monétaire", () => {
  it("les 17 champs fermés ne contiennent aucune clé pricing/money", () => {
    expect(ASSERTION_FIELD_KEYS).toHaveLength(17);
    for (const key of ASSERTION_FIELD_KEYS) {
      expect(key.toLowerCase()).not.toMatch(/price|tariff|cost|money|rate|amount/);
    }
  });
});

describe("brouillon — doublons et limite", () => {
  const ctx = ctxFrom();
  function makeAssertion(excerpt: string) {
    const result = buildAssertion({
      sourceId: "src-1",
      operation: "acknowledge",
      scopeKind: "case",
      excerpt,
    }, ctx);
    if (result.ok === false) throw new Error("fixture invalide");
    return result.value;
  }

  it("refuse un doublon structurel exact (hors id)", () => {
    const a = makeAssertion("Le poids est de 1200 kg");
    const b = makeAssertion("Le poids est de 1200 kg");
    expect(a.id).not.toBe(b.id);
    expect(isDuplicateAssertion([a], b)).toBe(true);
    const added = addAssertion([a], b);
    expect(added.ok).toBe(false);
  });

  it("n'est pas un doublon si l'extrait diffère", () => {
    const a = makeAssertion("Le poids est de 1200 kg");
    const b = makeAssertion("3.5 CBM");
    expect(isDuplicateAssertion([a], b)).toBe(false);
  });

  it("refuse d'ajouter au-delà de la limite de brouillon", () => {
    let draft: ReturnType<typeof makeAssertion>[] = [];
    for (let i = 0; i < MAX_DRAFT_ASSERTIONS; i++) {
      const a = buildAssertion({
        sourceId: "src-1",
        operation: "acknowledge",
        scopeKind: "case",
        excerpt: "1200 kg",
      }, ctx);
      if (a.ok === false) throw new Error("fixture invalide");
      // Force distinct signatures by using scope alternation is not possible here;
      // exercise the limit directly against the addAssertion() gate instead.
      draft = draft.length < MAX_DRAFT_ASSERTIONS ? [...draft, { ...a.value, id: `id-${i}`, excerpt: `1200 kg ${i}` }] : draft;
    }
    expect(draft).toHaveLength(MAX_DRAFT_ASSERTIONS);
    const overflowResult = addAssertion(draft, makeAssertion("Le poids est de 1200 kg"));
    expect(overflowResult.ok).toBe(false);
  });

  it("retire une assertion par id", () => {
    const a = makeAssertion("Le poids est de 1200 kg");
    const b = makeAssertion("3.5 CBM");
    const removed = removeAssertion([a, b], a.id);
    expect(removed).toEqual([b]);
  });
});

describe("describeAssertion", () => {
  it("produit un résumé lisible sans clé monétaire", () => {
    const ctx = ctxFrom();
    const result = buildAssertion({
      sourceId: "src-1",
      operation: "set",
      scopeKind: "case",
      field: "cargo.weight_kg",
      rawValue: "1200",
      excerpt: "Le poids est de 1200 kg",
    }, ctx);
    if (result.ok === false) throw new Error("fixture invalide");
    expect(describeAssertion(result.value)).toContain("cargo.weight_kg");
    expect(describeAssertion(result.value)).toContain("1200");
  });
});

describe("loadDraftFromRevisionAssertions — fail-closed", () => {
  it("recharge des assertions valides pour la capture courante", () => {
    const ctx = ctxFrom();
    const raw = [
      {
        id: "loaded-1",
        sourceId: "src-1",
        scope: "case",
        operation: "set",
        field: "cargo.weight_kg",
        value: 1200,
        excerpt: "Le poids est de 1200 kg",
      },
    ];
    const loaded = loadDraftFromRevisionAssertions(raw, ctx);
    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(1);
  });

  it("rejette entièrement le chargement si une assertion référence une source non éligible", () => {
    const ctx = ctxFrom();
    const raw = [
      {
        id: "loaded-1",
        sourceId: "src-unknown",
        scope: "case",
        operation: "acknowledge",
        excerpt: "1200 kg",
      },
    ];
    expect(loadDraftFromRevisionAssertions(raw, ctx)).toBeNull();
  });

  it("rejette une entrée qui n'est pas un tableau", () => {
    expect(loadDraftFromRevisionAssertions(undefined, ctxFrom())).toBeNull();
    expect(loadDraftFromRevisionAssertions({}, ctxFrom())).toBeNull();
  });

  it("rejette un extrait non verbatim dans les assertions chargées", () => {
    const ctx = ctxFrom();
    const raw = [
      {
        id: "loaded-1",
        sourceId: "src-1",
        scope: "case",
        operation: "acknowledge",
        excerpt: "texte absent",
      },
    ];
    expect(loadDraftFromRevisionAssertions(raw, ctx)).toBeNull();
  });

  it("rejette les doublons structurels au lieu de les dédupliquer silencieusement", () => {
    const base = {
      sourceId: "src-1",
      scope: "case",
      operation: "acknowledge",
      excerpt: "1200 kg",
    };
    expect(loadDraftFromRevisionAssertions([
      { ...base, id: "loaded-1" },
      { ...base, id: "loaded-2" },
    ], ctxFrom())).toBeNull();
  });

  it("rejette un identifiant dupliqué même si le contenu diffère", () => {
    expect(loadDraftFromRevisionAssertions([
      {
        id: "loaded-1",
        sourceId: "src-1",
        scope: "case",
        operation: "acknowledge",
        excerpt: "1200 kg",
      },
      {
        id: "loaded-1",
        sourceId: "src-1",
        scope: "case",
        operation: "acknowledge",
        excerpt: "3.5 CBM",
      },
    ], ctxFrom())).toBeNull();
  });
});
