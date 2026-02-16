
# Diagnostic architectural : flux Intake vers CaseView

## Probleme identifie

Le flux actuel comporte une **rupture architecturale** entre deux systemes :

```text
INTAKE (creation)                    CASEVIEW (consultation)
     |                                      |
     v                                      v
Railway API                           Railway API
POST /api/casefiles/intake            GET /api/casefiles/{id}
     |                                      |
     v                                      |
quote_cases (Supabase)                      |
     |                                      |
     v                                      |
Dashboard (lit Supabase) ----click---> CaseView (lit Railway)
```

### Ce qui fonctionne

1. **Intake** : `createIntake()` appelle Railway, qui cree le dossier et (normalement) l'insere dans la table `quote_cases` de la base de donnees
2. **Dashboard** : Lit les dossiers depuis `quote_cases` (base de donnees) -- fonctionne
3. **Upload document** : Apres creation, le fichier est stocke dans le storage `case-documents` et enregistre dans `case_documents` -- fonctionne
4. **Analyse IA** : `parse-document` + `analyze-document` extraient les donnees du document uploade -- fonctionne

### Ce qui ne fonctionne PAS

1. **CaseView** : Quand on clique sur un dossier, la page appelle `fetchCaseFile(caseId)` vers Railway (`GET /api/casefiles/{id}`). Si Railway ne retrouve pas le dossier ou est indisponible, on obtient "not_found"
2. **Documents multiples** : L'Intake ne supporte qu'un seul fichier. Vous ne pouvez pas uploader BL + Packing List + DPI + Invoice en meme temps
3. **Pas de lien document-dossier solide** : Les documents supplementaires doivent etre ajoutes APRES creation, via l'onglet Documents de CaseView... qui ne s'ouvre pas (voir point 1)

## Plan de correction (2 etapes)

### Etape 1 -- Corriger CaseView pour lire la base de donnees

**Fichier** : `src/pages/CaseView.tsx`

Remplacer l'appel `fetchCaseFile(caseId)` (Railway) par des requetes directes vers les tables existantes :

| Table | Donnees |
|-------|---------|
| `quote_cases` | Statut, type de demande, completude, priorite |
| `quote_facts` | Faits extraits (client, cargo, routing, incoterm...) groupes par categorie |
| `case_documents` | Documents uploades (deja gere par `CaseDocumentsTab`) |
| `case_timeline_events` | Historique des evenements |

L'interface sera adaptee pour afficher :
- En-tete : nom client (avec fallback) + statut + type + barre de completude
- Onglet Faits : tableau des `quote_facts` groupes par categorie
- Onglet Documents : composant `CaseDocumentsTab` existant (inchange)
- Onglet Timeline : evenements de `case_timeline_events`

Le bouton "Executer le workflow" (Railway) sera retire car non pertinent pour les dossiers Intake.

### Etape 2 -- Permettre l'upload de documents multiples depuis CaseView

Une fois CaseView fonctionnel, vous pourrez :
1. Creer le dossier via Intake avec l'Ordre de Transit (1 document)
2. Ouvrir le dossier depuis le Dashboard
3. Ajouter les documents supplementaires (BL, Packing List, DPI, Invoice, etc.) via l'onglet Documents qui utilise `CaseDocumentsTab` -- deja implemente et fonctionnel

Aucune modification necessaire pour cette etape : `CaseDocumentsTab` supporte deja l'upload multiple avec choix du type de document.

## Fichiers modifies

| Fichier | Action |
|---------|--------|
| `src/pages/CaseView.tsx` | Reecrit pour lire depuis la base de donnees au lieu de Railway |

## Fichiers NON modifies

- `src/pages/Intake.tsx` (inchange)
- `src/pages/Dashboard.tsx` (inchange)
- `src/components/case/CaseDocumentsTab.tsx` (inchange)
- `src/services/railwayApi.ts` (inchange, utilise par Intake)
- Aucune migration de base de donnees

## Flux corrige apres implementation

```text
INTAKE                  DASHBOARD              CASEVIEW
  |                        |                      |
  v                        v                      v
Railway API           quote_cases (DB)      quote_cases (DB)
  |                        |                quote_facts (DB)
  v                        |                case_documents (DB)
quote_cases (DB) <---------+                      |
  |                                               v
  +--- case_documents (storage) ----------> Documents tab
```

Tout le parcours consultation sera sur la base de donnees. Railway reste utilise uniquement pour la creation initiale (Intake).

## Resume

- Le dossier CASSIS sera cree normalement via Intake
- L'OT sera analyse et le formulaire pre-rempli
- Le dossier apparaitra sur le Dashboard
- En cliquant dessus, CaseView affichera les donnees depuis la base de donnees (plus de "not_found")
- Vous pourrez ajouter les documents supplementaires via l'onglet Documents
