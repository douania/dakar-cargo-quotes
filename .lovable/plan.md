
# HS10-AUTO-INJECTION-GUARD — Phase 2 plan chirurgical (Option C) — v3 FINAL

**Statut** : GO CTO conditionnel reçu sur v2. v3 intègre la **micro-réserve criticité gap** demandée. Patch backend isolé, exécution autorisée après ce plan.

---

## 1. Périmètre strict (inchangé v2)

**Fichier modifié, unique** : `supabase/functions/build-case-puzzle/index.ts`.

**Interdictions absolues** :
- ❌ `docs/DEFERRED_BACKLOG.md` (lot documentation séparé après Phase 3)
- ❌ Aucune modification memory dans ce lot
- ❌ `run-pricing`, `quotation-engine`, PAD-NST, Railway
- ❌ Toute migration SQL (la table `hs_codes` est lue seulement)
- ❌ `src/`, `config.toml`
- ❌ Aucune création d'`event_type` libre
- ❌ Aucune modification de `resolveSenegalHsCode`, `isExactHsMatch`, `extractHsCodesFromTextDetailed`, `MANUAL_PROTECTED_SOURCES`, `handleSubTenHsSuggestion` (sauf commentaire)
- ❌ Aucune modification de la logique sub-10 chiffres
- ❌ Aucun déploiement avant exécution complète du diff

---

## 2. Critères Option C (inchangés v2)

Auto-write `cargo.hs_code` autorisé **si tous** :

1. `sourceLen === 10`
2. `resolveSenegalHsCode === "unique"`
3. Cohérence cross-source : `uniqueCodes.length === 1`
4. **Taux DD/TVA SH6 complets et non divergents** :
   - `candidatesCount > 0`
   - `distinctRates.length === 1`
   - `dd !== null` ET `tva !== null`
5. **Source labellisée HS** :
   - `hs_label` → ✅
   - `code_douanier` → ✅
   - `parenthesized` → ✅ uniquement si `sourceExcerpt` matche `/\b(cargo|description|marchandise|goods|commodity|hs|hscode)\b/i`
   - `iso_10digit`, `cargo_line` → ❌

---

## 3. NOUVEAU v3 — Micro-réserve criticité gap (fix CTO #5)

Quand la garde bloque l'auto-write, le GAP `cargo.hs_code` doit **respecter la criticité existante du dossier**, sans la durcir.

### 3.1 Helper `assessHsCodeGapBlocking`

```ts
// Phase 2 HS10-AUTO-INJECTION-GUARD v3 : criticité gap respectée.
// Si le dossier est DDP ou customs-dependent, un gap cargo.hs_code peut être bloquant.
// Sinon, par défaut non bloquant pour éviter d'élargir le scope.
async function assessHsCodeGapBlocking(
  serviceClient: any,
  case_id: string,
): Promise<{ is_blocking: boolean; reason: string }> {
  try {
    const { data: facts } = await serviceClient
      .from("quote_facts")
      .select("fact_key, value_text")
      .eq("case_id", case_id)
      .eq("is_current", true)
      .in("fact_key", ["incoterm", "customs.regime", "service.scope"]);

    const factMap = new Map<string, string | null>();
    for (const f of facts ?? []) factMap.set(f.fact_key, f.value_text ?? null);

    const incoterm = (factMap.get("incoterm") ?? "").toUpperCase();
    const regime = (factMap.get("customs.regime") ?? "").toUpperCase();
    const scope = (factMap.get("service.scope") ?? "").toUpperCase();

    // Critère criticité : DDP ou régime douanier explicite ou scope customs
    if (incoterm === "DDP") {
      return { is_blocking: true, reason: "incoterm=DDP" };
    }
    if (regime && regime !== "NONE" && regime !== "") {
      return { is_blocking: true, reason: `customs_regime=${regime}` };
    }
    if (scope.includes("CUSTOMS") || scope.includes("DOUANE")) {
      return { is_blocking: true, reason: `scope_customs_dependent` };
    }
    return { is_blocking: false, reason: "no_criticality_signal" };
  } catch (err) {
    console.warn(`[hs10-guard] assessHsCodeGapBlocking failed, defaulting non-blocking: ${err}`);
    return { is_blocking: false, reason: "fallback_safe_default" };
  }
}
```

