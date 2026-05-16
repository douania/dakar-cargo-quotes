# MAP-8B — Runtime smoke limits and evidence

**Repo** : `douania/dakar-cargo-quotes`  
**Branche cible** : `work`  
**Date** : 2026-05-16  
**Mode** : documentation-only  
**Verdict** : `MAP_8B_RUNTIME_SMOKE_LIMITS_DOCUMENTED_NO_PATCH`

---

## 0. Statut d'exécution

Ce document clôt proprement la séquence de smoke tests runtime MAP-8B tentée après `MAP_8B_EXEC_MIGRATION_DONE`.

Aucune correction runtime n'est incluse dans ce lot.

Périmètre respecté :

- aucun changement `src/` ;
- aucun changement `supabase/functions/` ;
- aucune migration ;
- aucun changement `supabase/config.toml` ;
- aucun test runtime additionnel ;
- aucun insert / update / delete DB ;
- aucun dossier client modifié ;
- aucun composant FROZEN touché.

---

## 1. Contexte

MAP-8B a livré le maillon aval attendu : lorsqu'une catégorie PAD est validée, le wrapper `public.propagate_classification_candidate_to_fact(uuid,text)` doit matérialiser :

```text
cargo.pad_category
cargo.pad_rate_fcfa_per_ton
```

en récupérant le taux depuis `port_tariffs` avec le filtre métier strict :

```text
provider = PAD
category = DROIT_PASSAGE
operation_type = IMPORT
cargo_type = CONTENEUR
classification = <pad_category>
is_active = true
```

Ensuite, `run-pricing` doit pouvoir produire une ligne canonique :

```text
PAD_DROIT_PASSAGE
```

si les trois préconditions suivantes sont réunies :

```text
cargo.pad_category présent
cargo.pad_rate_fcfa_per_ton > 0
poids exploitable > 0
```

L'objectif des smoke tests était de vérifier ce comportement en DB live, sans patch code et sans créer de régression.

---

## 2. Résultat MAP-8B-RUNTIME-SMOKE-1

**Verdict** : `NO_DATA`

### Objectif

Vérifier, en lecture seule, s'il existait déjà un dossier live permettant de prouver la chaîne complète :

```text
cargo.pad_category
→ cargo.pad_rate_fcfa_per_ton
→ run-pricing
→ PAD_DROIT_PASSAGE
→ total_ht / total_ttc cohérents
```

### Résultat

Aucun dossier live pleinement exploitable n'a été identifié avec toutes les préconditions nécessaires :

```text
pad_category présent
pad_rate_fcfa_per_ton numérique et > 0
poids exploitable
pricing_run récent prouvant la chaîne post-MAP-8B
```

### Preuves positives néanmoins acquises

- Aucun double comptage PAD_DROIT_PASSAGE + PORT_TAX n'a été observé dans les dossiers lus.
- Aucun doublon évident de `PAD_DROIT_PASSAGE` n'a été observé.
- Les placeholders `PAD_DROIT_PASSAGE` à `amount = 0` restent cohérents lorsque la catégorie PAD est absente.
- Un dossier ancien montrait que `run-pricing` sait produire une ligne `PAD_DROIT_PASSAGE` valorisée lorsque les facts nécessaires sont présents.

### Limite

SMOKE-1 ne prouve pas que MAP-8B matérialise effectivement `cargo.pad_rate_fcfa_per_ton` depuis zéro dans le runtime actuel.

---

## 3. Résultat MAP-8B-RUNTIME-SMOKE-2A

**Verdict** : `MAP_8B_RUNTIME_SMOKE_2A_BLOCKED_RLS_OWNERSHIP`

### Objectif

Tester la propagation sur un dossier réel existant :

```text
29b96eec-2b85-489f-937e-0da8190c9787
```

Le dossier contenait déjà :

```text
cargo.pad_category = T12
cargo.pad_rate_fcfa_per_ton = 4780
```

Le test 2A devait donc surtout vérifier l'idempotence et la non-régression du wrapper.

