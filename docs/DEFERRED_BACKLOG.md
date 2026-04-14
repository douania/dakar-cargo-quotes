# BACKLOG DIFFÉRÉ — DAKAR CARGO QUOTES

Source de vérité unique de tous les sujets volontairement reportés, laissés dormants, acceptés comme dette, ou déplacés à une phase ultérieure.

Dernière mise à jour : 2026-04-10

---

## SOURCE-GUARD-DEBT — Tagging systématique sender_role sur les emails

| Champ | Valeur |
|-------|--------|
| **ID** | SOURCE-GUARD-DEBT |
| **Catégorie** | Data provenance / Email pipeline |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | SOURCE-GUARD-1 + SOURCE-GUARD-2 |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | (1) Nouveaux domaines SODATRA ou partenaires non couverts par le domain matching. (2) Clients multi-domaines ou partenaires utilisant Gmail/Outlook. (3) Besoin de `fact_provenance` explicite et persisté dans `quote_facts`. |
| **Recommandation** | Implémenter un vrai champ `sender_role` (client/internal/partner) sur la table `emails` au moment de l'import (`sync-emails`). Cela remplacerait le domain matching heuristique de `classifyEmailProvenance()` par une classification persistée et fiable. À terme, ajouter un champ `fact_provenance` dans la chaîne d'extraction pour traçabilité complète. Le matching par domaine (SG-2) est prudent mais imparfait pour les cas multi-domaines. |

---

## FLOW-FIX-1 — Normalisation pays + inférence port Sénégal

| Champ | Valeur |
|-------|--------|
| **ID** | FLOW-FIX-1 |
| **Catégorie** | Flow detection / Routing |
| **Statut** | `done` |
| **Priorité** | Critique |
| **Phase d'origine** | FLOW-FIX-1 |
| **Date** | 2026-04-09 |
| **Déclencheur de réouverture** | (1) Étendre `COUNTRY_NAME_TO_ISO` en table DB pour maintenance sans redéploiement. (2) Étendre l'inférence port à d'autres pays mono-port (Gambie→Banjul, Guinée-Bissau→Bissau). |
| **Recommandation** | Map `COUNTRY_NAME_TO_ISO` (~45 pays) ajoutée inline dans build-case-puzzle. À terme, migrer en table `country_aliases` pour éviter les redéploiements. L'inférence port est strictement limitée aux flows maritimes import vers SN. |

---

## COCKPIT-11 — Scope fournisseur multi-postes

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-11 |
| **Catégorie** | Communication partenaire |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-11 |
| **Date** | 2026-04-09 |
| **Déclencheur de réouverture** | COCKPIT-11 Phase 2 — pré-création assistée de demandes multiples depuis le scope détecté |
| **Recommandation** | Helper déterministe `derivePartnerRequestScope`. Facts structurés prioritaires sur texte brut. 4 blocs détectés (freight, origin, stuffing factory, stuffing CFS). **11B livré** : agrégation multi-blocs avec déduplication. **11C livré** : PURPOSE_INCLUDES freight enrichi (8 items), origin_charges adapté SODATRA (sans customs clearance), promotion scope high/medium via `PROMOTION_LABELS`, `normalizeForDedup()` anti-doublons, `confidence ?? "medium"` backward compatible. **11D livré** : mapping cargo.containers (value_json) → clés synthétiques container_type/count/fcl_lcl, fallback value_number pour weight_kg/volume_cbm, support conteneurs hétérogènes, label "Poids total". Phase 2 : pré-création assistée de demandes multiples depuis le scope détecté. |

---

## PACKAGE-FILTER-1 — Filtrage contextuel des services compatibles

| Champ | Valeur |
|-------|--------|
| **ID** | PACKAGE-FILTER-1 |
| **Catégorie** | UI / Service packages |
| **Statut** | `done` |
| **Priorité** | Moyenne |
| **Phase d'origine** | PACKAGE-FILTER-1 |
| **Date** | 2026-04-09 |
| **Déclencheur de réouverture** | Ajout de nouveaux packages dans SERVICE_PACKAGES nécessitant une entrée dans PACKAGE_COMPATIBLE_EXTRAS |
| **Recommandation** | Whitelist explicite par package dans `helpers.ts`. Fallback sur `isServiceRelevant()` si package inconnu. TRUCKING exclu de EXPORT_SENEGAL (service destination). Évolution future possible : filtrage dynamique par facts corridor/pays. |

---

## COCKPIT-10 — Email partenaire professionnel

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-10 |
| **Catégorie** | Communication partenaire |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-10 |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | COM-1A — si le format email nécessite ajustement post envoi réel |
| **Recommandation** | Template déterministe partagé (src/lib + _shared). Variations par purpose. purpose_detail opérateur prioritaire. |

---

## COCKPIT-9 Phase 2 — Offre retenue opérateur

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-9-P2 |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-9-P2 |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | COM-1A — envoi réel des demandes partenaires |
| **Recommandation** | Migration is_selected/selected_at sur external_quote_requests. Edge function select-partner-request. Badge + bouton "Retenir" dans PartnerRequestsDetailView. Enrichissement de PartnerCollectionReadinessCard, NextActionBanner, PricingReadinessCard. |

---

## COCKPIT-9 Phase 1 — Suffisance de collecte partenaire

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-9-P1 |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-9-P1 |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | COCKPIT-9 Phase 2 — notion persistée d'offre retenue opérateur |
| **Recommandation** | Composant `PartnerCollectionReadinessCard` lecture seule. 2 queries. 4 verdicts (neutre/insuffisante/en cours/suffisante). Ligne "Offre retenue" placeholder. Placé au-dessus de PricingReadinessCard. |

---

## COCKPIT-7C — Verdict de complétude avant pricing final

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-7C |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-7C |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Si ajout de client_gap_requests dans le verdict |
| **Recommandation** | Composant `PricingReadinessCard` lecture seule. 2 queries. Verdict 4 niveaux (Prêt/Provisoire/Incomplet/Neutre). Placé au-dessus de PricingLaunchPanel. |

---

## COCKPIT-8 Phase 1 — Bandeau prochaine action prioritaire

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-8-P1 |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-8 |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Phase 2 (CTA + scroll vers section concernée) |
| **Recommandation** | Composant `NextActionBanner` lecture seule. 6+2 queries. Hiérarchie 12 niveaux, STATUS_ORDER explicite. Placé avant CaseActionPlan. |

---


| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-7B |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Moyenne |
| **Phase d'origine** | COCKPIT-7B |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Si besoin d'actions inline (clôture, relance) depuis la vue détaillée |
| **Recommandation** | Composant `PartnerRequestsDetailView` lecture seule. 2 queries (requests + facts). Badge hiérarchique. Suite logique : COCKPIT-7C (complétude avant pricing final). |

---

## COCKPIT-7A — Vue synthétique "Offres attendues vs reçues"

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-7A |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Moyenne |
| **Phase d'origine** | COCKPIT-7A |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Si des compteurs supplémentaires sont nécessaires (ex: réponses attendues vs reçues par partenaire) |
| **Recommandation** | Composant `PartnerRequestsSummary` lecture seule. 2 queries (requests + facts). Barre de progression clôturées/total. Suite logique : COCKPIT-7B (vue par partenaire). |

---

## PRICING-GUARD — Garde-fou communication avant pricing

| Champ | Valeur |
|-------|--------|
| **ID** | PRICING-GUARD |
| **Catégorie** | Orchestration |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | PRICING-GUARD (post COCKPIT-6) |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Si un guard backend supplémentaire est nécessaire dans `run-pricing` |
| **Recommandation** | Implémenté en 3 volets : (1) auto-pricing conditionné par état des boucles comm, (2) warning ambre au pricing manuel via `PricingCommWarnings`, (3) badge "Provisoire" sur `PricingResultPanel`. Aucune modification de `run-pricing` (FROZEN respecté). Guard backend optionnel à évaluer après retour terrain. |

---

## EXPORT-QE-FROZEN — quotation-engine FROZEN produit encore des honoraires import sur dossiers export

| Champ | Valeur |
|-------|--------|
| **ID** | EXPORT-QE-FROZEN |
| **Catégorie** | Moteur de pricing |
| **Statut** | `deferred` |
| **Priorité** | Moyenne |
| **Phase d'origine** | Phase 15+ (export SENEGAL) |
| **Date** | 2026-04-07 |
| **Déclencheur de réouverture** | Quand quotation-engine sera dégelé ou qu'un client exige une cotation export sans lignes import parasites |
| **Recommandation** | Le moteur FROZEN `quotation-engine` continue de produire des lignes honoraires génériques (fee_clearance, fee_follow_up, fee_file, fee_docs) car il opère en operationType=IMPORT. Le patch `run-pricing` corrige l'injection package lot-level et le scope P5, mais les lignes moteur FROZEN restent. Nécessite un dégel ciblé de quotation-engine pour supporter un operationType EXPORT. |

---

## Règle de mise à jour obligatoire

Tout sujet explicitement différé, laissé dormant, accepté comme dette, ou déplacé à une phase ultérieure **doit être ajouté ou mis à jour dans ce fichier immédiatement**.

Cela inclut les décisions formulées comme :
- "pas maintenant"
- "phase ultérieure"
- "dormant"
- "legacy conservé"
- "dette acceptée"
- "à revalider plus tard"

---

## Vocabulaire de statuts

| Statut | Signification |
|--------|---------------|
| `deferred` | Reporté volontairement — sera traité plus tard |
| `deferred-high` | Reporté mais priorité haute — à traiter au prochain cycle |
| `dormant` | Conservé dans le code, pas d'appelant actif, pas de suppression prévue |
| `legacy` | Code ou modèle ancien, conservé par prudence |
| `watchlist` | À surveiller — pourrait devenir un problème |
| `pending_validation` | Nécessite une vérification avant action |
| `historical_note` | Information contextuelle archivée, pas d'action requise |
| `closed` | Résolu ou explicitement abandonné |

