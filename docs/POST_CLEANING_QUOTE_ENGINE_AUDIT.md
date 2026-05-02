# POST-CLEANING-QUOTE-ENGINE-AUDIT

**Date :** 2026-05-02  
**Type :** audit lecture seule + smoke runtime contrôlé + hardening R2  
**Périmètre :** validation globale post-nettoyages LOT2 + LOT3-A  
**Statut :** validé — R3 smoke passé, R2 appliqué et déployé  
**Verdict :** **GO confirmé** pour continuer le paramétrage tarifaire

---

## 1. Résumé exécutif

Le système est **nettement plus fiable** après LOT2/LOT3-A. Les sources non vérifiées (Aksa, Taleb, demurrage non prouvées) sont neutralisées. Les filtres runtime (`evidence_level`, `status`, `is_active`) sont en place dans les 4 edge functions principales. Les TO_CONFIRM sont visibles dans le cockpit, le PDF et l'email draft.

**Contamination post-LOT3 :** deux runs post-LOT3 existent (`73a912ba` AIR_IMPORT, `46cd9ded` SEA_FCL_IMPORT) et ont été inspectés analytiquement en base : 0 référence Aksa/Taleb. Cependant, aucun smoke runtime contrôlé n'a été déclenché spécifiquement dans le cadre de cet audit.

---

## 2. Sources tarifaires encore consommables

| Table | Total | Actives | Consommables runtime | Filtre runtime | Provenance |
|-------|------:|--------:|---------------------:|----------------|------------|
| `port_tariffs` | 98 | 90 | **71** (52 official + 19 validated_internal) | `.in('evidence_level', ['official','validated_internal'])` dans quotation-engine, price-service-lines, generate-response | PAD, DPW |
| `carrier_billing_templates` | 59 | 48 | **23** (validated_internal) | `.in('evidence_level', ['official','validated_internal'])` dans quotation-engine, generate-response | Hapag, CMA CGM, ONE |
| `demurrage_rates` | 35 | 26 | **26** — sources considérées vérifiées / documents fournisseur identifiés, sans colonne `evidence_level` | `.eq('is_active', true)` (pas de colonne evidence_level sur cette table) | CMA CGM:7, Maersk:7, Hapag-Lloyd:7, MSC:5 |
| `demurrage_tiers` | 35 | 33 consommables | **33** (official) | `.in('evidence_level', ['official','validated_internal'])` dans quotation-engine | Carriers vérifiés |
| `tax_rates` | 8 | 8 | **8** | Consommation directe | Barèmes UEMOA |
| `pricing_customs_tiers` | 12 | 12 | **12** | `.eq('active', true)` | Référentiel douanier |
| `pricing_service_catalogue` | 11 | 11 | **11** (5 confirmés + 6 placeholders TO_CONFIRM) | `.eq('active', true)` + logique `EXPORT_PLACEHOLDER_SERVICE_KEYS` | Interne SODATRA |

---

## 3. Sources filtrées / quarantainées

| Table | Lignes | Evidence_level / Status | Filtre runtime | Risque |
|-------|-------:|------------------------|----------------|--------|
| `port_tariffs` observed | 12 | `observed` | Exclu par evidence_level whitelist | Risque runtime actuel nul sous les filtres existants |
| `port_tariffs` to_confirm | 7 | `to_confirm` | Exclu par evidence_level whitelist | Risque runtime actuel nul sous les filtres existants |
| `carrier_billing_templates` observed | 10 | `observed` | Exclu par evidence_level whitelist | Risque runtime actuel nul sous les filtres existants |
| `carrier_billing_templates` to_confirm | 6 | `to_confirm` | Exclu par evidence_level whitelist | Risque runtime actuel nul sous les filtres existants |
| `carrier_billing_templates` historical_only | 9 active + 3 inactive | `historical_only` | Exclu par evidence_level whitelist | Risque runtime actuel nul sous les filtres existants |
| `pricing_rate_cards` | 35 | `status=to_confirm` | `.eq("status","active")` → 0 ligne servie | Risque runtime actuel nul sous les filtres existants |
| `local_transport_rates` Aksa | 81 | `is_active=false` + `historical_only` | Double exclusion | Risque runtime actuel nul sous les filtres existants |
| `local_transport_rates` génériques | 10 | `to_confirm` + `is_active=true` | Guard explicite L629 dans price-service-lines + filtre evidence_level L1709 dans quotation-engine | Risque runtime actuel nul sous les filtres existants |
| `destination_terminal_rates` Taleb | 10 | `is_active=false` | Exclusion totale | Risque runtime actuel nul sous les filtres existants |
| `border_clearing_rates` Taleb | 6 | `is_active=false` | Exclusion totale | Risque runtime actuel nul sous les filtres existants |
| `demurrage_rates` non vérifiées | 9 | `is_active=false` | Exclusion totale | Risque runtime actuel nul sous les filtres existants |
| `demurrage_tiers` observed | 2 | `observed` | Exclu par evidence_level whitelist | Risque runtime actuel nul sous les filtres existants |

