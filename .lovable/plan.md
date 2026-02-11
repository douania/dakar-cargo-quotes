

# Phase V4.1.4 — Faux positifs : breakbulk, incoterm flou, ambiguites

## Diagnostic

Trois problemes lies entre eux :

### Probleme 1 : Detection BREAKBULK au lieu de CONTAINER

Dans `detectFlowType` (build-case-puzzle, ligne 355-358), la regle breakbulk se declenche si `weightKg > 30000` OU si la description contient "transformer". Ce dossier a 38 tonnes + "transformer" dans la description, mais c'est du **FCL en 40HC** (2 conteneurs). La regle ne verifie pas si des conteneurs sont presents.

**Consequence** : `service.package = BREAKBULK_PROJECT` est injecte, ce qui genere des services breakbulk (dechargement navire, survey) au lieu de services conteneur (DTHC, restitution vide).

### Probleme 2 : Ambiguites fantomes generees par qualify-quotation-minimal

L'IA de qualification ne recoit que les emails bruts et les gaps ouverts. Elle ne connait **pas** les facts deja extraits (incoterm DAP, conteneurs 40HC). Resultat :
- "Incoterm flou" alors que `routing.incoterm = DAP` est deja extrait (confidence 1.00)
- "Detail cargo" demandant les dimensions d'un 40HC (standard, 12.03 x 2.35 x 2.69m)
- "Services ambigus" alors que le package devrait etre determine par le flow type

### Probleme 3 : Dimensions conteneurs standard

L'IA demande les dimensions d'un 40HC. Ces dimensions sont standardisees ISO et ne doivent pas faire l'objet d'une question de clarification.

## Solution en 3 volets chirurgicaux

### Volet 1 : Fix detectFlowType (build-case-puzzle)

**Fichier** : `supabase/functions/build-case-puzzle/index.ts` (lignes 355-358)

Modifier la regle 3 pour exclure les cas avec conteneurs detectes :

```
Avant :
  if (weightKg > 30000 || breakbulkKeywords.some(...)) {
    return 'BREAKBULK_PROJECT';
  }

Apres :
  if (!hasContainers && (weightKg > 30000 || breakbulkKeywords.some(...))) {
    return 'BREAKBULK_PROJECT';
  }
```

Si des conteneurs (40HC, 20DV, etc.) sont presents dans les facts, le poids lourd ou le mot "transformer" ne suffit plus a classer en breakbulk. Le flux tombera dans la regle 4 (`IMPORT_PROJECT_DAP`) qui est le bon package pour du FCL import.

### Volet 2 : Injecter les facts dans le contexte de qualify-quotation-minimal

**Fichier** : `supabase/functions/qualify-quotation-minimal/index.ts` (lignes 188-238)

Apres la recuperation des gaps existants, charger aussi les `quote_facts` actifs et les injecter dans le prompt IA :

```typescript
// Charger les facts existants
let existingFacts: Array<{ fact_key: string; value_text: string | null; value_number: number | null; confidence: number }> = [];
if (quoteCase?.id) {
  const { data: facts } = await supabase
    .from('quote_facts')
    .select('fact_key, value_text, value_number, confidence')
    .eq('case_id', quoteCase.id)
    .eq('is_current', true);
  existingFacts = facts || [];
}

// Ajouter au contexte IA
const factsContext = existingFacts.length > 0
  ? `\n\nFaits deja extraits et confirmes (NE PAS re-questionner) :\n${existingFacts.map(f => `- ${f.fact_key}: ${f.value_text || f.value_number} (confiance: ${f.confidence})`).join('\n')}`
  : '';
```

Et modifier le user message (ligne 238) :

```typescript
content: `Analyse cette demande...\n\n${emailContext}${gapsContext}${factsContext}`
```

### Volet 3 : Enrichir le prompt avec des regles anti-faux-positifs

**Fichier** : `supabase/functions/qualify-quotation-minimal/index.ts` (QUALIFICATION_PROMPT, lignes 49-108)

Ajouter une section de regles pour eviter les faux positifs :

```
== REGLES ANTI-FAUX-POSITIFS ==
1. Si un Incoterm (DAP, FOB, CIF, etc.) est present dans les faits extraits, NE PAS generer d'ambiguite "unclear_incoterm"
2. Les dimensions de conteneurs standards (20DV, 40HC, 40FR, etc.) sont connues ISO et NE necessitent PAS de question. Ne demander les dimensions que pour du breakbulk ou du cargo hors-gabarit (OOG)
3. Si un service.package est identifie dans les faits, NE PAS generer d'ambiguite "service_scope"
4. Si des conteneurs sont presents dans les faits, ne pas demander le poids par conteneur sauf si explicitement "TBC"
```

### Impact

| Element | Modification |
|---|---|
| build-case-puzzle/detectFlowType | 1 ligne (ajout `!hasContainers &&`) |
| qualify-quotation-minimal | ~20 lignes (chargement facts + contexte + regles prompt) |
| Autres fichiers | Zero changement |
| Frontend | Zero modification |
| Migration SQL | Aucune |

### Resultat attendu apres patch

| Avant | Apres |
|---|---|
| Flow type : BREAKBULK_PROJECT | Flow type : IMPORT_PROJECT_DAP |
| Services : Dechargement navire, Survey | Services : DTHC, Transport, Restitution vide, Douane |
| 3 ambiguites fantomes | 0 ambiguites (incoterm DAP connu, conteneurs 40HC standard) |

### Validation

1. Redeployer `build-case-puzzle` et `qualify-quotation-minimal`
2. Relancer "Analyser la demande" sur le dossier
3. Verifier que le flow type est `IMPORT_PROJECT_DAP` (pas BREAKBULK)
4. Verifier que les services pre-remplis correspondent au package DAP
5. Si des questions persistent, verifier qu'elles ne concernent pas des facts deja extraits

