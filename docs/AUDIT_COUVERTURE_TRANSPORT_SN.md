# Audit couverture transport local — Sénégal

**Date :** 2026-04-25 (initial) / 2026-05-02 (post-quarantaine LOT2-REV-A)  
**Source :** `local_transport_rates` (snapshot post-quarantaine Aksa)  
**Total lignes actives :** 10 (81 Aksa quarantinées → `is_active=false`, `evidence_level='historical_only'`)  
**Total lignes inactives (quarantaine) :** 81

---

## 1. Synthèse par client_code × evidence_level

| client_code   | evidence_level    | lignes | usage |
|---------------|-------------------|-------:|-------|
| `AKSA_ENERGY` | `client_override` | 81 | servi uniquement si `pricingCtx.client_code = 'AKSA_ENERGY'` |
| `NULL` (générique) | `to_confirm` | 10 | **JAMAIS servi comme tarif** (resolver skip → fallback `TO_CONFIRM`) |

---

## 2. Couverture destinations Aksa (26)

SOKONE, ZIGUINCHOR (VIA TAMBA), BIGNONA, MBOUR, FORFAIT ZONE 2 (SEIKHOTANE/POUT), THIAYES, JOAL, Chaux, KAOLACK, TAMBACOUNDA, DAGANA/MAKA, DIOURBEL, RICHARD TOLL, ZIGUINCHOR, MBACKE, KAFFRINE, TIVAOUANE, NIORO/Saint Louis, FORFAIT ZONE 1 <18km, LOUGA/TOUBA, BAMBEY/TAYBA, MECKHE, CAP SKIRING, KEBEMER/FATICK, PODOR, THIES/POPONGUINE.

→ **Couverture client-spécifique exclusive Aksa** (aucun autre client n'a de barème dédié dans la base).

## 3. Destinations couvertes uniquement par lignes génériques `to_confirm` (5)

VELINGARA / GOUDIRI, KOLDA / MATAM, KEDOUGOU, ROSSO / NIOKOLOKO, KIDIRA / BISSAU.

→ Pour ces destinations, **tout client (y compris Aksa)** déclenche `TO_CONFIRM` car les barèmes existants ne sont pas validés.

## 4. Gap explicite

- **Aucun barème générique validé (`evidence_level ∈ ('official','sodatra_grid')`)** n'existe en base pour les 26 destinations Aksa, **ni** pour les 5 destinations génériques.
- Conséquence : tout client non-Aksa demandant une livraison upcountry produira systématiquement un `TO_CONFIRM` opérateur (comportement attendu jusqu'à mise en place d'une grille générique validée — sujet **DEFERRED**).
- Sujet à promouvoir au backlog si une grille SODATRA "transport local générique Sénégal" est souhaitée à terme.

## 5. Ce que ce lot **ne fait pas** (par décision CTO)

- Ne promeut **pas** les 10 lignes génériques `to_confirm` en `official`.
- Ne crée **pas** de fallback générique Aksa pour les autres clients.
- Ne touche **pas** à `run-pricing`.
- Le cas `03ccf66d` (Kolda, sans `client.code`) basculera de "tarif servi via lignes `to_confirm`" → "TO_CONFIRM explicite" : **correction honnête**, pas régression.

---

## 6. Recommandation pour suite (hors Lot 2)

Créer une grille SODATRA générique transport local Sénégal validée, à insérer avec :
- `client_code = NULL`
- `evidence_level = 'sodatra_grid'` (à introduire ou aligner sur valeur officielle)
- `provider = 'SODATRA'` ou équivalent

→ À enregistrer dans `docs/DEFERRED_BACKLOG.md` (catégorie : pricing-data).