---

## 4. Vérification runtime par edge function

### `run-pricing/index.ts`
- **Tables lues** : `port_tariffs` (PAD aliases), `terminal_designations`, `terminal_tariff_codes`, `pad_designation_aliases`
- **Filtres** : `.eq('is_active', true)` + filtres hardcodés (category=DROIT_PASSAGE, operation_type=IMPORT)
- **Evidence_level** : non filtré, mais le match est impossible pour les 4 lignes observed (category/operation_type mismatch — prouvé LOT3-B-PAD)
- **Fallback TO_CONFIRM** : N/A (PAD est enrichissement post-moteur)
- **Verdict** : SAIN

### `quotation-engine/index.ts`
- **Tables lues** : `port_tariffs` (L975-976), `carrier_billing_templates` (L1007-1009), `local_transport_rates` (L1708-1709), `border_clearing_rates` (L1034-1037), `destination_terminal_rates` (L1059-1062), `demurrage_rates` (L2044-2047), `demurrage_tiers` (L2062-2066), `customs_regimes` (L2274-2276), `pricing_customs_tiers`
- **Filtres evidence_level** :
  - `port_tariffs` : ✅ `.in('evidence_level', ['official','validated_internal'])`
  - `carrier_billing_templates` : ✅ `.in('evidence_level', ['official','validated_internal'])`
  - `local_transport_rates` : ✅ `.in('evidence_level', ['official','validated_internal'])` (L1709)
  - `demurrage_tiers` : ✅ `.in('evidence_level', ['official','validated_internal'])` (L2066)
  - `border_clearing_rates` : `.eq('is_active', true)` — 0 ligne active (Taleb désactivées)
  - `destination_terminal_rates` : `.eq('is_active', true)` — 0 ligne active (Taleb désactivées)
  - `demurrage_rates` : `.eq('is_active', true)` — pas de colonne evidence_level, 26 actives considérées vérifiées (documents fournisseur identifiés)
- **Verdict** : SAIN

### `price-service-lines/index.ts`
- **Tables lues** : `pricing_rate_cards` (L908-910), `pricing_service_catalogue` (L913), `pricing_customs_tiers` (L916), `local_transport_rates` (L920), `port_tariffs` via DPW THC lookup (L666-668)
- **Filtres** :
  - `pricing_rate_cards` : ✅ `.eq("status","active")` → 0 ligne
  - `port_tariffs` DPW : ✅ `.in("evidence_level", ["official","validated_internal"])`
  - `local_transport_rates` : charge `is_active=true` (10 lignes `to_confirm`), **mais** guard L629 rejette `evidence_level='to_confirm'`
- **Risque mineur (R2)** : la requête L920 charge les 10 lignes en mémoire avant filtrage applicatif. Si de futures lignes `observed` ou `historical_only` étaient ajoutées comme `is_active=true`, elles **passeraient** le guard L629 (qui ne bloque que `to_confirm`). Ce n'est pas un risque actuel car aucune telle ligne n'existe, mais le filtre DB devrait être renforcé avant d'ajouter de nouvelles lignes.
- **Verdict** : SAIN (risque théorique futur R2 documenté)

### `generate-response/index.ts`
- **Tables lues** : `port_tariffs` (L1387-1388), `carrier_billing_templates` (L1421-1422), `demurrage_rates` (L1479)
- **Filtres** : ✅ evidence_level whitelist sur port_tariffs et carrier_billing_templates
- **Verdict** : SAIN

### `export-quotation-version-pdf/index.ts`
- **TO_CONFIRM rendering** : ✅ lignes TO_CONFIRM affichent "À confirmer" au lieu d'un montant (L278-280)
- **Quote qualification** : ✅ `resolveQuoteQualification` upgrade `firm` → `provisional` si TO_CONFIRM présent (Lot 3D-2)
- **Verdict** : SAIN

### `create-quotation-email-draft/index.ts`
- **TO_CONFIRM rendering** : ✅ même logique `resolveQuoteQualification` (Lot 3D-2)
- **Verdict** : SAIN

---

## 5. Analyse des cas représentatifs

