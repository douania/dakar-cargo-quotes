

# PHASE M1.4.3 — Elimination des regles implicites (THD/THO regex)

## Constat apres analyse du code

La fonction `determineTariffCategory()` (lignes 731-761) et `fetchCarrierTHD()` (lignes 876-894) sont actuellement definies mais **non appelees** dans `generateQuotationLines`. Ce sont des fonctions preparees pour le matching carrier-specific THD (Hapag-Lloyd categories T01-T14).

Malgre leur statut de "code mort", elles contiennent 6 regles regex hardcodees qui seront activees a terme. L'objectif M1.4.3 reste pertinent : rendre ces regles table-driven **avant** qu'elles ne soient connectees.

---

## Etape 1 — Migration SQL

Creer la table `tariff_category_rules` et seeder 7 regles :

```text
tariff_category_rules
  id              uuid PK default gen_random_uuid()
  category_code   varchar NOT NULL
  category_name   text NOT NULL
  match_patterns  text[] NOT NULL
  priority        integer NOT NULL default 10
  carrier         varchar default 'ALL'
  is_active       boolean default true
  source_document varchar NOT NULL
  notes           text
  created_at      timestamptz default now()
```

RLS : SELECT public read (comme les autres tables de reference).

### Seed (7 regles, bilingues FR+EN)

| category_code | category_name | priority | match_patterns (extrait) | source_document |
|---------------|--------------|----------|--------------------------|-----------------|
| T09 | Vehicules, Machines, Equipements | 10 | vehicle, truck, tractor, generator, transformer, vehicule, tracteur, generateur, transformateur | Hapag-Lloyd tariff classification rules -- TO_VERIFY |
| T01 | Boissons, Chimie, Accessoires | 20 | drink, beverage, chemical, pump, valve, boisson, chimique, pompe | Hapag-Lloyd tariff classification rules -- TO_VERIFY |
| T05 | Cereales, Ciment, Engrais | 30 | cereal, wheat, rice, cement, fertilizer, cereale, ble, riz, ciment, engrais | Hapag-Lloyd tariff classification rules -- TO_VERIFY |
| T14 | Produits metallurgiques | 40 | steel, iron, metal, pipe, tube, beam, acier, fer, tuyau, poutre | Hapag-Lloyd tariff classification rules -- TO_VERIFY |
| T07 | Textiles, Materiaux construction | 50 | textile, fabric, building, cotton, tile, tissu, coton, brique, carrelage | Hapag-Lloyd tariff classification rules -- TO_VERIFY |
| T12 | Produits divers | 60 | mixed, general, various, divers, melange | Hapag-Lloyd tariff classification rules -- TO_VERIFY |
| T02 | Categorie generale (defaut) | 999 | (tableau vide — applique si aucun match) | Hapag-Lloyd tariff classification rules -- TO_VERIFY |

---

## Etape 2 — Modification du moteur (chirurgicale)

Fichier : `supabase/functions/quotation-engine/index.ts`

### 2a. Ajouter la fonction de chargement (dans le bloc des loaders existants)

```typescript
interface TariffCategoryRule {
  category_code: string;
  category_name: string;
  match_patterns: string[];
  priority: number;
  carrier: string;
}

async function loadTariffCategoryRules(supabase: any): Promise<TariffCategoryRule[]> {
  const { data, error } = await supabase
    .from('tariff_category_rules')
    .select('category_code, category_name, match_patterns, priority, carrier')
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (error || !data || data.length === 0) {
    console.warn('tariff_category_rules: DB vide ou erreur, fallback regex');
    return [];
  }
  return data;
}
```

### 2b. Remplacer `determineTariffCategory` (signature synchrone conservee)

Correction CTO appliquee : la fonction reste synchrone, les regles sont pre-chargees.

```typescript
function determineTariffCategory(
  cargoDescription: string,
  rules: TariffCategoryRule[]
): string {
  // DB-backed matching (M1.4.3)
  if (rules.length > 0) {
    const desc = cargoDescription.toLowerCase();
    for (const rule of rules) {
      if (rule.match_patterns.length === 0) continue; // default rule
      const matched = rule.match_patterns.some(p => desc.includes(p.toLowerCase()));
      if (matched) return rule.category_code;
    }
    // Return default rule if exists
    const defaultRule = rules.find(r => r.match_patterns.length === 0);
    if (defaultRule) return defaultRule.category_code;
  }

  // @deprecated M1.4.3 — fallback regex (graceful degradation)
  const desc = cargoDescription.toLowerCase();
  if (desc.match(/power plant|generator|transformer|vehicle|truck|.../)) return 'T09';
  // ... existing regex blocks preserved as fallback ...
  return 'T02';
}
```

### 2c. Pre-charger les regles dans `generateQuotationLines`

Ajouter le chargement dans le bloc existant "0. LOAD DB-BACKED RULES" (ligne 1057) :

```typescript
const [dbIncoterms, dbZones, tariffCategoryRules] = await Promise.all([
  loadIncotermsFromDB(supabase),
  loadDeliveryZonesFromDB(supabase),
  loadTariffCategoryRules(supabase),
]);
```

Les appels futurs a `determineTariffCategory` utiliseront `tariffCategoryRules` en parametre. Puisque la fonction n'est pas encore appelee dans le flux principal, cela n'a pas d'impact fonctionnel immediat mais prepare le terrain.

---

## Fichiers modifies

| Fichier | Changement |
|---------|-----------|
| Migration SQL (nouveau) | Creer table `tariff_category_rules` + seed 7 regles + RLS |
| `supabase/functions/quotation-engine/index.ts` | Ajouter loader, modifier signature `determineTariffCategory`, pre-charger dans `generateQuotationLines` |

## Fichiers NON modifies

- Aucun fichier UI
- Aucun changement d'API
- `_shared/quotation-rules.ts` : pas touche

## Verification post-execution

1. Requete DB : 7 regles presentes dans `tariff_category_rules`, toutes avec `source_document` non-NULL
2. Deploiement du moteur : aucune erreur
3. Appel moteur standard : resultat identique (la fonction n'est pas encore dans le chemin d'execution principal)

## Critere de fin M1.4.3

- Table `tariff_category_rules` creee et seedee avec 7 regles bilingues
- `determineTariffCategory()` lit les regles en parametre (signature synchrone)
- Regex conserves comme fallback `@deprecated`
- Pre-chargement integre dans le flux principal
- Zero changement d'API, zero changement UI