### 3.2 Usage dans les paths bloqués

Remplacer dans 4.1 et 4.3 le `is_blocking: false` codé en dur par :

```ts
const gapCriticality = await assessHsCodeGapBlocking(serviceClient, case_id);
await ensureHsCodeGap(serviceClient, {
  case_id,
  is_blocking: gapCriticality.is_blocking,
  question_fr: `HS10 ${match.code10} détecté mais garde Option C : ${guard.reason}. Validation opérateur requise (criticité: ${gapCriticality.reason}).`,
  question_en: `HS10 ${match.code10} detected but Option C guard: ${guard.reason}. Operator validation required (criticality: ${gapCriticality.reason}).`,
});
```

> **Note** : si les fact_keys `incoterm`, `customs.regime`, `service.scope` ne sont pas exactement ceux utilisés dans le projet, **vérification en lecture obligatoire avant patch** (rg sur `fact_key.*incoterm` dans `build-case-puzzle/index.ts`). Ajustement ≤2 lignes au mapping si nécessaire. Pas de nouvelle fact_key.

---

## 4. Helpers Option C (inchangés v2 sauf §3.1 ajouté)

### 4.1 `checkSh6RateDivergence` — voir v2 §3.1
### 4.2 `isLabeledHsContext` — voir v2 §3.2
### 4.3 `hs10AutoInjectionGuardAllows` — voir v2 §3.3
### 4.4 `emitHs10AutoInjectionTrace` — voir v2 §3.4
### 4.5 `assessHsCodeGapBlocking` — voir §3.1 ci-dessus

---

## 5. Modifications dans les paths

### 5.1 Path A — M3.4b doc-regex mono (L3252-3280)

```ts
const match = resolvedCandidates.find(r => r.code10 === uniqueCodes[0])!;
const guard = await hs10AutoInjectionGuardAllows(serviceClient, {
  code10: match.code10,
  source_context: match.source_context,
  source_excerpt: match.source_excerpt,
});
if (!guard.allowed) {
  console.warn(`[HS doc-regex] Auto-injection BLOCKED Option C: ${guard.reason} (sh6=${guard.sh6})`);
  await handleSubTenHsSuggestion(serviceClient, {
    case_id,
    source_digits: match.code10,
    source_context: match.source_context,
    origin: "document_regex",
    source_label: match.file,
    cargoDescription: cargoDescDoc,
    sourceExcerpt: match.source_excerpt,
    clientName: hsRankingClientName,
    documentSource: match.file,
  });
  // v3 : criticité gap respectée
  const gapCriticality = await assessHsCodeGapBlocking(serviceClient, case_id);
  await ensureHsCodeGap(serviceClient, {
    case_id,
    is_blocking: gapCriticality.is_blocking,
    question_fr: `HS10 ${match.code10} détecté mais garde Option C : ${guard.reason} (criticité: ${gapCriticality.reason}).`,
    question_en: `HS10 ${match.code10} detected but Option C guard: ${guard.reason} (criticality: ${gapCriticality.reason}).`,
  });
} else {
  // supersede_fact existant inchangé
  await emitHs10AutoInjectionTrace(serviceClient, {
    case_id, code10: match.code10, sh6: guard.sh6,
    origin: "document_regex", source_label: match.file,
    confidence: 0.95, distinct_rates_count: guard.distinctRatesCount,
  });
}
```

> **Pré-requis** : `resolvedCandidates` doit porter `source_context` et `source_excerpt`. Vérification en lecture avant patch ; mapping local ≤4 lignes si absent.

### 5.2 Path A bis — M3.4b multi-CSV (L3281-3316)

Suppression écriture CSV multi (critère 3 incompatible). Bascule N suggestions + GAP avec criticité (§3.1).

### 5.3 Path B — M3.4c email-regex (L3410-3475)

Symétrique 5.1 + 5.2. `confidence=0.92`, `origin="email_regex"`.

