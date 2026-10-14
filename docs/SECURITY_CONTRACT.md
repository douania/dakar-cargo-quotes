# Security Contract — Edge Functions

> **Subordinate to `docs/MASTER_CONTEXT.md`** (source of truth).
> This document details operational application of security rules defined in MASTER_CONTEXT.

## Scope

This contract covers the **canonical pipeline** and **critical functions** only. Functions not listed in the classification table are not individually formalized here; their absence does not imply lack of authentication — the project standard is `requireUser` for all non-public functions. For an exhaustive inventory of all edge functions, refer to the codebase directly.

---

## Authentication Standard

Pattern: `verify_jwt = false` + `requireUser` (centralized auth helper in `_shared/auth.ts`).

- `requireUser(req)` → validates JWT, then checks internal admission under that JWT. Returns `AuthResult`, `401` for invalid identity, `403` for a non-member, or `503` if admission cannot be verified (fail closed).
- `requireAdmin(req)` → validates JWT + checks `ADMIN_EMAIL_ALLOWLIST`

Active business Edge Functions set `verify_jwt = false` in `supabase/config.toml` for ES256 signing-keys compatibility.

Exception approved 2026-10-09: the five retired M26b endpoints `calculate-duties`,
`learn-from-contact`, `suggest-regime`, `generate-case-outputs` and
`get-active-exchange-rate` must set `verify_jwt = true`. Their replacement handlers
refuse every business operation with HTTP 410 (empty OPTIONS preflight only).
They do not read identity, request bodies, credentials or business data, and do not
call any service. A gateway 401 is not evidence that the refusal handler ran;
ES256 rejection on these retired paths is acceptable. No other function policy changes.

---

## Access Model

**Current access model**: shared authenticated operator workspace.

- Members with `workspace_operator` or `role_admin` can access the shared case portfolio. Authentication alone is insufficient. A currently banned account is not admitted, including an account with `role_admin`.
- Case ownership (`created_by`) is **not enforced** for access control.
- Actor identity **is preserved** for audit trail (`actor_user_id`, `decided_by`, `created_by`).

This model is appropriate for a single-company transit/customs team with a shared case portfolio.

### Isolation Surfaces

| Surface | Modèle d'accès | Notes |
|---------|---------------|-------|
| `email_drafts` | **Owner-scoped** (B1-A) | SELECT/DELETE: owner + legacy NULL transitoire. UPDATE/INSERT: owner strict. Service_role non affecté. |
| `case_documents` + bucket | Shared workspace (B1-B reporté) | Flux upload-first/delete-first incompatible avec jointure RLS storage. |
| `quotation_documents` | Owner-scoped (existant) | Policies `owner_select`/`owner_insert` déjà en place. |
| `quote_cases` et tables enfants | Shared workspace | Contrat team-wide inchangé. |

B1-A crée volontairement une asymétrie : les drafts deviennent owner-scoped tandis que les dossiers restent en shared workspace. Cette asymétrie est acceptée comme trade-off produit local, pas comme modèle d'isolation global.

### Admin Surface

**Important** : les pages sous `/admin/*` dans l'application sont un **regroupement produit/UI**, pas une frontière d'autorisation backend. Il n'existe pas de garde frontend admin — tout utilisateur authentifié voit ces pages dans la sidebar.

La protection réelle repose sur :

1. **Edge Functions admin-only** (`data-admin`, `email-admin`) : protégées par `requireAdmin` (allowlist email). Les pages Knowledge, MarketIntelligence, PricingIntelligence, et les actions sensibles d'Emails passent par ces fonctions.

2. **Tables de référence — shared workspace authenticated CRUD** : les tables suivantes sont accessibles en lecture/écriture à tout utilisateur authentifié, sans restriction de rôle :
   - `hs_codes` (SELECT public, UPDATE/DELETE authenticated)
   - `tax_rates` (SELECT public, INSERT/UPDATE authenticated)
   - `customs_regimes` (SELECT public, INSERT/UPDATE authenticated)
   - `port_tariffs` (SELECT public, INSERT/UPDATE/DELETE authenticated)
   - `pricing_client_overrides` (SELECT/INSERT/UPDATE/DELETE authenticated)
   - `documents` (SELECT/DELETE authenticated ; INSERT via `parse-document` service_role)
   - `learned_knowledge` (SELECT authenticated ; writes via `data-admin` service_role)

   Ce modèle est un **choix produit volontaire** pour une équipe mono-société. Ce n'est pas un modèle RBAC admin.