---

## Backlog

| ID | Sujet | Catégorie | Statut | Priorité | Phase | Date | Pourquoi non traité | Déclencheur de réouverture | Surface probable | Source | Vérification | Recommandation |
|----|-------|-----------|--------|----------|-------|------|---------------------|---------------------------|-----------------|--------|--------------|----------------|
| E1 | MASTER_CONTEXT.md référence `generate-case-outputs` (§Cockpit, §Fonctions dormantes) — supprimée en M26b | doc | closed | — | M26b | 2026-03-26 | Corrigé par convergence documentaire E1+E2+E3 | — | `docs/MASTER_CONTEXT.md` | repo + chat | Fermé | Aucune action requise |
| E2 | SECURITY_CONTRACT.md référence `generate-case-outputs` (ligne 36, 74) | doc | closed | — | M26b | 2026-03-26 | Corrigé par convergence documentaire E1+E2+E3 | — | `docs/SECURITY_CONTRACT.md` | repo + chat | Fermé | Aucune action requise |
| E3 | STATUS_REGISTRY.md référence `generate-case-outputs` comme writer HUMAN_REVIEW | doc | closed | — | M26b | 2026-03-26 | Corrigé par convergence documentaire E1+E2+E3 | — | `docs/STATUS_REGISTRY.md` | repo | Fermé | Aucune action requise |
| E4 | PHASE_15_NOTES.md référence `generate-case-outputs` dans config verify_jwt | doc | historical_note | Moyenne | M26b | 2026-03 | Document historique | Lors de prochaine relecture | `.lovable/PHASE_15_NOTES.md` | repo | Confirmé | Annoter comme historique |
| C1 | CaseView.tsx monolithique — extraction progressive | dette | closed | — | C1 | 2026-03-26 | Objectif minimal atteint : C1.1 (constantes/types/helpers), C1.2a (FactHistoryPopover), C1.2b (ServiceOverridePanel). CaseView réduit de 2700+ à 2119 lignes (~21%). Smoke tests verts. | — | `src/pages/CaseView.tsx` | chat C1 | Fermé | Aucune action requise |
| C1-rest | Extractions CaseView restantes (PipelineStepper, TimelineTab, ClientClarifications) | dette | dormant | Basse | C1 | 2026-03-26 | Restant volontairement non extrait ; ratio gain/risque insuffisant hors changement UX majeur | Prochain changement UX majeur sur CaseView | `src/pages/CaseView.tsx` | chat C1 | Confirmé | Garder dormant |
| B1-A | Isolation email_drafts (CRUD ouvert → owner-scoped) | sécurité | closed | — | B1-A | 2026-03-28 | Implémenté : 4 policies USING(true) remplacées par owner-scoped. SELECT/DELETE : owner + legacy NULL transitoire. UPDATE/INSERT : owner strict. Impacts produit documentés (Dashboard cross-user, admin listing). | — | RLS `email_drafts` | repo + chat B1 | Fermé | Aucune action requise |
| B1-B | Isolation case_documents + storage bucket | sécurité | deferred | Moyenne | M23c | 2026-03-28 | Pré-audit B1-B complet (2026-03-28). 3 blocages structurels prouvés : (1) upload storage-first → policy storage par jointure DB impossible (CaseDocumentsTab.tsx L82-98, Intake.tsx L412-424), (2) delete DB-first → policy storage par jointure DB impossible (CaseDocumentsTab.tsx L176-180), (3) quote_cases en shared workspace → restreindre case_documents seul créerait une asymétrie produit (documents = pièces dossier partagé, ≠ email_drafts = artefact opérateur). Le problème est applicatif + produit, pas seulement RLS. Options évaluées : A (inverser flux applicatif), B (storage path-based), C (durcir DB SELECT only), D (statu quo documenté). Décision CTO : Option D retenue. | Ouverture multi-société, refonte flux upload/delete, ou incident réel de visibilité inter-opérateurs | Storage `case-documents`, RLS `case_documents`, `CaseDocumentsTab.tsx`, `Intake.tsx` | repo + chat B1 + pré-audit B1-B | Confirmé | Reconcevoir flux (Option A) si multi-société requis ; sinon statu quo justifié |
| B2 | Données historiques `route_port = 'Dakar'` non corrigées rétroactivement | dette | legacy | Basse | M23b-fix | 2026-03 | Migration données risquée | Jamais (accepté) | `quotation_history` | chat M23b-fix | Confirmé | Garder dormant |
| A1 | Fin commerciale post-SENT (ACCEPTED/REJECTED) | futur produit | closed | — | A1 | 2026-03-28 | Implémenté : migration enum, edge function `close-commercial-outcome` (FSM guard SENT-only, idempotence, cross-transition interdite, timeline status_changed), UI (labels, filtres, stepper, boutons outcome, bandeau), docs alignés. | — | Enum DB, FSM, CaseView, `close-commercial-outcome` | repo + chat A1 | Fermé | Aucune action requise |
| A2 | Statut ARCHIVED jamais écrit par le runtime | dormant | dormant | Basse | M25 | 2026-03 | Action manuelle future prévue | Besoin d'archivage | Enum DB, CaseView | repo | Confirmé | Garder dormant |
| A3 | Re-pricing après version (QUOTED_VERSIONED → re-priceable) | futur produit | deferred | Basse | M25 | 2026-03 | Choix produit assumé (irréversibilité) | Ticket produit dédié | `generate-quotation-version`, CaseView | repo | Confirmé | Garder tel quel |
| A4 | Emails de cotation IA (corps enrichi au lieu de template statique) | futur produit | closed | — | A4 | 2026-03-27 | Implémenté : template déterministe enrichi, branche IA optionnelle avec fallback, garde post-IA ci-joint, traçabilité timeline. Réserve mineure : replace fragmentaire sur formulations IA (élégance rédactionnelle, pas de risque métier). | — | `create-quotation-email-draft` | repo + chat A4 | Fermé | Aucune action requise |
| A5 | Persistance du rejet des suggestions dérivées | futur produit | dormant | Basse | M27 | 2026-03 | Acceptable avec 1 suggestion | ≥3 suggestions dérivées | CaseView, potentiellement table dédiée | repo | Confirmé | Garder dormant |
| A6 | Intégration SMTP réelle | futur produit | deferred | Conditionnelle | — | 2026-03 | Décision fondamentale "Pas d'auto-send" | Décision produit SMTP | Edge functions send-*, email_drafts | repo | Confirmé | Conditionnel |
| A7 | Filtrage lot-level demandes partenaires P1 Auto-EQ | dette | dormant | Basse | P1 | 2026-03 | Extension schéma quote_gaps nécessaire | Multi-lot mixte fréquent | `build-case-puzzle` (FROZEN) | repo | Confirmé | Garder dormant |
| C2 | Idempotence divergente entre 3 chemins learned_knowledge | dette | watchlist | Basse | M23a | 2026-03-28 | Pré-audit C2 (2026-03-28). 3 stratégies d'idempotence divergentes confirmées : learn-from-content (SELECT+UPDATE/INSERT applicatif), learn-quotation-puzzle (onConflict: "name,category" non sécurisé sans contrainte compatible), analyze-attachments (INSERT+catch 23505, protège uniquement index partiel source_type='attachment'). Aucun index UNIQUE (name, category) en base. Volume doublons marginal : 1 groupe doublon / 1 067 lignes. Cause exacte non prouvée, compatible avec insert concurrent ponctuel. | Volume élevé d'apprentissage auto, ou fréquence de re-runs puzzle/attachments en hausse | `learn-from-content`, `learn-quotation-puzzle`, `analyze-attachments` | repo + DB lecture seule | Confirmé | Dédoublonner d'abord, puis créer index UNIQUE (name, category), puis normaliser les 3 chemins vers stratégie commune |
| C3 | quotation_history à double usage (historique + comparaison) | dette | legacy | Basse | M23b | 2026-03 | Pas de scission envisagée | Jamais (accepté) | `quotation_history` | chat M23b | Confirmé | Garder tel quel |
| C4 | Idempotence P1 Auto-EQ applicative seulement (pas de UNIQUE DB) | dette | watchlist | Basse | P1 | 2026-03 | Mitigé par orchestration séquentielle | Re-runs concurrents fréquents | `build-case-puzzle` (FROZEN) | repo | Confirmé | Garder dormant |
| C5 | Fallback legacy multi-lot (raw_lines pré-M14b) | legacy | pending_validation | Basse | M14b | 2026-03-28 | Revalidation C5 (2026-03-28). Audit repo : fallback localisé uniquement dans `export-quotation-version-pdf/index.ts` L246-264. Vérification DB : 1 snapshot existant avec `lot_index` dans `raw_lines` (case a6a82a70, version a2d7150e, 22 lignes). Le code n'est donc PAS mort — au moins 1 version historique l'utilise potentiellement. `create-quotation-email-draft` n'utilise pas ce fallback. | Suppression sûre seulement si le snapshot a6a82a70 est migré ou supprimé | `export-quotation-version-pdf/index.ts` L246-264 | repo + DB lecture seule | Confirmé (1 cas vivant) | Conserver le fallback ; envisager migration du snapshot si nettoyage souhaité |
| D1 | Scroll-to-section auto sur changement de statut | UX | deferred | Basse | M27 | 2026-03 | Polish non prioritaire | Phase UX dédiée | `CaseView.tsx` | chat M27 | Confirmé | Garder dormant |
| D2 | Actions clôturées collapsibles par défaut | UX | deferred | Basse | M27 | 2026-03 | Mineur | Phase UX dédiée | `CaseView.tsx` | chat M27 | Confirmé | Garder dormant |
| D3 | Panels visibles sans contenu (ExternalRequests en INTAKE) | UX | deferred | Basse | M27 | 2026-03 | Bruit visuel mineur | Phase UX dédiée | `CaseView.tsx` | chat M27 | Confirmé | Garder dormant |
| F1 | Audit P0 métier (précision cotation, 30-50 dossiers) | audit | pending_validation | Opérationnelle | — | 2026-03 | Pré-audit F1.0 (6 dossiers) + revue F1.1 (4 dossiers prioritaires) complétés. Aucun bug moteur critique démontré. Défauts non bloquants identifiés (NULL_TO_ZERO, lignes P5 sans description, service_key absentes). Phase gelée après F1.1 — aucun correctif runtime engagé volontairement avant validation métier. Validation finale bloquée par absence de devis réels SODATRA. | Devis réels SODATRA disponibles pour comparaison E0-E4 | `AUDIT_METIER_P0_PROTOCOL.md`, `audit/p0/`, `/mnt/documents/f1_review_synthesis.json` | repo + runtime | Confirmé | Reprendre comparaison manuelle dès devis disponibles |
| F2 | Smoke test post-M24b (cargo.weight_kg = 22000) | audit | closed | — | M24b | 2026-03-27 | Fix M24b confirmé en runtime : case 29b96eec, weight_kg=840000 → cargoWeight=840 (run 31a65987, 2026-03-27T16:07:19Z) | — | `run-pricing`, `quotation-engine` | chat M24b + runtime proof | Fermé | Aucune action requise |
| S1 | ~~Label `sent` EQ1 sémantiquement ambigu~~ | dette | **closed** | — | EQ1 | 2026-04-08 | Résolu : `email_sent_at` + `email_draft_id` ajoutés, timer stale corrigé, badge UI brouillon/confirmé (emerald vs blue), toast corrigé. Micro-correctif badge couleur appliqué. | — | `external_quote_requests`, `ExternalRequestsPanel`, `getNextAction` | repo | Fermé | Aucune action requise |
| S2 | HUMAN_REVIEW dormant dans l'enum (jamais atteint canoniquement) | dormant | dormant | Basse | M25 | 2026-03 | Supporté défensivement | Jamais (conservé par design) | Enum DB, `generate-quotation-version` | repo | Confirmé | Garder dormant |
| P2B | `create_knowledge` dans `data-admin` inaccessible aux opérateurs non-admin | sécurité | deferred | Moyenne | B1-audit | 2026-03-29 | `create_knowledge` est une écriture opérateur (depuis `QuotationSheet.tsx` L1203) routée via `data-admin` (requireAdmin). Les lectures opérateur ont été extraites vers `data-query` (requireUser) en P2A. L'écriture `create_knowledge` reste dans `data-admin` car c'est une écriture avec implications métier/gouvernance qui nécessite une évaluation séparée : faut-il la déplacer vers `data-query`, créer un endpoint dédié, ou la maintenir en admin-only ? | Opérateur non-admin tente d'utiliser l'apprentissage depuis QuotationSheet, ou décision de gouvernance sur qui peut créer du knowledge | `supabase/functions/data-admin/index.ts` L189-205, `src/pages/QuotationSheet.tsx` L1203 | repo + audit B1 | Confirmé | Évaluer séparément : déplacer vers data-query, endpoint dédié, ou maintenir admin-only |
| RLS-ADMIN | Système de rôles (RBAC) pour pages admin | sécurité | historical_note | Basse | RLS-audit | 2026-03-29 | Évalué lors de l'audit admin/RLS/CRUD. ROI négatif en mono-équipe. Le modèle actuel est shared workspace authenticated CRUD pour les tables de référence, avec protection backend requireAdmin uniquement sur data-admin/email-admin. Les pages admin sont un regroupement UI, pas une frontière d'autorisation. | Ouverture multi-société ou ajout d'opérateurs non-fiables | Pages `/admin/*`, tables de référence, sidebar | repo + audit RLS | Confirmé | Ne pas implémenter tant que mono-équipe. Documenter dans SECURITY_CONTRACT.md. |
| RLS-FIX | DENY ALL sur documents + learned_knowledge corrigé | sécurité | closed | — | RLS-audit | 2026-03-29 | Policies DENY ALL (migration 20251217183036) bloquaient SELECT/DELETE sur `documents` et SELECT sur `learned_knowledge`. Corrigé : drop DENY ALL, ajout SELECT authenticated (+ DELETE authenticated pour documents). Écriture non touchée (passe par service_role via edge functions). | — | `documents`, `learned_knowledge` | repo + DB live | Fermé | Aucune action requise |
| RLS-REF | Write policies manquantes sur 5 tables de référence corrigé | sécurité | closed | — | RLS-audit | 2026-03-29 | Tables hs_codes, tax_rates, customs_regimes, port_tariffs, pricing_client_overrides avaient RLS activé avec uniquement SELECT → écriture bloquée par défaut. Corrigé : ajout INSERT/UPDATE/DELETE TO authenticated selon les besoins de chaque page admin. Modèle = shared workspace authenticated CRUD (choix produit, pas RBAC). | — | 5 tables de référence | repo + DB live | Fermé | Aucune action requise |
| LEG-LOCK | Verrouillage pipeline legacy dans QuotationSheet | architecture | closed | — | LEG-audit | 2026-03-29 | QuotationSheet peut encore créer des artefacts legacy (quotation_history, PDF, email) concurrents au pipeline canonique quand un quote_case existe. Corrigé : `isLegacyLocked` désactive save draft, generate response, exports PDF/Excel, mark as sent quand `quoteCase?.id` est défini. Guards défensifs dans handlers + masquage UI. | — | `QuotationSheet.tsx`, `QuotationHeader.tsx` | repo + audit pipeline | Fermé | Aucune action requise |
| LEG-CLEANUP | Retrait fonctions legacy pures (create-quotation-draft, generate-quotation, generate-quotation-pdf) | dette | deferred | Basse | LEG-audit | 2026-03-29 | Audit post-lockdown (2026-03-29). Ces 3 edge functions ne sont PAS du dead code : elles restent le seul pipeline de création pour `/quotation/new` (Dashboard → "Nouveau devis", QuotationHistory → "Charger comme modèle"). LEG-LOCK les rend inaccessibles quand un quote_case existe, mais le parcours manuel sans email les utilise activement. Retrait = régression produit. | Retrait possible uniquement si : (1) `/quotation/new` supprimé ou migré vers pipeline canonique, ET (2) "Charger comme modèle" redirigé vers CaseView | `create-quotation-draft`, `generate-quotation`, `generate-quotation-pdf`, `src/pages/Dashboard.tsx` L413, `src/pages/admin/QuotationHistory.tsx` L169 | repo + audit pipeline post-lockdown | Confirmé (legacy vivant, fallback actif) | Ne pas retirer. Garder tant que `/quotation/new` est un point d'entrée produit valide |
| FCL-OVR | Override manuel FCL non pris en compte par la détection build-case-puzzle | dette | deferred | Moyenne | PAD-phase3 | 2026-04-02 | Diagnostic complet et patch validé (CTO), hors scope d'exécution phase courante. Phase 3 PAD clôturée sans ce patch ; blocage FCL/LCL confirmé hors scope PAD. Pas d'incident production bloquant immédiat. | Ambiguïté FCL/LCL bloque un smoke test opérateur ou un flux pricing production | `supabase/functions/build-case-puzzle/index.ts` (détection L1755, `detectRequestType` L4249-4314) | repo + diagnostic chat PAD-phase3 | Confirmé (cause racine prouvée) | Patch ~15 lignes : après détection, si `ambiguous_lcl_fcl === true`, lire `quote_facts` manuels (`cargo.container_type`, `cargo.container_count`) source `manual_input`/`operator` ; si exploitable → forcer `SEA_FCL_IMPORT`, `ambiguous_lcl_fcl = false`. Garde-fous : valeur non vide, sources manuelles strictes, log explicite, pas de bypass autres ambiguïtés. Dépendance UI optionnelle : formulaire "Ajouter un fact" CaseView (ne résout rien sans ce patch) |
| DEM-LEGACY | Colonnes `day_1_7/8_14/15_plus` dans `demurrage_rates` — legacy, superseded progressively by `demurrage_tiers` | dette | legacy | Basse | DEM-V1 | 2026-04-02 | Nouveau modèle `demurrage_tiers` créé et peuplé avec 4 tiers prouvés. Colonnes legacy conservées comme fallback tant que le moteur n'est pas migré. | Moteur (`quotation-engine`, `analyze-risks`) branché sur `demurrage_tiers` | `demurrage_rates` colonnes `day_1_7_rate`, `day_8_14_rate`, `day_15_plus_rate` | repo + migration | Confirmé | Supprimer les colonnes legacy uniquement après migration complète du moteur vers `demurrage_tiers` |
| DEM-17FD | Interprétation "17 FD" MSC Dakar — franchise réelle vs franchise de calcul | donnée | pending_validation | Moyenne | DEM-V1 | 2026-04-02 | Mention "17 FD" observée sur factures MSC Dakar. Pourrait signifier 17 free days (vs standard 10j). Non utilisé comme règle métier tant que la logique exacte n'est pas confirmée. | Clarification obtenue de MSC Dakar ou d'un opérateur terrain | Factures MSC BL MEDUF8860316 + MEDUAK978032 | factures réelles | Confirmé | Ne pas modifier `free_days_import` MSC sans preuve formelle de la règle 17 FD |
| DT-NOMENCLATURE | Peuplement `commodity_categories` avec codes terminal Dakar Terminal (storage uniquement) | donnée | legacy | Basse | DT-V1 | 2026-04-02 | **Requalifié legacy (2026-04-03).** Peuplement partiel conservateur effectué : 3/10 catégories PAD peuplées (T05→410, T09→414, T14→412). 7 catégories laissées NULL. Ce mapping PAD→codes terminal est désormais reconnu comme **approximation provisoire, pas comme cible architecturale**. Le bon modèle de résolution du magasinage terminal est par désignation marchandise (cf. DT-DESIGNATION-MODEL), pas par catégorie PAD. **RÈGLE : Tant qu'un modèle par désignation terminale n'existe pas, le moteur ne doit pas consommer `commodity_categories.terminal_storage_code_p1/p2/p3` comme source normative de calcul du magasinage.** | Remplacement par DT-DESIGNATION-MODEL | `commodity_categories` colonnes `terminal_storage_code_p1/p2/p3` | repo + grille officielle 2014 + factures TOM | Confirmé | Ne pas utiliser ces colonnes comme clé d'entrée moteur. Données conservées sans rollback mais requalifiées comme non-cibles. |
| DT-DESIGNATION-MODEL | Modèle de résolution magasinage terminal par désignation marchandise (remplace DT-FINE-MAPPING) | architecture | deferred | Moyenne | DT-V3 | 2026-04-03 | **Remplace DT-FINE-MAPPING.** Phase 1 livrée : table `terminal_designations` créée. Phase 2 livrée : **956 lignes** importées. `tariff_position = int(handling_code)` — équivalence spécifique à ce référentiel, non généralisable. `handling_code` = métadonnée descriptive Dakar Terminal, non consommable moteur manutention DPW. **Phase 3-A livrée et validée métier (2026-04-03)** : résolution provisionnelle P1 dans `run-pricing`. Smoke tests : T1b match exact PASS, T2 non-match PASS (preuves isolées complètes) ; T3 vrac et T4 AIR confirmés indirectement via guards amont, non testés en isolation complète. Bugfix `unit` → `unit_basis` capturé et corrigé. **Phase 3-B.1-A livrée (2026-04-03)** : table `terminal_designation_aliases` créée, 9 alias sûrs seedés (is_validated=true), lookup alias intégré dans `run-pricing` avant match direct Phase 3-A. Smoke tests : T1 alias match PASS (`ceramic tiles` → CARREAUX → 446 040 FCFA), T2 no match PASS, chaîne de résolution DB prouvée. Phase 3-B.1-B (UI admin alias) et Phase 3-B.2 (fallback IA) : **deferred**. | Phase 3-B.1-B : UI admin alias. Phase 3-B.2 : fallback IA. Phase 3-B matching fin, P2/P3, jours réels après franchise | `public.terminal_designations`, `terminal_designation_aliases`, `terminal_tariff_codes`, `run-pricing/index.ts` | grille officielle 2014 (956 désignations importées) | Confirmé | Périmètre strictement magasinage / codification terminal. Ne pas étendre à la manutention ; DPW reste le référentiel séparé via `port_tariffs`. |
| DT-ALIAS-ADMIN-UI | UI admin pour gestion des alias BL → désignation terminale | UI | closed | — | DT-V3-B1 | 2026-04-03 | **Fermé (2026-04-04).** Phase 3-B.1-B livrée : onglet Alias BL dans TerminalStorage.tsx, CRUD complet, validation explicite, normalizeForMatch() cohérent moteur. Workflow validé en conditions réelles (S1-S4). | — | `src/pages/admin/TerminalStorage.tsx` | backlog Phase 3-B.1 | Fermé | Aucune action requise |
| DT-AI-FALLBACK | Fallback IA pour matching BL → désignation terminale (Phase 3-B.2) | architecture | closed | — | DT-V3-B2 | 2026-04-04 | **Phase 3-B.2-A livrée (2026-04-04).** Table `terminal_designation_suggestions` créée. Appel IA (Gemini 2.5 Flash) dans `run-pricing` après échec alias+direct. Anti-duplication (pas de re-appel si pending existe). Score filtré [0,1], max 3 suggestions. Aucune ligne pricing produite. UI admin 3e onglet "Suggestions IA" : accepter, rejeter, accepter+créer alias. Anti-doublon alias. Champ `alias_created` pour traçabilité capitalisation. Statuts : pending/accepted/rejected. | Phase 3-B.2-B éventuelle : multi-marchandise, auto-segmentation composite, P2/P3 | `run-pricing/index.ts`, `terminal_designation_suggestions`, `TerminalStorage.tsx` | backlog Phase 3-B.2 | Fermé | IA = aide à la proposition, pas décideur autonome. Validation opérateur obligatoire. |
| DT-AI-MULTI-CARGO | Auto-segmentation BL composites multi-désignations par IA | architecture | deferred | Basse | DT-V3-B2 | 2026-04-04 | L'IA détecte les textes composites et le signale dans le reasoning, mais aucun découpage automatique multi-désignation n'est implémenté. Validation opérateur obligatoire pour chaque suggestion. | Fréquence élevée de BL composites non traités correctement | `run-pricing/index.ts` | Phase 3-B.2-A | Confirmé | Ne pas implémenter sans analyse statistique des BL composites réels |
| DT-P2P3-ENGINE | Calcul P2/P3 magasinage terminal et jours réels après franchise | architecture | deferred | Moyenne | DT-V3-B | 2026-04-03 | Moteur actuel = provision P1 × 3 jours seulement. P2/P3 nécessitent : jours réels, franchise, paliers progressifs. | Besoin opérationnel de précision sur longue durée de stockage | `run-pricing/index.ts`, `terminal_tariff_codes` | Phase 3-A | Confirmé | Nécessite d'abord un modèle de jours réels après franchise |
| DT-RATE-TABLE | Table `terminal_tariff_codes` — 34 lignes storage (12 familles), handling et révision 419 à suivre | architecture | deferred | Moyenne | DT-V1 | 2026-04-02 | Table créée + peuplement storage Dakar Terminal 2014 : **34 lignes** (12 familles, P1/P2/P3). 33 `official`, 1 `to_confirm` (419/P1). Vague 2 (2026-04-03) : ajout familles 411 (RIZ en sacs, `tonne_per_day`) et 415 (animaux vivants, `unit`). Couverture résultante : P1=100%, P2/P3=98.5%. **Gap résiduel : codes 520/620 (véhicules P2/P3) — référencés dans la nomenclature des désignations (pages 28-29, 32) mais taux FCFA absents du barème officiel page 34 — gap de la source elle-même, non injectés (règle 0-extrapolation).** ~14 désignations véhicules non résolubles en P2/P3. Notes corroboration sur 519/619. **Handling non injecté. DPW non injecté.** | Prochaine étape : investigation écart 419, puis éventuel peuplement handling ou intégration moteur. Codes 520/620 : injectable si source secondaire (facture TOM véhicules, grille post-2014) obtenue. | `public.terminal_tariff_codes` | grille officielle 2014 p.34 + factures TOM | Confirmé | Périmètre strictement magasinage / codification terminal. Ne pas étendre à la manutention ; DPW reste le référentiel séparé via `port_tariffs`. |
| DT-2014-REVISION | Investigation écart taux P1 magasinage Dakar Terminal (grille 2014 vs facture TOM) | donnée | pending_validation | Basse | DT-V1 | 2026-04-02 | Écart observé à investiguer : code 419 (P1 magasinage) = 1 768 FCFA/T/j dans grille 2014 vs 1 964 FCFA/T/j sur facture TOM récente (+11%). P2 et P3 exacts. Cause possible : révision partielle, contexte TOM/TCD spécifique, arrondi, ou surcharge locale. | Obtention d'une grille Dakar Terminal post-2014, ou d'une deuxième facture TOM avec même code pour comparer | Grille 2014 page 34 (code 419), facture TOM (position 138) | grille officielle + facture réelle | Confirmé | Périmètre strictement magasinage / codification terminal. Ne pas étendre à la manutention ; DPW reste le référentiel séparé via `port_tariffs`. Ne pas utiliser le montant 2014 du code 419 comme vérité tarifaire sans consolidation. P2 (519) et P3 (619) exploitables tels quels |

