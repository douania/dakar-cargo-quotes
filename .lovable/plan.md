
# Correctif Transport Routier LCL

## Diagnostic

Le transport routier affiche **3 500 000 FCFA** pour un envoi LCL. Cette valeur provient d'un tarif conteneur 40HC dans `pricing_rate_cards` (corridor DAKAR_KEDOUGOU, scope import, confiance 70%).

### Causes racines identifiees

| Composant | Probleme | Ligne |
|---|---|---|
| `quotation-engine/index.ts` | Quand `containers` est vide, il cree un **faux conteneur 40HC** par defaut (ligne 1192) | `[{ type: '40HC', quantity: 1 }]` |
| `price-service-lines/index.ts` | Aucune detection du mode LCL : pas de variable `isLCL` | Lignes 780-782 |
| `price-service-lines` quantity rules | TRUCKING utilise la base `COUNT` (nombre de conteneurs). En LCL, ca donne `missing_containers_default_1` | Ligne 203 |
| `pricing_rate_cards` | Tous les tarifs TRUCKING sont par conteneur (40HC, 20DV). Aucun tarif au poids/volume pour le vrac | DB |
| `local_transport_rates` | Toute la table est par type de conteneur (20' Dry, 40' Dry) | DB |

### Consequence

Pour du LCL, le systeme fabrique un conteneur fantome 40HC et applique un tarif conteneur plein. Le client recoit un devis transport a 3 500 000 FCFA pour quelques colis.

---

## Plan de correction — 3 actions

### Action 1 — Quotation Engine : ne pas creer de conteneur fantome pour le LCL

**Fichier** : `supabase/functions/quotation-engine/index.ts`

Ligne 1188-1192, modifier le fallback pour respecter le mode de transport :

```text
// Avant (defaut aveugle)
: [{ type: '40HC', quantity: 1 }];

// Apres (respecter le type de demande)
const containers: ContainerInfo[] = request.containers?.length
  ? request.containers
  : request.containerType
    ? [{ type: request.containerType, quantity: request.containerCount || 1 }]
    : [];
```

Quand `containers` est un array vide, le moteur doit utiliser les metriques poids/volume au lieu de forcer un conteneur.

La section transport (ligne 1572) `for (const container of containers)` ne generera simplement aucune ligne transport si `containers` est vide, ce qui est le comportement correct pour le LCL ou le transport doit etre price differemment.

### Action 2 — price-service-lines : detecter le mode LCL et adapter le pricing

**Fichier** : `supabase/functions/price-service-lines/index.ts`

#### 2a. Ajouter la detection LCL

Apres la ligne 782 (`isAirMode`), ajouter :

```text
const isLCL = /LCL/i.test(requestType);
```

#### 2b. Adapter computeQuantity pour LCL

Pour les services LCL, la quantite TRUCKING doit etre basee sur le poids (TONNE) ou un forfait, pas sur le nombre de conteneurs.

Dans `computeQuantity`, ajouter un guard au debut de la section `COUNT` (ligne 201) :

```text
// LCL mode: TRUCKING/ON_CARRIAGE use TONNE basis instead of COUNT
if (isLCL && (serviceKey === "TRUCKING" || serviceKey === "ON_CARRIAGE")) {
  const weightKg = ctx.weight_kg;
  if (weightKg && weightKg > 0) {
    const tonnes = Math.ceil(weightKg / 1000);
    return {
      quantity_used: tonnes,
      unit_used: "tonne",
      rule_id: rule.id,
      conversion_used: `lcl_weight_${weightKg}kg=${tonnes}t`,
    };
  }
  // Pas de poids connu → forfait 1 voyage
  return {
    quantity_used: 1,
    unit_used: "forfait",
    rule_id: rule.id,
    conversion_used: "lcl_no_weight_forfait",
  };
}
```

#### 2c. Adapter findBestRateCard pour LCL

Pour le LCL, exclure les rate cards qui ont un `container_type` defini (meme logique que le mode AIR) :

```text
// LCL mode: exclure rate cards par conteneur
if (isLCL && card.container_type) continue;
```

Cela forcera le systeme a utiliser uniquement les rate cards sans container_type (generiques par voyage ou forfait) ou a retourner `no_match`.

#### 2d. Adapter findLocalTransportRate pour LCL

Ligne 522 : le code fait `if (!ctxContainer) return null`. Pour le LCL, il faut autoriser la recherche sans container_type et matcher sur la destination uniquement :

```text
// LCL: skip container matching, use destination-only rate
if (isLCL) {
  // For LCL, return null (no container-based transport rate applies)
  // Transport will be priced via rate card or manual input
  return null;
}
```

### Action 3 — Ajouter un rate card TRUCKING generique pour le LCL

Inserer dans `pricing_rate_cards` un tarif transport LCL forfaitaire "a confirmer" :

```sql
INSERT INTO pricing_rate_cards (
  service_key, scope, currency, unit, value, source, confidence,
  container_type, corridor, notes, status
) VALUES (
  'TRUCKING', 'import', 'XOF', 'voyage', 0, 'no_match', 0,
  NULL, NULL, 'LCL transport — tarif à confirmer avec transporteur', 'active'
);
```

Avec `value: 0` et `confidence: 0`, l'operateur sera averti que le tarif est "Non trouve" et devra etre rempli manuellement. C'est preferable a un faux tarif conteneur.

---

## Resume

| Action | Fichier | Impact |
|---|---|---|
| 1. Supprimer le conteneur fantome 40HC | quotation-engine | Empeche le moteur de generer des lignes transport par conteneur pour du LCL |
| 2a-d. Detecter LCL dans price-service-lines | price-service-lines | Quantite basee sur le poids, rate cards conteneur exclues |
| 3. Rate card generique LCL | DB migration | Fallback propre "a confirmer" |

## Ce qui ne change PAS

- Le pricing FCL reste identique (la branche conteneurs n'est pas modifiee)
- Le pricing AIR reste identique
- Aucune modification frontend
- Aucune modification de tables DB (sauf insertion d'un rate card)

## Validation

Apres deploiement, relancer le pricing sur le dossier Lantia :
1. Transport routier : **0 FCFA** avec source "Non trouve" et note "a confirmer"
2. Pas de reference a un conteneur 40HC
3. Quantite basee sur le poids ou forfait (pas EVP/COUNT)
