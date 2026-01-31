

# PHASE 3B.4 — ThreadTimelineCard Freeze + Tests + Garde-fous

## Analyse de l'existant

| Element | Statut |
|---------|--------|
| Composant ThreadTimelineCard | 180 lignes, stable |
| Configuration Vitest | **Non existante** |
| Dépendances de test | **Non installées** |
| Dossier __tests__ | **Non existant** |
| README-dev | **Non existant** (seulement README.md) |

---

## Modifications prévues

### 1. Gel fonctionnel (Commentaire FREEZE)

**Fichier** : `src/features/quotation/components/ThreadTimelineCard.tsx`

Ajouter en tête du fichier :

```typescript
/**
 * UI COMPONENT — FROZEN (Phase 3B.4)
 * - Ne pas modifier sans ouvrir une nouvelle phase
 * - Logique métier volontairement absente
 * - Toute évolution = nouvelle phase (3B.x)
 */
```

---

### 2. Infrastructure de test (pré-requis)

**a) Dépendances à installer** (package.json devDependencies)

```json
"@testing-library/jest-dom": "^6.6.0",
"@testing-library/react": "^16.0.0",
"@testing-library/user-event": "^14.5.2",
"jsdom": "^20.0.3",
"vitest": "^3.2.4"
```

**b) Configuration Vitest** — `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

**c) Setup de test** — `src/test/setup.ts`

```typescript
import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
```

**d) Configuration TypeScript** — `tsconfig.app.json`

Ajouter dans `compilerOptions.types` :
```json
"types": ["vitest/globals"]
```

---

### 3. Tests unitaires ciblés

**Fichier** : `src/features/quotation/components/__tests__/ThreadTimelineCard.test.tsx`

5 cas de test couvrant les comportements critiques :

| Test | Description |
|------|-------------|
| 1 | Ne rend rien si 1 email ou moins |
| 2 | Affiche la timeline si > 1 email |
| 3 | Toggle expand/collapse au clic |
| 4 | Sélection d'un email au clic |
| 5 | Support clavier (Enter/Space) |

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadTimelineCard } from '../ThreadTimelineCard';

const mockEmail = (id: string, subject: string) => ({
  id,
  subject,
  from_address: 'test@example.com',
  sent_at: '2024-01-15T10:00:00Z',
  received_at: '2024-01-15T10:00:00Z',
});

const defaultProps = {
  selectedEmailId: null,
  quotationOffers: [],
  expanded: false,
  onExpandedChange: vi.fn(),
  onSelectEmail: vi.fn(),
  formatDate: () => '15 Jan 2024',
};

describe('ThreadTimelineCard', () => {
  it('returns null when threadEmails has 1 or fewer items', () => {
    const { container } = render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={[mockEmail('1', 'Test')]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders timeline when threadEmails has more than 1 item', () => {
    render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={[
          mockEmail('1', 'First email'),
          mockEmail('2', 'Second email'),
        ]}
      />
    );
    expect(screen.getByText(/Historique du fil/)).toBeInTheDocument();
    expect(screen.getByText('(2 échanges)')).toBeInTheDocument();
  });

  it('calls onExpandedChange when toggle is clicked', async () => {
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    
    render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={[
          mockEmail('1', 'First'),
          mockEmail('2', 'Second'),
        ]}
        onExpandedChange={onExpandedChange}
      />
    );
    
    await user.click(screen.getByRole('button', { name: /Afficher l'historique/i }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('calls onSelectEmail when an email item is clicked', async () => {
    const onSelectEmail = vi.fn();
    const user = userEvent.setup();
    const emails = [
      mockEmail('1', 'First email'),
      mockEmail('2', 'Second email'),
    ];
    
    render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={emails}
        expanded={true}
        onSelectEmail={onSelectEmail}
      />
    );
    
    await user.click(screen.getByText('Second email'));
    expect(onSelectEmail).toHaveBeenCalledWith(emails[1]);
  });

  it('supports keyboard navigation with Enter and Space', async () => {
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    
    render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={[
          mockEmail('1', 'First'),
          mockEmail('2', 'Second'),
        ]}
        onExpandedChange={onExpandedChange}
      />
    );
    
    const trigger = screen.getByRole('button', { name: /Afficher l'historique/i });
    trigger.focus();
    
    await user.keyboard('{Enter}');
    expect(onExpandedChange).toHaveBeenCalled();
  });
});
```

---

### 4. Documentation des conventions

**Fichier** : `README.md` (section ajoutée à la fin)

```markdown
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
```

---

## Fichiers impactés

| Fichier | Action |
|---------|--------|
| `src/features/quotation/components/ThreadTimelineCard.tsx` | Ajouter commentaire FREEZE |
| `package.json` | Ajouter devDependencies de test |
| `vitest.config.ts` | **Créer** |
| `src/test/setup.ts` | **Créer** |
| `tsconfig.app.json` | Ajouter types vitest |
| `src/features/quotation/components/__tests__/ThreadTimelineCard.test.tsx` | **Créer** |
| `README.md` | Ajouter section conventions |

---

## Checklist de validation

- [ ] Build TypeScript OK
- [ ] Aucun runtime error
- [ ] Tests unitaires verts (5/5)
- [ ] Import nommé vérifié dans QuotationSheet.tsx
- [ ] Composant gelé (commentaire FREEZE présent)

---

## Message de clôture attendu

```
Phase 3B.4 exécutée.
ThreadTimelineCard gelé (freeze UI).
Infrastructure de test créée (Vitest + Testing Library).
5 tests unitaires ajoutés.
Conventions documentées dans README.md.
Aucune logique métier modifiée.
Extraction validée définitivement.
```

