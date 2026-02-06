

# PHASE M1.4.2 — Corrections critiques DATA

## Contexte verifie par audit DB

| Table | Constat |
|-------|---------|
| `carrier_billing_templates` | 57 lignes, toutes `source_documents = NULL` |
| `port_tariffs` | 15 lignes `DP_WORLD` + 28 lignes `DPW` (pas de doublons) |
| `tax_rates` | 7 taux actifs, TIN absent. `calculate-duties` lit deja `hs_codes.tin` |

---

## Tache 1 — source_documents (correction CTO appliquee)

Une seule migration SQL avec 3 UPDATEs :

| Carrier | Nb lignes | source_documents |
|---------|-----------|-----------------|
| CMA_CGM | 9 | `{"TO_VERIFY"}` |
| GENERIC | 6 | `{"TO_VERIFY"}` |
| GRIMALDI | 6 | `{"TO_VERIFY"}` |
| MAERSK | 6 | `{"TO_VERIFY"}` |
| MSC | 9 | `{"TO_VERIFY"}` |
| HAPAG_LLOYD | 14 | `{"hapag_lloyd_local_charges.pdf"}` |
| ONE | 7 | `{"one_line_local_charges.pdf"}` |

Seuls les 2 fichiers reellement presents dans `public/data/tarifs/` sont references. Tout le reste est marque `TO_VERIFY`.

## Tache 2 — Fusion DP_WORLD vers DPW

Un seul UPDATE :

```text
UPDATE port_tariffs SET provider = 'DPW' WHERE provider = 'DP_WORLD'
```

Resultat : 0 lignes DP_WORLD, 43 lignes DPW. Le moteur cherche deja `DPW` — aucun changement de code.

## Tache 3 — Ajout TIN dans tax_rates

Un INSERT :

| code | name | rate | base_calculation | applies_to |
|------|------|------|-----------------|------------|
| TIN | Taxe d'Internalisation | 0 | CAF + DD + RS | Codes HS specifiques (5%, 10%, 15%) |

Le `rate = 0` est intentionnel : le taux reel est variable par code HS et deja lu depuis `hs_codes.tin` par `calculate-duties`. Cette ligne sert de reference documentaire.

## Implementation technique

Un seul fichier de migration SQL contenant les 3 operations (UPDATE + UPDATE + INSERT). Zero fichier de code modifie.

## Verification post-execution

3 requetes de controle :
1. Verifier que chaque carrier a un `source_documents` non-NULL
2. Verifier `COUNT(*) WHERE provider = 'DP_WORLD'` = 0
3. Verifier `SELECT * FROM tax_rates WHERE code = 'TIN'` retourne 1 ligne