3. **Suppression `documents`** : tout utilisateur authentifié peut supprimer tout document. C'est un choix accepté en mono-équipe, documenté explicitement. À restreindre si ouverture multi-société.

**Historique** : la décision initiale de ne pas créer de RBAC global est remplacée pour l'admission de la V1 interne par `app_roles.workspace_operator` / `role_admin`. Les règles existantes de propriété, de rôle tarifaire et d'allowlist admin restent nécessaires ; ce lot ne transforme pas la mono-équipe en modèle multi-société.

## V1 interne — lot local de sécurisation du 7 octobre 2026

### Complément local IMAP du 9 octobre 2026

- GO utilisateur local : `/admin/emails`, onglet configurations, « Remplacer le mot de passe ». Ressaisie humaine uniquement, champs masqués et confirmation ; aucune lecture, initialisation, trace ou restitution de l'ancien secret.
- `email-admin/replace_password` conserve `requireAdmin` : JWT valide + admission workspace + `ADMIN_EMAIL_ALLOWLIST`. `role_admin` seul ne suffit pas ; l'appartenance réelle de Ramzi à l'allowlist reste non vérifiée et aucune configuration distante n'est modifiée.
- `replace_mailbox_secret(uuid,text)` est service-only, SECURITY DEFINER à search_path vide : verrou configuration, création d'un nouveau secret sous la clé opérationnelle, bascule de référence puis nettoyage du seul ancien UUID, dans une transaction. Aucun UUID de configuration, email, pièce jointe ou lien métier n'est supprimé/recréé.
- Référence NULL, ancienne ligne legacy ou ancien secret absent/indéchiffrable : la réparation ne lit pas l'ancien mot de passe. Moteur/clé incapable de chiffrer, erreur de bascule ou de nettoyage : échec fermé et transaction annulée. Le parcours n'est pas une garantie de conservation de la clé lors d'une restauration Lovable.
- Les doubles clics sont bloqués côté UI ; les remplacements successifs sont sérialisés par FOR UPDATE, sans promesse d'idempotence serveur. Entrée sensible conservée masquée après erreur, effacée au succès/fermeture, sans stockage persistant ni erreur RPC brute.
- CI locale PASS_WITH_BASELINE : 692 Vitest, 1921 Deno / 0 échec / 6 ignorés, type Deno 49/5, lint 723/16, typecheck/build PASS ; tests PostgreSQL/WASM + Vault simulé PASS. Nouvelle RPC avec Vault natif et recette navigateur NOT_RUN, cette dernière bloquée par `Transport closed`. Publication suspendue ; aucun secret réel ni changement distant.

**Statut : code local, non publié.** GO local utilisateur ; `STRUCTURAL_PATCH_ALLOWED` limité à l'ajout d'admission aux entrées `run-pricing` et `build-case-puzzle`. Aucun calcul ni tarif modifié. Ce texte décrit le résultat préparé, pas une sécurité déjà active en Cloud.

- Admission centralisée dans `_shared/auth.ts`, ainsi qu'aux entrées JWT inline ; le chemin service interne de `suggest-historical-lines` reste explicite. `has_workspace_access()` lit les rôles serveur, pas les métadonnées modifiables de l'utilisateur.
- RLS `AS RESTRICTIVE FOR ALL` sur 50 tables et les quatre buckets métier : les policies préexistantes continuent de limiter propriété/écriture. Un membre de l'équipe ne gagne aucune permission propriétaire par ce gate. `app_roles` est également protégé, y compris contre un ancien JWT de role_admin banni.
- Les helpers case et les RPC opérateur `reset_attachment_for_retry` / `select_quotation_version` exigent l'admission ; les quatre locks d'analyse sont service-only. Les grants explicites anon/authenticated observés sont retirés, pas seulement PUBLIC. Huit RPC métier/maintenance historiques conservent seulement le chemin serveur ; leurs corps métier restent inchangés. La migration refuse une RLS storage désactivée ou un bucket métier voisin absent/public, sans présumer les ACL Cloud.
- `quotation-attachments` devient privé. Les exports HTML/CSV/Excel ad hoc utilisent des téléchargements signés d'une heure (champs de réponse conservés pour compatibilité). Un tel URL n'est pas un lien client durable ; télécharger la pièce avant un envoi. Les PDF canoniques utilisent déjà des liens signés. Un lien déjà émis demeure utilisable jusqu'à son expiration (au plus une heure), même après ban ou révocation du rôle ; ceux-ci bloquent les nouveaux accès par JWT.
- Secret IMAP : Vault installé est utilisé via RPC service-only. Création configuration + secret atomique, référence UUID interne, aucune lecture client de Vault, aucun fallback vers `password_encrypted`. LOGIN échappe guillemets/backslashes et refuse CR/LF/NUL. Les erreurs de RPC secrète ne transmettent pas de détail backend.
- L'installation Vault ne déplace aucune ancienne valeur. `migrate_legacy_imap_secrets()` est une action distincte, transactionnelle, idempotente, renvoyant seulement un compte ; elle refuse les doubles sources et élimine le clair. Le CHECK NOT VALID bloque les nouveaux enregistrements/mises à jour en clair, y compris last_sync sur une ancienne configuration non convertie.

