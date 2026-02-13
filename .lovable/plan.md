

# Sprint "Comprehension LCL + Injection PJ" — 4 corrections ciblees

## Diagnostic confirme

Le dossier **"DDP RATE REQUEST DAKAR LCL 25607"** (case `acddafa7`) presente 4 defauts :

| Probleme | Cause racine | Impact |
|---|---|---|
| Type detecte `SEA_FCL_IMPORT` au lieu de `SEA_LCL_IMPORT` | `detectRequestType` ne connait pas "LCL" comme pattern distinct | Gap bloquant "conteneurs" genere a tort |
| Gap "Merci de preciser type et nombre de conteneurs" | `MANDATORY_FACTS.SEA_FCL_IMPORT` exige `cargo.containers` | Question absurde pour du LCL |
| HS codes et valeur CIF (4655 EUR) non injectes depuis les pieces jointes | `injectAttachmentFacts` cherche `extracted_data.extracted_info.*` mais `analyze-attachments` stocke sous `extracted_data.codes_hs`, `extracted_data.valeur_caf` (structure plate) | Facts PJ ignores silencieusement |
| Prompt qualification demande la date d'arrivee souhaitee | Ligne 70 du prompt `qualify-quotation-minimal` | Question inutile selon la regle CTO |

---

## Action 1 — Ajouter le type SEA_LCL_IMPORT

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`

### 1a. Ajouter LCL dans `detectRequestType`

Inserer un Step 2b apres le Step 2 (maritime patterns) :

```text
// Step 2b: LCL detection (before FCL default)
const lclPatterns = ["lcl", "less than container", "groupage", "consolidation"];
if (lclPatterns.some(p => lowerContext.includes(p))) {
  return "SEA_LCL_IMPORT";
}
```

Modifier Step 2 pour ne retourner `SEA_FCL_IMPORT` que si PAS de signal LCL.

### 1b. Ajouter MANDATORY_FACTS pour SEA_LCL_IMPORT

```text
SEA_LCL_IMPORT: [
  "routing.origin_port",
  "routing.destination_city",
  "cargo.description",
  "cargo.weight_kg",      // poids obligatoire en LCL
  "cargo.volume_cbm",     // volume obligatoire en LCL
  "contacts.client_email",
],
```

Pas de `cargo.containers` — c'est la difference cle avec FCL.

### 1c. Ajouter SEA_LCL_BLOCKING_GAPS

```text
const SEA_LCL_BLOCKING_GAPS = new Set([
  "routing.destination_city",
  "cargo.description",
  "cargo.weight_kg",
  "cargo.volume_cbm",
  "contacts.client_email",
]);
```

### 1d. Ajouter les hypotheses SEA_LCL_IMPORT dans ASSUMPTION_RULES

```text
SEA_LCL_IMPORT: [
  { key: 'service.package', value: 'LCL_IMPORT_DAP', confidence: 0.7 },
  { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
],
```

### 1e. Gerer SEA_LCL dans le switch de gap blocking

Dans la section `isBlocking` (ligne ~1141), ajouter :

```text
else if (detectedType === "SEA_LCL_IMPORT") {
  isBlocking = SEA_LCL_BLOCKING_GAPS.has(requiredKey);
}
```

---

## Action 2 — Corriger l'injection des facts depuis les pieces jointes

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`, fonction `injectAttachmentFacts`

### Probleme structurel

Le code actuel (ligne 578) cherche :
```text
attachment.extracted_data.extracted_info[rawKey]
```

Mais `analyze-attachments` stocke les donnees directement :
```text
attachment.extracted_data.codes_hs = ["8525.50", "8507.20"]
attachment.extracted_data.valeur_caf = 4655
attachment.extracted_data.poids_brut_kg = null
```

### Correction

Modifier `injectAttachmentFacts` pour chercher dans les deux structures :

```text
// Try both formats:
// Format 1: extracted_data.extracted_info.* (packing lists, B/L)
// Format 2: extracted_data.* (analyze-attachments quotations/MSDS)
const extractedInfo = attachment.extracted_data?.extracted_info || attachment.extracted_data;
```

### Ajout de mappings pour le format analyze-attachments

Ajouter au `ATTACHMENT_FACT_MAPPING` :

```text
'codes_hs': { factKey: 'cargo.hs_code', category: 'cargo', valueType: 'text' },
'valeur_caf': { factKey: 'cargo.value', category: 'cargo', valueType: 'number' },
'poids_brut_kg': { factKey: 'cargo.weight_kg', category: 'cargo', valueType: 'number' },
'poids_net_kg': { factKey: 'cargo.weight_net_kg', category: 'cargo', valueType: 'number' },
'volume_cbm': { factKey: 'cargo.volume_cbm', category: 'cargo', valueType: 'number' },
'origine': { factKey: 'routing.origin_port', category: 'routing', valueType: 'text' },
'destination': { factKey: 'routing.destination_city', category: 'routing', valueType: 'text' },
'incoterm': { factKey: 'routing.incoterm', category: 'routing', valueType: 'text' },
'fournisseur': { factKey: 'contacts.shipper', category: 'contacts', valueType: 'text' },
'devise': { factKey: 'pricing.currency', category: 'pricing', valueType: 'text' },
```

Pour `codes_hs` (array), joindre les valeurs : `"8525.50, 8507.20"`.

---

## Action 3 — Supprimer la question sur la date d'arrivee

**Fichier** : `supabase/functions/qualify-quotation-minimal/index.ts`

Ligne 70 — Remplacer :
```text
6. Dates floues ("ASAP", "urgent", "dès que possible") → demander la date d'arrivée souhaitée
```
Par :
```text
6. NE JAMAIS demander la date d'arrivée souhaitée ou l'ETA. Les cotations sont indicatives et non engageantes sur les delais.
```

Cela respecte la regle CTO existante : "Quotation requests should NOT require agents to ask for desired delivery dates."

---

## Action 4 — Ajouter une regle anti-faux-positif pour les HS codes deja extraits

**Fichier** : `supabase/functions/qualify-quotation-minimal/index.ts`

Ajouter a la section "REGLES ANTI-FAUX-POSITIFS" (ligne 72+) :

```text
6. Si des codes HS sont presents dans les faits extraits (cargo.hs_code), NE PAS generer de question demandant les codes HS ou la classification tarifaire
7. Si la valeur CIF/CAF est presente dans les faits (cargo.value), NE PAS demander la valeur de la marchandise
```

---

## Resume de l'impact

| Action | Fichier modifie | Effort | Dossiers corriges |
|---|---|---|---|
| 1. Type SEA_LCL_IMPORT | build-case-puzzle | Moyen | `acddafa7` (LCL Lantia) |
| 2. Injection PJ corrigee | build-case-puzzle | Moyen | Tous les dossiers avec PJ analysees |
| 3. Suppression date arrivee | qualify-quotation-minimal | Trivial | Tous les dossiers futurs |
| 4. Anti-faux-positif HS/valeur | qualify-quotation-minimal | Trivial | `acddafa7` + futurs |

## Ce qui ne change PAS

- Aucune modification frontend
- Aucune modification de tables DB
- Aucune modification du moteur de pricing
- Aucune modification des tarifs

## Validation apres deploiement

Relancer "Analyser la demande" sur le dossier LCL Lantia (`acddafa7`).

Resultats attendus :
1. Type detecte : `SEA_LCL_IMPORT` (au lieu de `SEA_FCL_IMPORT`)
2. Facts injectes depuis PJ : `cargo.hs_code = "8525.50, 8507.20"`, `cargo.value = 4655`, `pricing.currency = EUR`
3. Pas de gap "conteneurs"
4. Gaps pertinents uniquement : poids et volume (manquants dans les PJ)
5. Pas de question sur la date d'arrivee
6. Pas de question sur les codes HS

