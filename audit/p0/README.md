# Démarrage audit métier P0 (bootstrap exécutable)

Ce dossier permet de **démarrer immédiatement** un audit métier P0 avec des données bootstrap.

## Fichiers

- `input/cases.csv`: liste des cas audités.
- `input/quote_lines.csv`: lignes normalisées pour référence / agent / IA.
- `input/incoterm_rules.csv`: règles simplifiées d'inclusion/exclusion.
- `reports/bootstrap_summary.json`: rapport KPI généré.

## Exécution

```bash
node tools/audit/run_p0_audit.mjs
```

## Interprétation

Le script calcule:

- coverage structurelle
- MAPE médian lignes
- conformité incoterm
- taux d'erreurs bloquantes
- écart total médian

et donne un verdict `GO` ou `NO-GO` selon les seuils du protocole.

## Partager les fichiers sans clone local (GitHub/Lovable)

Si vous travaillez seulement avec GitHub/Lovable, vous pouvez générer un seul fichier texte prêt à copier-coller:

```bash
bash tools/audit/export_p0_bundle.sh
```

Par défaut, le bundle est écrit dans:

- `audit/p0/reports/audit_p0_bundle_for_share.txt`

Pour choisir un autre chemin de sortie:

```bash
bash tools/audit/export_p0_bundle.sh /tmp/mon_bundle.txt
```

