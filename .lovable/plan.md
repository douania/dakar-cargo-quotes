

## Micro-lot documentaire Lot 1-B — Synchronisation docs

### Contexte
Lot 1-B code est validé CTO (ZIP 2026-04-21T173511.970). Reste à synchroniser la documentation de suivi avec l'état réel du code (notamment : la note "constante définie dans le bloc else" du Lot 1 n'est plus exacte, la constante est désormais hissée au niveau module).

### Périmètre strict (2 fichiers documentaires uniquement)

**1. `docs/DEFERRED_BACKLOG.md` — édition ciblée**

- **Ajout d'une sous-entrée Lot 1-B** :
  - Statut : `closed`
  - Date : 2026-04-21
  - Objet : Les entrées catalogue export `FIXED` à 0 XOF avec description normalisée `"tarif a confirmer"` ne sortent plus en `catalogue_sodatra` / confidence 0.95. Elles bypassent le catalogue et continuent vers les resolvers aval (transport rate, rate card, port tariff fallback) ; elles tombent en `TO_CONFIRM` uniquement si aucun tarif réel n'est trouvé.
  - Fichier impacté : `supabase/functions/price-service-lines/index.ts` uniquement
  - Garanties : scope export, whitelist `EXPORT_PLACEHOLDER_SERVICE_KEYS`, `pricing_mode === "FIXED"`, `base_price === 0`, description normalisée `"tarif a confirmer"`, `missing[]` conservé, `rate: null`, aucun FROZEN, aucune migration

- **Correction de la note non-bloquante Lot 1** :
  - Supprimer / remplacer la note disant que `EXPORT_PLACEHOLDER_SERVICE_KEYS` est définie dans le bloc `else`
  - Remplacer par : « Dette stylistique levée en Lot 1-B : la constante a été hissée au niveau module. »

**2. `.lovable/plan.md` — mise à jour ciblée**

- Ajouter / marquer **Lot 1-B — Catalogue 0 XOF export placeholders** : ✅ `closed` (2026-04-21)
- Conserver intégralement les sections **Lot 0**, **Lot 1**, **Lot 1-A** déjà présentes
- Conserver **SEC-001** : `closed_pending_rotation_review` (inchangé)
- Mettre à jour les garde-fous :
  - Ajouter : « Lot 1-B livré et clôturé (non rouvrable sans nouveau déclencheur métier) »
- Ne pas ouvrir de nouveau lot

### Contraintes respectées

- ✅ Aucun fichier runtime (pas de `src/`, pas de `supabase/functions/`)
- ✅ Pas de modification `.gitignore` ni `.env`
- ✅ Aucune migration DB
- ✅ Édition ciblée, sections existantes (Lot 0 / SEC-001 / Lot 1 / Lot 1-A) préservées
- ✅ Aucun nouveau lot ouvert

### Livrable post-exécution

- Diff réel des 2 fichiers documentaires
- Confirmation : aucun fichier runtime modifié
- Confirmation : `.lovable/plan.md` mis à jour de façon ciblée
- Confirmation : DEFERRED_BACKLOG enregistre Lot 1-B en `closed` et la note Lot 1 est corrigée
- Prochaine étape disponible : **Lot 2 — auth cleanup ciblé**

