

# Correction : les modifications texte de l'operateur ne sont pas prises en compte

## Diagnostic

Le flux actuel a deux problemes :

### Probleme 1 : extractedAnalysis n'est jamais mis a jour par le texte

Quand l'utilisateur modifie le champ "Texte de la Demande" :
- Le texte modifie est envoye a Railway (`createIntake`) -- OK
- Mais `injectContainerFacts` utilise `extractedAnalysis` (donnees du document) sans tenir compte des modifications de l'utilisateur
- Resultat : le document dit "8 conteneurs", l'operateur ecrit "1 seul conteneur 40'", mais le fait injecte reste `cargo.container_count = 8`

### Probleme 2 : le lieu de livraison n'est jamais injecte

Meme si `extractedAnalysis` contient `destination` ou si l'utilisateur ecrit "livraison a Diamniadio", aucun fait `routing.destination_city` n'est injecte. La fonction `injectContainerFacts` ne gere que les faits cargo/mode.

## Plan de correction (Intake.tsx uniquement)

### Modification 1 : Nouvelle fonction `parseTextOverrides(text)`

Avant l'injection des faits, parser le champ texte pour detecter les informations que l'operateur a explicitement ajoutees ou corrigees :

```text
function parseTextOverrides(text: string): Partial<Record<string, any>> {
  const overrides: Record<string, any> = {};

  // Detecter "1 conteneur", "un seul conteneur 40'", "1 x 40HC", etc.
  const containerMatch = text.match(
    /(\d+)\s*(?:seul\s+)?(?:conteneur|container|x)\s*(\d{2})?[''']?\s*(HC|DV|OT|FR|GP)?/i
  );
  if (containerMatch) {
    overrides.container_count = parseInt(containerMatch[1], 10);
    if (containerMatch[2]) {
      const size = containerMatch[2];
      const type = containerMatch[3] || "";
      overrides.container_type = size + "'" + (type ? " " + type.toUpperCase() : "");
    }
  }

  // Detecter lieu de livraison
  const destPatterns = [
    /(?:livraison|livrer|destination|lieu)\s*(?:a|à|:)\s*([A-Za-zÀ-ÿ\s-]+)/i,
    /(?:site|chantier)\s*(?:a|à|de|:)\s*([A-Za-zÀ-ÿ\s-]+)/i,
  ];
  for (const pat of destPatterns) {
    const match = text.match(pat);
    if (match) {
      overrides.destination = match[1].trim();
      break;
    }
  }

  return overrides;
}
```

### Modification 2 : Fusionner les overrides dans injectContainerFacts

Renommer et enrichir la fonction pour devenir `injectFacts(caseId, analysis, textOverrides)` :

- Les overrides du texte ont priorite sur les donnees du document
- Ajouter l'injection de `routing.destination_city` si une destination est detectee

```text
async function injectFacts(
  caseId: string,
  analysis: Record<string, any>,
  textOverrides: Record<string, any>
) {
  // Merge : text overrides > document analysis
  const containerCount = Number(textOverrides.container_count ?? analysis.container_count) || 0;
  const containerType = String(textOverrides.container_type ?? analysis.container_type ?? "");
  const weightKg = Number(analysis.weight_kg) || 0;
  const destination = textOverrides.destination ?? analysis.destination ?? null;

  const facts = [];

  if (containerCount >= 1) {
    facts.push({ fact_key: "cargo.container_count", value_number: containerCount });
    facts.push({ fact_key: "cargo.container_type", value_text: containerType });
  }
  if (weightKg > 0) {
    facts.push({ fact_key: "cargo.weight_kg", value_number: weightKg });
  }
  if (containerType.includes("40") || containerType.includes("20")) {
    facts.push({ fact_key: "service.mode", value_text: "SEA_FCL_IMPORT" });
  }
  if (destination) {
    facts.push({ fact_key: "routing.destination_city", value_text: destination });
  }

  for (const fact of facts) {
    try {
      await supabase.functions.invoke("set-case-fact", {
        body: { case_id: caseId, ...fact },
      });
    } catch (err) {
      console.warn(`[Intake] Failed to inject fact ${fact.fact_key}:`, err);
    }
  }
}
```

### Modification 3 : Appeler la fusion dans handleSubmit

Dans `handleSubmit`, avant l'injection :

```text
// Parse text overrides from operator's edits
const textOverrides = parseTextOverrides(text);

// Inject facts with operator overrides taking priority
if (extractedAnalysis || Object.keys(textOverrides).length > 0) {
  injectFacts(data.case_id, extractedAnalysis || {}, textOverrides);
}
```

### Modification 4 : Mettre a jour correctAssumptions

Ajouter les overrides dans les hypotheses affichees pour que l'operateur voie que ses corrections sont prises en compte :

- Si `textOverrides.container_count` existe et differe de `analysis.container_count`, afficher "Correction operateur : X conteneur(s) (OT originale : Y)"
- Si `textOverrides.destination` existe, afficher "Lieu de livraison : [destination]"

## Fichiers modifies

| Fichier | Action |
|---------|--------|
| `src/pages/Intake.tsx` | Ajouter `parseTextOverrides`, enrichir `injectContainerFacts` en `injectFacts`, appeler la fusion dans `handleSubmit`, mettre a jour `correctAssumptions` |

## Aucune modification backend necessaire

- `set-case-fact` accepte deja `routing.destination_city` (dans la whitelist)
- `set-case-fact` accepte deja `cargo.container_count` et `cargo.container_type`
- Pas de migration SQL

## Flux corrige

```text
1. Upload OT → analyse: 8 conteneurs, destination Dakar
2. Operateur edite le texte: "1 seul conteneur 40', livraison a Diamniadio"
3. Submit → createIntake(text modifie) → Railway
4. parseTextOverrides(text) → { container_count: 1, destination: "Diamniadio" }
5. injectFacts(caseId, analysis{8 containers}, overrides{1 container, Diamniadio})
   → cargo.container_count = 1 (override)
   → cargo.container_type = "40'" (override ou document)
   → routing.destination_city = "Diamniadio" (override)
6. CaseView affiche les valeurs corrigees
```

## Risques

- Aucune regression : si l'operateur ne modifie pas le texte, le comportement est identique (overrides vide)
- Les regex de parsing sont volontairement simples et ciblent les patterns francais courants
- En cas de non-detection, les donnees du document font toujours fallback
