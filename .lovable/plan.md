

# PHASE 6A COMPLÈTE — Auth Infrastructure + Login Fonctionnel

## Contexte de l'audit CTO

L'audit a révélé que :
- Les fichiers `AuthProvider.tsx` et `RequireAuth.tsx` n'ont pas encore été créés
- Le découpage "6A Provider / 6A.2 Login" est invalide sans UI fonctionnelle
- L'application est actuellement inutilisable (RLS bloque tout sans session)

## Correction : Tout créer en une seule phase

| Fichier | Action | Lignes |
|---------|--------|--------|
| `src/features/auth/AuthProvider.tsx` | CRÉER | ~60 |
| `src/features/auth/RequireAuth.tsx` | CRÉER | ~35 |
| `src/features/auth/index.ts` | CRÉER | ~3 |
| `src/pages/LoginPage.tsx` | CRÉER | ~85 |
| `src/App.tsx` | MODIFIER | ~40 lignes de changement |

## Fichiers NON modifiés (FROZEN)

| Fichier | Statut |
|---------|--------|
| `CargoLinesForm.tsx` | FROZEN |
| `ServiceLinesForm.tsx` | FROZEN |
| `QuotationTotalsCard.tsx` | FROZEN |

---

## 1. AuthProvider.tsx

```typescript
// src/features/auth/AuthProvider.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 1. Setup listener FIRST (before getSession) - pattern Supabase recommandé
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setIsLoading(false);
      }
    );

    // 2. Then get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    isLoading,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

**Points clés :**
- `onAuthStateChange` configuré AVANT `getSession` (anti race condition)
- État `isLoading` pour éviter le flash de contenu
- Export du hook `useAuth` depuis le même fichier

---

## 2. RequireAuth.tsx

```typescript
// src/features/auth/RequireAuth.tsx
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthProvider';

