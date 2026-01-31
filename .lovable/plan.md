

# ÉTAPE 3A – PLAN D'EXTRACTION UI P0 (VERSION CORRIGÉE)

## Corrections intégrées par rapport au plan initial

| Correction | Impact |
|------------|--------|
| **Emplacement** | `src/features/quotation/components/` (feature-first, pas `src/components/quotation/`) |
| **SuggestionsCard** | Reclassé P0 (lecture seule pure) |
| **SelectedEmailPreview** | Reporté en P1 (dépendances utilitaires) |

---

## 1. COMPOSANTS À EXTRAIRE (P0 uniquement)

### 1.1 RegulatoryInfoCard

| Attribut | Valeur |
|----------|--------|
| Lignes source | 890-956 (67 lignes) |
| Fichier cible | `src/features/quotation/components/RegulatoryInfoCard.tsx` |
| Props | `regulatoryInfo: RegulatoryInfo \| null` |
| Imports requis | `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Badge`, `Ship`, `Info`, `CheckCircle`, `ShieldCheck`, `RegulatoryInfo` type |
| Handlers | Aucun |
| State modifié | Aucun |
| Risque | **Faible** |

---

### 1.2 AlertsPanel

| Attribut | Valeur |
|----------|--------|
| Lignes source | 958-981 (24 lignes) |
| Fichier cible | `src/features/quotation/components/AlertsPanel.tsx` |
| Props | `alerts: Alert[]` |
| Imports requis | `Card`, `CardHeader`, `CardTitle`, `CardContent`, `AlertTriangle`, `HelpCircle`, `CheckCircle`, `Alert` type |
| Handlers | Aucun |
| State modifié | Aucun |
| Risque | **Faible** |

---

### 1.3 SuggestionsCard

| Attribut | Valeur |
|----------|--------|
| Lignes source | 1601-1629 (29 lignes) |
| Fichier cible | `src/features/quotation/components/SuggestionsCard.tsx` |
| Props | `suggestions: Suggestion[]` |
| Imports requis | `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Badge`, `Lightbulb`, `Suggestion` type |
| Handlers | Aucun |
| State modifié | Aucun |
| Risque | **Faible** |

---

### 1.4 QuickActionsCard

