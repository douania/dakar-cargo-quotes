
## Objectif (correction CTO)
Stabiliser **uniquement** `supabase/functions/generate-quotation/index.ts` en garantissant :
- **Une seule** logique d’auth (getUser), **zéro** trace de `getClaims()`
- `Authorization` correctement propagé au client anon (sinon `getUser()` retourne `null`)
- Code **compilable**, lisible, testable
- Aucun changement d’architecture / aucune feature additionnelle

---

## Constats factuels (état actuel du repo)
- `supabase/functions/generate-quotation/index.ts` ne contient **déjà** aucune occurrence de `getClaims()` (vérifié par recherche repo).
- Le client anon est bien construit avec `global.headers.Authorization = authHeader` (présent et correct).
- Malgré ça, pour alignement strict avec votre “VERSION FINALE” (et éviter tout piège de header non-`Bearer`/case), on applique le bloc **exact** demandé et on supprime toute variation.

---

## Changements prévus (chirurgicaux)

### 1) Fichier : `supabase/functions/generate-quotation/index.ts`
**But :** remplacer le bloc AUTH existant par votre version finale (copier-coller), sans laisser de logique résiduelle.

#### 1.1 Remplacement du guard `Bearer`
Actuellement :
- Le code fait `if (!authHeader?.startsWith('Bearer ')) { ... }`

À appliquer (version CTO) :
- `if (!authHeader) { ... }`

Raison : éviter les faux négatifs (token valide mais header non strictement “Bearer …”), tout en restant conforme à la règle “header obligatoire”.

#### 1.2 Bloc client anon + getUser()
S’assurer que le code **contient exactement** :
```ts
const anonClient = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  }
);

const { data: { user }, error: authError } = await anonClient.auth.getUser();

if (authError || !user) { ... }

const userId = user.id;
```

#### 1.3 Nettoyage “zéro trace”
Vérifier qu’il ne reste **aucune** référence à :
- `token`
- `getClaims`
- `claimsData`
- `claimsError`
- `claimsData.claims.sub`

---

## Vérifications techniques (anti-régression)
1) **Recherche repo** : confirmer 0 match sur `getClaims(` et `claimsData|claimsError`.
2) Vérifier que le fichier `supabase/config.toml` contient bien :
```toml
[functions.generate-quotation]
verify_jwt = false
```
(Si absent : l’ajouter. S’il est déjà présent : ne pas toucher.)

---

## Tests CTO post-fix (obligatoires)

### A) Tests fonctionnels (mêmes que votre checklist)
1. Build / compilation OK (pas d’erreur runtime Deno / TS côté function)
2. Appel `generate-quotation` avec JWT valide → **200**
3. JWT invalide / absent → **401**
4. Bon user + draft `status='draft'` → `status='generated'` + `generated_snapshot` persisté
5. Refresh page `/quotation/new` après génération → preview relue depuis `generated_snapshot`

### B) Test ownership critique (ajout CTO)
Objectif : prouver le verrou ownership même si la function utilise le service role.

Procédure (simple, réaliste) :
1. **User A** : créer un draft, noter `quotation_id` (dans l’UI / logs / DB selon vos habitudes).
2. Se déconnecter.
3. **User B** (compte différent) : appeler la function `generate-quotation` en réutilisant **le quotation_id de A** (via un appel manuel DevTools ou en instrumentant temporairement un appel test).
Résultat attendu :
- **403 Non autorisé**
- aucun update en base

---

## Diff attendu (clair)
### `supabase/functions/generate-quotation/index.ts`
- Suppression/ajustement du check `startsWith('Bearer ')` → `if (!authHeader)`
- Bloc AUTH remplacé pour correspondre strictement à la version CTO
- Garantie “zéro occurrence getClaims”

---

## Fichiers impactés (scope minimal)
- Modifié : `supabase/functions/generate-quotation/index.ts`
- Aucun autre fichier

---

## Critères d’acceptation (fin de correction)
- La function ne contient **aucune** trace de `getClaims`
- `getUser()` fonctionne (Authorization bien propagé au client anon)
- 200 / 401 / 403 conformes aux scénarios
- Build OK