---

## TARIFF-COHERENCE-1 — PORT_DAKAR_HANDLING vs DTHC/THC import

| Champ | Valeur |
|-------|--------|
| **ID** | TARIFF-COHERENCE-1-DEBT |
| **Catégorie** | Pricing / Déduplication |
| **Statut** | `deferred` |
| **Priorité** | Moyenne |
| **Phase d'origine** | TARIFF-COHERENCE-1 |
| **Date** | 2026-04-09 |
| **Déclencheur de réouverture** | Validation métier confirmant si PORT_DAKAR_HANDLING (15K) est un poste distinct ou un doublon du THC import DPW (930K). |
| **Recommandation** | Ne pas fusionner PORT_DAKAR_HANDLING dans le dedup_group TERMINAL_HANDLING tant que la doctrine métier n'est pas arbitrée. Si doublon confirmé, ajouter `'PORT_DAKAR_HANDLING': 'TERMINAL_HANDLING'` dans DEDUP_GROUP_MAP. Si poste distinct, documenter la différence et conserver séparé. |


---

## Top priorités futures

| Rang | ID | Sujet | Valeur |
|------|----|-------|--------|
| 1 | ~~CARRIER-CMACGM-TEMPLATES~~ | ~~Templates CMA CGM manquants~~ | **DONE** (2026-04-05) — 4 templates corrigés + activés, recheck ALL_MATCH |
| 2 | ~~CARRIER-MSC-EMANIF~~ | ~~Micro-gap MSC manifeste électronique~~ | **DONE** (2026-04-06) — template EMANIF 550 XOF/BL inséré, recheck D1 ALL_MATCH 100% |
| 3 | B1-B | Isolation case_documents + storage | Pré-requis ouverture multi-société (B1-A email_drafts déjà traité) |
| 4 | F1 | Audit P0 métier | Validation justesse tarifaire |
| 5 | CARRIER-GRIMALDI-RORO | Chantier Grimaldi RORO | Modèle facturation RORO quasi non couvert (1.1%) |
| 6 | EXPORT-PRICING-SOURCING | Sourcing tarifaire réel des 7 codes export | Priorité : SEA_FREIGHT > THC_EXPORT > DOCUMENTATION_BL > VGM_WEIGHING > STUFFING_FACTORY > STUFFING_CFS > EMPTY_REPO |
| 7 | EXPORT-HS-NORMALIZATION-MULTILOT | Incohérence HS 8 vs 10 digits inter-lots | **Phase A livrée et validée runtime** — garde mergeFactsForLot + fallback SH6 candidat unique. Validation run #6 (2026-04-07) : 5 lots homogènes sur `0801310000`, warning 8 digits disparu |
| 8 | EXPORT-CUSTOMS-SEMANTICS | Sémantique CUSTOMS_EXPORT / duties_total export | Clarification labels avant première offre client |
| 9 | COM-1A | Envoi réel emails partenaires (SMTP) — décision produit + secrets + traçabilité | Prérequis : S1 livré (email_sent_at). COM-1A remplira email_sent_at après transmission SMTP réussie. |
| — | ~~S1~~ | ~~Clarification sémantique statut partenaire (email_sent_at)~~ | **DONE (2026-04-08)** — Colonnes `email_sent_at` + `email_draft_id` ajoutées sur `external_quote_requests`. Timer stale basé sur `email_sent_at ?? sent_at`. Badge UI distinct brouillon/confirmé. Toast corrigé. Aucun changement d'enum. |
| 10 | COM-3 | SLA / relances partenaires | Badges overdue, relances brouillon, nécessite COM-1A |
| 11 | COM-4 | Comparaison multi-offres + réponse client consolidée | Vue comparative par lot/purpose, sélection offre retenue |
| — | ~~COM-2A~~ | ~~Auto-matching réponses partenaires~~ | **DONE (2026-04-07)** — table `partner_response_suggestions`, edge function `auto-match-partner-responses` (scan/confirm/reject), hook `usePartnerSuggestions`, UI intégrée dans ExternalRequestsPanel, correctif final confirm : analyse EQ1 avant passage à accepted |
| — | ~~A6~~ | ~~Intégration SMTP~~ | **closed — absorbé par COM-1A** |
| — | ~~COCKPIT-2~~ | ~~Garde-fous communication SendQuotationPanel~~ | **DONE (2026-04-08)** — Avertissements (non bloquants) dans SendQuotationPanel : demandes partenaires non clôturées (tout sauf `closed`), faits partenaires `proposed`, clarifications client `drafted`/`sent`/`answered`. Rappel dans dialog de confirmation. `canSend` inchangé (opérateur souverain). Fichiers : `useSendQuotation.ts`, `SendQuotationPanel.tsx`. Aucune migration DB. |
| — | ~~COCKPIT-3~~ | ~~Résumé communication dossier (widget case-level)~~ | **DONE (2026-04-08)** — Composant `CommunicationSummaryCard.tsx` dans CaseView, juste avant ExternalRequestsPanel. 3 requêtes parallèles (filtres COCKPIT-2). Badge global vert/amber. Mini-liste partenaires. staleTime 30s. Aucune migration DB. Aucune zone FROZEN. |

