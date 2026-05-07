# Synthèse tarifaire globale — Post-nettoyage LOT2 + LOT3-A + PAD-NOM-2

**Date :** 2026-05-07 (mise à jour PAD-NOM-2)  
**Date initiale :** 2026-05-02  
**Contexte :** après exécution de LOT2-REV-A/B/C (transport local), LOT3-A (quarantaine P0 minimale), et **PAD-NOM-2** (injection nomenclature officielle PAD 2006 : 324 alias, 9 catégories, 384 alias totaux).  
**Type de validation :** analytique (SELECT réels post-LOT3-A + post-checks PAD-NOM-2). Deux runs post-LOT3 existent et ont été inspectés analytiquement en base (0 contamination Aksa/Taleb). Cependant, aucun smoke runtime contrôlé n'a été déclenché spécifiquement dans le cadre de l'audit.  
**Périmètre :** les sources P0 identifiées dans LOT3-0 et traitées par LOT3-A ne peuvent plus sortir automatiquement en cotation client. Cette conclusion est limitée aux sources P0 identifiées ; elle ne constitue pas une garantie absolue sur toutes les futures sources.  
**Audit complet :** voir `docs/POST_CLEANING_QUOTE_ENGINE_AUDIT.md` — verdict GO conditionnel, risques R1–R4 documentés dans `docs/DEFERRED_BACKLOG.md`.  
**PAD-NOM-2 :** voir `docs/tariff-collection/pad/PAD_NOM2_EXECUTION_REPORT.md`.

---

## Section A — Ce qui est sécurisé / consommable par le moteur

Sources filtrées par `evidence_level IN ('official', 'validated_internal')` ET `is_active = true` dans les edge functions (`quotation-engine`, `price-service-lines`, `generate-response`).

| Table | Lignes actives consommables | Niveau de preuve | Filtre runtime vérifié |
|-------|----------------------------:|------------------|----------------------|
| `port_tariffs` (official) | 52 | `official` | ✅ `.in('evidence_level', ['official', 'validated_internal'])` dans quotation-engine, price-service-lines, generate-response |
| `port_tariffs` (validated_internal) | 19 | `validated_internal` | ✅ idem |
| `carrier_billing_templates` (validated_internal) | 23 | `validated_internal` | ✅ `.in('evidence_level', ['official', 'validated_internal'])` dans quotation-engine, generate-response |
| `demurrage_tiers` (official) | 33 | `official` | ✅ `.in('evidence_level', ['official', 'validated_internal'])` dans quotation-engine |
| `demurrage_rates` (active, carriers vérifiés) | 26 | Sources considérées vérifiées / à preuve documentaire identifiée (CMA CGM: 7, Hapag-Lloyd: 7, Maersk: 7, MSC: 5). Les 9 sources non vérifiées ont été désactivées par LOT3-A. | ✅ `is_active = true` (pas de colonne `evidence_level` sur cette table) |
| `tax_rates` | 8 | Barèmes UEMOA officiels | ✅ consommé directement |
| `pricing_service_catalogue` | 11 | Référentiel interne (5 confirmés + 6 placeholders `TO_CONFIRM` Lot 1-B) | ✅ logique `EXPORT_PLACEHOLDER_SERVICE_KEYS` active |
| `pricing_customs_tiers` | 12 | Référentiel douanier | ✅ non touché par LOT3-A |

---

## Section B — Ce qui reste en base mais filtré ou à confirmer

Sources actives en base (`is_active = true`) mais **filtrées par le runtime** via `evidence_level IN ('official', 'validated_internal')` — elles ne sont pas consommées automatiquement par les edge functions principales.

| Table | Lignes | evidence_level | Statut runtime | Action recommandée |
|-------|-------:|----------------|---------------|-------------------|
| `pricing_rate_cards` (to_confirm) | 35 | `to_confirm` (colonne `status`) | **Filtré** par `.eq("status", "active")` dans price-service-lines — 0 ligne servie | Nettoyer / documenter — en attente validation SODATRA (voir `VALIDATION_RATE_CARDS_AND_CATALOGUE.md`) |
| `local_transport_rates` (to_confirm) | 10 | `to_confirm` | **Filtré** par `.in('evidence_level', ['official', 'validated_internal'])` dans `quotation-engine` L1709 **ET** `price-service-lines` L920 (R2 appliqué 2026-05-02) — non servi | En attente document officiel transport Sénégal |
| `port_tariffs` (observed) | 12 | `observed` | **Filtré** par evidence_level dans quotation-engine, price-service-lines, generate-response — non consommé par ces fonctions | À nettoyer / documenter |
| `port_tariffs` (to_confirm) | 7 | `to_confirm` | **Filtré** par evidence_level — non consommé par les fonctions principales | À nettoyer / documenter |
| `carrier_billing_templates` (observed) | 10 | `observed` | **Filtré** par evidence_level — non consommé par les fonctions principales | À nettoyer / documenter |
| `carrier_billing_templates` (to_confirm, active) | 6 | `to_confirm` | **Filtré** par evidence_level — non consommé par les fonctions principales | À nettoyer / documenter |
| `demurrage_tiers` (observed) | 2 | `observed` | **Filtré** par evidence_level dans quotation-engine — non servi | Obtenir grilles MSC officielles ou supprimer |

### ✅ LOT3-B-PAD — Résolu : match impossible prouvé (aucun risque runtime)

L'audit ciblé LOT3-B-PAD (2026-05-02) a prouvé que les **4 lignes PAD `observed`** actives (source Taleb_Quote_2024) **ne peuvent pas être consommées** par le pipeline actuel.

