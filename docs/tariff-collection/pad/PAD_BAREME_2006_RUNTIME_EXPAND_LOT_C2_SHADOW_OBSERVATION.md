# PAD-BAREME-2006-RUNTIME-EXPAND — Lot C.2 : Observation shadow

**Verdict :** `LOT_C2_BLOCKED_NO_LOGS`
**Branche :** `work`
**Date :** 2026-05-10
**Flag :** `PAD_RESOLVER_SHADOW` — **non activé** (aucun log `tag=PAD_SHADOW` observé)

---

## Périmètre observé

IMPORT / CONTENEUR uniquement. TRANSIT / TRANSBORDEMENT / TRANSSHIPMENT exclus (cf. Lot C v3.1).

Lecture seule. Aucun patch code, aucune migration, aucune écriture DB, aucun changement runtime applicatif.

## Méthode

1. Recherche `tag=PAD_SHADOW` dans les logs `run-pricing` via `supabase--edge_function_logs(function_name="run-pricing", search="PAD_SHADOW")`.
2. Résultat : **aucun log trouvé**.
3. Aucun `case_id` à analyser → aucune lecture DB de contextualisation effectuée (aucun `quote_facts` / `pricing_runs` interrogé). Conformément aux garde-fous du plan, aucune donnée n'est inventée.

## Données extraites depuis les logs PAD_SHADOW

| Champ | Valeur |
|---|---|
| Entrées PAD_SHADOW lues | **0** |

Aucune entrée à reporter. Tableau structuré (case_id, legacy.pad_category, legacy.source, legacy.alias_match_count, resolver.classification, resolver.source, resolver.confidence, resolver.blocking_gap, resolver.warnings, comparison.match, comparison.mismatch_reason) — non rempli faute de logs.

## Contexte dossier (lecture seule DB)

Non applicable : aucun `case_id` identifié dans les logs PAD_SHADOW, donc aucune lecture de contexte dossier effectuée.

## Synthèse

- Total entrées PAD_SHADOW lues : **0**
- Cas alias validé (`legacy.source=alias`) observés : 0
- Cas `operator_confirmed` observés : 0
- `comparison.match=true` : 0
- `comparison.match=false` : 0
- Mismatchs détaillés : aucun

## Mismatchs détaillés

Aucun (aucune donnée).

## Conclusion CTO

**Verdict : `LOT_C2_BLOCKED_NO_LOGS`.**

Cause : le secret `PAD_RESOLVER_SHADOW=true` n'a pas été activé en environnement contrôlé, ou bien aucun dossier IMPORT/CONTENEUR n'a été rejoué après activation. Le bloc shadow inséré au Lot C v3.1 est conditionné à `SHADOW_ON = (env === 'true')`. Tant que ce flag reste absent ou différent de `'true'`, aucun log `tag=PAD_SHADOW` n'est émis, ce qui est conforme à la décision prise au Lot C (OFF par défaut, activation manuelle uniquement).

Aucune progression n'est possible avant action opérateur. Le Lot D reste explicitement non instruit.

### Action opérateur requise pour débloquer C.2

1. Activer le secret `PAD_RESOLVER_SHADOW=true` dans Lovable Cloud (env contrôlé).
2. Rejouer **au moins un dossier IMPORT / CONTENEUR alias validé** (ex : `carreaux ceramiques` → T12, ou `riz en sacs` → T05). Optionnellement compléter avec un cas `operator_confirmed`.
3. Signaler à l'agent que les logs sont disponibles → relance Lot C.2 → mise à jour de ce rapport avec verdict `LOT_C2_SHADOW_OBSERVATION_READY` ou `LOT_C2_INSUFFICIENT_ALIAS_COVERAGE` selon la couverture observée.

## Interdictions respectées

- ✅ Aucun patch code
- ✅ Aucune migration
- ✅ Aucune écriture DB
- ✅ Aucun changement runtime applicatif
- ✅ Lecture seule (logs uniquement, pas de DB lue faute de case_id à contextualiser)
- ✅ Aucune donnée inventée (zéro entrée loggée → zéro ligne reportée)
- ✅ Aucune décision Lot D

## Hors scope (différé, ne pas trancher ici)

- Bascule resolver → source de vérité (Lot D)
- Élargissement EXPORT / TRANSIT / TRANSBORDEMENT / CONVENTIONNEL
- Ingestion HS-NST mappings, NST rules, AI suggestions
- `containerSizeToCxxMapping` pour T13
