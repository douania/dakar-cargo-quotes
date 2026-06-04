## Mission

CASEVIEW-PRICING-GATE-UNIFICATION-1-RUNTIME-SMOKE — vérifier en preview que la CTA "Lancer le pricing" n'apparaît plus prématurément après le patch d'unification de la gate, sur les 3 composants concernés (`ReadyActionsPanel`, `NextActionBanner`, `PricingLaunchPanel`).

## Mode

Plan / read-only. Aucun patch, aucune migration, aucun deploy, aucun write DB, aucun edge function change. Uniquement SELECT pour identifier les fixtures + navigation browser preview pour observation visuelle.

## Pré-analyse statique du code (déjà faite)

| Composant | Règle pertinente | Référence |
|---|---|---|
| `ReadyActionsPanel.tsx` | `launch_pricing` poussé **uniquement si** `status === "ACK_READY_FOR_PRICING"` ET pas de blocking gaps | L438 |
| `ReadyActionsPanel.tsx` | `create_version` poussé si `!hasSelectedVersion && !statusBelow(status,"PRICED_DRAFT")` | L453 |
| `NextActionBanner.tsx` | `"Lancer le pricing"` retourné **uniquement si** `status === "ACK_READY_FOR_PRICING"` | L152-167 |
| `NextActionBanner.tsx` | `"Débloquer le pricing"` retourné si `status === "DECISIONS_COMPLETE"` | L142-149 |
| `CaseView.tsx` | `PricingLaunchPanel` monté **uniquement si** status ∈ `[ACK_READY_FOR_PRICING, PRICED_DRAFT, HUMAN_REVIEW]` **ou** `canProvisionalDdp` | L1963-1965 |
| `CaseView.tsx` | `isRerun=true` si status ∈ `[PRICED_DRAFT, HUMAN_REVIEW]` | L1976 |

Le code en `src/` est conforme à l'unification attendue. Le commit runtime exact `471f588…` reste `NOT_VERIFIABLE_FROM_LOVABLE` (Lovable n'expose pas le SHA déployé en preview).

## Inventaire fixtures (SELECT déjà exécuté)

| status | count |
|---|---|
| READY_TO_PRICE | 3 |
| DECISIONS_PENDING | 1 |
| PRICED_DRAFT | 17 |
| DECISIONS_COMPLETE | **0** |
| ACK_READY_FOR_PRICING | **0** |

→ Statuts 4 (DECISIONS_COMPLETE) et 5 (ACK_READY_FOR_PRICING) seront marqués `NOT_TESTED_NO_FIXTURE` avec preuve SQL ci-dessus.

## Étapes du smoke

1. SELECT 1 case_id par statut testable (READY_TO_PRICE, DECISIONS_PENDING, PRICED_DRAFT sans `is_selected` version).
2. Pour chaque case : SELECT `quote_gaps` open + `quotation_versions` + `quote_facts` (service.package, routing.incoterm, cargo.value) pour déterminer la branche `canProvisionalDdp`.
3. `navigate_to_sandbox` → `/case/<case_id>` pour chacun des 3 cas.
4. `observe` + `screenshot` ciblés sur :
   - bloc `NextActionBanner` (Card en haut)
   - bloc `ReadyActionsPanel` ("Actions à exécuter")
   - section `#section-pricing` (présence/absence de `PricingLaunchPanel`)
5. Consigner pour chaque case : libellé exact de la Badge "Action prioritaire", liste des cards du panel, présence/absence de la card "Lancer le pricing" / "Créer la version du devis" / "Débloquer le pricing", mount/non-mount du PricingLaunchPanel, flag `canProvisionalDdp` déduit.

## Critères de PASS/FAIL appliqués

- FAIL si NextActionBanner affiche "Lancer le pricing" pour READY_TO_PRICE ou DECISIONS_PENDING.
- FAIL si PricingLaunchPanel monté pour READY_TO_PRICE sans exception `canProvisionalDdp`.
- FAIL si PRICED_DRAFT sans version sélectionnée n'affiche plus "Créer la version du devis".
- FAIL si DECISIONS_COMPLETE affiche "Lancer le pricing" au lieu de "Débloquer le pricing" (non testable — no fixture).

## Livrable

Tableau final :

```
status | case_id | commit | ReadyActionsPanel | NextActionBanner | PricingLaunchPanel | canProvisionalDdp | expected | verdict | anomaly
```

Plus un rapport synthétique distinguant PASS / FAIL / NOT_TESTED_NO_FIXTURE / CAN_PROVISIONAL_DDP_EXCEPTION et la note "commit runtime = NOT_VERIFIABLE_FROM_LOVABLE".

## Garde-fous

Arrêt immédiat si une étape requiert : patch, fichier modifié, migration, RLS change, deploy, edge function change, ou écriture DB. Le browser n'est utilisé qu'en observation (`observe`, `screenshot`, navigation) — aucun `act` mutant.
