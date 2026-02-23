

# Fix extraction regime/titre d'exoneration + categorie manquante

## 3 bugs identifies

### Bug 1 -- Regex titre tronquee (ligne 1324)

Le texte OCR a cette structure multi-lignes :

```text
TITRE D'EXONERATION
Numero:
2025CI-1244
Regime :
C139
```

La regex actuelle capture ce qui suit "Titre d'exoneration" sur la meme ligne, soit `"Numero:"` au lieu de `"2025CI-1244"`.

**Correction** : Ajouter un pattern specifique pour capturer le numero d'exoneration sur la ligne suivante.

```text
// Pattern 1: "Titre d'exoneration" suivi du contenu sur la meme ligne
// Pattern 2: "Numero:" suivi de la valeur (meme ligne ou ligne suivante)
const numberPattern = /Num[ée]ro\s*:?\s*\n?\s*([A-Z0-9][\w\s\-\/CI]+\d)/i;
```

Si la regex titre ne capture que `"Numero:"`, on extrait la vraie valeur via le pattern numero.

### Bug 2 -- Regex regime ne traverse pas les sauts de ligne (ligne 1312-1315)

La regex `/Regime\s*:?\s*(C\d{3,4})/` ne matche pas quand il y a un saut de ligne entre `Regime :` et `C139`.

**Correction** : Ajouter `\n?\s*` pour autoriser un saut de ligne optionnel entre le label et la valeur.

```text
// Avant
/R[ee]gime\s*:?\s*(C[\s\-\/]?\d{3,4}|...)/gi

// Apres
/R[ee]gime\s*:?\s*\n?\s*(C[\s\-\/]?\d{3,4}|...)/gi
```

### Bug 3 -- Categorie "customs" absente du check constraint (ligne 1399)

La fonction `supersede_fact` est appelee avec `p_fact_category: "customs"` pour `customs.regime_code`. Or le check constraint `quote_facts_fact_category_check` n'autorise PAS `customs`. C'est pourquoi les logs montrent :

```text
[Regime doc-regex] supersede_fact FAILED: quote_facts_fact_category_check
```

Meme si les regex etaient correctes, l'insertion echouerait toujours.

**Correction** : Ajouter `'customs'` au check constraint via migration SQL.

## Plan d'implementation

### Etape 1 -- Migration SQL

Ajouter `'customs'` a la contrainte `quote_facts_fact_category_check` :

```text
ALTER TABLE quote_facts DROP CONSTRAINT IF EXISTS quote_facts_fact_category_check;
ALTER TABLE quote_facts ADD CONSTRAINT quote_facts_fact_category_check
  CHECK (fact_category IN (
    'cargo', 'routing', 'timing', 'pricing', 'documents',
    'contacts', 'other', 'service', 'regulatory',
    'carrier', 'survey', 'customs'
  ));
```

### Etape 2 -- Corriger les regex dans build-case-puzzle/index.ts

**Ligne 1312-1315** : Modifier les patterns regime pour accepter un saut de ligne optionnel entre le label et la valeur :

```text
const codePatterns = [
  /R[ee]gime\s*:?\s*\n?\s*(C[\s\-\/]?\d{3,4}|S[\s\-\/]?\d{3,4}|\d{4})/gi,
  /Code\s*r[ee]gime\s*:?\s*\n?\s*(C[\s\-\/]?\d{3,4}|S[\s\-\/]?\d{3,4}|\d{4})/gi,
];
```

**Ligne 1324-1328** : Corriger le pattern titre pour gerer le format OCR multi-lignes. Si le texte apres "Titre d'exoneration" est juste un label comme "Numero:", extraire la valeur sur la ligne suivante :

```text
const titlePattern = /(Titre\s*d['''\u2019]exon[ee]ration\s*:?\s*)([^\r\n]{5,120})/i;
const tm = text.match(titlePattern);
if (tm) {
  let titleValue = tm[2].trim();
  // Si la valeur capturee est juste un label (ex: "Numero:"), chercher la vraie valeur
  if (/^Num[ee]ro\s*:?\s*$/i.test(titleValue)) {
    const numMatch = text.match(/Num[ee]ro\s*:?\s*\n?\s*([A-Z0-9][\w\-\/\s]*\d)/i);
    if (numMatch) {
      titleValue = numMatch[1].trim();
    }
  }
  if (titleValue.length > 3 && !/^(Num[ee]ro|R[ee]gime)\s*:?\s*$/i.test(titleValue)) {
    titles.push(titleValue);
  }
}
```

### Etape 3 -- Deployer et tester

1. Deployer la migration SQL
2. Deployer `build-case-puzzle`
3. Relancer l'analyse sur le dossier CASSIS EQUIPEMENTS
4. Verifier que les facts injectes sont :
   - `regulatory.exemption_title = "2025CI-1244"`
   - `customs.regime_code = "C139"`
5. Relancer le pricing pour verifier qu'il passe

## Section technique

### Fichier modifie : supabase/functions/build-case-puzzle/index.ts

**Lignes 1312-1315** : Ajout de `\n?\s*` dans les regex regime pour traverser les sauts de ligne OCR.

**Lignes 1324-1328** : Ajout d'une logique de fallback quand le pattern titre capture un label au lieu de la valeur.

### Migration SQL

Ajout de `'customs'` au check constraint `quote_facts_fact_category_check`. Sans cette migration, AUCUN fact de categorie `customs` ne peut etre insere -- ce qui explique pourquoi `customs.regime_code` n'a jamais ete injecte, meme si le regex le detectait.

### Risque de regression

Faible. Les regex sont elargies (acceptent plus de formats) sans changer le comportement pour les cas existants. La migration ajoute une valeur au check sans toucher les valeurs existantes.

### Verification des erreurs existantes

Le log montre que cette erreur se reproduit a chaque run :
```text
[Regime doc-regex] supersede_fact FAILED: quote_facts_fact_category_check
```
Cela signifie que C139 ETAIT detecte par la regex, mais l'insertion echouait systematiquement a cause du check constraint. C'est donc le bug 3 qui est le plus critique des trois.