### 5.4 Path C — Post-Attach (L3987-4005)

**Inchangé.** Commentaire justificatif au-dessus de L3989 :

```ts
// Phase 2 HS10-AUTO-INJECTION-GUARD : Path C inchangé.
// Re-validation d'un cargo.hs_code déjà présent (manuel ou écrit par M3.4b/c sous garde Option C).
// La garde Option C s'applique uniquement aux paths d'écriture initiale (M3.4b/c),
// pas à la re-validation Post-Attach qui ne crée pas de nouveau fact.
```

### 5.5 Commentaire fix #4 sur `handleSubTenHsSuggestion` (L850)

```ts
// NOTE Phase 2 HS10-AUTO-INJECTION-GUARD : ce helper est réutilisé comme mécanisme
// générique de suggestion HS10 trace quand l'auto-write est bloqué par la garde Option C,
// même si source_digits contient déjà 10 chiffres. Il ne doit JAMAIS écrire cargo.hs_code
// (cf. corps de la fonction : seulement event HS10_CLASSIFICATION_SUGGESTION + GAP).
// Renommage différé pour éviter un refactor inutile.
```

---

## 6. Diff prévisionnel

| Fichier | + lignes | – lignes | Sites |
|---|---|---|---|
| `supabase/functions/build-case-puzzle/index.ts` | ~165 | ~25 | 5 helpers (près de L485) + commentaires L850 + L3989 + 4 sites de modification |

**Aucun autre fichier modifié dans ce lot.**

---

## 7. Vérifications post-patch (Phase 3, hors ce lot)

### 7.1 Requête DB préalable Test B `31efcc01`

```sql
SELECT DISTINCT dd, tva, COUNT(*) AS n
FROM hs_codes
WHERE code_normalized LIKE '440311%'
GROUP BY dd, tva
ORDER BY n DESC;
```

- 1 ligne, dd/tva non null → garde laisse passer
- ≥2 lignes ou null → garde bloque, suggestion + GAP (criticité évaluée)

### 7.2 Tests Phase 3

| Test | Cible | Attendu |
|---|---|---|
| T-C1 | `31efcc01` HS10 unique labellisé | Selon §7.1 |
| T-C2 | 2 HS10 distincts | N suggestions, pas de CSV |
| T-C3 | HS10 contexte `iso_10digit`/`cargo_line` | Suggestion (fix #1) |
| T-C4 | SH6 `dd=NULL` ou `tva=NULL` | Suggestion (fix #2) |
| T-C5 | Idempotence T-C1 | Skip insert |
| **T-C6** | **Dossier DDP HS10 bloqué** | **GAP `is_blocking=true`** (fix #5) |
| **T-C7** | **Dossier non-DDP HS10 bloqué** | **GAP `is_blocking=false`** (fix #5) |

---

## 8. Risques résiduels et mitigations

| Risque | Probabilité | Mitigation |
|---|---|---|
| `resolvedCandidates` ne porte pas `source_context`/`source_excerpt` | Moyenne | Vérification en lecture avant patch |
| Fact keys criticité incorrects | Faible | Try/catch → fallback non-blocking ; vérif rg avant patch |
| Régression `PRICED_DRAFT` pré-patch | Faible | `document_regex` non protégé → re-évaluation. No-op si critères OK. **Aucun pricing rétroactif.** |
| Coût DB +1-2 queries par HS10 | Très faible | LIMIT 200 + 1 select facts indexé |

---

## 9. Livrables Phase 2 (ce lot)

1. **Diff `supabase/functions/build-case-puzzle/index.ts` uniquement** : 5 helpers + 2 commentaires + 4 sites.
2. Diff réel envoyé au CTO après exécution (règle projet).
3. Résultat de la requête §7.1 documenté dans le message de livraison.

**Pas de mise à jour `DEFERRED_BACKLOG.md` ni memory dans ce lot.**

---

## 10. GO CTO

Plan v3 prêt à exécution. Sortie en mode build pour livrer le diff complet, puis envoi du diff réel au CTO conformément à la règle projet.