Validation locale clôturée sur DESKTOP-DJVBKU7 le 7 octobre 2026 : `npm run ci` exit 0 (680 Vitest, 1829 Deno / 0 échec / 6 ignorés), typecheck app/node PASS, Deno 49 diagnostics/5 buckets inchangés, lint 725/16 ≤ baseline 732/16, build PASS. Recette PostgreSQL renforcée PASS (grants clients adverses, prérequis avec rollback, propriété et service), Vault simulé seulement. Contre-revue indépendante PASS_WITH_BASELINE, aucun blocage local. CI GitHub de ce lot, schéma/ACL Cloud et activation non vérifiés ; crypto native et recette connectée NOT_RUN.

### Activation distante — autorisation distincte obligatoire, aucune action faite

1. Valider la liste nominative des opérateurs/admins, les comptes de recette à bloquer, les inscriptions fermées et la maintenance. Une pause UI seule ne bloque pas les anciens endpoints service_role : vérifier une suspension technique des accès ou un déploiement coordonné, puis les refus d'accès avant toute réouverture. Si cette suspension n'est pas disponible, garder la release bloquée jusqu'au protocole d'activation validé.
2. Appliquer dans Lovable Cloud les migrations `20261007120000` puis `20261007121000`, après revue de leur diff et des ACL actuelles. Aucun seed de compte dans ces migrations.
3. Sous le même GO de bascule mail, exécuter côté serveur `SELECT public.migrate_legacy_imap_secrets();` ; vérifier uniquement le compte migré, l'absence de clair et le résultat de rejeu. Ne jamais SELECT les secrets déchiffrés ni copier de valeur dans une commande, une discussion ou Git. Faire ensuite renouveler l'identifiant IMAP par son administrateur : les anciens backups peuvent contenir l'ancien clair.
4. Attribuer uniquement aux UUID validés le rôle workspace_operator via la procédure SQL ci-dessous. role_admin est déjà admis ; pad_admin/tariff_admin seuls ne donnent pas l'accès métier. Contrôler les comptes de test et les inscriptions dans les paramètres Auth Lovable ; aucun identifiant réel ni modification Auth inclus dans le lot local.
5. Déployer de façon coordonnée **tous** les consommateurs du helper auth et les entrées inline modifiées, les six fonctions mail et les exports ad hoc. Le changement d'un fichier partagé seul ne prouve pas le redéploiement des bundles déjà en ligne. Conserver l'allowlist ADMIN_EMAIL_ALLOWLIST existante et vérifier son appartenance à l'équipe, sans imprimer sa valeur.
6. Recette connectée : anonyme/non-membre/banni/rôle retiré refusés ; opérateur admis fonctionne ; admin non allowlisté refusé ; fonctions d'analyse service-only ; bucket inaccessible par URL public ; accès signé fonctionne ; secret non exposé ; synchronisation/hydratation/import en sandbox autorisé. Ces vérifications et la crypto Vault native sont NOT_RUN dans le lot local.

