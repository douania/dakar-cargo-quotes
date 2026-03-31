

# Plan — Reprise extraction pages 51→124 + regroupement dossiers

## Contexte
- 50 pages sur 124 déjà extraites (checkpoint sauvé dans `/tmp/extract_checkpoint.json`)
- Images PNG déjà converties pour les 124 pages
- Script `extract_all.py` validé par smoke test

## Étapes d'exécution

### 1. Reprendre l'extraction (pages 51→124)
- Charger le checkpoint existant (`/tmp/extract_checkpoint.json`)
- Relancer le script sur les pages 51→124 en lots de ~40 pages par exécution (pour éviter les timeouts)
- Passe 1 : pages 51→90
- Passe 2 : pages 91→124
- Sauvegarder le checkpoint après chaque passe

### 2. Regroupement dossiers (Étape B)
- Logique Python déterministe (pas d'IA)
- Priorité stricte : `same_bl` > `same_container` > `same_vessel_voyage` > `same_client+weight`
- Dernier niveau automatiquement classé `low_confidence_match`
- Détection doublons via `image_hash`

### 3. Génération des livrables dans `/mnt/documents/`
- `pdf_analysis_pages.json` — 124 entrées avec `raw_extraction` + `normalized_fields`
- `pdf_analysis_dossiers.json` — dossiers D001, D002... avec `evidence_basis`
- `pdf_analysis_pages.csv` — vue tabulaire page-level
- `pdf_analysis_dossiers.csv` — vue tabulaire dossier-level

### 4. Compte-rendu
- Nombre réel de pages traitées
- Nombre de dossiers détectés
- Pages non résolues / doublons probables
- 5 exemples concrets de dossiers

## Contraintes
- Aucun changement repo / DB / migration
- Aucun module FROZEN touché
- Travail documentaire uniquement

