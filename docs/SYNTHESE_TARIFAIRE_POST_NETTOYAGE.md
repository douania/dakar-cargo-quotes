# Synthèse tarifaire globale — Post-nettoyage LOT2 + LOT3-A

**Date :** 2026-05-02  
**Contexte :** après exécution de LOT2-REV-A/B/C (transport local) et LOT3-A (quarantaine P0 minimale).  
**Type de validation :** analytique (SELECT réels post-LOT3-A). Aucun `run-pricing` post-déploiement lancé.  
**Périmètre :** les sources P0 identifiées dans LOT3-0 et traitées par LOT3-A ne peuvent plus sortir automatiquement en cotation client. Cette conclusion est limitée aux sources P0 identifiées ; elle ne constitue pas une garantie absolue sur toutes les futures sources.

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
| `local_transport_rates` (to_confirm) | 10 | `to_confirm` | **Filtré** par `.in('evidence_level', ['official', 'validated_internal'])` dans quotation-engine — non servi | En attente document officiel transport Sénégal |
| `port_tariffs` (observed) | 12 | `observed` | **Filtré** par evidence_level dans quotation-engine, price-service-lines, generate-response — non consommé par ces fonctions | À nettoyer / documenter |
| `port_tariffs` (to_confirm) | 7 | `to_confirm` | **Filtré** par evidence_level — non consommé par les fonctions principales | À nettoyer / documenter |
| `carrier_billing_templates` (observed) | 10 | `observed` | **Filtré** par evidence_level — non consommé par les fonctions principales | À nettoyer / documenter |
| `carrier_billing_templates` (to_confirm, active) | 6 | `to_confirm` | **Filtré** par evidence_level — non consommé par les fonctions principales | À nettoyer / documenter |
| `demurrage_tiers` (observed) | 2 | `observed` | **Filtré** par evidence_level dans quotation-engine — non servi | Obtenir grilles MSC officielles ou supprimer |

### ⚠️ Point d'attention — `run-pricing` PAD alias

La fonction `run-pricing` accède à `port_tariffs` pour résoudre les alias PAD (droits de passage) avec uniquement `.eq('is_active', true)` **sans filtre `evidence_level`**. Actuellement, **4 lignes PAD `observed`** (provider=PAD) sont actives et potentiellement consommables par ce chemin. Les 19 lignes PAD `official` dominent, mais les 4 `observed` pourraient être servies si elles correspondent à une catégorie PAD non couverte par les officielles.

**Action recommandée** : vérifier si les 4 lignes PAD `observed` couvrent des catégories non présentes dans les 19 `official`. Si oui, ajouter un filtre `evidence_level` dans `run-pricing` ou les désactiver. À traiter en LOT3-B potentiel.

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
| LOT3-B-PAD | Filtre `evidence_level` manquant dans `run-pricing` pour PAD alias (4 lignes `observed` potentiellement consommables) | P1 | À traiter avec LOT3-B |
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
3. **Point découvert** — `run-pricing` accède à `port_tariffs` PAD sans filtre `evidence_level` (4 lignes `observed` potentiellement consommables). À traiter en priorité P1.
4. **`demurrage_rates`** — cette table n'a pas de colonne `evidence_level`. Les 26 lignes actives sont issues de carriers considérés vérifiés (CMA CGM, Hapag-Lloyd, Maersk, MSC). Les 9 non vérifiées ont été désactivées par LOT3-A.