interface RequireAuthProps {
  children: React.ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  // Loading state - écran minimal thème Maritime
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  // Non authentifié - redirect vers /login avec state pour retour
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authentifié - afficher le contenu protégé
  return <>{children}</>;
}
```

---

## 3. Barrel export

```typescript
// src/features/auth/index.ts
export { AuthProvider, useAuth } from './AuthProvider';
export { RequireAuth } from './RequireAuth';
```

---

## 4. LoginPage.tsx (fonctionnelle, login-only)

```typescript
// src/pages/LoginPage.tsx
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, Anchor } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  
  // Redirect vers la page d'origine après login
  const from = (location.state as any)?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      toast.success('Connexion réussie');
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error('Login error:', err);
      toast.error('Erreur de connexion', { 
        description: err.message || 'Vérifiez vos identifiants' 
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50 bg-gradient-card shadow-card">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 p-3 rounded-full bg-primary/10 w-fit">
            <Anchor className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl text-gradient-gold">
            SODATRA
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Connectez-vous pour accéder à l'application
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="votre@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                autoComplete="email"
                autoFocus
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connexion...
                </>
              ) : (
                'Se connecter'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Design :**
- Thème Maritime cohérent (`bg-gradient-card`, `text-gradient-gold`)
- Logo Anchor pour l'identité SODATRA
- Gestion des erreurs avec toast
- État loading sur le bouton
- Redirect vers la page d'origine après login

---

## 5. App.tsx modifié

```typescript
// src/App.tsx - avec AuthProvider et RequireAuth
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

// Auth
import { AuthProvider } from "@/features/auth";
import { RequireAuth } from "@/features/auth";

// Pages
import LoginPage from "./pages/LoginPage";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import QuotationSheet from "./pages/QuotationSheet";
import HsCodesAdmin from "./pages/admin/HsCodes";
import TaxRatesAdmin from "./pages/admin/TaxRates";
import DocumentsAdmin from "./pages/admin/Documents";
import EmailsAdmin from "./pages/admin/Emails";
import KnowledgeAdmin from "./pages/admin/Knowledge";
import MarketIntelligence from "./pages/admin/MarketIntelligence";
import CustomsRegimesAdmin from "./pages/admin/CustomsRegimes";
import PricingIntelligence from "./pages/admin/PricingIntelligence";
import PortTariffsAdmin from "./pages/admin/PortTariffs";
import TruckLoading from "./pages/TruckLoading";
import Intake from "./pages/Intake";
import CaseView from "./pages/CaseView";
import TariffReports from "./pages/admin/TariffReports";
import TendersAdmin from "./pages/admin/Tenders";
import TransportRates from "./pages/admin/TransportRates";
import QuotationHistory from "./pages/admin/QuotationHistory";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Route publique - Login */}
            <Route path="/login" element={<LoginPage />} />

            {/* Routes protégées */}
            <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/chat" element={<RequireAuth><Index /></RequireAuth>} />
            <Route path="/quotation/new" element={<RequireAuth><QuotationSheet /></RequireAuth>} />
            <Route path="/quotation/:emailId" element={<RequireAuth><QuotationSheet /></RequireAuth>} />
            <Route path="/admin/hs-codes" element={<RequireAuth><HsCodesAdmin /></RequireAuth>} />
            <Route path="/admin/tax-rates" element={<RequireAuth><TaxRatesAdmin /></RequireAuth>} />
            <Route path="/admin/customs-regimes" element={<RequireAuth><CustomsRegimesAdmin /></RequireAuth>} />
            <Route path="/admin/documents" element={<RequireAuth><DocumentsAdmin /></RequireAuth>} />
            <Route path="/admin/emails" element={<RequireAuth><EmailsAdmin /></RequireAuth>} />
            <Route path="/admin/knowledge" element={<RequireAuth><KnowledgeAdmin /></RequireAuth>} />
            <Route path="/admin/market-intelligence" element={<RequireAuth><MarketIntelligence /></RequireAuth>} />
            <Route path="/admin/pricing-intelligence" element={<RequireAuth><PricingIntelligence /></RequireAuth>} />
            <Route path="/admin/tarifs-portuaires" element={<RequireAuth><PortTariffsAdmin /></RequireAuth>} />
            <Route path="/admin/tariff-reports" element={<RequireAuth><TariffReports /></RequireAuth>} />
            <Route path="/admin/tenders" element={<RequireAuth><TendersAdmin /></RequireAuth>} />
            <Route path="/admin/transport-rates" element={<RequireAuth><TransportRates /></RequireAuth>} />
            <Route path="/admin/quotation-history" element={<RequireAuth><QuotationHistory /></RequireAuth>} />
            <Route path="/truck-loading" element={<RequireAuth><TruckLoading /></RequireAuth>} />
            <Route path="/intake" element={<RequireAuth><Intake /></RequireAuth>} />
            <Route path="/case/:caseId" element={<RequireAuth><CaseView /></RequireAuth>} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
```

---

## 6. Architecture finale

```text
src/
├── features/
│   ├── auth/
│   │   ├── AuthProvider.tsx    # Context + session management
│   │   ├── RequireAuth.tsx     # Route guard
│   │   └── index.ts            # Barrel export
│   └── quotation/              # (existant, FROZEN)
│
├── pages/
│   ├── LoginPage.tsx           # NOUVEAU - UI login fonctionnelle
│   ├── Dashboard.tsx
│   └── ...
│
└── App.tsx                     # AuthProvider wrapper + RequireAuth guards
```

---

## 7. Flux d'authentification

```text
┌─────────────────────────────────────────────────────────────┐
│                    FLUX PHASE 6A COMPLET                   │
│                                                             │
│  User accède à /                                           │
│      │                                                      │
│      ▼                                                      │
│  AuthProvider.isLoading = true                             │
│      │ (loading spinner)                                   │
│      ▼                                                      │
│  getSession() + onAuthStateChange                          │
│      │                                                      │
│      ▼                                                      │
│  isLoading = false                                         │
│      │                                                      │
│  ┌───┴───────────────┐                                     │
│  │                   │                                     │
│  session?         !session                                 │
│  │                   │                                     │
│  ▼                   ▼                                     │
│  Dashboard       Navigate /login                           │
│                      │                                     │
│                      ▼                                     │
│                  LoginPage                                 │
│                      │                                     │
│                  signInWithPassword()                      │
│                      │                                     │
│                      ▼                                     │
│                  onAuthStateChange                         │
│                  (session updated)                         │
│                      │                                     │
│                      ▼                                     │
│                  navigate(from)                            │
│                  → retour Dashboard                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Critères de sortie Phase 6A (corrigés)

- [ ] `AuthProvider` créé avec `onAuthStateChange` + `getSession`
- [ ] `RequireAuth` créé avec loading screen Maritime
- [ ] Hook `useAuth()` exporté et fonctionnel
- [ ] `LoginPage.tsx` fonctionnelle (login-only)
- [ ] `App.tsx` wrappé avec `AuthProvider`
- [ ] Toutes les routes protégées par `RequireAuth`
- [ ] Route `/login` publique avec vraie UI
- [ ] Build TypeScript OK
- [ ] Aucun composant FROZEN modifié

---

## 9. Post-déploiement : Test manuel

1. Accéder à `/` sans session → redirect `/login`
2. Login avec un compte existant → retour `/`
3. Refresh page → session persistante
4. Créer un devis → fonctionne (RLS OK car `auth.uid()` existe)

---

## 10. Prochaines phases (non incluses)

| Phase | Description |
|-------|-------------|
| 6A+ | Ajouter Signup (optionnel, admin crée les users) |
| 6A+ | Bouton Logout dans sidebar/header |
| 6B | Système de rôles (admin/agent) |
| 6C | Durcissement RLS policies |