---

## Tableau de sourcing tarifaire export (EXPORT-PRICING-SOURCING)

État au 2026-04-07 — confirmé par run #3 dossier 76c9819c.

| Priorité | Service | Source visée | Nature tarif | Unité | Règle quantité | Mode MAJ | Statut catalogue |
|----------|---------|-------------|--------------|-------|-----------------|----------|-----------------|
| 1 | SEA_FREIGHT | Cotations compagnies maritimes (CMA CGM, MSC, Grimaldi) par destination/type conteneur | compagnie | EVP | `service_quantity_rules` existante | Rate card ou saisie manuelle | 0 XOF placeholder |
| 2 | THC_EXPORT | Barème terminal export (DP World / MPTC Dakar) | officiel | EVP | `service_quantity_rules` existante | Document officiel tarifaire | 0 XOF placeholder |
| 3 | DOCUMENTATION_BL | Compagnie maritime / agent | compagnie | BL | `service_quantity_rules` existante | Grille agent | 0 XOF placeholder |
| 4 | VGM_WEIGHING | Peseur agréé / terminal | prestataire | EVP | `service_quantity_rules` existante | Contrat prestataire | 0 XOF placeholder |
| 5 | STUFFING_FACTORY | Manutentionnaire usine | prestataire | EVP | `service_quantity_rules` existante | Contrat prestataire | 0 XOF placeholder |
| 6 | STUFFING_CFS | Terminal CFS / magasin | prestataire | EVP | `service_quantity_rules` existante | Contrat prestataire | 0 XOF placeholder |
| 7 | EMPTY_REPO | Dépôt conteneurs vides | prestataire | EVP | `service_quantity_rules` existante | Contrat dépôt | 0 XOF placeholder |

