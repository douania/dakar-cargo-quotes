
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
- **Couverture** : toutes les catégories PAD actuellement présentes dans `commodity_categories` sont couvertes par au moins un alias
- **T06 / T08 / T10 / T11** : restent hors périmètre référentiel applicatif actuel, audit différé en attente d'observation des non-matchs réels
- **Lookup runtime** : `run-pricing` effectue un lookup alias PAD avant le bloc PAD existant (facts opérateur prioritaires)
- **Résolution** : alias → `pad_category` → `port_tariffs` (provider=PAD, category=DROIT_PASSAGE, operation_type=IMPORT) → `pad_rate_fcfa_per_ton`
- **Source de vérité** : `commodity_category_id` (FK). `pad_category` = copie dénormalisée runtime.
- **Gestion collisions** : warning + skip si ambiguïté multi-catégorie
- **Séparation** : tables distinctes du magasinage, 0 mélange
- **UI Admin** : onglet "Alias PAD" dans `CommodityCategories.tsx` — KPI, recherche, filtre statut, création (anti-doublon), validation, suppression (AlertDialog)

### Ce qui est différé

Voir `docs/DEFERRED_BACKLOG.md` : PAD-IA, PAD-MULTI-LOT, audit T06/T08/T10/T11

---

## Comparatif consolidé

| Sujet | Magasinage DT | PAD |
|-------|--------------|-----|
| **Référentiel** | ~956 désignations + 34 codes tarifaires | 10 catégories + 19 tarifs |
| **Matching direct** | Oui (normalisé sur designation_label) | Non (pas de match direct) |
| **Alias runtime** | Oui (`terminal_designation_aliases`) | Oui (`pad_designation_aliases`, 57) |
| **IA fallback** | Oui (Gemini 2.5 Flash, 3 couches) | Non implémentée (différée) |
| **UI admin** | 3 onglets (Désignations / Alias / Suggestions IA) | 1 onglet (Alias PAD) |
| **Capitalisation** | Oui (IA → alias validé → moteur) | Oui (manuel uniquement) |
| **Validation opérateur** | Obligatoire (alias + suggestions IA) | Obligatoire (alias) |
| **P2/P3 moteur** | Non (différé) | N/A |
| **Observation exploitation** | Requise | Requise |

## Conclusion de maturité

- **Magasinage DT** : opérationnel dans son périmètre actuel, avec assistance IA et supervision opérateur
- **PAD** : opérationnel en mode déterministe supervisé, sans couche IA à ce stade

## Recommandation unique

Observer les non-matchs réels en exploitation avant tout nouveau chantier structurel (PAD-IA, audit T06/T08/T10/T11, P2/P3 moteur).

### Prochaine suite logique

1. **Observation exploitation** : mesurer les non-matchs réels sur les deux sous-systèmes
2. **PAD-IA** : Fallback IA pour les descriptions non couvertes par les alias (quand la couverture alias atteint ses limites)
