## PHASE 2-P — Runtime / UI Check (READ-ONLY)

**Statut : PASS (vérification statique) — PARTIAL (vérification visuelle live non exécutée, Plan Mode strict)**

### Faits observés (statique, source de vérité = repo)

- Composant présent : `src/components/case/CargoCanonicalPreviewPanel.tsx` (326 lignes).
- Import dans `src/pages/CaseView.tsx` ligne 74.
- Insertion ligne 1149, **juste après la Card d'info dossier** (fermée ligne 1146) et **avant le Thread Intent Display** (ligne 1151) → position conforme à la spec ("après l'info bar du dossier").
- Rendu conditionnel `{caseId && <CargoCanonicalPreviewPanel caseId={caseId} />}` → pas de montage sans `caseId`.

### Vérifications du composant (lecture `CargoCanonicalPreviewPanel.tsx`)

| Critère | Résultat |
|---|---|
| Texte "Prévisualisation uniquement. Aucune donnée cargo canonique n'est écrite." | Présent (CardDescription) |
| Bouton "Prévisualiser depuis les pièces jointes" | Présent (unique `<Button>` du panneau) |
| Auto-trigger au montage | **Non** — `useState("idle")`, aucun `useEffect` déclencheur, action uniquement sur `onClick` |
| Bouton commit/write/apply/save | **Aucun** — un seul `<Button>` dans le JSX |
| Edge Function appelée | `derive-cargo-canonical-payload` uniquement |
| Appels interdits (`write-cargo-canonical`, `canonicalize-cargo-from-case`) | **Aucun** (vérifié, pas de référence dans le fichier) |
| UI cohérente avec Cards existantes | Oui — `Card`/`CardHeader`/`CardContent`, `Button`, `Badge`, `Alert`, `Table` shadcn standards |

### Console logs preview (snapshot fourni)

- Seuls warnings React Router v7 (pré-existants, non liés à la Phase 2-P).
- Aucune erreur runtime.

### Vérification live non effectuée

Plan Mode interdit toute exécution Playwright/clic. La vérification visuelle réelle (ouverture d'un dossier dans CaseView, clic sur "Prévisualiser", affichage warnings/sources/cargo_lines/unallocated_equipment/canonicalize_status) **n'a pas été exécutée**. Aucune donnée DB lue, aucun appel Edge Function effectué.

### Risques

- Aucun risque code observé. Le panneau est strictement read-only côté UI : pas d'effet de bord au montage, pas de chemin d'écriture, pas d'invocation des fonctions de commit.
- Risque résiduel (non vérifiable sans live click) : comportement réel de `derive-cargo-canonical-payload` côté Edge — hors scope Phase 2-P UI.

### Recommandation

**Aucun changement / aucun patch nécessaire.**

Pour compléter en PASS total, exécuter en mode autorisé (lecture live uniquement) :
1. Naviguer vers `/cases/:id` sur un dossier de test ayant des pièces jointes.
2. Capture d'écran de la position du panneau.
3. Un seul clic "Prévisualiser depuis les pièces jointes" → observer rendu (warnings, sources_used, cargo_lines, unallocated_equipment, canonicalize_status).
4. Aucune autre interaction.

Si CTO souhaite cette validation live, donner :
**GO PHASE 2-P LIVE UI CHECK** (read-only Playwright + invoke unique de `derive-cargo-canonical-payload` via le bouton, aucun autre appel).

### Stop condition

Aucune modification requise. Aucun GO supplémentaire demandé pour patch.
