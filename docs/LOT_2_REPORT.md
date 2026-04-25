# Lot 2 — Rapport Smoke G6 / G7 / G8 / G9

**Date d'exécution :** 2026-04-25  
**Statut global :** ⏸ **EXÉCUTION RUNTIME EN ATTENTE** (blocage technique sandbox — voir §0)  
**Code Lot 2 :** ✅ déployé (migration + price-service-lines)  
**Harness de preuve :** ✅ prêt (`scripts/lot2_smoke/`)

---

## 0. Blocage d'exécution runtime — déclaration honnête

L'agent ne peut pas, depuis le sandbox actuel :
- invoquer `run-pricing` directement : la fonction renvoie **HTTP 401 "Invalid token"** avec la clé anon (la nouvelle API signing-keys rejette les tokens legacy non authentifiés malgré `verify_jwt = false`) ;
- accéder au `SUPABASE_SERVICE_ROLE_KEY` (non exposé dans l'environnement sandbox) ;
- invoquer l'edge function via `pg_net` (extension non installée) ;
- exécuter les scripts SQL transactionnels (`BEGIN/COMMIT` + `\set ON_ERROR_STOP on` + méta-commandes psql `\set baseline_fact_id`) : les tools backend disponibles ne maintiennent pas de session psql persistante. Une transcription en SQL pur dégraderait la transactionnalité (perte de `BEGIN/COMMIT`, `ON_ERROR_STOP`, restauration atomique, rollback en cas d'échec) — **explicitement refusée par le CTO le 2026-04-25**.

**Conséquence :** les 4 runs runtime + les scripts SQL d'injection/restauration doivent être déclenchés **par l'utilisateur** :
- les SQL d'injection/restauration via un **vrai client psql** ou via le **SQL editor du backend** (avec UUID `baseline_fact_id` collé en dur dans le script 04) ;
- les runs `run-pricing` depuis le cockpit (bouton "Lancer le pricing") ;
- ordre strict défini au §7.

L'agent fournit :
1. les scripts SQL d'injection / restauration (`scripts/lot2_smoke/01..04`), id-safe transactionnels, assertions verrouillées en `1 / CASE WHEN ... THEN 1 ELSE 0 END` (division par zéro réelle si l'assertion échoue → `ON_ERROR_STOP` rollback effectif) ;
2. le harness de validation (`scripts/lot2_smoke/05_validate_results.sql`) qui extrait les preuves attendues directement depuis `pricing_runs.tariff_lines`.

**Ce rapport sera complété (verdicts PASS/FAIL) dès que les runs auront été déclenchés et la sortie du harness §05 transmise à l'agent.**

---

## 1. État de la base au début du lot 2

| Catégorie                         | Lignes | Détail |
|-----------------------------------|-------:|--------|
| Aksa (`client_code='AKSA_ENERGY'`, `evidence_level='client_override'`) | 81 | 26 destinations dont Kolda |
| Génériques (`client_code IS NULL`, `evidence_level='to_confirm'`)       | 10 | 5 destinations exclusives : Velingara, Kolda/Matam, Kedougou, Rosso, Kidira |
| **Total actif**                   | **91** | aucune ligne `client_override` non-Aksa |

**Cas réels avec `client.code` posé en base :** un seul → `240167ed` (`AI0CARGO`).  
Aucun dossier réel n'a `client.code='AKSA_ENERGY'` — d'où l'injection temporaire pour G6.

---

## 2. Cas de test sélectionnés

| Test | case_id | route | service.package | client.code (baseline) | Objectif |
|------|---------|-------|-----------------|------------------------|----------|
| **G6** | `03ccf66d-df20-47a1-875d-93133ee79020` | Shenzhen → Kolda (FCL) | `DAP_PROJECT_IMPORT` | *(absent)* | Injection `AKSA_ENERGY` → tarif Aksa servi |
| **G7** | `29b96eec-2b85-489f-937e-0da8190c9787` | (FCL) → Kolda           | `DAP_PROJECT_IMPORT` | *(absent)* | Pas d'injection → TO_CONFIRM, **aucune fuite Aksa** |
| **G8** | `29b96eec-2b85-489f-937e-0da8190c9787` | (FCL) → **VELINGARA** *(injecté)* | `DAP_PROJECT_IMPORT` | *(absent)* | Destination hors Aksa, génériques `to_confirm` → TO_CONFIRM strict |
| **G9** | `01c3fbbc-9176-4e9a-b376-9def3bcf0091` | (AIR) → Frankfurt       | `AIR_IMPORT_DAP`    | *(absent)* | Mode aérien — n'utilise pas `local_transport_rates` → non-régression |

---

## 3. Procédure d'exécution

### G6 — Aksa servi

```bash
psql -f scripts/lot2_smoke/01_inject_aksa_g6.sql      # injection client.code=AKSA_ENERGY
# >>> déclencher run-pricing dans le cockpit pour 03ccf66d-...
psql -f scripts/lot2_smoke/02_restore_aksa_g6.sql     # RESTAURATION OBLIGATOIRE
```

**Critère PASS G6 :**
- Au moins 1 ligne `TRUCKING` ou `ON_CARRIAGE` avec `source.type ≠ 'TO_CONFIRM'`
- `source.reference` contient `aksa` (ou `local_transport_rates`)
- log edge `[LOT2A] local_transport_rate matched: client_code="AKSA_ENERGY", dest=KOLDA…`

### G7 — non-Aksa, dest Aksa-couverte

```bash
# Pas d'injection : on utilise le case tel quel (pas de client.code)
# >>> déclencher run-pricing dans le cockpit pour 29b96eec-...
```

**Critère PASS G7 :**
- Lignes `TRUCKING` / `ON_CARRIAGE` avec `source.type = 'TO_CONFIRM'`
- **Aucune** ligne dont `source.reference` ou `description` contient `aksa`
- log edge `[LOT2C] TO_CONFIRM trucking/on_carriage: client_code="generic"…`

### G8 — non-Aksa, hors zone Aksa

```bash
psql -f scripts/lot2_smoke/03_inject_g8_dest_velingara.sql  # destination → VELINGARA
# >>> déclencher run-pricing dans le cockpit pour 29b96eec-...
psql -f scripts/lot2_smoke/04_restore_g8_dest_kolda.sql     # restauration Kolda
```

**Critère PASS G8 :**
- `TO_CONFIRM` strict (les génériques Velingara sont `to_confirm` → resolver renvoie `null` → fallback Lot 2C)
- log edge `[LOT2A] generic to_confirm rate skipped (no tariff served): dest=VELINGARA…`

### G9 — non-régression (aérien)

```bash
# Pas d'injection
# >>> déclencher run-pricing dans le cockpit pour 01c3fbbc-...
```

**Critère PASS G9 :**
- 0 ligne TRUCKING/ON_CARRIAGE (mode air, pas de transport local)
- `total_ht` proche de la run précédente (5c58fd2f-…) — variance ≤ 1%

### Validation finale (lecture des preuves)

```bash
psql -f scripts/lot2_smoke/05_validate_results.sql > docs/lot2_smoke_evidence.txt
```

---

## 4. Basculement attendu sur 03ccf66d (déclaration de transparence)

| Phase | client.code | Comportement transport KOLDA | Statut |
|-------|-------------|------------------------------|--------|
| **Avant Lot 2A** (run #1, 2026-04-23) | absent | 10 lignes génériques `to_confirm` étaient servies **comme tarifs officiels** (≈ 22 M XOF) | ❌ comportement faux |
| **Après Lot 2A** sans injection | absent | `TO_CONFIRM` explicite (resolver skip les `to_confirm`) | ✅ comportement honnête |
| **Après Lot 2A** + injection G6 | `AKSA_ENERGY` | tarif Aksa servi (`client_override`, validé) | ✅ comportement attendu |

**Interprétation :** la baisse apparente du total (passage à TO_CONFIRM) **n'est pas une régression** — c'est la correction d'un bug pré-existant où des tarifs non validés (`evidence_level='to_confirm'`) étaient servis comme s'ils étaient officiels. Cette correction est conforme au mandat Lot 2A et explicitement validée par le CTO le 2026-04-25.

---

## 5. Verdicts (à compléter après runtime)

| Test | Verdict | Preuve | Notes |
|------|--------:|--------|-------|
| G6   | ⏸ PENDING | — | en attente d'exécution runtime |
| G7   | ⏸ PENDING | — | en attente d'exécution runtime |
| G8   | ⏸ PENDING | — | en attente d'exécution runtime |
| G9   | ⏸ PENDING | — | en attente d'exécution runtime |

**Anti-fuite Aksa global** (requête finale du harness) : ⏸ PENDING.

---

## 6. Garde-fous respectés (statiques, vérifiés)

- ✅ `run-pricing/index.ts` non modifié dans le Lot 2 (vérifié `git diff`)
- ✅ Aucune promotion de `to_confirm → official` (resolver renvoie `null` strict)
- ✅ Aucun fallback Aksa pour non-Aksa (filtre `clientFiltered` strict, ligne 569-579 de `price-service-lines/index.ts`)
- ✅ Réutilisation de la structure `source: "TO_CONFIRM"` du Lot 1 (lignes 1430, 1441)
- ✅ Audit séparé : `docs/AUDIT_COUVERTURE_TRANSPORT_SN.md` (à produire en parallèle)

---

## 7. Prochaine action attendue de l'utilisateur

1. Exécuter `scripts/lot2_smoke/01_inject_aksa_g6.sql`
2. Cockpit → case `03ccf66d-…` → "Lancer le pricing"
3. Exécuter `scripts/lot2_smoke/02_restore_aksa_g6.sql` **immédiatement**
4. Cockpit → case `29b96eec-…` → "Lancer le pricing" (G7)
5. Exécuter `scripts/lot2_smoke/03_inject_g8_dest_velingara.sql`
6. Cockpit → case `29b96eec-…` → "Lancer le pricing" (G8)
7. Exécuter `scripts/lot2_smoke/04_restore_g8_dest_kolda.sql`
8. Cockpit → case `01c3fbbc-…` → "Lancer le pricing" (G9)
9. Exécuter `scripts/lot2_smoke/05_validate_results.sql`
10. Renvoyer la sortie à l'agent → l'agent finalise les verdicts dans ce rapport.
