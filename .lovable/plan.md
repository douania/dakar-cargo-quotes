
# État courant — Sous-système Magasinage Dakar Terminal

## Statut

**Phase 3-B.2-A livrée et validée métier** (2026-04)

## Ce qui est livré

- **Référentiel** : `terminal_designations` (~956 entrées) + `terminal_tariff_codes` (~34 codes) peuplés et audités
- **Alias BL** : table `terminal_designation_aliases`, consommation moteur des alias validés, UI admin (création / validation / suppression)
- **IA suggestions** : table `terminal_designation_suggestions`, fallback Gemini 2.5 Flash après échec alias + direct, anti-duplication, UI revue opérateur (accepter / rejeter / accepter + créer alias)
- **Moteur** : `run-pricing` produit `TERMINAL_STORAGE_PROVISION_ESTIMATE` (P1 × poids × 3j) si match couche 1 (alias) ou couche 2 (direct)
- **Règle centrale** : les suggestions IA ne produisent aucune ligne pricing ni aucun calcul tant qu'un opérateur ne les a pas validées et capitalisées en alias

## Ce qui est différé

Voir `docs/DEFERRED_BACKLOG.md` pour le détail :

- P2/P3 dans le moteur (`DT-P2P3-ENGINE`)
- Jours réels après franchise (`DT-RATE-TABLE`)
- Multi-cargo IA (`DT-AI-MULTI-CARGO`)
- Synonymes avancés / matching DPW (`DT-DESIGNATION-MODEL`)
- Révision tarifs 2014 → 2024+ (`DT-2014-REVISION`)

## Prochaine suite logique

Enrichissement progressif du dictionnaire d'alias en exploitation réelle, puis Phase 3-B.2 avancée (multi-cargo, P2/P3) quand le besoin opérationnel se manifeste.