Note : AGENCY (frais agence) est dans le package mais déjà géré par la grille interne SODATRA — pas dans le scope sourcing externe.

---

## Éléments à revalider avant action

| ID | Sujet | Ce qu'il faut vérifier | Pourquoi |
|----|-------|----------------------|----------|
| E4 | PHASE_15_NOTES config | Vérifier si le document est encore consulté ou purement archivé | Si archivé, pas besoin de corriger |
| C5 | ~~Revalidé 2026-03-28~~ | ~~1 snapshot vivant trouvé (a6a82a70). Fallback conservé.~~ | ~~Ligne C5 mise à jour dans le backlog principal~~ |

---

## PAD — Sujets différés

| ID | Catégorie | Statut | Priorité | Phase d'origine | Date | Déclencheur de réouverture | Recommandation |
|----|-----------|--------|----------|----------------|------|---------------------------|----------------|
| PAD-IA | PAD matching IA | `deferred` | moyenne | PAD-1 | 2026-04-04 | Quand le dictionnaire d'alias PAD atteint ses limites de couverture (>20% de descriptions non résolues) | Implémenter un fallback IA similaire au magasinage (Phase PAD-2), avec validation opérateur obligatoire |
| PAD-ADMIN-UI | UI admin alias PAD | `closed` | — | PAD-1 | 2026-04-04 | ✅ Livré — onglet "Alias PAD" dans CommodityCategories.tsx, enrichissement T14 (6 alias), total 57 alias | Aucune action requise |
| PAD-MULTI-LOT | PAD multi-lot | `deferred` | basse | Phase 3 | 2026-04-02 | Quand un dossier multi-lot nécessite des catégories PAD différentes par lot | Extension du schéma quote_gaps et des facts par lot |
| PAD-T06-T08-T10-T11 | Audit référentiel catégories PAD absentes (T06, T08, T10, T11) | `deferred` | moyenne | PAD-1 | 2026-04-05 | Non-matchs réels en exploitation montrant des descriptions relevant de ces catégories | Mini-audit : vérifier dans les données existantes (commodity_designation_matches, emails, quotations) si ces catégories sont un oubli ou un choix de périmètre volontaire |
| PAD-GRIMALDI-T09 | Écart tarif PAD Grimaldi : facture 2 715 XOF/t vs DB 4 367 XOF/t — régime RORO à clarifier | donnée | `pending_validation` | moyenne | Blind-F1.0 | 2026-04-05 | Clarification obtenue de Grimaldi/PAD ou 2e facture Grimaldi avec même code pour comparer | Ne pas modifier le tarif T09 sans preuve formelle. Écart peut être dû à régime RORO spécifique, tarif négocié, ou classification facture différente |
| CARRIER-CMACGM-TEMPLATES | Templates carrier billing CMA CGM — 4 templates corrigés et activés | carrier | `closed` | P0 | Blind-F1.0 | 2026-04-05 | — | **DONE.** ISPS_TERM (8.85 EUR), LOC_TERM (11.50 EUR), TBL (25 000 XOF), SVC (18 000 XOF) corrigés, activés, source_documents tracés (D5/D6 blind audit). Recheck post-patch : ALL_MATCH sur D5 et D6. Réserve : montants dérivés de 2 factures, reclassables en `is_variable` si 3e dossier contredit |
| CARRIER-GRIMALDI-RORO | Templates carrier billing Grimaldi RORO — carrier lines corrigées | carrier | `closed` | P2 | Blind-F1.0 | 2026-04-06 | — | **DONE carrier.** 3 templates corrigés/activés (TBL 25 000 XOF, SVC 18 000 XOF, TRL 15 000 XOF) + 1 inséré (EMANIF 550 XOF). Recheck D4 : ALL_CARRIER_LINES_MATCH 5/5 carrier (100%). Ligne Taxe de Port (38 010 XOF) exclue → PAD-GRIMALDI-T09 scope. Réserves : TRL=Telex Release provisoire (matched by amount/carrier/invoice context), montants dérivés d'1 seule facture RORO |
| CARRIER-MSC-EMANIF | Micro-gap MSC manifeste électronique — template EMANIF ajouté | carrier | `closed` | P1 | Blind-F1.0 | 2026-04-06 | — | **DONE.** Template EMANIF inséré : 550 XOF/BL, PER_BL, DOCUMENTATION, is_active=true. Source : D1 blind audit sample - MSC invoice. Recheck D1 post-insert : ALL_MATCH 8/8 lignes, 100% couverture. Réserve : montant fixe 550 dérivé d'1 facture, reclassable is_variable si 2e dossier contredit |
| EXPORT-DB-ENUM | Badge request_type ne peut pas stocker EXPORT_SENEGAL — enum DB import-only | dette | `deferred` | basse | Export-patch | 2026-04-07 | Enum `quote_request_type` ne contient que des types import. Le patch export gap profile (STRUCTURAL_PATCH_ALLOWED 2026-04-07) corrige la logique de gaps via `gapProfileType` mais le badge DB reste un type import. | Migration DB ajoutant `EXPORT_SENEGAL` à l'enum `quote_request_type` + mise à jour de `build-case-puzzle` L3667/L3853 pour écrire le type export | Pas d'impact fonctionnel immédiat : la gap analysis utilise `gapProfileType`, seul le badge UI est affecté |
| EXPORT-PRICING-SOURCING | Sourcing tarifaire réel des 7 codes export à 0 XOF | pricing | `deferred` | moyenne | P7-export | 2026-04-07 | Verrou technique levé : 6 codes dans whitelist moteur, catalogue placeholder FIXED à 0 XOF, quantification OK. Tarifs réels à alimenter via pricing_rate_cards ou mise à jour catalogue. Confirmé run #3 dossier 76c9819c : 7 lignes P5/lot injectées correctement, PORT_CHARGES (12 000) et CUSTOMS_EXPORT (200 000) valorisés, les 5 autres à 0 XOF source catalogue_sodatra. | Rate cards reçues de l'opérateur ou source officielle port/terminal | Pas de régression : lignes à 0 visibles dans l'offre, filtrables par l'opérateur |
| EXPORT-HS-NORMALIZATION-MULTILOT | Incohérence normalisation HS code entre lots sur dossiers export multi-lot | moteur/normalisation | `confirmed — Phase A livrée et validée runtime` | moyenne | P7-export | 2026-04-07 | Dossier 76c9819c run #3 : lots 1-2 évalués avec HS `08013100` (8 digits, non trouvé dans hs_codes), lots 3-5 évalués avec `0801310000` (10 digits, trouvé). **Cause racine prouvée par audit DB** : lots 1-2 portent `cargo.hs_code = "08013100"` dans `extracted_facts_json`, qui écrase le global 10 digits via `mergeFactsForLot()`. **Phase A livrée dans le repo (2026-04-07)** : (1) garde dans `mergeFactsForLot()` empêche écrasement du global 10-digit par un lot-level court avec même SH6, (2) fallback SH6 candidat unique dans `quotation-engine` — exact match prioritaire, puis résolution SH6 seulement si 1 seul candidat 10-digit existe, sinon non-résolu. Exception STRUCTURAL_PATCH_ALLOWED documentée dans MASTER_CONTEXT.md. **Validation runtime (run #6, 2026-04-07)** : après redéploiement edge functions, lots 1-2 résolus en `0801310000`, warning HS 8 digits disparu, 5 lots homogènes. | Phase B (architecture multi-couche HS source/ancrage/Sénégal) : cf. HS-MULTI-LAYER-ARCHITECTURE | Patch Phase A minimal et défensif. Aucune sur-correction arbitraire. |
| HS-MULTI-LAYER-ARCHITECTURE | Architecture multi-couche HS : source → ancrage SH6 → code Sénégal | architecture | `deferred` | moyenne | P7-export | 2026-04-07 | **Phase B du chantier HS.** Règle métier : le SH est harmonisé mondialement à 6 chiffres seulement. Au-delà, chaque pays/union applique ses propres subdivisions. L'architecture cible doit séparer : `cargo.hs_code_source` (code brut client), `cargo.hs6_anchor` (6 digits harmonisés), `cargo.hs_code_sn` (code Sénégal/UEMOA résolu), `cargo.hs_confidence`, `cargo.hs_resolution_method` (exact/sh6_match/operator_confirmed/unresolved). Le moteur pricing doit consommer `cargo.hs_code_sn` à terme. UI opérateur requise pour résolution ambiguë (plusieurs candidats sous un même SH6). | Fréquence élevée de codes clients non-10-digits, ou premier dossier multi-SH6 ambiguë | Nécessite : nouveaux fact keys dans build-case-puzzle, résolution enrichie, UI opérateur, migration moteur pricing vers cargo.hs_code_sn |
| EXPORT-CUSTOMS-SEMANTICS | Sémantique CUSTOMS_EXPORT et duties_total en contexte export sénégalais | métier/sémantique | `watchlist` | basse | P7-export | 2026-04-07 | Le dossier export 76c9819c affiche encore des lignes `duties_total` et `CUSTOMS_EXPORT` à 200 000 XOF/lot. À l'export sénégalais, il n'y a pas de droits et taxes de sortie comparables à l'import. Le montant CUSTOMS_EXPORT couvre les frais de dédouanement export (honoraires/formalités), pas des droits de douane. Le label et la présentation au client doivent refléter cette distinction. `duties_total` est un artefact du moteur FROZEN import (cf. EXPORT-QE-FROZEN). | Première offre export envoyée à un client — le libellé doit être clair avant envoi | Clarifier le label CUSTOMS_EXPORT comme "Frais de dédouanement export" (pas "droits de douane"). Filtrer ou annoter `duties_total` dans le rendu export. Ne pas confondre honoraires dédouanement et taxation douanière. |
| COCKPIT-4B | Plan d'actions dossier — 12 étapes orientées communication réelle | cockpit/UX | `DONE` | moyenne | COM/COCKPIT | 2026-04-08 | Livré zip 39. CaseActionPlan.tsx : 12 étapes décomposant boucles partenaire (préparer/confirmer envoi/traiter réponses) et client (envoyer clarifications/analyser réponses). Étape 4 "Confirmer l'envoi" honnête pré-COM-1A (done seulement si email_sent_at renseigné). 3 queries supplémentaires (draftPartnerRequests, unsentPartnerRequests, draftedClientGaps). Filtres alignés COCKPIT-2/COCKPIT-3. Contrôle PDF corrigé (quotation_documents). Composant autonome, lecture seule, aucune mutation, aucune migration. |
| COCKPIT-4C | Séparation visuelle Communication / Consolidation dans le plan d'actions | cockpit/UX | `DONE` | basse | COM/COCKPIT | 2026-04-08 | Livré. Ajout de labels de section "Communication" et "Consolidation commerciale" dans CaseActionPlan.tsx pour séparer visuellement les 12 étapes en 2 groupes logiques. Aucune logique métier modifiée, aucune query ajoutée, rendu uniquement. |
| COCKPIT-5-P1 | Suggestion prudente des partenaires à contacter | cockpit/UX | `DONE` | moyenne | COM/COCKPIT | 2026-04-08 | PartnerSuggestionPanel autonome. Croise routing.transport_mode (quote_facts) avec known_business_contacts (rôle supplier/partner/agent). Maritime → filtre Armateur + agents. Préremplissage formulaire ExternalRequestsPanel via onPrefill. Badge "déjà contacté" par croisement normalisé partner_name. Aucune migration, aucune mutation nouvelle, aucun matching route-carrier (données absentes). Validé fonctionnellement sur dossier maritime réel (case 57f0043c, MSC, freight_rate). |
| COCKPIT-5-P2 | Enrichissement known_business_contacts (contact_email, service_types) | cockpit/données | `DONE` | moyenne | COM/COCKPIT | 2026-04-08 | Livré. Migration : contact_email TEXT NULL, service_types TEXT[] NOT NULL DEFAULT '{}'. PartnerSuggestionPanel enrichi : derivePurpose() priorise service_types, affiche icône email, passe email dans onPrefill. ExternalRequestsPanel : préremplissage email. |
| COCKPIT-6 | Brief intelligent partenaire + compteurs opérationnels honnêtes | cockpit/UX | `DONE` | moyenne | COM/COCKPIT | 2026-04-08 | Livré. Volet A : query autonome quote_facts dans PartnerSuggestionPanel, buildBriefText() génère brief 3-6 lignes (route, cargo, client, timing), injection dans purpose_detail si vide. Volet B : badges conditionnels dans CaseActionPlan (à préparer, envois à confirmer, faits à valider, clarifications à envoyer, gaps bloquants). Aucune migration, aucune mutation, données déjà calculées. |

