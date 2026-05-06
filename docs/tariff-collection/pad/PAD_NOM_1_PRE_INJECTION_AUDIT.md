# Rapport PAD-NOM-1 : Audit Pré-Injection (Lecture Seule)

**Date** : 6 Mai 2026
**Auteur** : Manus AI
**Périmètre** : Audit du schéma, des contraintes, et préparation de l'injection des alias PAD 2006.

## 1. Synthèse de l'audit

L'audit pré-injection a été réalisé avec succès en mode lecture seule stricte. Sur les 345 lignes uniques extraites du PDF PAD 2006, **312 lignes sont qualifiées comme injectables**.

| Métrique | Valeur |
|---|---|
| Lignes CSV en entrée | 345 |
| **Lignes injectables** | **312** |
| Lignes exclues (total) | 33 |
| *dont exclues pour conflit* | *4* |
| *dont exclues car déjà existantes* | *1* |
| *dont exclues pour catégorie manquante* | *28* |

Les fichiers générés dans `docs/tariff-collection/pad/` sont :
- `PAD_NOM1_INJECTABLE.csv` (312 lignes)
- `PAD_NOM1_EXCLUDED.csv` (33 lignes)
- `PAD_NOM1_AUDIT_STATS.json` (Statistiques détaillées)

## 2. Audit du schéma et des contraintes

### 2.1 Schéma de `pad_designation_aliases`
La table requiert les colonnes suivantes :
- `bl_term` (NOT NULL)
- `normalized_term` (NOT NULL)
- `commodity_category_id` (NOT NULL, Foreign Key vers `commodity_categories.id`)
- `pad_category` (NOT NULL)
- `is_validated` (BOOLEAN, défaut false)
- `source_type` (CHECK: `seed`, `operator_correction`, `ai_suggestion_validated`)
- `source_reference` (TEXT, nullable)

**Conclusion** : L'injection devra utiliser `source_type = 'seed'` et concaténer les informations de source dans `source_reference`.

### 2.2 Contrainte unique
La contrainte unique anti-doublon est définie sur `(normalized_term, commodity_category_id)`.
**Attention** : Elle n'est *pas* définie sur `(normalized_term, pad_category)`. Cela signifie que la base de données autorise techniquement l'insertion d'un même terme normalisé pointant vers deux `commodity_category_id` différents. La détection des collisions doit donc être gérée en amont ou au runtime.

### 2.3 Dépendance `run-pricing`
L'analyse du code source de `supabase/functions/run-pricing/index.ts` (lignes 1955-2025) révèle que :
1. Le moteur sélectionne `pad_category`, `bl_term`, et `commodity_category_id`.
2. **Cependant, il ne consomme que `pad_category`** pour effectuer le lookup dans `port_tariffs`.
3. La détection des collisions au runtime se fait en comparant les `pad_category` retournées, et non les `commodity_category_id`.

**Conclusion** : `commodity_category_id` est une contrainte structurelle forte (Foreign Key NOT NULL) mais n'est pas utilisé dans la logique de calcul du prix.

## 3. Catégories manquantes et exclusions

Conformément au `MASTER_CONTEXT.md`, les catégories **T06, T08, T10, T11** sont actuellement absentes du référentiel applicatif (`commodity_categories`).

Par conséquent, **28 lignes** pointant vers ces catégories ont été exclues du lot injectable. Il n'est pas recommandé de créer ces catégories artificiellement sans un besoin métier avéré.

## 4. Script d'injection proposé (PAD-NOM-2)

Le script suivant est proposé pour la phase PAD-NOM-2. Il est **idempotent** et respecte toutes les contraintes identifiées. **Il n'a pas été exécuté.**

```typescript
// supabase/functions/scripts/inject_pad_nom2.ts
import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function run() {
  const csvContent = fs.readFileSync('../../docs/tariff-collection/pad/PAD_NOM1_INJECTABLE.csv', 'utf-8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true });

  console.log(`Lecture de ${records.length} lignes injectables...`);

  // 1. Récupérer le mapping pad_category -> commodity_category_id
  const { data: categories, error: catErr } = await supabase
    .from('commodity_categories')
    .select('id, pad_category')
    .not('pad_category', 'is', null);
    
  if (catErr) throw catErr;

  // Prendre le premier ID trouvé pour chaque pad_category (suffisant car run-pricing utilise pad_category)
  const catMap = new Map<string, string>();
  for (const c of categories) {
    if (!catMap.has(c.pad_category)) {
      catMap.set(c.pad_category, c.id);
    }
  }

  // 2. Préparer le payload
  const payload = [];
  for (const r of records) {
    const catId = catMap.get(r.pad_category);
    if (!catId) {
      console.warn(`⚠️ Catégorie ${r.pad_category} introuvable en DB pour "${r.normalized_term}". Ignoré.`);
      continue;
    }

    payload.push({
      bl_term: r.raw_designation,
      normalized_term: r.normalized_term,
      commodity_category_id: catId,
      pad_category: r.pad_category,
      is_validated: true,
      source_type: 'seed',
      source_reference: `REDEVANCES_PORTUAIRES_2006.pdf, Section ${r.source_section}, Page ${r.source_page}`
    });
  }

  console.log(`Préparation de ${payload.length} insertions...`);

  // 3. Insérer avec ON CONFLICT DO NOTHING (idempotence)
  const { data, error } = await supabase
    .from('pad_designation_aliases')
    .upsert(payload, { 
      onConflict: 'normalized_term, commodity_category_id',
      ignoreDuplicates: true 
    })
    .select();

  if (error) {
    console.error("❌ Erreur d'insertion:", error);
  } else {
    console.log(`✅ Injection terminée. ${data?.length || 0} nouvelles lignes insérées.`);
  }
}

run().catch(console.error);
```

## 5. Prochaines étapes

1. Validation de ce rapport par le CTO.
2. Si validé, exécution du script d'injection (Phase PAD-NOM-2).
