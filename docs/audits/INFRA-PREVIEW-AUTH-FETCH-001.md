# INFRA-PREVIEW-AUTH-FETCH-001 — Failed to fetch sur Supabase Auth depuis la preview Lovable

> Audit de clôture. Diagnostic invalidé comme ticket autonome / cause principale.
> Le symptôme réel observé en preview directe hors iframe est englobé par
> `INFRA-PUBLISH-VITE-ENV-001` (variables `VITE_*` indisponibles au runtime).

## 1. Métadonnées

| Champ | Valeur |
|-------|--------|
| ID | INFRA-PREVIEW-AUTH-FETCH-001 |
| Catégorie | Infrastructure / Preview Lovable |
| Statut | **INVALIDE comme ticket autonome / cause principale** (2026-04-27) |
| Date d'invalidation | 2026-04-27 |
| Ticket englobant | `INFRA-PUBLISH-VITE-ENV-001` (périmètre élargi publish + preview directe hors iframe) |

## 2. Hypothèse initiale (invalidée comme cause principale)

Un diagnostic antérieur supposait :

> « `/login` s'affiche normalement dans la preview directe, React monte, le guard
> ne `throw` pas, les variables `VITE_*` sont présentes dans ce bundle de
> preview. Le problème est désormais une erreur réseau `TypeError: Failed to
> fetch` lors de l'appel à Supabase Auth depuis la preview Lovable. »

Cette hypothèse a conduit à proposer un nouveau ticket d'investigation réseau
(connectivité DNS/TLS, CORS, extensions navigateur, mode incognito).

## 3. Évidence terrain qui invalide l'hypothèse comme cause principale

Test reproductible effectué le 2026-04-27 :

| Paramètre | Valeur |
|-----------|--------|
| Navigateur | Microsoft Edge |
| Mode | InPrivate (navigation privée) |
| Extensions | Aucune |
| URL testée | `https://id-preview--c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef.lovable.app` |
| Contexte | Hors iframe Lovable Editor (URL preview ouverte directement) |

Observations runtime :

- Panneau du guard `[supabase/guard]` affiché : **« Configuration manquante »**.
- Liste des variables manquantes affichée par le guard : `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`.
- React ne monte pas (le guard `throw` avant l'initialisation de l'app).
- Aucune requête Supabase Auth n'est émise depuis le navigateur (le code qui
  appellerait `supabase.auth.*` n'est jamais exécuté).
- Donc aucune erreur `Failed to fetch` n'apparaît dans ce contexte preview
  directe : le symptôme initialement décrit ne s'y reproduit pas.

Conclusion immédiate : la preview directe hors iframe ne reçoit pas les
variables `VITE_*` au runtime. Le problème observable est rigoureusement le
même que celui déjà documenté pour le bundle publish dans
`docs/audits/INFRA-PUBLISH-VITE-ENV-001-evidence.md`.

## 4. Origine de la confusion

L'erreur `TypeError: Failed to fetch` capturée précédemment (logs runtime du
2026-04-27 entre 16:08 et 16:13) provenait du runtime exécuté **dans l'iframe
de l'éditeur Lovable** (`*.lovableproject.com`), pas de la preview directe ni
du site publié. Dans ce contexte iframe :

- Les variables `VITE_*` peuvent être injectées différemment par
  l'environnement Lovable Editor.
- Le code applicatif s'exécute alors au-delà du guard, atteint l'appel à
  Supabase Auth, et peut échouer pour d'autres raisons (réseau, sandbox iframe,
  CORS, etc.).

Cette erreur iframe a pu exister réellement et ne doit pas être niée
catégoriquement. Mais elle **ne représente pas l'état réel de la preview
directe hors iframe**, qui est aujourd'hui bloquée bien plus tôt, au boot,
par le guard `VITE_*`.

## 5. Verdict

| Élément | Verdict |
|---------|---------|
| Existence d'une erreur `Failed to fetch` dans le runtime iframe Lovable Editor | Plausible, non niée |
| Représentativité de cette erreur pour la preview directe hors iframe | **Non représentative** |
| Pertinence d'un ticket réseau/Auth autonome | **Aucune** |
| Cause principale réelle observée en preview directe | Variables `VITE_*` indisponibles au runtime → guard `throw` → React ne monte pas |
| Ticket actif à suivre | `INFRA-PUBLISH-VITE-ENV-001` (périmètre élargi) |

Statut final : **INVALIDE comme ticket autonome / cause principale.**

## 6. Renvoi

Voir `docs/DEFERRED_BACKLOG.md` → `INFRA-PUBLISH-VITE-ENV-001` (statut
`diagnostic_confirme_perimetre_elargi_escalade_support_requise`,
2026-04-25 publish + 2026-04-27 preview directe hors iframe).

Voir `docs/audits/INFRA-PUBLISH-VITE-ENV-001-evidence.md` pour l'évidence
détaillée du bundle publish (grep `snjewofqxfsdmaszapux` = 0, `import.meta.env`
substitué à vide). Le bundle preview directe n'a pas été capturé par grep ;
l'évidence preview est **runtime via affichage du guard**, pas une capture du
bundle.

## 7. Garde-fous

- Pas de réouverture de ce ticket en tant qu'incident réseau autonome.
- Toute récurrence de `Failed to fetch` côté preview directe ne doit être
  investiguée comme problème réseau **qu'après** confirmation que les variables
  `VITE_*` sont bien présentes dans ce bundle (grep capture preview
  authentifiée requise).
- Suit la résolution de `INFRA-PUBLISH-VITE-ENV-001`.
