

# Correction PCS : 1% vers 0.8% dans la base hs_codes

## Contexte

La table `hs_codes` contient **2 995 lignes** avec un taux PCS de 1.00% au lieu de 0.80%.
Les valeurs par defaut dans le code sont deja a 0.8%, ce qui confirme que 0.8% est le taux reglementaire correct (UEMOA).

## Etat actuel des donnees

```text
PCS = 0.80  →  3 135 lignes (correct)
PCS = 1.00  →  2 995 lignes (a corriger)
PCS = 5.00  →  1 ligne (cas special, non touche)
PCS = 20.00 →  1 ligne (cas special, non touche)
```

## Action

Une seule operation de mise a jour en base :

```sql
UPDATE hs_codes SET pcs = 0.80 WHERE pcs = 1.00;
```

Cela corrige les 2 995 lignes sans toucher aux cas speciaux (5% et 20%).

## Impact

- Tous les calculs de droits futurs utiliseront le bon taux PCS de 0.8%
- Les dossiers existants ne sont pas retroactivement modifies (les pricing runs passes restent intacts dans leur snapshot)
- Pour le dossier en cours (`7eab135d`), un nouveau pricing run sera necessaire pour prendre en compte le bon taux PCS

## Aucune modification de code

Le code source est deja aligne sur 0.8% comme valeur par defaut. Seule la donnee en base est incorrecte.

## Section technique

- Table cible : `hs_codes`
- Colonne : `pcs` (numeric)
- Condition : `WHERE pcs = 1.00`
- Lignes affectees : 2 995
- Aucun risque de regression : les fallbacks code sont deja a 0.8

