

# Correction des flags customs_regimes -- Source 4D (screenshots)

## Constat

La comparaison entre les 3 screenshots du systeme 4D (55 regimes, source de verite metier) et la table `customs_regimes` en base revele :

- **31 regimes avec au moins un flag incorrect**
- **2 regimes manquants** (C520, C530 absents de la base)

## Tableau comparatif detaille des ecarts

### Regimes avec flags a corriger (UPDATE)

```text
Code   | Colonne(s) en ecart         | DB actuel → Valeur 4D
-------|-----------------------------|-----------------------
C100   | cosec F→T, pcc F→T, tpast F→T
C121   | cosec T→F
C122   | dd T→F, cosec T→F, pcc F→T
C131   | dd T→F, stx F→T, cosec T→F, pcc F→T
C132   | dd T→F, stx F→T
C139   | stx T→F, rs T→F, cosec F→T, ta T→F
C140   | cosec F→T, pcs T→F, pcc T→F
C201   | rs T→F, tin T→F, tva T→F
C301   | stx T→F, rs T→F
C303   | stx T→F, tin F→T
C321   | pcc T→F
C322   | dd T→F
C332   | pcc F→T
C339   | dd T→F, stx F→T, rs T→F, cosec F→T
C401   | tin F→T, pcs F→T, pcc F→T
C501   | pcs T→F, pcc T→F
C502   | tin F→T, pcc F→T, tpast F→T, ta F→T
C503   | rs T→F, tva T→F
C521   | rs T→F
C522   | rs T→F, pcc T→F
C540   | stx T→F
C600   | ta T→F
C951   | cosec T→F
E840   | dd T→F
R320   | dd T→F, rs T→F, tva T→F
S110   | dd T→F
S300   | dd T→F, pcs T→F, cosec F→T
S520   | cosec F→T
S600   | dd T→F
S951   | dd T→F
S972   | tin T→F
```

### Regimes manquants (INSERT)

```text
Code   | DD  STX  RS  TIN  TVA  COSEC PCS PCC TPAST TA
-------|--------------------------------------------------
C520   |  T   T   T   T    T    F     T   T    T    F
C530   |  T   T   T   T    T    F     T   T    T    F
```

### Regimes deja conformes (aucune modification)

C123, C124, C138, C331, C340, E100, R300, R510, R520, R530, R951, S301, S320, S321, S510, S521, S530, S531, S601, S952, S954

## Plan d'implementation

### Etape 1 -- Corrections par UPDATE (31 regimes)

Executer 31 instructions UPDATE ciblant uniquement les colonnes en ecart pour chaque regime.

### Etape 2 -- Insertions des regimes manquants (2 regimes)

Inserer C520 et C530 avec les flags lus depuis le systeme 4D. Le nom et la categorie devront etre renseignes (a confirmer par l'utilisateur ou a laisser vides pour le moment).

### Etape 3 -- Verification

Requete de controle post-migration pour confirmer 0 ecart restant.

## Section technique

### Outil utilise

Outil `insert` (data update) pour les UPDATE et INSERT, pas de migration de schema necessaire.

### Risque de regression

Aucun impact sur le schema. Seules les valeurs boolean des colonnes de taxes sont modifiees. Les colonnes `code`, `name`, `category`, `use_case`, `keywords`, `fixed_amount`, `is_active` ne sont pas touchees.

### Note importante

Les valeurs sont lues directement depuis les captures d'ecran du systeme 4D de production. Certains regimes avec beaucoup de checkboxes proches (comme C401, C502, C503) ont ete lus avec attention mais une verification post-correction est recommandee par l'utilisateur via la page admin `/admin/customs-regimes`.