### Résultat observé

Le wrapper a refusé l'écriture avec :

```text
{ ok:false, code:"rls_write_denied" }
```

L'appel via Edge Function a été mappé en :

```text
HTTP 403 FORBIDDEN_OWNER
```

Cause identifiée :

```text
has_case_write_access exige created_by = auth.uid() OR assigned_to = auth.uid()
```

Or le dossier réel était :

```text
created_by = fcd6d183-5572-4982-9fd4-3ba3ea5ac33e
assigned_to = NULL
```

Le JWT opérateur preview n'était pas le propriétaire du dossier.

### Interprétation CTO

Ce résultat n'est pas un échec fonctionnel de MAP-8B.

Il valide au contraire un garde-fou de sécurité : le wrapper ne doit pas modifier les facts d'un dossier client lorsque le caller n'a pas les droits métier.

### État final

- Aucun fact existant modifié.
- Aucun nouveau current fact créé.
- Aucun doublon `cargo.pad_category` ou `cargo.pad_rate_fcfa_per_ton` créé.
- Candidate smoke supprimé pendant rollback H2.
- État final identique à l'état initial.

---

## 4. Résultat préflight MAP-8B-RUNTIME-SMOKE-2B

**Verdict** : `MAP_8B_RUNTIME_SMOKE_2B_BLOCKED_TOOLING_GOVERNANCE`

### Objectif

Créer un dossier sandbox appartenant au JWT opérateur actif, puis prouver la propagation depuis zéro :

```text
sandbox case
→ candidate pad_category accepted = T12
→ propagate_classification_candidate_to_fact
→ cargo.pad_category créé
→ cargo.pad_rate_fcfa_per_ton créé depuis port_tariffs
→ idempotence
→ rollback complet
```

### Préflight read-only réalisé

Informations confirmées :

```text
T12 port_tariffs active
amount = 4780
unit = PER_TONNE
provider = PAD
category = DROIT_PASSAGE
operation_type = IMPORT
cargo_type = CONTENEUR
classification = T12
is_active = true
```

Contraintes minimales observées :

```text
quote_facts NOT NULL sans default : case_id, fact_key, fact_category, source_type
commodity_classification_candidates NOT NULL sans default : case_id, designation_normalized, candidate_kind, candidate_value, source
```

### Blocage 1 — rollback strict impossible dans l'outillage actuel

La contrainte CTO exigeait :

```text
rollback complet obligatoire
reliquat sandbox = 0
aucune migration
```

Or les outils DB disponibles dans cette session n'exposaient que :

```text
SELECT
INSERT
```

Aucun `DELETE` ni `UPDATE` n'était disponible hors migration.

Conséquence : tout artefact sandbox créé aurait pu rester en base sans capacité de cleanup stricte dans le périmètre autorisé.

### Blocage 2 — identité JWT non vérifiable cryptographiquement

L'identité du Preview operator JWT n'a pas pu être confirmée de manière cryptographique, car les Edge Functions disponibles ne retournaient pas `auth.uid()` du caller.

Une inférence existait, mais elle n'était pas suffisante pour créer un dossier sandbox avec garantie :

```text
created_by = auth.uid() du JWT actif
```

Si l'inférence avait été fausse, le test aurait répété le blocage RLS de 2A tout en créant des artefacts sandbox non rollbackables.

### Décision prise

STOP avant insertion.

Aucune écriture effectuée.

État DB inchangé.

---

## 5. État des preuves après SMOKE-1 / 2A / 2B

### Prouvé

- Le tarif PAD T12 est bien présent et actif dans `port_tariffs` avec un montant de `4780` FCFA/t dans le périmètre import conteneur.
- La protection RLS / ownership du wrapper fonctionne : un caller sans droit ne peut pas propager une classification sur un dossier client.
- Le mapping d'erreur wrapper → Edge Function est cohérent : `rls_write_denied` devient `403 FORBIDDEN_OWNER`.
- Aucun double comptage `PAD_DROIT_PASSAGE` + `PORT_TAX` n'a été observé pendant les lectures effectuées.
- Aucun doublon current `cargo.pad_category` / `cargo.pad_rate_fcfa_per_ton` n'a été créé par les tentatives bloquées.
- `run-pricing` sait produire `PAD_DROIT_PASSAGE` lorsque les facts nécessaires existent déjà sur un dossier exploitable.