Attribution révisable (remplacer les placeholders uniquement dans l'outil serveur autorisé ; ne pas exécuter tel quel) :

```sql
INSERT INTO public.app_roles (user_id, role, created_by)
VALUES ('<UUID_OPERATEUR_VALIDE>'::uuid, 'workspace_operator', '<UUID_ADMIN_VALIDE>'::uuid)
ON CONFLICT (user_id, role) DO NOTHING;
```

### Vérification et retour arrière

Tests HTTP locaux : JWT valide + admission vraie, admission absente/fausse/malformée, vérification indisponible, allowlist et OPTIONS ; les requêtes refusées n'atteignent ni métier ni IMAP. Tests SQL : `supabase/tests/internal_workspace_access.sql` sous transaction ROLLBACK, à exécuter seulement en base de recette autorisée. Le harness local PostgreSQL/WASM utilise de fausses API Vault : il prouve RLS/ACL/transactions, pas le chiffrement natif ni la totalité du schéma Cloud.

Avant publication : annuler les changements de la copie locale suffit, le dépôt d'origine et le Cloud sont intacts. Après activation : maintenir les accès suspendus, l'admission, les ACL, Vault et les buckets privés ; privilégier une correction en avant. **Ne pas republier simplement d371e02, rétablir le clair ou rendre le bucket public.** Un retour arrière distant ciblé exige son propre GO et une preuve négative des accès avant réouverture.

---

## Function Classification

| Level | Auth method | Examples |
|-------|-------------|---------|
| **public** | None | `healthz` |
| **user_auth (requireUser)** | `requireUser` helper | `ack-pricing-ready`, `suggest-decisions`, `generate-quotation-version`, `analyze-partner-response`, `validate-partner-fact`, `send-external-quote-request`, `confirm-external-request-sent`, `close-external-quote-request`, `analyze-reply-event`, `analyze-attachments`, `analyze-service-scope`, `analyze-risks`, `ensure-quote-case`, `send-quotation`, `create-quotation-email-draft`, `close-commercial-outcome`, `generate-reply-draft`, `sync-gap-client-actions`, `auto-match-partner-responses`, `select-partner-request`, `close-manual-action`, `mark-client-gap-request-sent`, **`data-query`**, **`get-pad-nst-suggestions`** |
| **user_auth (inline, dual-path)** | Inline JWT validation | `commit-decision` (S1.3 — granular error codes), `run-pricing` (FROZEN), `build-case-puzzle` (FROZEN), `export-quotation-version-pdf` (canonical pipeline, inline auth conservé, `verify_jwt = false` en config), `suggest-historical-lines` (Dual-path: accepts user JWT via getClaims OR service-role key for internal invocation. Service-role path: userId=null, traceability via meta `auth_mode`/`caller`. Patched 2026-04-15, ex AUTH-HIST-1.) |
| **admin** | `requireAdmin` | `data-admin`, `email-admin` |

### `data-query` — Operator read surface (B1-audit)

Created to decouple operator-level read queries from `data-admin` (which requires `requireAdmin`). Exposes **5 read-only actions**: `search`, `search_tariffs`, `find_historical_references`, `get_transport_rates`, `search_transport_rate`. Write operations (`create_knowledge`, etc.) remain in `data-admin` — see `DEFERRED_BACKLOG.md` item P2B.

### Auth migration stance

Auth convergence is **complete for the current stabilization phase**.

All non-FROZEN functions without a specific observability justification have been migrated to `requireUser`. The remaining inline-auth functions are **intentional exceptions**, not deferred work:

- `commit-decision` — retained for **observability preservation** (granular `AUTH_MISSING_JWT` / `AUTH_INVALID_JWT` distinction, S1.3).
- `run-pricing` — **FROZEN**. Must not be reopened without a `STRUCTURAL_PATCH_ALLOWED` exception.
- `build-case-puzzle` — **FROZEN**. Must not be reopened without a `STRUCTURAL_PATCH_ALLOWED` exception.

No further auth migration should be opened unless a new business or structural need justifies it.

---

## SOURCE-GUARD — Protection provenance facts

`build-case-puzzle` implémente un système de protection contre la contamination des faits depuis les sources internes ou partenaires :

1. **SG-1 — Filtrage contexte IA** : les emails des domaines internes (`@sodatra.sn`, `@sodatra.com`) sont exclus du contexte d'extraction IA
2. **SG-2 — Garde monétaire post-extraction** : les facts monétaires sensibles (`cargo.value`, `cargo.freight_cost`, etc.) sont bloqués si la provenance email n'est pas `client` (classification par `classifyEmailProvenance()` via domain matching)
3. **SG-2 doc-regex** : les documents internes (devis, brouillons) sont ignorés lors de l'extraction par regex

Limitations : le domain matching est heuristique — voir `SOURCE-GUARD-DEBT` dans `docs/DEFERRED_BACKLOG.md`.

---

## Observability

Functions using the `runtime.ts` contract (`logRuntimeEvent`, `respondOk`, `respondError`) preserve auth failure events in `runtime_events` for traceability.

Functions migrated to `requireUser` that previously used inline auth with `logRuntimeEvent` add a post-check log to preserve this observability (see `generate-quotation-version`).

Note: `generate-quotation-version` logs all auth failures as `AUTH_INVALID_JWT` regardless of whether the cause is a missing header or an invalid token. This is a known trade-off accepted in S1.2 to avoid re-implementing inline auth.

---

## S1 Patch Log

| Function | Change | Date |
|----------|--------|------|
| `ack-pricing-ready` | Migrated to `requireUser` | 2026-03 |
| `suggest-decisions` | Migrated to `requireUser`, removed false `verify_jwt=true` comment | 2026-03 |
| `generate-quotation-version` | Migrated to `requireUser` + post-check log, fixed false docstrings | 2026-03 |
| `commit-decision` | Comments only (auth deferred to S1.3 for observability preservation) | 2026-03 |
| `ensure-quote-case` | Migrated to `requireUser`, removed inline auth + local corsHeaders, harmonized CORS with shared helper | 2026-03 |
| `send-quotation` | Migrated to `requireUser` + post-check log, retained userClient for RLS (reconstructed via `auth.token`) | 2026-03 |
| `generate-case-outputs` | ~~Migrated to `requireUser`~~ — **Fonction supprimée en M26b** (dead code confirmé). Entrée conservée pour historique. | 2026-03 |
| — | **Auth convergence complete.** Remaining inline: `commit-decision` (observability), `run-pricing` (FROZEN), `build-case-puzzle` (FROZEN). No further migration planned for current phase. | 2026-03 |
| `export-quotation-version-pdf` | Added to classification as user_auth (inline). Docstring corrected: `verify_jwt = false`. Inline auth conserved — no migration in M7b. | 2026-03 |
| `create-quotation-email-draft` | Added to classification as user_auth (requireUser). Previously missing from security contract. | 2026-03 |
| `close-commercial-outcome` | Added as user_auth (requireUser). Transitions SENT → ACCEPTED/REJECTED. | 2026-03 |
| `data-query` | Created as user_auth (requireUser). Decouples operator reads (search, tariffs, transport rates, historical references) from admin-only `data-admin`. Components migrated: `KnowledgeSearch`, `HistoricalRateReminders`, `useTariffSuggestions`, `MatchKnowledgeToSegmentDialog`. | 2026-03 |
| `generate-reply-draft` | Added to classification as user_auth (requireUser). Generates client reply drafts from gap questions. | 2026-04 |
| `sync-gap-client-actions` | Added to classification as user_auth (requireUser). Syncs open gaps to idempotent manual_action timeline events. | 2026-04 |
| `auto-match-partner-responses` | Added to classification as user_auth (requireUser). COM-2A partner response suggestion scanning. | 2026-04 |
| `select-partner-request` | Added to classification as user_auth (requireUser). COCKPIT-9 P2 partner offer selection. | 2026-04 |
| `close-manual-action` | Added to classification as user_auth (requireUser). Closes manual_action timeline events. | 2026-04 |
| `mark-client-gap-request-sent` | Added to classification as user_auth (requireUser). CL1 marks client_gap_requests as sent. | 2026-04 |
| `confirm-external-request-sent` | Added as user_auth (requireUser). P0-C: confirms partner request actual send, sets `email_sent_at`. Preconditions: `status=sent`, `email_draft_id` present. Idempotent. | 2026-04 |
| `close-external-quote-request` | Added as user_auth (requireUser). P1-B: backendised partner request closure. Preconditions: no `proposed` facts remaining (409 if any). No status whitelist — any non-closed status allowed. Idempotent if already closed. Timeline: NON-SILENT (failure → 500). | 2026-04 |
| `find-similar-quotations` | **Lot 2** — Migrated from inline `getClaims` to `requireUser` + post-check log. Trade-off observabilité accepté (S1.2): échecs auth loggés `AUTH_INVALID_JWT`. | 2026-04-21 |
| `import-historical-quotation` | **Lot 2** — Migrated from inline `getClaims` to `requireUser` + post-check log. `serviceClient` créé avant `requireUser` pour permettre logging des échecs auth. Docstring corrigée. | 2026-04-21 |
| — | **Lot 2 closed.** Seul `suggest-historical-lines` conserve un appel `getClaims(` réel : dual-path service-role intentionnel et documenté (`AUTH-HIST-1`). | 2026-04-21 |
| `get-pad-nst-suggestions` | **PAD-NST-2E-C-B** — Edge Function isolée de lecture SELECT sur `pad_nst_recommendation_rules`. Auth via `requireUser`. Client Supabase construit avec JWT utilisateur (RLS respectée). Aucun service role. Aucune écriture DB. POST uniquement, OPTIONS preflight, autres méthodes → 405. Réponse `source_type=TO_CONFIRM`, `requires_operator_confirmation=true`. Aucun amount/OFFICIAL. | 2026-05-08 |
