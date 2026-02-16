

# Correction : parseTextOverrides ne detecte pas les nombres en lettres et la destination deborde

## Bugs identifies

### Bug 1 : nombres en lettres non detectes
L'operateur ecrit "un des huit conteneurs 40'" mais la regex ne cherche que des chiffres (`\d+`). Les mots francais "un", "deux", "huit" etc. ne matchent pas.

Resultat : `textOverrides.container_count` reste `undefined`, donc le document original (8 conteneurs) est utilise sans correction.

### Bug 2 : destination capture le retour de ligne
La regex destination utilise `[A-Za-zÀ-ÿ\s-]+` ou `\s` inclut les retours de ligne. Dans le texte structure :
```
Destination : DAKAR
Poids : 212000 kg
```
La capture greedy traverse le `\n` et prend "DAKAR\nPoids". Apres trim : "Dakar Poids".

## Corrections dans `src/pages/Intake.tsx`

### Correction 1 : Ajouter un dictionnaire de nombres francais

```text
const FRENCH_NUMBERS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4,
  cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
};
```

### Correction 2 : Enrichir la regex conteneurs

Ajouter un second pattern qui matche les nombres en lettres :

```text
// Pattern 1: digits "1 conteneur 40'"
const containerMatch = inputText.match(
  /(\d+)\s*(?:seul\s+)?(?:conteneur|container|x)\s*(\d{2})?[''']?\s*(HC|DV|OT|FR|GP)?/i
);

// Pattern 2: French words "un des huit conteneurs 40'"
// Captures: "un" (le nombre effectif) + "conteneur(s)" + taille
if (!containerMatch) {
  const wordPattern = new RegExp(
    `(?:^|\\s)(${Object.keys(FRENCH_NUMBERS).join("|")})\\s+(?:seul\\s+|des\\s+\\w+\\s+)?(?:conteneur|container)s?\\s*(\\d{2})?['''"]?\\s*(HC|DV|OT|FR|GP)?`,
    "i"
  );
  const wordMatch = inputText.match(wordPattern);
  if (wordMatch) {
    overrides.container_count = FRENCH_NUMBERS[wordMatch[1].toLowerCase()] ?? 1;
    // same logic for size/type
  }
}
```

Cela matche "un des huit conteneurs 40'" et extrait container_count=1 (le premier mot-nombre) + container_type="40'".

### Correction 3 : Limiter la capture destination a une seule ligne

Remplacer `[A-Za-zÀ-ÿ\s-]+` par `[A-Za-zÀ-ÿ0-9 -]+` (espace explicite, pas `\s`) pour ne pas traverser les retours de ligne.

```text
// Avant
/(?:livraison|livrer|destination|lieu)\s*(?:a|à|:)\s*([A-Za-zÀ-ÿ\s-]+)/i

// Apres
/(?:livraison|livrer|destination|lieu)\s*(?:a|à|:)\s*([A-Za-zÀ-ÿ0-9 -]+)/i
```

Meme correction pour le second pattern (site/chantier).

Ajouter aussi un pattern specifique pour le format OT "Lieu de Livraison ou Expedition : DAKAR ZONE 1" :

```text
/Lieu\s+de\s+Livraison[^:]*:\s*([A-Za-zÀ-ÿ0-9 -]+)/i
```

## Fichier modifie

| Fichier | Modification |
|---------|-------------|
| `src/pages/Intake.tsx` | Dictionnaire FRENCH_NUMBERS, second pattern regex conteneurs avec mots, regex destination sans `\s` + pattern OT specifique |

## Aucune modification backend

Les edge functions `set-case-fact` et `ensure-quote-case` restent inchangees.

## Resultat attendu

Avec le texte "un des huit conteneurs 40', livraison a Diamniadio" ou le format OT "Lieu de Livraison ou Expedition : DAKAR ZONE 1" :

- `container_count = 1` (mot "un" detecte)
- `container_type = "40'"` (detecte)
- `destination = "DAKAR ZONE 1"` (pas de debordement sur "Poids")

Hypotheses affichees :
- "1 conteneur(s) 40' detecte(s)..."
- "Correction operateur : 1 conteneur(s) (OT originale : 8)"
- "Lieu de livraison : DAKAR ZONE 1"