---

## PAD-GAP-1-DEBT — Fallback tarif max PAD si client ne répond pas

| Champ | Valeur |
|-------|--------|
| **ID** | PAD-GAP-1-DEBT |
| **Catégorie** | Pricing / PAD |
| **Statut** | `reporté` |
| **Priorité** | Basse |
| **Phase d'origine** | PAD-GAP-1 |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | Client ne répond pas à la demande de clarification dans un délai configurable (ex: 48h). |
| **Recommandation** | Option 2 alternative : appliquer le tarif PAD maximal (T01 = 28 100 FCFA/t) comme fallback conservateur si le gap `pricing.pad_category` reste ouvert au-delà d'un seuil. Permet de débloquer le pricing sans sous-estimer. À valider avec doctrine métier avant implémentation. |

---

## ORCH-ACTION-2 — Envoi SMTP réel depuis le panneau d'actions

| Champ | Valeur |
|-------|--------|
| **ID** | ORCH-ACTION-2 |
| **Catégorie** | Communication client / Orchestration |
| **Statut** | `reporté` |
| **Priorité** | Haute |
| **Phase d'origine** | ORCH-ACTION-1 |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | Dépend de COM-1A (envoi SMTP réel). Quand COM-1A sera livré, le bouton "Marquer envoyé" pourra être remplacé par un vrai bouton "Envoyer" avec envoi effectif. |
| **Recommandation** | Ajouter un envoi SMTP réel derrière le bouton "Envoyer la clarification" dans ReadyActionsPanel. Nécessite l'intégration SMTP (COM-1A). En attendant, le workflow est : copier le message → envoyer manuellement → marquer envoyé dans l'app. |