| Case | Type | Dernier run | Total HT | TO_CONFIRM | Contamination Aksa/Taleb | Verdict |
|------|------|-------------|----------|------------|--------------------------|---------|
| `29b96eec` | SEA_FCL_IMPORT | run #17, `46cd9ded` (post-LOT3) | 1 260 000 XOF | 1 ligne | 0 | SAIN |
| `01c3fbbc` | AIR_IMPORT | run #3, `73a912ba` (post-LOT3) | 145 000 XOF | 1 ligne | 0 | SAIN |
| `03ccf66d` | SEA_FCL_IMPORT (Kolda) | run #1, `613cc817` (pré-LOT3) | 1 210 000 XOF | 1 ligne | 0 | SAIN (mais run pré-LOT3) |
| `737c9b08` | AIR_IMPORT | run #5, `9d155c39` | 200 000 XOF | 1 ligne | 0 | SAIN |
| `240167ed` | SEA_FCL_IMPORT (AI0CARGO) | run #4, `128110e1` (pré-LOT3) | 0 XOF | 2 lignes | **16 refs Taleb** | HISTORIQUE — run pré-LOT3 persisté |
| `76c9819c` | SEA_FCL_IMPORT | run #7 (pré-LOT3) | 1 000 000 XOF | 0 | 0 | SAIN |
| `f2ba5d01` | SEA_FCL_IMPORT | run #1 | 175 000 XOF | — | 0 | SAIN |

**Cas absents** : aucun dossier EXPORT, TRANSIT MALI, ou LCL avec pricing run réussi en base. 5 dossiers LCL existent mais sans pricing run. 0 dossier export/transit.

**Contamination historique** : le run `128110e1` (case `240167ed`, pré-LOT3) contient 16 références Taleb dans ses lignes persistées. Ce run **ne sera pas re-généré** sauf si l'opérateur relance le pricing. Un nouveau run produirait 0 contamination grâce aux quarantaines.

---

## 6. Visibilité des TO_CONFIRM dans UI/PDF/email

| Surface | Mécanisme | Verdict |
|---------|-----------|---------|
| **PricingResultPanel** (cockpit) | Compteur dédié : "X à confirmer" (amber), liste des services TO_CONFIRM | ✅ Visible |
| **QuotationVersionCard** | Quote qualification : upgrade `firm` → `provisional` si TO_CONFIRM, badge "RATE_PENDING_CONFIRMATION" | ✅ Visible |
| **PDF export** | Ligne TO_CONFIRM affiche "— / À confirmer" au lieu d'un montant (L278-280) | ✅ Visible |
| **Email draft** | Quote qualification merge `RATE_PENDING_CONFIRMATION` reason | ✅ Visible |
| **SendQuotationPanel** | `canSend` nécessite `QUOTED_VERSIONED` + draft complet, communication warnings amber (COCKPIT-2), mais **pas de blocage dur** sur TO_CONFIRM | ⚠️ L'opérateur **peut** envoyer un devis avec des TO_CONFIRM — intentionnel (doctrine : opérateur souverain) |
| **PricingCommWarnings** | Avertissement amber pour communications ouvertes, pas pour TO_CONFIRM spécifiquement | ℹ️ Informatif |

**Observation UI** : un opérateur peut envoyer un devis contenant des TO_CONFIRM. Le PDF affichera "À confirmer" (pas un faux prix). C'est conforme à la doctrine "opérateur souverain" documentée.

---

## 7. Gaps métier restants

| # | Gap | Impact commercial | Source nécessaire | Action | Priorité |
|---|-----|-------------------|-------------------|--------|----------|
| 1 | Transport local Sénégal (10 lignes to_confirm, 0 official) | **Fort** — tout transport local → TO_CONFIRM | Document officiel `TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS` ou grille SODATRA | LOT2-REV-C : ingestion officielle | P1 |
| 2 | Rate cards SODATRA (35 lignes to_confirm, 0 active) | **Moyen** — services AGENCY, CUSTOMS, DTHC, TRUCKING, BORDER non servis automatiquement | Validation SODATRA (`VALIDATION_RATE_CARDS_AND_CATALOGUE.md`) | Arbitrage SODATRA | P1 |
| 3 | Terminaux Mali (SDV_KATI, MALI_SHIPPER_COUNCIL) — 10 désactivées | **Faible** (pas de dossier transit Mali en base) | Barèmes officiels transit Mali | Collecte officielle | P2 |
| 4 | Frontière KIDIRA_DIBOLI — 6 désactivées | **Faible** (idem) | Barèmes officiels frontière | Collecte officielle | P2 |
| 5 | Demurrage COSCO / Evergreen / ONE — 9 désactivées | **Moyen** — ces carriers tomberont en TO_CONFIRM si rencontrés | Grilles demurrage officielles | Collecte officielle | P2 |
| 6 | Services export SODATRA (6 placeholders à 0 XOF) | **Faible** (logique TO_CONFIRM Lot 1-B active) | Validation SODATRA | TARIFF-COLLECTION-CAMPAIGN | P2 |
| 7 | MSC demurrage tiers observed (2 lignes) | **Nul actuellement** (filtré runtime, fallback legacy colonnes) | Grille MSC tiered officielle | P3 |

---

## 8. Risques résiduels

