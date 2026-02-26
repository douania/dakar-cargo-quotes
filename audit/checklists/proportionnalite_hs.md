# Checklist — Proportionnalité HS (dossier multi-HS en répartition équitable)

> À appliquer dès qu'un dossier multi-HS sort en répartition **équitable** alors qu'une répartition **proportionnelle** est attendue.

## Prérequis

- Le dossier doit avoir **N ≥ 2 codes HS** dans `cargo.hs_code`
- Le moteur (`quotation-engine`) utilise un coverage guard exact 10 digits

---

## Checklist (5 items)

### 1. Vérifier `cargo.hs_code`

Le fact `cargo.hs_code` contient-il bien N codes (N ≥ 2) séparés par des virgules ?

```sql
SELECT value FROM quote_facts
WHERE case_id = '<CASE_ID>' AND category = 'cargo' AND field = 'hs_code' AND is_current = true;
```

- ✅ Contient 2+ codes → continuer
- ❌ Contient 1 seul code → pas de répartition proportionnelle possible (comportement normal)

### 2. Vérifier `cargo.articles_detail`

Le fact `cargo.articles_detail` existe-t-il avec `is_current = true` ?

```sql
SELECT id, value, source_type FROM quote_facts
WHERE case_id = '<CASE_ID>' AND category = 'cargo' AND field = 'articles_detail' AND is_current = true;
```

- ✅ Existe → continuer
- ❌ Absent → relancer `build-case-puzzle` pour le case

### 3. Comparer les HS des articles vs les HS du dossier

Les codes HS dans `articles_detail` matchent-ils **exactement** (10 digits) les codes de `cargo.hs_code` ?

Exemple de mismatch :
- `cargo.hs_code` = `9015300000`
- `articles_detail` contient `9015301000`

- ✅ Match exact → le problème est ailleurs (vérifier le moteur)
- ❌ Mismatch (`...1000` vs `...0000`) → le pré-enrichissement SH6 n'a pas fonctionné **ou** le fact n'a pas été rafraîchi (voir item 4)

### 4. Rafraîchir le fact si nécessaire

Si un fact `cargo.articles_detail` existant bloque la ré-extraction :

```sql
UPDATE quote_facts SET is_current = false
WHERE case_id = '<CASE_ID>' AND category = 'cargo' AND field = 'articles_detail';
```

Puis relancer `build-case-puzzle` pour le case.

> **Note** : Un flag `force_articles_detail: true` est envisagé pour éviter cette manipulation SQL (voir PHASE_15_NOTES.md).

### 5. Vérifier le résultat après `run-pricing`

Après relance de `run-pricing` :

- Le `duty_breakdown` contient-il des CAF **différents** entre les HS ?
- La note mentionne-t-elle "proportionnelle" (et non "équitable") ?

```sql
SELECT output_json->'duty_breakdown' FROM pricing_runs
WHERE case_id = '<CASE_ID>' ORDER BY created_at DESC LIMIT 1;
```

- ✅ CAF différents + mention "proportionnelle" → **fix confirmé**
- ❌ CAF identiques ou mention "équitable" → escalader (vérifier les logs `[Engine]` du pricing run)

---

## Référence

- **Fix source** : `supabase/functions/build-case-puzzle/index.ts` (L1609-1619)
- **Case de référence** : Taleb `57f0043c-1316-4837-a38e-c07e055d2373` (Run #8)
- **Notes** : `.lovable/PHASE_15_NOTES.md` → section "Fix Taleb — Proportionnalité HS"
