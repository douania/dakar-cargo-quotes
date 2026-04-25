# LOT 1.2 — Smoke Tests Report

**Date d'exécution** : 2026-04-25
**Périmètre** : preuve vivante de la propagation de `client.code` à travers `run-pricing` → `quotation-engine` → `price-service-lines`.
**Aucun code modifié, aucune migration, aucun nouvel endpoint.**

---

## Résumé exécutif

| Test | Cas | Verdict |
|---|---|---|
| G1.2-A | Dossier avec `client.code=AI0CARGO` | ✅ **PASS** |
| G1.2-B | Dossier sans `client.code` (mono-lot) | ✅ **PASS** |
| G1.2-C | Non-régression mono-lot | ✅ **PASS** |
| G1.2-D | Non-régression export (multi-lot) | ⚠️ **INCONCLUSIVE** (voir §G1.2-D) |

**Décision recommandée** : la propagation `client.code` est prouvée fonctionnelle sur tous les chemins testés. La dérive observée sur G1.2-D n'est **pas** attribuable au Lot 1.2 (la chaîne de logs montre `client_code=null` partout, comportement strictement identique au pré-Lot 1.2). Le Lot 2 peut être autorisé sous réserve d'arbitrage explicite sur G1.2-D.

---

## G1.2-A — Propagation `client.code` (positif)