---

## PORT-DAKAR-HANDLING-AUDIT — Validation métier PORT_DAKAR_HANDLING

| Champ | Valeur |
|-------|--------|
| **ID** | PORT-DAKAR-HANDLING-AUDIT |
| **Catégorie** | Pricing / Tariff validation |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | PRICING-AUDIT-1 |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | (1) Retour métier sur la légitimité du poste PORT_DAKAR_HANDLING distinct de THC IMPORT. (2) Confiance actuelle = 69% (faible). (3) Le commentaire L302 dans run-pricing exclut explicitement ce poste du dedup DTHC en attendant validation. |
| **Recommandation** | Ne pas supprimer le poste. Attendre validation métier explicite avant de l'inclure ou l'exclure définitivement. Le `dedup_group` est `PORT_DAKAR_HANDLING` (distinct de `TERMINAL_HANDLING` pour DTHC), donc pas de doublon technique, mais la justification métier reste à confirmer. |

---

## CARRIER-PORT-TAX-1B — Provisionnement prudent carrier inconnu (Option B)

| Champ | Valeur |
|-------|--------|
| **ID** | CARRIER-PORT-TAX-1B |
| **Catégorie** | Pricing / Décision produit |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | CARRIER-PORT-TAX-1B |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | (1) Décision métier explicite sur le périmètre des postes à provisionner (TXI seul ? EDO ? ISPS ?). (2) Arbitrage sur la comparabilité PER_BL vs PER_CNT pour le calcul du "max". (3) Validation de l'introduction de `source.type: 'ESTIMATED'` dans le pipeline. (4) MSC THO et Maersk FAI restent variables sans montant exploitable — à enrichir quand des montants réels seront collectés. |
| **Recommandation** | Ne pas implémenter tant que les questions métier ne sont pas tranchées. Option A (carrier connu uniquement) est en place. La distinction "À confirmer" vs "Estimé" vs "Calculé" est saine en principe mais nécessite un cadrage produit avant injection dans le moteur. |

---

## TIMELINE-DEDUPE-1 — quotation_email_draft_v1 sans dedupe_key

| Champ | Valeur |
|-------|--------|
| **ID** | TIMELINE-DEDUPE-1 |
| **Catégorie** | Timeline contract / Idempotence |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | P1-C |
| **Date** | 2026-04-11 |
| **Déclencheur de réouverture** | (1) Doublons observés en production pour `quotation_email_draft_v1`. (2) Besoin d'idempotence stricte sur la génération d'email de cotation. |
| **Recommandation** | Ajouter un `dedupe_key` dans le `event_data` écrit par `create-quotation-email-draft` pour aligner avec le contrat canonique P1-C. Le fix est trivial (une ligne) mais non bloquant actuellement car l'écriture est en try/catch best-effort. |

---

## P2-C-AIR-SCOPE — Garde-fou aérien non validé par signal réel

| Champ | Valeur |
|-------|--------|
| **ID** | P2-C-AIR-SCOPE |
| **Catégorie** | Scope contractuel / Suggestions partenaires |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | P2-C |
| **Date** | 2026-04-11 |
| **Déclencheur de réouverture** | (1) Dossier aérien où le fret est hors scope (rare mais possible). (2) Ajout d'un champ `air_scope` dans `service_scope_v1`. |
| **Recommandation** | Le garde-fou P2-C utilise `freightScope` de `service_scope_v1` pour bloquer `freight_rate` et `air_tariff` symétriquement. Mais `air_scope` n'existe pas encore comme champ distinct dans le payload de `analyze-service-scope`. Le garde-fou aérien est conservatif par symétrie mais non validé par un signal réel dédié. À terme, envisager un champ `air_scope` séparé si les cas aériens hors-scope deviennent fréquents. |

---

## P2-D-LOT2 — Scope-driven dégradation NextActionBanner + ReadyActionsPanel

| Champ | Valeur |
|-------|--------|
| **ID** | P2-D-LOT2 |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `fermé` |
| **Priorité** | Moyenne |
| **Phase d'origine** | P2-D |
| **Date de fermeture** | 2026-04-11 |
| **Résolution** | Implémenté via `useQualifiedScopeGate(caseId)`. NextActionBanner step 8 : dépromotion "Confirmer le périmètre du dossier" (amber). ReadyActionsPanel step 8 : priorité "later". Seul `unconfirmed + scope_confirmed` déclenche. `out_of_scope` et `scope_absent` neutres. 1 query facts légère partagée ajoutée (7 keys). |

---

## P2-D-PRICING-SCOPE — Brancher PricingLaunchPanel sur qualifyScope avec facts réels

| Champ | Valeur |
|-------|--------|
| **ID** | P2-D-PRICING-SCOPE |
| **Catégorie** | Scope / Pricing UI |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | P2-D Lot 1 |
| **Date** | 2026-04-11 |
| **Déclencheur de réouverture** | PricingLaunchPanel reçoit les facts réels du dossier (via prop ou query dédiée) |
| **Recommandation** | Réintroduire le wording conditionnel dérivé de `qualifyScope()` dans PricingLaunchPanel uniquement quand les facts structurants (hs_code, cargo_value, transport_mode, etc.) sont disponibles dans le composant. Ne pas passer `facts: {}` ni `caseStatus: "INTAKE"` en dur. |

---

## PJ-BODYSTRUCTURE-FALLBACK — Fallback BODYSTRUCTURE pour images dans import-thread

