# BACKLOG DIFFÉRÉ — DAKAR CARGO QUOTES

Source de vérité unique de tous les sujets volontairement reportés, laissés dormants, acceptés comme dette, ou déplacés à une phase ultérieure.

Dernière mise à jour : 2026-03-28

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
| S1 | Label `sent` EQ1 sémantiquement ambigu (devrait être draft_ready) | dette | watchlist | Basse | EQ1 | 2026-03 | Renommage coûteux | Ajout SMTP | `external_quote_requests`, STATUS_REGISTRY | repo | Confirmé | Conditionnel (si SMTP) |
| S2 | HUMAN_REVIEW dormant dans l'enum (jamais atteint canoniquement) | dormant | dormant | Basse | M25 | 2026-03 | Supporté défensivement | Jamais (conservé par design) | Enum DB, `generate-quotation-version` | repo | Confirmé | Garder dormant |

---

## Top priorités futures

| Rang | ID | Sujet | Valeur |
|------|----|-------|--------|
| 1 | B1-B | Isolation case_documents + storage | Pré-requis ouverture multi-société (B1-A email_drafts déjà traité) |
| 2 | F1 | Audit P0 métier | Validation justesse tarifaire |
| 3 | A6 | Intégration SMTP | Automatisation envoi (si décision produit) |
| 4 | D1 | Scroll-to-section | UX polish à fort impact perçu |
| 5 | A3 | Re-pricing après version | Flexibilité opérateur |

---

## Éléments à revalider avant action

| ID | Sujet | Ce qu'il faut vérifier | Pourquoi |
|----|-------|----------------------|----------|
| E4 | PHASE_15_NOTES config | Vérifier si le document est encore consulté ou purement archivé | Si archivé, pas besoin de corriger |
| C5 | ~~Revalidé 2026-03-28~~ | ~~1 snapshot vivant trouvé (a6a82a70). Fallback conservé.~~ | ~~Ligne C5 mise à jour dans le backlog principal~~ |

---

## Note méthodologique

Cet inventaire couvre les sources suivantes :
- **Repo** : `MASTER_CONTEXT.md`, `STATUS_REGISTRY.md`, `SECURITY_CONTRACT.md`, `PHASE_15_NOTES.md`, `DECISIONS.md`, `AUDIT_METIER_P0_PROTOCOL.md`, `.lovable/plan.md`, code runtime
- **Chats** : phases M18d → M27b (session de stabilisation complète)

Les sujets reportés dans des conversations antérieures (pré-M18d) qui n'auraient laissé aucune trace dans le code ou la documentation ne sont **pas** listés ici. Pour les capturer, fournir les résumés/prompts des anciens chats.
