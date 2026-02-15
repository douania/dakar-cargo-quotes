# Protocole d’audit métier P0 — Précision de cotation (SODATRA)

## 1) Objectif business

Mesurer la valeur réelle du produit en comparant, à périmètre égal :

1. **Cotation de référence métier** (golden truth)
2. **Cotation agent humain**
3. **Cotation IA**

Le protocole produit un verdict **Go/No-Go** basé sur des KPI métier, pas techniques.

---

## 2) Périmètre et gouvernance

### 2.1 Périmètre initial (Semaine 1)

- 30 dossiers (minimum), idéalement 50.
- Répartition recommandée :
  - 40% maritime import
  - 20% maritime export
  - 20% aérien import
  - 20% cas "complexes" (multi-lignes, HS multiples, incoterm ambigu, surcharge/exception)

### 2.2 Rôles

- **Owner audit**: valide les cas et arbitrages.
- **Référent métier**: construit la vérité de référence.
- **Ops data**: extrait/normalise les jeux.
- **Owner IA**: génère les sorties IA “blind”.

### 2.3 Règles d’intégrité

- Même input fonctionnel pour agent et IA.
- Evaluation à l’aveugle (pas de fuite de la référence vers l’évaluateur IA).
- Horodatage + versionnement des runs.

---

## 3) Données requises

## 3.1 Cas minimum (par dossier)

- Métadonnées: dossier_id, date, client_segment, mode, incoterm.
- Variables opérationnelles: origine/destination, poids/volume, type marchandise, conteneurs, HS.
- Sortie de référence: lignes de cotation détaillées + totaux.
- Sortie agent: lignes + totaux.
- Sortie IA: lignes + totaux.

### 3.2 Schéma standard des lignes (normalisation)

Chaque ligne doit être mappée dans un bloc métier:

- `TRANSPORT_INTERNATIONAL`
- `PORT_AIRPORT`
- `HANDLING`
- `CUSTOMS_CLEARANCE`
- `CUSTOMS_DUTIES_TAXES`
- `FORWARDER_FEES`
- `OTHER`

Champs ligne:

- `service_code`
- `service_label`
- `currency`
- `amount_ht`
- `qty`
- `unit`
- `source` (reference|agent|ia)

---

## 4) KPI métier (scorecard officielle)

## 4.1 KPI bloquants (P0)

1. **Coverage structurelle** = % lignes attendues présentes (par bloc).
2. **Exactitude montants** = MAPE montant par ligne (quand ligne appariée).
3. **Conformité incoterm** = % coûts correctement inclus/exclus selon incoterm.
4. **Séparation débours/honoraires** = taux d’erreur de classification.
5. **Erreur bloquante devis** = % dossiers avec erreur métier critique.

## 4.2 KPI de confiance (P1)

- Écart total devis (% vs référence)
- Écart marge implicite estimée
- Taux de correction manuelle nécessaire
- Temps de production devis (agent vs IA)

## 4.3 Seuils Go/No-Go recommandés

- Coverage structurelle ≥ **95%**
- MAPE médian lignes ≤ **8%**
- Conformité incoterm ≥ **98%**
- Erreur bloquante ≤ **2%**
- Écart total devis médian ≤ **5%**

> Si un seuil P0 échoue => **No-Go produit**.

---

## 5) Pipeline d’exécution (prêt à lancer)

## Étape A — Construire le Gold Set

1. Sélectionner 30–50 dossiers.
2. Figer la vérité de référence (validation expert).
3. Enregistrer sous format tabulaire standardisé.

Format CSV recommandé (`audit_cases.csv`) :

```csv
audit_case_id,dossier_id,mode,incoterm,origin,destination,cargo_type,weight_kg,volume_cbm,hs_codes,reference_quote_id,agent_quote_id,ia_quote_id
A001,DOS-2026-001,SEA_IMPORT,CIF,Shanghai,Dakar,electronics,12000,35,"85044000|85371000",QREF001,QAG001,QIA001
```

## Étape B — Générer sorties IA “blind”

- Générer la cotation IA sans accès au résultat de référence.
- Journaliser `run_id`, version moteur, timestamp.

## Étape C — Apparier les lignes

Règles d’appariement par priorité:

1. `service_code` exact
2. bloc + label normalisé (fuzzy)
3. bloc + proximité montant

Si non apparié => faux négatif de couverture.

## Étape D — Calcul des KPI

Pour chaque dossier:

- Coverage structurelle par bloc
- MAPE lignes appariées
- Contrôle incoterm (inclusion/exclusion)
- Contrôle débours/honoraires
- Erreur bloquante (bool)

## Étape E — Comité de verdict

- Consolidation des KPI globaux.
- Top 10 écarts.
- Décision Go/No-Go + backlog correctif priorisé.

---

## 6) Utilisation immédiate de l’existant dans ce repo

Même sans dossiers réels complets, vous pouvez faire un **audit proxy robuste** en utilisant:

- `import-historical-quotation` pour injecter les cas de référence.
- `suggest-historical-lines` comme baseline historique/agent-like.
- `data-admin: populate_quotation_history` pour bootstrap depuis connaissances validées.

Cela permet de démarrer un cycle P0 en 48h, puis de remplacer progressivement les cas proxy par des dossiers comptables certifiés.

---

## 7) Plan opérationnel 10 jours

### J1–J2

- Cadrage KPI + seuils.
- Sélection 30 cas.
- Mapping schéma de lignes.

### J3–J4

- Injection gold set.
- Génération sorties IA blind.

### J5–J6

- Appariement auto + revue manuelle des ambiguïtés.
- Calcul KPI v1.

### J7

- Atelier erreurs récurrentes (incoterm, lignes manquantes, sur/sous-quoting).

### J8–J9

- Correctifs moteur.
- Re-run sur même set.

### J10

- Rapport final + décision Go/No-Go.

---

## 8) Template de rapport final (copier/coller)

## Audit P0 métier — Rapport

- Fenêtre d’audit: `YYYY-MM-DD -> YYYY-MM-DD`
- Nombre de dossiers: `N`
- Version moteur IA: `vX.Y.Z`

### KPI P0

- Coverage structurelle: `xx.x%` (seuil 95%)
- MAPE médian lignes: `x.x%` (seuil 8%)
- Conformité incoterm: `xx.x%` (seuil 98%)
- Erreurs bloquantes: `x.x%` (seuil 2%)
- Écart total médian: `x.x%` (seuil 5%)

### Verdict

- `GO` ou `NO-GO`

### Top causes d’écart

1. `...`
2. `...`
3. `...`

### Actions prioritaires

- P0: `...`
- P1: `...`
- P2: `...`

---

## 9) Check-list d’exécution (Done/Not Done)

- [ ] Cas sélectionnés et signés métier
- [ ] Schéma de normalisation appliqué
- [ ] Sorties IA blind générées
- [ ] Appariement validé
- [ ] KPI calculés
- [ ] Rapport final produit
- [ ] Décision Go/No-Go actée