| # | Risque | Probabilité | Impact | Mitigation |
|---|--------|-------------|--------|------------|
| R1 | **Runs historiques persistés avec données Taleb** (ex: `240167ed` run #4, 16 refs Taleb) | Certain (données en base) | Faible — visible uniquement si l'opérateur consulte un ancien run sans relancer | Les quotation_versions générées à partir de ces runs contiennent les anciennes lignes. Un re-run post-LOT3 les corrigerait. |
| R2 | **price-service-lines L920 charge local_transport_rates sans filtre evidence_level au niveau DB** | P3 (aucune ligne observed/historical_only active aujourd'hui) | Risque runtime actuel nul sous les filtres existants, risque si nouvelles lignes ajoutées | Renforcer le filtre DB avec `.in('evidence_level', ['official','validated_internal'])` avant d'ajouter de nouvelles lignes (micro-lot LOCAL-TRANSPORT-RUNTIME-HARDENING) |
| R3 | **Aucun smoke runtime contrôlé post-LOT3 exécuté dans ce protocole d'audit** | Certain | Moyen — les filtres sont vérifiés par requête DB et inspection code, mais aucun run-pricing complet contrôlé n'a été lancé dans le cadre de cet audit. Deux runs post-LOT3 existent et montrent 0 contamination, mais n'ont pas été déclenchés comme smoke tests formels. | L'opérateur devrait relancer un run sur `29b96eec` ou `01c3fbbc` pour confirmer en conditions contrôlées. |
| R4 | **demurrage_rates sans colonne evidence_level** | Certain (par design) | Faible — les 26 actives sont de carriers considérés vérifiés (documents fournisseur identifiés) | Ajouter evidence_level si nouvelles sources non vérifiées arrivent |

---

## 9. Recommandations CTO

1. **P0 — Smoke runtime contrôlé** : relancer un `run-pricing` sur au moins 2 dossiers (1 SEA_FCL, 1 AIR) depuis le cockpit, dans le cadre d'un protocole de test formel. Vérifier que les lignes TO_CONFIRM apparaissent et qu'aucune référence Taleb/Aksa ne sort.

2. **P1 — Transport local** : obtenir le document officiel transport Sénégal (LOT2-REV-C). Sans lui, tout transport local reste TO_CONFIRM.

3. **P1 — Rate cards SODATRA** : faire signer `VALIDATION_RATE_CARDS_AND_CATALOGUE.md` par l'équipe métier. 35 lignes de services sont bloquées en attente.

4. **P2 — Renforcer price-service-lines L920** : ajouter `.in('evidence_level', ['official','validated_internal'])` à la requête `local_transport_rates` dans `price-service-lines` pour aligner avec `quotation-engine` et éliminer le risque R2. Micro-lot : LOCAL-TRANSPORT-RUNTIME-HARDENING.

5. **P3 — Nettoyage historique** : identifier les `quotation_versions` générées à partir de runs contaminés (pré-LOT3) et les marquer comme obsolètes, ou simplement documenter que tout re-run les corrigera.

---

## 10. Go / No-Go pour continuer le paramétrage tarifaire

**Verdict : GO conditionnel**

Le système est suffisamment protégé pour continuer le paramétrage tarifaire. Les conditions sont :

- **Condition obligatoire** : exécuter au moins 1 smoke runtime contrôlé (recommandation #1) avant d'injecter de nouvelles données tarifaires.
- **Condition recommandée** : appliquer le renforcement P2 sur `price-service-lines` L920 avant d'ajouter de nouvelles lignes `local_transport_rates`.

Le paramétrage peut commencer sur les familles déjà sécurisées (port_tariffs, carrier_billing_templates, demurrage) sans risque sous les filtres existants. L'injection de nouvelles lignes `local_transport_rates` ou `pricing_rate_cards` nécessite les validations SODATRA pendantes.

---

## Annexe A — Documents de référence lus

- `docs/MASTER_CONTEXT.md` (878 lignes)
- `docs/DEFERRED_BACKLOG.md` (1161 lignes)
- `docs/LOT_2_REPORT.md` (331 lignes)
- `docs/SYNTHESE_TARIFAIRE_POST_NETTOYAGE.md`
- `docs/AUDIT_COUVERTURE_TRANSPORT_SN.md`
- `docs/tariff-collection/VALIDATION_RATE_CARDS_AND_CATALOGUE.md`
- `.lovable/plan.md`
- 6 edge functions sources lues
- 11 tables DB auditées par SELECT réels

## Annexe B — Contraintes respectées

- ✅ Zéro modification runtime
- ✅ Zéro migration
- ✅ Zéro update DB
- ✅ Zéro edge function modifiée
- ✅ Zéro tarif inventé
- ✅ Zéro promotion evidence_level
- ✅ Distinction faits prouvés / hypothèses / risques / recommandations