### Non prouvé

- Propagation MAP-8B depuis zéro sur sandbox.
- Création effective de `cargo.pad_rate_fcfa_per_ton` par le wrapper sur chemin succès.
- Idempotence complète du wrapper sur chemin succès.
- Nouveau `run-pricing` post-propagation dans un scénario contrôlé.
- Inclusion post-propagation dans `total_ht` / `total_ttc` sur un nouveau run contrôlé.

---

## 6. Pourquoi il ne faut pas patcher uniquement pour ce smoke

Deux options d'outillage auraient pu débloquer le test :

```text
1. Ajouter une Edge Function read-only whoami pour exposer auth.uid().
2. Ajouter une capacité cleanup sandbox stricte : DELETE/UPDATE filtré ou RPC dédiée.
```

Ces options sont techniquement possibles, mais elles ajoutent une surface de code ou une migration uniquement pour un test de vérification.

Décision CTO : ne pas ajouter d'outillage runtime uniquement pour prouver un smoke non bloquant, tant que :

- aucun bug production n'est observé ;
- les garde-fous sécurité fonctionnent ;
- le maillon aval est déjà documenté comme livré ;
- le prochain besoin métier prioritaire est l'amont CN/NHM/NST/PAD.

---

## 7. Conditions nécessaires pour un futur smoke complet

Un futur smoke MAP-8B end-to-end pourra être repris si l'une des conditions suivantes est disponible :

### Option A — Environnement de test isolé

Un environnement DB sandbox où les données de test peuvent être créées et détruites librement.

### Option B — Dossier sandbox créé depuis l'UI par le même utilisateur actif

L'utilisateur actif crée lui-même un dossier sandbox, ce qui garantit :

```text
created_by = auth.uid()
```

Il faudra malgré tout une capacité cleanup ou une règle claire de conservation des dossiers sandbox.

### Option C — Outillage de test dédié

Outillage minimal possible :

```text
whoami read-only
sandbox_cleanup(tag text)
```

Cette option nécessite un GO CTO séparé, car elle implique patch / migration / tests.

---

## 8. Décision CTO finale

```text
MAP_8B_RUNTIME_SMOKE_LIMITS_DOCUMENTED_NO_PATCH
```

Décisions :

```text
- Ne pas requalifier les blocages 2A/2B en échec MAP-8B.
- Ne pas réassigner un dossier client réel pour tester.
- Ne pas patcher uniquement pour le smoke.
- Ne pas créer de sandbox non rollbackable.
- Clore la séquence runtime smoke comme bloquée par gouvernance / outillage.
- Passer au prochain chantier utile : MAP-RUNTIME-2 audit read-only amont CN/NHM/NST/PAD.
```

---

## 9. Prochain chantier recommandé

```text
MAP-RUNTIME-2 — audit read-only amont CN/NHM/NST/PAD
```

Objectif : auditer en lecture seule les sources et tables de mapping nécessaires pour la chaîne amont :

```text
code structuré explicite ou désignation
→ HS/CN/NHM/CPA/NSTR
→ NST
→ catégorie PAD candidate
→ validation opérateur
→ cargo.pad_category
→ cargo.pad_rate_fcfa_per_ton
→ PAD_DROIT_PASSAGE
```

Contraintes recommandées pour MAP-RUNTIME-2 :

- audit statique GitHub prioritaire ;
- SELECT DB live uniquement si indispensable ;
- aucun patch runtime ;
- aucune migration ;
- aucune activation automatique du resolver ;
- distinguer codes explicitement présents dans documents et codes suggérés ;
- aucune taxe calculée depuis une simple suggestion IA/web ;
- validation opérateur obligatoire avant montant compté.
