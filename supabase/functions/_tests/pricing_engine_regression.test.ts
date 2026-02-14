/**
 * Pricing Engine Regression Tests — Patch M3.4.1
 *
 * Contrat de régression pour la logique de répartition CAF
 * dans le moteur de cotation (quotation-engine).
 *
 * Exécution :
 *   deno test --allow-env supabase/functions/_tests/pricing_engine_regression.test.ts
 */

import {
  assertEquals,
  assertAlmostEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ─── Types ───────────────────────────────────────────────────────────

interface ArticleDetail {
  hs_code: string;
  value: number;
  currency: string;
}

interface CafDistributionResult {
  cafDistribution: number[];
  distributionMethod: "proportional" | "equal";
  warnings: string[];
}

// ─── Fonction pure extraite du moteur (lignes 2048-2087 + M3.4.1) ──

function convertArticleValueToFCFA(
  value: number,
  currency: string,
  warnings: string[],
): number {
  const cur = (currency || "XOF").toUpperCase();
  if (cur === "XOF" || cur === "FCFA" || cur === "CFA") return value;
  if (cur === "EUR") return value * 655.957;
  warnings.push(
    `Devise article non supportée (${cur}) — répartition CAF peut être inexacte`,
  );
  return value;
}

function computeCafDistribution(
  hsCodes: string[],
  cafTotal: number,
  articlesDetail?: ArticleDetail[],
): CafDistributionResult {
  const warnings: string[] = [];
  const cafDistribution: number[] = [];
  let distributionMethod: "proportional" | "equal" = "equal";

  if (articlesDetail && articlesDetail.length >= 2) {
    // Build detailMap with FCFA-converted values
    const detailMap = new Map<string, number>();
    for (const art of articlesDetail) {
      const normKey = art.hs_code.replace(/\D/g, "");
      const valueFCFA = convertArticleValueToFCFA(
        art.value,
        art.currency,
        warnings,
      );
      detailMap.set(normKey, (detailMap.get(normKey) || 0) + valueFCFA);
    }

    const totalEXW = Array.from(detailMap.values()).reduce(
      (sum, v) => sum + v,
      0,
    );

    if (totalEXW > 0) {
      // Coverage guard (P2): check how many requested HS are covered
      const coveredCount = hsCodes.filter((h) => {
        const hsNorm = h.replace(/\D/g, "");
        return (detailMap.get(hsNorm) || 0) > 0;
      }).length;

      if (coveredCount !== hsCodes.length) {
        warnings.push(
          `Détails articles incomplets : ${coveredCount}/${hsCodes.length} HS couverts — répartition équitable utilisée`,
        );
        for (const _ of hsCodes) {
          cafDistribution.push(cafTotal / hsCodes.length);
        }
        distributionMethod = "equal";
      } else {
        // Proportional distribution
        let distributedSum = 0;
        for (let i = 0; i < hsCodes.length; i++) {
          const hsNorm = hsCodes[i].replace(/\D/g, "");
          const exwValue = detailMap.get(hsNorm) || 0;
          if (i === hsCodes.length - 1) {
            cafDistribution.push(cafTotal - distributedSum);
          } else {
            const ratio = exwValue / totalEXW;
            const cafArticle = Math.round(cafTotal * ratio);
            cafDistribution.push(cafArticle);
            distributedSum += cafArticle;
          }
        }
        distributionMethod = "proportional";
      }
    }
  }

  // Fallback: equal distribution if nothing was computed
  if (cafDistribution.length === 0 || cafDistribution.length !== hsCodes.length) {
    cafDistribution.length = 0;
    for (const _ of hsCodes) {
      cafDistribution.push(cafTotal / hsCodes.length);
    }
    distributionMethod = "equal";
  }

  return { cafDistribution, distributionMethod, warnings };
}

// ─── Tests ───────────────────────────────────────────────────────────

Deno.test("T1 — Proportional 2 articles EUR", () => {
  const hsCodes = ["8504.40.00", "8537.10.00"];
  const cafTotal = 3053480; // FCFA
  const articles: ArticleDetail[] = [
    { hs_code: "8504.40.00", value: 165, currency: "EUR" },
    { hs_code: "8537.10.00", value: 3760, currency: "EUR" },
  ];

  const result = computeCafDistribution(hsCodes, cafTotal, articles);

  assertEquals(result.distributionMethod, "proportional");
  assertEquals(result.cafDistribution.length, 2);

  // article1 ratio = 165 / (165+3760) ≈ 4.205%
  const expectedRatio1 = 165 / (165 + 3760);
  const expected1 = Math.round(cafTotal * expectedRatio1);
  assertAlmostEquals(result.cafDistribution[0], expected1, 1);

  // article2 = remainder
  const expected2 = cafTotal - expected1;
  assertEquals(result.cafDistribution[1], expected2);

  // Sum must equal CAF exactly (no rounding drift)
  const sum = result.cafDistribution.reduce((a, b) => a + b, 0);
  assertEquals(sum, cafTotal);

  assertEquals(result.warnings.length, 0);
});

Deno.test("T2 — Equal fallback (no articlesDetail)", () => {
  const hsCodes = ["8504.40.00", "8537.10.00"];
  const cafTotal = 3053480;

  const result = computeCafDistribution(hsCodes, cafTotal, undefined);

  assertEquals(result.distributionMethod, "equal");
  assertEquals(result.cafDistribution.length, 2);
  assertEquals(result.cafDistribution[0], cafTotal / 2);
  assertEquals(result.cafDistribution[1], cafTotal / 2);

  const sum = result.cafDistribution.reduce((a, b) => a + b, 0);
  assertEquals(sum, cafTotal);
});

Deno.test("T3 — Single article gets full CAF", () => {
  const hsCodes = ["8504.40.00"];
  const cafTotal = 3053480;
  const articles: ArticleDetail[] = [
    { hs_code: "8504.40.00", value: 165, currency: "EUR" },
  ];

  // Single article → articlesDetail.length < 2 → fallback equal (1 HS = full)
  const result = computeCafDistribution(hsCodes, cafTotal, articles);

  assertEquals(result.cafDistribution.length, 1);
  assertEquals(result.cafDistribution[0], cafTotal);

  const sum = result.cafDistribution.reduce((a, b) => a + b, 0);
  assertEquals(sum, cafTotal);
});

Deno.test("T4 — Mismatch HS vs articles → equal + warning", () => {
  const hsCodes = ["8504.40.00", "8537.10.00"];
  const cafTotal = 3053480;
  // 3 articles but only 2 HS requested, and one HS in articles doesn't match
  const articles: ArticleDetail[] = [
    { hs_code: "8504.40.00", value: 165, currency: "EUR" },
    { hs_code: "9999.99.00", value: 500, currency: "EUR" }, // not in hsCodes
    { hs_code: "9999.99.00", value: 300, currency: "EUR" }, // not in hsCodes
  ];

  const result = computeCafDistribution(hsCodes, cafTotal, articles);

  assertEquals(result.distributionMethod, "equal");
  assertEquals(result.cafDistribution.length, 2);
  assertEquals(result.cafDistribution[0], cafTotal / 2);
  assertEquals(result.cafDistribution[1], cafTotal / 2);

  // Must have a coverage warning
  const hasWarning = result.warnings.some((w) =>
    w.includes("HS couverts")
  );
  assertEquals(hasWarning, true);

  const sum = result.cafDistribution.reduce((a, b) => a + b, 0);
  assertEquals(sum, cafTotal);
});

Deno.test("T5 — Mixed currencies EUR + XOF → conversion before ratio", () => {
  const hsCodes = ["8504.40.00", "8537.10.00"];
  const cafTotal = 2_000_000; // FCFA
  const articles: ArticleDetail[] = [
    { hs_code: "8504.40.00", value: 1000, currency: "EUR" },     // → 655957 FCFA
    { hs_code: "8537.10.00", value: 655957, currency: "XOF" },   // → 655957 FCFA
  ];

  const result = computeCafDistribution(hsCodes, cafTotal, articles);

  assertEquals(result.distributionMethod, "proportional");
  assertEquals(result.cafDistribution.length, 2);

  // Both articles have equal FCFA value → 50/50 split
  const expected1 = Math.round(cafTotal * 0.5);
  assertAlmostEquals(result.cafDistribution[0], expected1, 1);

  const sum = result.cafDistribution.reduce((a, b) => a + b, 0);
  assertEquals(sum, cafTotal);

  assertEquals(result.warnings.length, 0);
});
