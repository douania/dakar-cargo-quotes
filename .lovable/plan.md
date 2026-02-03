

# Plan d'implémentation : Corrections critiques post-audit

## Résumé des tâches

| Tâche | Fichier | Effort |
|-------|---------|--------|
| Corriger lien cassé | `AppSidebar.tsx` | 1 min |
| Ajouter MainLayout à Intake | `Intake.tsx` | 2 min |
| Ajouter MainLayout à CaseView | `CaseView.tsx` | 2 min |
| Ajouter routes au sidebar | `AppSidebar.tsx` | 3 min |
| Supprimer code mort | `QuotationForm.tsx` | 1 min |

**Temps total estimé : 10 minutes**

---

## 1. Corriger le lien sidebar cassé

**Fichier :** `src/components/AppSidebar.tsx`

**Ligne 68 :**
```tsx
// AVANT
{ title: 'Rapports tarifs', url: '/admin/tariff-report', icon: TrendingUp },

// APRÈS
{ title: 'Rapports tarifs', url: '/admin/tariff-reports', icon: TrendingUp },
```

---

## 2. Ajouter MainLayout à Intake.tsx

**Fichier :** `src/pages/Intake.tsx`

**Modification :** Importer et wrapper avec `MainLayout`

```tsx
// Ajouter l'import
import { MainLayout } from "@/components/layout/MainLayout";

// Wrapper le contenu
export default function Intake() {
  // ... state existant ...

  return (
    <MainLayout>
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        {/* ... contenu existant inchangé ... */}
      </div>
    </MainLayout>
  );
}
```

---

## 3. Ajouter MainLayout à CaseView.tsx

**Fichier :** `src/pages/CaseView.tsx`

**Modification :** Importer et wrapper avec `MainLayout`

```tsx
// Ajouter l'import
import { MainLayout } from "@/components/layout/MainLayout";

// Wrapper le contenu
export default function CaseView() {
  // ... state existant ...

  // Gérer le loading DANS le MainLayout
  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  // Gérer l'erreur DANS le MainLayout
  if (error && !data) {
    return (
      <MainLayout>
        <div className="container mx-auto py-8 px-4 max-w-4xl">
          {/* ... erreur existante ... */}
        </div>
      </MainLayout>
    );
  }

  // Retour principal DANS le MainLayout
  return (
    <MainLayout>
      <div className="container mx-auto py-8 px-4 max-w-5xl">
        {/* ... contenu existant inchangé ... */}
      </div>
    </MainLayout>
  );
}
```

---

## 4. Ajouter les routes manquantes au sidebar

**Fichier :** `src/components/AppSidebar.tsx`

### 4.1 Ajouter `/intake` dans mainNavItems

```tsx
import { 
  // ... imports existants ...
  PlusCircle  // Nouvel icône pour Intake
} from 'lucide-react';

const mainNavItems = [
  { 
    title: 'Demandes à traiter', 
    url: '/', 
    icon: LayoutDashboard,
    description: 'Cotations en attente'
  },
  { 
    title: 'Nouvelle demande',  // AJOUT
    url: '/intake', 
    icon: PlusCircle,
    description: 'Saisie manuelle'
  },
  { 
    title: 'Chat IA', 
    url: '/chat', 
    icon: MessageSquare,
    description: 'Questions & recherches'
  },
  { 
    title: 'Optimisation Chargement', 
    url: '/truck-loading', 
    icon: Truck,
    description: 'Planification chargement camions'
  },
];
```

### 4.2 Ajouter `/admin/transport-rates` dans adminItems

```tsx
import { 
  // ... imports existants ...
  Route  // Nouvel icône pour Transport rates
} from 'lucide-react';

const adminItems = [
  { title: 'Emails', url: '/admin/emails', icon: Mail },
  { title: 'Tenders', url: '/admin/tenders', icon: Briefcase },
  { title: 'Historique cotations', url: '/admin/quotation-history', icon: History },
  { title: 'Connaissances', url: '/admin/knowledge', icon: Brain },
  { title: 'Rapports tarifs', url: '/admin/tariff-reports', icon: TrendingUp },
  { title: 'Tarifs transport', url: '/admin/transport-rates', icon: Route },  // AJOUT
  { title: 'Codes SH', url: '/admin/hs-codes', icon: Package },
  { title: 'Taux & Taxes', url: '/admin/tax-rates', icon: DollarSign },
  { title: 'Régimes douaniers', url: '/admin/customs-regimes', icon: FileText },
  { title: 'Tarifs portuaires', url: '/admin/tarifs-portuaires', icon: Ship },
  { title: 'Documents', url: '/admin/documents', icon: BookOpen },
  { title: 'Intelligence marché', url: '/admin/market-intelligence', icon: BarChart3 },
  { title: 'Intelligence prix', url: '/admin/pricing-intelligence', icon: DollarSign },
];
```

---

## 5. Supprimer QuotationForm.tsx (code mort)

**Action :** Supprimer le fichier `src/pages/QuotationForm.tsx`

**Justification :** 
- 547 lignes de code mort (aucune route)
- Duplique `Intake.tsx` fonctionnellement
- Contient des constantes dupliquées (`containerTypes`, `incoterms`)
- Utilise l'ancien `Header` au lieu de `MainLayout`

---

## Résultat attendu

| Avant | Après |
|-------|-------|
| Lien "Rapports tarifs" cassé (404) | Lien fonctionne correctement |
| Intake/CaseView sans sidebar | Navigation cohérente avec sidebar |
| Routes actives mais invisibles | Toutes les fonctionnalités découvrables |
| 547 lignes de code mort | Codebase allégée |

---

## Vérifications post-implémentation

1. Naviguer vers `/intake` depuis le sidebar
2. Créer une demande et vérifier que CaseView a le sidebar
3. Cliquer sur "Rapports tarifs" → doit ouvrir `/admin/tariff-reports`
4. Cliquer sur "Tarifs transport" → doit ouvrir `/admin/transport-rates`
5. Vérifier que le build ne contient plus de référence à `QuotationForm`