| Attribut | Valeur |
|----------|--------|
| Lignes source | 1631-1654 (24 lignes) |
| Fichier cible | `src/features/quotation/components/QuickActionsCard.tsx` |
| Props | Aucune (boutons statiques sans fonctionnalité) |
| Imports requis | `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Button`, `DollarSign`, `Package`, `Truck`, `History` |
| Handlers | Aucun (boutons inactifs pour l'instant) |
| State modifié | Aucun |
| Risque | **Faible** |

---

## 2. ORDRE D'EXÉCUTION

| Étape | Action |
|-------|--------|
| 1 | Créer `src/features/quotation/components/RegulatoryInfoCard.tsx` |
| 2 | Créer `src/features/quotation/components/AlertsPanel.tsx` |
| 3 | Créer `src/features/quotation/components/SuggestionsCard.tsx` |
| 4 | Créer `src/features/quotation/components/QuickActionsCard.tsx` |
| 5 | Modifier `QuotationSheet.tsx` : ajouter imports + remplacer JSX inline |
| 6 | Build TypeScript |
| 7 | Test manuel sur cotation existante |

---

## 3. MODIFICATIONS DANS QuotationSheet.tsx

### 3.1 Imports à ajouter

```typescript
import { RegulatoryInfoCard } from '@/features/quotation/components/RegulatoryInfoCard';
import { AlertsPanel } from '@/features/quotation/components/AlertsPanel';
import { SuggestionsCard } from '@/features/quotation/components/SuggestionsCard';
import { QuickActionsCard } from '@/features/quotation/components/QuickActionsCard';
```

### 3.2 Blocs à remplacer

| Lignes | Bloc actuel | Remplacement |
|--------|-------------|--------------|
| 890-956 | JSX RegulatoryInfo inline | `<RegulatoryInfoCard regulatoryInfo={regulatoryInfo} />` |
| 958-981 | JSX Alerts inline | `<AlertsPanel alerts={alerts} />` |
| 1601-1629 | JSX Suggestions inline | `<SuggestionsCard suggestions={suggestions} />` |
| 1631-1654 | JSX QuickActions inline | `<QuickActionsCard />` |

---

## 4. STRUCTURE DES COMPOSANTS

### RegulatoryInfoCard.tsx

```typescript
interface RegulatoryInfoCardProps {
  regulatoryInfo: RegulatoryInfo | null;
}

export function RegulatoryInfoCard({ regulatoryInfo }: RegulatoryInfoCardProps) {
  // Condition d'affichage conservée
  if (!regulatoryInfo || (!regulatoryInfo.projectTaxation && !regulatoryInfo.dpiRequired && regulatoryInfo.customsNotes.length === 0)) {
    return null;
  }
  
  // JSX identique (lignes 892-955)
}
```

### AlertsPanel.tsx

```typescript
interface AlertsPanelProps {
  alerts: Alert[];
}

export function AlertsPanel({ alerts }: AlertsPanelProps) {
  if (alerts.length === 0) return null;
  
  // JSX identique (lignes 960-980)
}
```

### SuggestionsCard.tsx

```typescript
interface SuggestionsCardProps {
  suggestions: Suggestion[];
}

export function SuggestionsCard({ suggestions }: SuggestionsCardProps) {
  if (suggestions.length === 0) return null;
  
  // JSX identique (lignes 1603-1628)
}
```

### QuickActionsCard.tsx

```typescript
export function QuickActionsCard() {
  // JSX identique (lignes 1632-1654)
  // Boutons statiques sans handlers
}
```

---

## 5. RÉDUCTION ATTENDUE

| Composant | Lignes supprimées |
|-----------|-------------------|
| RegulatoryInfoCard | ~67 |
| AlertsPanel | ~24 |
| SuggestionsCard | ~29 |
| QuickActionsCard | ~24 |
| **Total Phase 3A** | **~144 lignes** |

**QuotationSheet.tsx après Phase 3A : ~1516 lignes** (vs 1660 actuellement)

---

## 6. FICHIERS CRÉÉS (RÉCAPITULATIF)

| Fichier | Type |
|---------|------|
| `src/features/quotation/components/RegulatoryInfoCard.tsx` | Composant |
| `src/features/quotation/components/AlertsPanel.tsx` | Composant |
| `src/features/quotation/components/SuggestionsCard.tsx` | Composant |
| `src/features/quotation/components/QuickActionsCard.tsx` | Composant |

---

## 7. VALIDATION OBLIGATOIRE APRÈS EXÉCUTION

- [ ] Build TypeScript OK
- [ ] Ouverture cotation existante OK
- [ ] Bloc "Informations réglementaires" affiché IDENTIQUE
- [ ] Bloc "Points d'attention" affiché IDENTIQUE
- [ ] Bloc "Suggestions IA" affiché IDENTIQUE
- [ ] Bloc "Actions rapides" affiché IDENTIQUE
- [ ] Aucune régression sur les autres blocs

---

## 8. SIGNAUX D'ALERTE (ROLLBACK IMMÉDIAT)

- Erreur TypeScript bloquante
- Affichage différent d'un bloc extrait
- Props manquantes ou incorrectes
- Condition d'affichage cassée

---

## 9. CE QU'ON NE TOUCHE PAS (PHASE 3A)

- Aucun handler (fetchThreadData, handleGenerateResponse, etc.)
- Aucun state
- Aucun utilitaire (formatDate, getEmailSenderName, etc.)
- Aucune extraction de hooks
- Les composants P1 et P2 (QuotationHeader, ThreadTimelineCard, etc.)

---

## Message de clôture attendu

```
Phase 3A exécutée.
4 composants créés dans src/features/quotation/components/
Lignes supprimées dans QuotationSheet.tsx : ~144
Build OK.
En attente du GO pour Phase 3B.
```

