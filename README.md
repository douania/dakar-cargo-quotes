# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

---

## Development Conventions

### UI Components

Components extracted to `src/features/*/components/` follow these rules:

- **Named exports only** — Never use `export default`
- **Import syntax** — Always use `import { Component } from '...'`
- **memo()** — Wrapped components require a cold restart in Vite after changes
- **FROZEN components** — Components marked with `FROZEN` comment should not be modified without opening a new phase

### Testing

Run tests with:
```sh
npx vitest
```

Test files location: `src/**/__tests__/*.test.tsx`

### Frozen Components (Phase 3B)

| Component | Location | Frozen Since |
|-----------|----------|--------------|
| ThreadTimelineCard | `src/features/quotation/components/` | Phase 3B.4 |
| QuotationHeader | `src/features/quotation/components/` | Phase 3B |
| AlertsPanel | `src/features/quotation/components/` | Phase 3B |
| RegulatoryInfoCard | `src/features/quotation/components/` | Phase 3B |
| SuggestionsCard | `src/features/quotation/components/` | Phase 3B |
| QuickActionsCard | `src/features/quotation/components/` | Phase 3B |

---

## Architecture Patterns

### UI State vs Events (Phase 12)

**Règle** : Les conditions d'affichage UI doivent dépendre de l'état métier vérifiable, jamais d'événements historiques.

| Approche | Exemple | Robustesse |
|----------|---------|------------|
| Fragile | `bouton visible si case vient d'être créé` | Échoue au reload |
| Robuste | `bouton visible si factsCount === 0` | Toujours cohérent |

**Application Phase 12** :
```typescript
// Anti-pattern
const showButton = !hasQuoteCase; // Dépend de l'existence, pas du besoin

// Pattern correct
const needsAnalysis = !quoteCase || factsCount === 0; // Dépend de l'état métier
```

**Checklist nouvelle feature** :
- [ ] La condition UI peut-elle être recalculée après un reload ?
- [ ] L'état est-il vérifiable en base de données ?
- [ ] Le comportement est-il identique pour les données legacy ?

### Currency Detection Architecture Backlog (CURRENCY-DETECTION-ARCHITECTURE-1)

> Dette technique à concevoir — **ne pas implémenter maintenant**.

- La **détection de la devise source client** est distincte de la **conversion par taux de change**.
- La page/table des taux sert à **convertir une devise déjà identifiée**, pas à deviner ni à remplacer la devise présente dans un email client.
- La reconnaissance devise devra être **centralisée** (un seul point de vérité).
- Elle devra reconnaître les **codes ISO 4217**, ou au minimum **toutes les devises configurées dans la table des taux**.
- Les **symboles et synonymes** devront être gérés séparément : `EUR/€`, `USD/$`, `GBP/£`, `XOF/FCFA`, `QAR/QR`, `dirham`, `riyal`, `yuan`, etc.
- **Une seule** devise explicite détectée → utiliser cette devise source.
- **Plusieurs** devises explicites présentes → ne pas choisir automatiquement, créer un **gap de confirmation**.
- Devise reconnue mais **taux absent** → créer un **gap « taux de change manquant »**.
- Valeur détectée mais **devise inconnue** → créer un **gap « devise à confirmer »**.
- **Jamais** de fallback automatique vers EUR/USD/XOF.

### Multi-Cargo Lines Architecture Backlog (MULTI-CARGO-LINES-ARCHITECTURE-1)

> Dette technique à concevoir — **ne pas implémenter maintenant**.

- Les dossiers réels peuvent contenir **plusieurs lignes cargo**.
- Un modèle **mono-valué `quote_facts`** n'est **pas suffisant** comme modèle canonique long terme pour les dossiers complexes.
- Le futur modèle devra distinguer :
  - **données globales dossier** : client, routing, incoterm, mode, carrier, contexte package ;
  - **lignes cargo** : description, quantité, HS code, valeur, devise, DGR, poids, volume ;
  - **équipements** : `20GP`, `40GP`, `40HC`, `40FR`, `20OT`, `40RF`, etc. ;
  - **relation ligne cargo ↔ équipement** ;
  - **statut par ligne** : `confirmed`, `to-confirm`, `superseded` ;
  - **pricing par ligne** ou groupe de lignes.
- Tant que cette architecture n'est pas conçue et migrée, l'application **ne doit pas forcer silencieusement** plusieurs lignes cargo dans un seul fact.
- En cas de **multi-scope non représentable proprement** → créer un **gap bloquant** au lieu d'inventer ou d'écraser.
- `quote_request_lines` doit être **audité** avant d'être promu modèle canonique cargo.
- **Aucun patch** ne doit transformer `quote_request_lines` en modèle canonique multi-cargo sans **phase architecture dédiée, plan de migration, tests, rollback et GO CTO**.
