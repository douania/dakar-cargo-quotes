3 patchs chirurgicaux — sans refactor

## Patch 1 : QuotationSheet.tsx — fallback stableThreadRef

**Probleme** : Quand `emailData.thread_ref` est `null` (emails importes sans header References), `stableThreadRef` reste `null`. Le bouton "Analyser la demande" affiche "Fil email introuvable" et bloque tout le flux.

**Correction** : Apres le fallback par sujet (ligne ~828), si `stableThreadRef` est toujours `null` et qu'on a trouve des emails par sujet, generer un ref synthetique `subject:<normalized>` et l'injecter dans `stableThreadRef`.

```text
// Apres ligne 828 (fallback subject), ajouter :
if (!stableThreadRef && threadEmailsList.length > 0 && emailData.subject) {
  const syntheticRef = `subject:${normalizeSubject(emailData.subject)}`;
  setStableThreadRef(syntheticRef);
}
```

**Fichier** : `src/pages/QuotationSheet.tsx` (lignes 826-829)
**Impact** : Le flux "Analyser la demande" fonctionne meme sans `thread_ref` natif. `normalizeSubject` est deja importe (ligne 133).

---

## Patch 2 : calculate-duties/index.ts — base TVA corrigee

**Probleme** : Ligne 313, la base TVA est `caf_value + ddAmount + rsAmount + tinAmount + tciAmount`. La surtaxe (`surtaxeAmount`) est calculee plus haut mais absente de l'assiette TVA. Or, selon le droit douanier senegalais, la TVA s'applique sur l'ensemble des droits et taxes exigibles, incluant la surtaxe.

**Correction** : Ajouter `surtaxeAmount` dans la formule.

Ligne 313 actuelle :

```text
const baseTVA = caf_value + ddAmount + rsAmount + tinAmount + tciAmount;
```

Remplacer par :

```text
// Base TVA = CAF + DD + Surtaxe + RS + TIN + TCI (droit douanier senegalais)
const surtaxeTotal = breakdown.find(d => d.code === 'SURTAXE')?.amount || 0;
const baseTVA = caf_value + ddAmount + surtaxeTotal + rsAmount + tinAmount + tciAmount;
```

Note : `surtaxeAmount` n'est pas toujours dans le scope (elle est declaree dans un bloc conditionnel a la ligne ~150). On utilise donc `breakdown.find()` qui est toujours fiable puisque la ligne SURTAXE est ajoutee au breakdown avant ce point.

**Fichier** : `supabase/functions/calculate-duties/index.ts` (ligne 313)
**Impact** : Correctif fiscal pur. Ne change rien aux autres calculs.

---

## Patch 3 : supabase/config.toml — verify_jwt = true sur fonctions sensibles

**Probleme** : Toutes les fonctions sont en `verify_jwt = false`. Les fonctions qui modifient des donnees critiques (decisions, pricing, envoi de devis, import de threads) doivent etre protegees au niveau transport JWT, en complement du guard `requireUser()` dans le code.

**Correction** : Passer en `verify_jwt = true` les 9 fonctions suivantes :


| Fonction          | Raison                   |
| ----------------- | ------------------------ |
| data-admin        | Acces admin aux donnees  |
| email-admin       | Acces admin aux emails   |
| send-quotation    | Envoi de devis au client |
| import-thread     | Import de donnees email  |
| sync-emails       | Synchronisation emails   |
| ensure-quote-case | Creation de dossier      |
| build-case-puzzle | Extraction IA            |
| run-pricing       | Calcul de prix           |
| commit-decision   | Decision operateur       |


**Fichier** : `supabase/config.toml`
**Impact** : Config uniquement. Aucun changement de logique interne. Le guard `requireUser()` reste en place comme deuxieme couche.

**Attention** : Ce patch suppose que le frontend envoie correctement le header `Authorization: Bearer <token>` pour ces appels (via `supabase.functions.invoke` qui le fait automatiquement quand l'utilisateur est connecte). Si un appel est fait sans session active, il sera rejete au niveau JWT avant meme d'atteindre le code.

---

## Resume


| Patch                       | Fichier                   | Lignes touchees    | Risque regression             |
| --------------------------- | ------------------------- | ------------------ | ----------------------------- |
| 1. Fallback stableThreadRef | QuotationSheet.tsx        | ~3 lignes ajoutees | Minimal (fallback uniquement) |
| 2. Base TVA + surtaxe       | calculate-duties/index.ts | 1 ligne modifiee   | Nul (correctif fiscal)        |
| 3. verify_jwt config        | config.toml               | 9 lignes changees  | Faible (config transport)     |
