
# État courant — Sous-systèmes Magasinage DT + Taxe de Port PAD

## Magasinage Dakar Terminal

**Phase 3-B.2-A livrée et validée métier** (2026-04)

### Ce qui est livré

- **Référentiel** : `terminal_designations` (~956 entrées) + `terminal_tariff_codes` (~34 codes) peuplés et audités
- **Alias BL** : table `terminal_designation_aliases`, consommation moteur des alias validés, UI admin (création / validation / suppression)
- **IA suggestions** : table `terminal_designation_suggestions`, fallback Gemini 2.5 Flash après échec alias + direct, anti-duplication, UI revue opérateur (accepter / rejeter / accepter + créer alias)
- **Moteur** : `run-pricing` produit `TERMINAL_STORAGE_PROVISION_ESTIMATE` (P1 × poids × 3j) si match couche 1 (alias) ou couche 2 (direct)
- **Règle centrale** : les suggestions IA ne produisent aucune ligne pricing ni aucun calcul tant qu'un opérateur ne les a pas validées et capitalisées en alias

### Ce qui est différé

Voir `docs/DEFERRED_BACKLOG.md` : DT-P2P3-ENGINE, DT-RATE-TABLE, DT-AI-MULTI-CARGO, DT-DESIGNATION-MODEL, DT-2014-REVISION

---

## Taxe de Port PAD

**Phase PAD-ADMIN-UI livrée + T14 enrichi** (2026-04-04)

### Ce qui est livré

- **Table** : `pad_designation_aliases` — 57 alias (51 seed initial + 6 alias T14 ajoutés 2026-04-04), 0 collision auditée
- **T14 désormais couverte** : 6 alias prudents (fil machine, wire rod, feuillard, steel strip, fer blanc, tinplate) — catégorie auparavant sans alias
- **Couverture** : toutes les catégories PAD présentes dans `commodity_categories` ont au moins 1 alias
- **Lookup runtime** : `run-pricing` effectue un lookup alias PAD avant le bloc PAD existant (facts opérateur prioritaires)
- **Résolution** : alias → `pad_category` → `port_tariffs` (provider=PAD, category=DROIT_PASSAGE, operation_type=IMPORT) → `pad_rate_fcfa_per_ton`
- **Source de vérité** : `commodity_category_id` (FK). `pad_category` = copie dénormalisée runtime.
- **Gestion collisions** : warning + skip si ambiguïté multi-catégorie
- **Séparation** : tables distinctes du magasinage, 0 mélange
- **UI Admin** : onglet "Alias PAD" dans `CommodityCategories.tsx` — KPI, recherche, filtre statut, création (anti-doublon), validation, suppression (AlertDialog)

### Ce qui est différé

Voir `docs/DEFERRED_BACKLOG.md` : PAD-IA, PAD-MULTI-LOT

### Prochaine suite logique

1. **PAD-IA** : Fallback IA pour les descriptions non couvertes par les alias (quand la couverture alias atteint ses limites)