| Champ | Valeur |
|-------|--------|
| **ID** | PJ-BODYSTRUCTURE-FALLBACK |
| **Catégorie** | pipeline/import |
| **Statut** | `dormant` |
| **Priorité** | P3 |
| **Phase d'origine** | P0-3 |
| **Date** | 2026-04-11 |
| **Déclencheur de réouverture** | Preuve d'une PJ image manquée à l'import IMAP (pas seulement à l'analyse). Cas concret où le fallback BODYSTRUCTURE de `import-thread`/`sync-emails` ne détecte pas une extension image dans sa regex de secours. |
| **Recommandation** | Élargir la regex BODYSTRUCTURE fallback dans `import-thread` et `sync-emails` pour couvrir `.jfif`, `.webp`, `.jpeg` en plus des formats actuels. Non traité car aucune preuve sur le runtime actuel que des PJ sont perdues à l'import (le problème observé était à l'analyse, pas à l'import). |

---

## CLAIM-BULK-POSTGREST — Bulk fetch filter encore dépendant de PostgREST

| Champ | Valeur |
|-------|--------|
| **ID** | CLAIM-BULK-POSTGREST |
| **Catégorie** | Edge Function / PostgREST cache |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | Hotfix RPC claim bypass (2026-04-11) |
| **Date** | 2026-04-11 |
| **Déclencheur de réouverture** | Le mode bulk/start de `analyze-attachments` (sans `attachmentId`) est utilisé en production et échoue avec `column does not exist` sur `analysis_claimed_at`. |
| **Recommandation** | Le pattern E (ligne ~1109 de `analyze-attachments/index.ts`) utilise `.or('analysis_claimed_at.is.null,analysis_claimed_at.lt...')` via PostgREST pour le fetch bulk. Ce filtre reste vulnérable au cache PostgREST obsolète. Solution : créer une RPC `fetch_unclaimed_attachments(p_limit int)` qui retourne les PJ non analysées et non claimées, ou claimées depuis >15 min. Non bloquant pour le flux `build-case-puzzle` qui passe toujours un `attachmentId` explicite. |

---

## ATT-ERROR-RETRY — Mécanisme de reset pour relancer l'analyse des PJ en erreur terminale

| Champ | Valeur |
|-------|--------|
| **ID** | ATT-ERROR-RETRY |
| **Catégorie** | Email pipeline / Attachments |
| **Statut** | `done` |
| **Priorité** | Basse |
| **Phase d'origine** | Stabilisation pipeline PJ (P0+P1) |
| **Date clôture** | 2026-04-13 |
| **Résolution** | RPC `reset_attachment_for_retry` (SECURITY DEFINER) remet la PJ en état vierge (`is_analyzed=false`, `analysis_claimed_at=null`, `extracted_text=null`, `extracted_data=null`) uniquement si `extracted_data->>'type' = 'error'`. Bouton "Relancer l'analyse" ajouté dans `EmailAttachments.tsx` pour statut `error` uniquement. `unsupported` et `skipped` restent non relançables. |
| **Dette résiduelle pipeline PJ** | Observabilité des retries (compteur, historique), chemins parallèles d'analyse, et traçabilité enrichie des resets restent hors périmètre de ce lot. |

---

## COMPOSITE-DOC-2 — Exploitation de documents[] dans build-case-puzzle

| Champ | Valeur |
|-------|--------|
| **ID** | COMPOSITE-DOC-2 |
| **Catégorie** | Extraction / Puzzle pipeline |
| **Statut** | `ouvert` |
| **Priorité** | Haute |
| **Phase d'origine** | COMPOSITE-DOC-1 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Dès que COMPOSITE-DOC-1 est déployé et validé sur un PDF composite réel. |
| **Recommandation** | Dans `build-case-puzzle`, exploiter `extracted_data.documents[]` pour un mapping différencié par `doc_type` : priorité de source par type documentaire (ex: `commercial_invoice` pour `cargo.value`, `bill_of_lading` pour `transport.bl_number`). Ne pas fusionner aveuglément les sous-documents. |

---

## COMPOSITE-DOC-3 — Affichage UI des sous-documents

| Champ | Valeur |
|-------|--------|
| **ID** | COMPOSITE-DOC-3 |
| **Catégorie** | UI / Case documents |
| **Statut** | `done` — implémenté dans `AnalysisResultsDisplay.tsx` (section Collapsible avec doc_type/page_range/confidence/summary) |
| **Priorité** | Moyenne |
| **Phase d'origine** | COMPOSITE-DOC-1 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Quand COMPOSITE-DOC-2 est en place et que les sous-documents sont exploités dans les faits. |
| **Recommandation** | Afficher dans `AnalysisResultsDisplay` et/ou `CaseDocumentsTab` les sous-documents détectés (`documents[]`) avec leur type, plage de pages, et résumé. Permettre à l'opérateur de voir la provenance des données extraites. |

---

## ATT-REANALYZE — Mécanisme de re-analyse pour PJ non-error

| Champ | Valeur |
|-------|--------|
| **ID** | ATT-REANALYZE |
| **Catégorie** | Attachment pipeline / Lifecycle |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | COMPOSITE-DOC-1 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Besoin de re-analyser une PJ déjà analysée (type ≠ error) avec un prompt enrichi. |
| **Recommandation** | `reset_attachment_for_retry` est réservé aux PJ en statut `error`. Il faut un mécanisme propre (ex: RPC dédiée ou flag `force_reanalyze`) pour permettre la re-analyse d'une PJ déjà traitée sans contourner le runtime par manipulation manuelle du type. |

---

## COMPOSITE-DOC-3 — Affichage UI des sous-documents

| Champ | Valeur |
|-------|--------|
| **ID** | COMPOSITE-DOC-3 |
| **Catégorie** | UI / Attachments |
| **Statut** | `done` — fusionné avec l'entrée COMPOSITE-DOC-3 ci-dessus |
| **Priorité** | Basse |
| **Phase d'origine** | COMPOSITE-DOC-2 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Besoin opérateur de voir les sous-documents individuels d'un PDF composite dans l'UI. |
| **Recommandation** | Ajouter un affichage des `documents[]` dans le panneau PJ du CaseView, avec type documentaire et page range. |

---

## FOB-FACT-KEY — Fact key canonique pour valeurs FOB

| Champ | Valeur |
|-------|--------|
| **ID** | FOB-FACT-KEY |
| **Catégorie** | Data model / Cargo values |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | COMPOSITE-DOC-2 (micro-correction Bonus C) |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Dossier avec valeur FOB distincte de la valeur CIF/CAF et du fret. |
| **Recommandation** | Décider d'une fact key canonique dédiée (`cargo.fob_value` ?) et l'intégrer dans le pipeline d'extraction. FOB ne doit pas être mappé vers `freightValue` (métierment faux). |

---

## COMPOSITE-DOC-TIMELINE — Traçabilité doc_type dans timeline events

| Champ | Valeur |
|-------|--------|
| **ID** | COMPOSITE-DOC-TIMELINE |
| **Catégorie** | Traçabilité / Timeline |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | COMPOSITE-DOC-2 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Besoin d'audit ou de traçabilité fine sur la provenance documentaire des facts injectés. |
| **Recommandation** | Enrichir `event_data` des timeline events avec le `doc_type` source lors de l'injection COMPOSITE-DOC-2. Retiré du lot initial par consigne CTO. |

---

## Audit CTO consolidé — 2026-04-14

> Cette section distingue strictement les constats prouvés par le repo, les constats issus du runtime/cloud externe, et les sujets restant à confirmer. Aucun point runtime externe ne doit être promu au rang de vérité repo sans preuve dans le dépôt.
>
> Tout correctif technique futur doit mettre à jour cette section au moment du patch.

### A. Confirmé par le repo

| ID | Sévérité | Statut | Preuve | Impact | Plus petit correctif sûr |
|----|----------|--------|--------|--------|--------------------------|
| AUTH-HIST-1 | critical | open | `quotation-engine/index.ts` L383-387 envoie `Bearer ${serviceKey}` à `suggest-historical-lines`. `suggest-historical-lines/index.ts` L110-120 valide via `anonClient.auth.getUser(token)` — un service role key n'est pas un JWT GoTrue → échec systématique. | Suggestions historiques mortes silencieusement. `quotation-engine` log des UPSTREAM_DB_ERROR 401. Fonctionnalité entière (recommandation de lignes tarifaires historiques) inopérante. | Fix dans `suggest-historical-lines` (non FROZEN) : accepter service role key comme auth alternative. |
| OUTCOME-AUTH-1 | high | open | `close-commercial-outcome/index.ts` L87 : `userId = authResult.id`. Mais `_shared/auth.ts` L15-18 : `AuthResult = { user: { id }, token }` → `authResult.id` est `undefined`. Conséquence directe : `actor_user_id` est `null` dans timeline events `status_changed` (SENT→ACCEPTED/REJECTED), et dans tous les `logRuntimeEvent` de cette fonction. | Traçabilité opérateur perdue sur tous les outcomes commerciaux. Pas un stop-ship du pipeline canonique mais perte d'audit trail. | Changer L87 en `userId = authResult.user.id` (1 ligne). |
| UI-ADMIN-1 | medium | deferred (= P2B) | `QuotationSheet.tsx` L1206 appelle `data-admin` action `create_knowledge`. `data-admin/index.ts` est protégé par `requireAdmin`. Un opérateur non-admin reçoit un 403. | Fonctionnalité apprentissage inaccessible aux non-admins depuis QuotationSheet. | Déplacer vers `data-query` ou endpoint dédié, ou maintenir admin-only (décision produit). Voir P2B. |
| TIMELINE-DEDUPE-1 | low | open | `create-quotation-email-draft/index.ts` écrit `quotation_email_draft_v1` sans `dedupe_key`. | Doublons timeline possibles mais atténués par try/catch best-effort. | Ajouter `dedupe_key` (1 ligne). |
| GENERATE-RESPONSE-LIVE | medium | watchlist | `emailService.ts` L105, L500 ; `Emails.tsx` L367 ; `QuotationSheet.tsx` L1366 — `generate-response` encore appelé depuis l'UI (fallback C1 + legacy paths). | Fonction legacy vivante, appelle `quotation-engine` (FROZEN). Pas morte. | Aucun correctif immédiat — legacy vivant par design. |

### B. Confirmé par runtime/cloud externe (source : audit Lovable 2026-04-14)

> Les constats ci-dessous proviennent d'observations runtime et requêtes DB live effectuées lors de l'audit. Ils ne sont pas prouvables par le seul dépôt de code.

| ID | Sévérité | Source | Impact | Statut |
|----|----------|--------|--------|--------|
| OBS-HIST-1 | info | `runtime_events` : 126 erreurs AUTH_INVALID_JWT pour `suggest-historical-lines` | Confirme AUTH-HIST-1 en production réelle | lié à AUTH-HIST-1 |
| ATTACH-OPS-1 | medium | DB live : 114/259 PJ non analysées (44%) | Facts potentiellement manquants sur dossiers anciens. PJ-ANALYSIS-ON-PUZZLE les traite progressivement au rebuild. | watchlist |
| PRICING-RUNS-WATCH-1 | low | DB live : 30 pricing runs `failed`, 20 `blocked` sur 133 total | À surveiller — vérifier si récurrents ou ponctuels anciens | watchlist |
| CONTACTS-DENY-1 | low | pg_policies live : DENY ALL sur table `contacts`. Aucun usage UI actif identifié lors de la revue repo. | Table dormante de facto. | dormant |
| TENDER-POLICY-1 | low | pg_policies live : 2 policies SELECT identiques sur `tender_segments` | Doublon fonctionnel, pas d'impact | watchlist |

### C. À confirmer

| ID | Sujet | Ce qu'il faut vérifier |
|----|-------|----------------------|
| COMM-SCHEMA-1 | Drift repo ↔ schéma DB sur tables communication canoniques | Comparer les colonnes réellement présentes dans `external_quote_requests`, `client_gap_requests`, `external_quote_responses`, `external_quote_response_facts`, `partner_response_suggestions` avec ce que le code attend |
| ARCHIVED-WRITER-1 | Statut ARCHIVED en DB (14 cas en ARCHIVED) mais aucun writer canonique actif | Vérifier si ces 14 cas ont été archivés par migration manuelle, script ponctuel, ou ancien code supprimé. L'origine n'est pas établie dans le runtime canonique actuel. |

### D. Ordre exact recommandé des prochains lots

1. **AUTH-HIST-1** — Fix auth `suggest-historical-lines` (critique, 1 fichier, ~15 lignes)
2. **OUTCOME-AUTH-1** — Fix `close-commercial-outcome` L87 (haute, 1 ligne)
3. **TIMELINE-DEDUPE-1** — Ajouter `dedupe_key` (basse, 1 ligne)
4. Vérification COMM-SCHEMA-1 / ARCHIVED-WRITER-1
5. Dette PJ anciennes (ATTACH-OPS-1)
6. EXPORT-QE-FROZEN (déjà deferred)
7. Dette secondaire (tender policy doublon, CaseView taille)

---

Cet inventaire couvre les sources suivantes :
- **Repo** : `MASTER_CONTEXT.md`, `STATUS_REGISTRY.md`, `SECURITY_CONTRACT.md`, `PHASE_15_NOTES.md`, `DECISIONS.md`, `AUDIT_METIER_P0_PROTOCOL.md`, `.lovable/plan.md`, code runtime
- **Chats** : phases M18d → M27b (session de stabilisation complète)
- **Audit CTO consolidé** : 2026-04-14 (repo + runtime/cloud externe)

Les sujets reportés dans des conversations antérieures (pré-M18d) qui n'auraient laissé aucune trace dans le code ou la documentation ne sont **pas** listés ici. Pour les capturer, fournir les résumés/prompts des anciens chats.