**Raison** : `run-pricing` filtre strictement via `.eq('category', 'DROIT_PASSAGE')` et `.eq('operation_type', 'IMPORT')`. Or les 4 lignes Taleb ont `category = PORT_TAX / REDEVANCE_VARIABLE` et `operation_type = TRANSIT` — elles sont exclues par la logique métier hardcodée, indépendamment de `evidence_level`.

| id (short) | category | classification | operation_type | amount | Statut |
|------------|----------|----------------|----------------|--------|--------|
| 307be606 | PORT_TAX | Conteneur léger <15t | TRANSIT | 11 308 | **Orpheline** — match impossible |
| 6c14adfe | PORT_TAX | Conteneur standard 15-25t | TRANSIT | 16 962 | **Orpheline** — match impossible |
| e4bb1b4d | REDEVANCE_VARIABLE | Standard 20 pieds | TRANSIT | 9 183 | **Orpheline** — match impossible |
| 6cddfb14 | REDEVANCE_VARIABLE | Standard 40 pieds | TRANSIT | 18 366 | **Orpheline** — match impossible |

Aucune autre edge function ne requête `PORT_TAX`, `REDEVANCE_VARIABLE` ou `TRANSIT` dans `port_tariffs` (vérifié par grep).

**Option P3 (non prioritaire)** : désactiver ces 4 lignes pour hygiène de base. Risque runtime = zéro.

---

## Section C — Ce qui nécessite un document officiel

| Famille | Lignes concernées | Document requis | Statut |
|---------|------------------:|----------------|--------|
| Transport local Sénégal | 10 (`to_confirm`) | `TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS` — introuvable dans le stockage projet | En attente opérateur (LOT2-REV-C) |
| Terminaux Mali (SDV_KATI, MALI_SHIPPER_COUNCIL) | 10 (désactivées) | Barèmes officiels transit Mali | Désactivées par LOT3-A — `TO_CONFIRM` en fallback |
| Frontière KIDIRA_DIBOLI | 6 (désactivées) | Barèmes officiels frontière | Désactivées par LOT3-A — `TO_CONFIRM` en fallback |
| Demurrage COSCO / Evergreen / ONE | 9 (désactivées) | Grilles demurrage officielles de ces carriers | Désactivées par LOT3-A — `TO_CONFIRM` en fallback |
| MSC demurrage tiers `observed` | 2 (filtrées runtime) | Grille MSC tiered officielle | Filtrées par evidence_level — fallback colonnes legacy |
| Rate cards internes | 35 (`to_confirm`) | Validation SODATRA (document `VALIDATION_RATE_CARDS_AND_CATALOGUE.md`) | En attente validation SODATRA |

---

## Section D — Ce qui est reporté (DEFERRED)

| ID backlog | Famille | Priorité | Déclencheur |
|-----------|---------|----------|------------|
| PORT-TARIFFS-NATURE-SPLIT | Séparation natures `port_tariffs` | P2 | Multi-port ou terminal alternatif |
| LOT2-SMOKE-RUNTIME-EXEC | Smoke tests G6-G9 runtime | P0 (clôture Lot 2) | Exécution par opérateur via psql |
| LOT3-B (potentiel) | Audit `port_tariffs` observed/to_confirm + `carrier_billing_templates` observed/to_confirm | P1 | Décision CTO post-synthèse |
| LOT3-B-PAD | ~~Filtre `evidence_level` manquant dans `run-pricing` pour PAD alias~~ — **FERMÉ** : match impossible prouvé (category/operation_type hardcodés excluent les 4 lignes Taleb). Option P3 : désactivation hygiène. | closed | Aucun — risque nul |
| TRANSPORT-GRILLE-GENERIQUE | Grille SODATRA générique transport local Sénégal | P2 | Décision métier |
| RATE-CARDS-SODATRA | Validation/activation rate cards internes (35 lignes) | P1 | Retour SODATRA sur `VALIDATION_RATE_CARDS_AND_CATALOGUE.md` |

---

## Résumé chiffré

| Catégorie | Lignes |
|-----------|-------:|
| **Sécurisées** (official/validated_internal, consommables) | ~184 |
| **Filtrées runtime** (en base mais non consommées) | ~82 |
| **Quarantinées** (`is_active=false`) | ~116 |
| **En attente document officiel** | 5 familles |
| **En attente validation SODATRA** | 35 rate cards |

---

## Constats méthodologiques

1. **Validation analytique uniquement** — aucun `run-pricing` post-déploiement n'a été lancé. Les comptages sont issus de SELECT réels post-LOT3-A.
2. **Formulation prudente** — le système est nettement plus fiable, pas "parfait". Les sources P0 identifiées sont neutralisées ; d'autres sources ou chemins edge non encore testés pourraient exister.
3. **LOT3-B-PAD résolu** — `run-pricing` accède à `port_tariffs` PAD sans filtre `evidence_level`, mais les 4 lignes `observed` (Taleb) ont `category=PORT_TAX/REDEVANCE_VARIABLE` et `operation_type=TRANSIT`, donc **match impossible** avec les filtres hardcodés `DROIT_PASSAGE` + `IMPORT`. Aucun risque runtime. Option P3 : désactivation hygiène.
4. **`demurrage_rates`** — cette table n'a pas de colonne `evidence_level`. Les 26 lignes actives sont issues de carriers considérés vérifiés (CMA CGM, Hapag-Lloyd, Maersk, MSC). Les 9 non vérifiées ont été désactivées par LOT3-A.