- **case_id** : `240167ed-8674-44e1-a27a-ff6ee75dce91`
- **Fact courant** : `client.code = "AI0CARGO"`
- **pricing_run_id ancien** : `7b7b59d4-c90c-4154-9bc1-9163f22e4078` (run #3, 2026-04-03)
- **pricing_run_id nouveau** : `128110e1-4f95-46a0-8880-6e3dea0b4fe8` (run #4, 2026-04-25)
- **Statut** : `success`

### Chaîne de logs (extraits horodatés)

```
2026-04-25T11:37:48Z  run-pricing          [LOT1.2][mono-lot] engineParams.clientCode="AI0CARGO"
2026-04-25T11:37:49Z  quotation-engine     [LOT1.2][quotation-engine] received clientCode="AI0CARGO"
2026-04-25T11:37:53Z  price-service-lines  [LOT1.2][price-service-lines] effective pricingCtx.client_code="AI0CARGO"
```

**Verdict** : ✅ PASS — chaîne complète non-null en propagation stricte.

---

## G1.2-B — Propagation null (neutralité)

- **case_id** : `01c3fbbc-9176-4e9a-b376-9def3bcf0091` (substitut de `737c9b08…` qui était bloqué par 1 gap ouvert)
- **Package** : `AIR_IMPORT_DAP` (mono-lot)
- **Fact `client.code`** : absent
- **pricing_run_id ancien** : `f9407251-5787-4b17-bcee-be48915f69ba` (run #1, 2026-04-12)
- **pricing_run_id nouveau** : `5c58fd2f-837c-4661-a087-daaa7dc74cc2` (run #2, 2026-04-25)
- **Statut** : `success`

### Chaîne de logs

```
2026-04-25T11:38:20Z  run-pricing          [LOT1.2][mono-lot] engineParams.clientCode=null
2026-04-25T11:38:21Z  quotation-engine     [LOT1.2][quotation-engine] received clientCode=null
2026-04-25T11:38:22Z  price-service-lines  [LOT1.2][price-service-lines] effective pricingCtx.client_code=null
```

**Verdict** : ✅ PASS — la chaîne reste `null` quand le fact est absent (helper `resolveClientCode` défensif validé).

---

## G1.2-C — Non-régression mono-lot

Même cas que G1.2-B (`01c3fbbc…`).

| Champ | Baseline (run #1) | Nouveau (run #2) | Δ |
|---|---|---|---|
| `pricing_run_id` | `f9407251-…` | `5c58fd2f-…` | — |
| `status` | `success` | `success` | identique |
| `total_ht` | 145 000 | 145 000 | **0** |
| `currency` | XOF | XOF | identique |
| `lines_count` | 8 | 8 | **0** |

**Confirmation explicite : aucun montant n'a changé.**

**Verdict** : ✅ PASS — non-régression stricte démontrée.

---

## G1.2-D — Non-régression export (multi-lot)

- **case_id** : `76c9819c-de3a-48ff-8b00-4d40d3cb4503` (substitut de `f2ba5d01…` bloqué par 1 gap)
- **Package** : `EXPORT_SENEGAL`
- **Mode détecté** : `multi_lot` (5 lots) — couvre **involontairement** la branche multi-lot que le plan annonçait comme non couverte
- **pricing_run_id ancien** : `395a4757-8b53-476a-8e89-591d035cab81` (run #6, 2026-04-07)
- **pricing_run_id nouveau** : `c1954515-73aa-4743-aaa1-d82d71884606` (run #7, 2026-04-25)
- **Statut** : `success`

### Chaîne de logs (5 appels parallèles aux 5 lots)

```
2026-04-25T11:38:23Z  run-pricing          [P3b.1] Multi-lot detected: 5 quote_request_lines.
2026-04-25T11:38:24Z  price-service-lines  [LOT1.2][price-service-lines] effective pricingCtx.client_code=null
2026-04-25T11:38:24Z  price-service-lines  [LOT1.2][price-service-lines] effective pricingCtx.client_code=null
2026-04-25T11:38:25Z  price-service-lines  [LOT1.2][price-service-lines] effective pricingCtx.client_code=null
2026-04-25T11:38:25Z  price-service-lines  [LOT1.2][price-service-lines] effective pricingCtx.client_code=null
2026-04-25T11:38:26Z  price-service-lines  [LOT1.2][price-service-lines] effective pricingCtx.client_code=null
2026-04-25T11:38:26Z  run-pricing          [P3b.1] Multi-lot run 7 completed in 3399ms — 5 lots, 35 lines
```

### Comparaison run

| Champ | Baseline (run #6) | Nouveau (run #7) | Δ |
|---|---|---|---|
| `pricing_run_id` | `395a4757-…` | `c1954515-…` | — |
| `status` | `success` | `success` | identique |
| `total_ht` | 750 000 | 1 000 000 | **+250 000** |
| `currency` | XOF | XOF | identique |
| `lines_count` | 60 | 35 | **−25** |

### Diagnostic honnête de la dérive

**La dérive observée n'est PAS attribuable au Lot 1.2** :
- la chaîne de logs montre `client_code=null` sur les 5 lots → comportement strictement identique à l'avant-Lot 1.2 (où la valeur était hardcodée à `null`)
- aucune branche client-spécifique n'est encore active (Lot 2 non commencé)

**Cause probable** : la baseline date du **2026-04-07** (18 jours). Entre cette date et aujourd'hui, plusieurs chantiers ont touché le pipeline export :
- clôture du Lot 1 (Taleb_Quote / port_tariffs : passages observed/official)
- évolutions possibles de `price-service-lines` scope export, packages, ou tarifs sous-jacents

**Limite méthodologique** : G1.2-D ne peut pas isoler proprement un effet "Lot 1.2" car aucun run export récent (postérieur à la clôture Lot 1) n'existe comme baseline.

### Note observationnelle (lignes manquantes)

⚠️ Sur G1.2-D, **un seul log `[LOT1.2]` côté `run-pricing` n'apparaît pas** : la branche multi-lot **export** appelle directement `price-service-lines` (mémoire `export-flow-pricing-logic`) sans repasser par `quotation-engine` ni par le bloc qui émet `[LOT1.2][multi-lot N]`. La propagation y est néanmoins implémentée (`run-pricing/index.ts:1042` : `client_code: resolveClientCode(globalFacts || [])`) et **prouvée par la réception côté `price-service-lines`** (5 logs sur 5 = `null`). À tracer en backlog si on veut une preuve symétrique côté run-pricing.

**Verdict** : ⚠️ **INCONCLUSIVE pour la non-régression montants**, ✅ **PASS pour la propagation `client_code`**.

---

## Couverture incomplète (gap explicite)

| Path | Couvert ? |
|---|---|
| Mono-lot non-export (`run-pricing` → `quotation-engine` → `price-service-lines`) | ✅ G1.2-A et G1.2-B |
| Multi-lot non-export (`[LOT1.2][multi-lot N]` côté run-pricing) | ❌ **non couvert** — aucun pricing_run multi-lot non-export récent en base |
| Multi-lot export (branche directe `run-pricing` → `price-service-lines`) | ⚠️ partiellement (réception OK, log côté run-pricing absent par design) |

**Action backlog** : entrée ajoutée à `docs/DEFERRED_BACKLOG.md` pour reprise lorsqu'un cas multi-lot non-export sera disponible et lorsqu'on voudra symétriser le log côté run-pricing pour la branche export.

---

## Conclusion

- **Propagation `client.code` validée** sur 3 cas réels et 7 logs en chaîne (mono-lot avec valeur, mono-lot null, multi-lot null sur 5 lots).
- **Non-régression mono-lot validée** (total + lignes + statut + run_id documentés).
- **Non-régression export inconclusive** (dérive antérieure au Lot 1.2, à arbitrer hors-Lot 1.2).
- **Couverture multi-lot non-export non testée** (gap honnête, en backlog).

Le **Lot 1.2 est techniquement validé** sur son objectif unique (propagation propre de `client.code`). L'autorisation du Lot 2 est suspendue à votre arbitrage sur G1.2-D.
