

# Phase 6D.1 — Génération Devis (HTML + Snapshot) — PLAN RÉVISÉ

## Corrections appliquées (suite à revue CTO)

| Point bloquant | Correction |
|----------------|------------|
| 1. UUID frontend | `quotation_id = currentDraft.id` uniquement, erreur si absent |
| 2. `route_destination` | Type changé en `string \| null` |
| 3. Gouvernance Phase 6C | Nouvelle Edge Function `generate-quotation` |
| 4. QuotationHeader.tsx | **NON modifié** — badge géré dans QuotationSheet |

---

## 1. Migration Base de données

```sql
-- Ajouter colonnes pour snapshot généré
ALTER TABLE quotation_history
ADD COLUMN generated_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE quotation_history
ADD COLUMN generated_snapshot JSONB DEFAULT NULL;

-- Documentation (recommandation CTO)
COMMENT ON COLUMN quotation_history.generated_snapshot 
IS 'Snapshot figé du devis au moment de la génération';
```

**Impact** : Aucune donnée existante affectée (colonnes nullable)

---

## 2. Types Domain — `src/features/quotation/domain/types.ts`

### Extension QuotationStatus

```typescript
// Ligne ~48 — Avant
export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

// Après
export type QuotationStatus = 'draft' | 'generated' | 'sent' | 'accepted' | 'rejected' | 'expired';
```

### Nouveau type GeneratedSnapshot

```typescript
/**
 * Snapshot figé d'un devis généré
 * Structure immuable après génération
 */
export interface GeneratedSnapshot {
  readonly meta: {
    readonly quotation_id: string;  // TOUJOURS un ID existant, jamais généré côté client
    readonly version: number;
    readonly generated_at: string;  // ISO 8601
    readonly currency: string;
  };
  readonly client: {
    readonly name: string | null;
    readonly company: string | null;
    readonly email?: string | null;
    readonly project_name: string | null;
    readonly incoterm: string | null;
    readonly route_origin: string | null;
    readonly route_destination: string | null;  // ✅ CORRIGÉ: nullable
  };
  readonly cargo_lines: ReadonlyArray<{
    readonly id: string;
    readonly description: string | null;
    readonly cargo_type: string;
    readonly container_type?: string | null;
    readonly container_count?: number | null;
    readonly weight_kg?: number | null;
    readonly volume_cbm?: number | null;
  }>;
  readonly service_lines: ReadonlyArray<{
    readonly id: string;
    readonly service: string;
    readonly description: string | null;
    readonly quantity: number;
    readonly rate: number;
    readonly currency: string;
    readonly unit: string | null;
  }>;
  readonly totals: {
    readonly subtotal: number;
    readonly total: number;
    readonly currency: string;
  };
}
```

---

## 3. Edge Function — `supabase/functions/generate-quotation/index.ts`

**Conformité Phase 6C** : Tous les changements de statut métier passent par Edge Function.

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, ...',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validation JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Parse body
    const { quotation_id, snapshot } = await req.json();

    // 3. Validation stricte
    if (!quotation_id || typeof quotation_id !== 'string') {
      return new Response(
        JSON.stringify({ error: 'quotation_id requis (UUID existant)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!snapshot || !snapshot.meta || !snapshot.client) {
      return new Response(
        JSON.stringify({ error: 'Snapshot invalide' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Service client (bypass RLS pour vérification + update)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 5. Vérifier ownership + statut actuel
    const { data: existingDraft, error: fetchError } = await serviceClient
      .from('quotation_history')
      .select('id, status, created_by')
      .eq('id', quotation_id)
      .single();

    if (fetchError || !existingDraft) {
      return new Response(
        JSON.stringify({ error: 'Devis introuvable' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Contrôle ownership strict
    if (existingDraft.created_by !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Non autorisé' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Vérifier transition valide (seul draft → generated autorisé)
    if (existingDraft.status !== 'draft') {
      return new Response(
        JSON.stringify({ error: 'Ce devis a déjà été généré', current_status: existingDraft.status }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 8. UPDATE avec snapshot figé
    const generatedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await serviceClient
      .from('quotation_history')
      .update({
        status: 'generated',
        generated_at: generatedAt,
        generated_snapshot: snapshot,
        updated_at: generatedAt,
      })
      .eq('id', quotation_id)
      .select('id, version, status, generated_at')
      .single();

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ success: true, quotation: updated }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('generate-quotation error:', error);
    return new Response(
      JSON.stringify({ error: 'Échec génération', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

### Configuration TOML

```toml
[functions.generate-quotation]
verify_jwt = false
```

---

## 4. Hook — `src/features/quotation/hooks/useQuotationDraft.ts`

Ajouter méthode `generateQuotation()` qui appelle l'Edge Function :

```typescript
import type { GeneratedSnapshot } from '@/features/quotation/domain/types';

// Dans le hook, ajouter:
const GENERATE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-quotation`;

const generateQuotation = useCallback(async (snapshot: GeneratedSnapshot): Promise<boolean> => {
  if (!currentDraft) {
    toast.error('Aucun brouillon à générer');
    return false;
  }

  if (currentDraft.status !== 'draft') {
    toast.error('Ce devis a déjà été généré');
    return false;
  }

  setIsSaving(true);
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      toast.error('Session expirée, veuillez vous reconnecter');
      return false;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(GENERATE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quotation_id: currentDraft.id,
        snapshot,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    setCurrentDraft({ ...currentDraft, status: 'generated' });
    toast.success('Devis généré avec succès');
    return true;

  } catch (error) {
    console.error('Error generating quotation:', error);
    const message = error instanceof Error ? error.message : 'Erreur génération';
    toast.error(message);
    return false;
  } finally {
    setIsSaving(false);
  }
}, [currentDraft]);

// Retourner dans le hook
return {
  // ... existant
  generateQuotation,  // NOUVEAU
};
```

---

## 5. Composant — `src/features/quotation/components/QuotationPreview.tsx`

**Nouveau fichier** (non FROZEN, créé pour cette phase) :

```typescript
/**
 * QuotationPreview — Phase 6D.1
 * Affichage lecture seule du snapshot généré
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CheckCircle, Package, FileText } from 'lucide-react';
import type { GeneratedSnapshot } from '@/features/quotation/domain/types';

interface QuotationPreviewProps {
  snapshot: GeneratedSnapshot;
}

export function QuotationPreview({ snapshot }: QuotationPreviewProps) {
  const refNumber = snapshot.meta.quotation_id.substring(0, 8).toUpperCase();
  const generatedDate = format(new Date(snapshot.meta.generated_at), 'dd MMMM yyyy à HH:mm', { locale: fr });

  return (
    <Card className="border-success/30 bg-success/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Devis N° {refNumber}
            </CardTitle>
            <CardDescription>
              Version {snapshot.meta.version} — Généré le {generatedDate}
            </CardDescription>
          </div>
          <Badge className="bg-success/20 text-success border-success/30">
            <CheckCircle className="h-3 w-3 mr-1" />
            Généré
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* En-tête SODATRA */}
        <div className="text-center border-b pb-4">
          <h2 className="text-lg font-bold">SODATRA</h2>
          <p className="text-sm text-muted-foreground">Transit & Logistique</p>
        </div>

        {/* Infos client */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium">Client</p>
            <p>{snapshot.client.name || 'N/A'}</p>
            <p className="text-muted-foreground">{snapshot.client.company || ''}</p>
          </div>
          <div>
            <p className="font-medium">Projet</p>
            <p>{snapshot.client.project_name || 'N/A'}</p>
            <p className="text-muted-foreground">Incoterm: {snapshot.client.incoterm || 'N/A'}</p>
          </div>
          <div>
            <p className="font-medium">Origine</p>
            <p>{snapshot.client.route_origin || 'N/A'}</p>
          </div>
          <div>
            <p className="font-medium">Destination</p>
            <p>{snapshot.client.route_destination || 'N/A'}</p>
          </div>
        </div>

        <Separator />

        {/* Marchandises */}
        {snapshot.cargo_lines.length > 0 && (
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <Package className="h-4 w-4" /> Marchandises
            </h3>
            <div className="text-sm space-y-1">
              {snapshot.cargo_lines.map((cargo) => (
                <div key={cargo.id} className="flex justify-between">
                  <span>{cargo.description || cargo.cargo_type}</span>
                  <span className="text-muted-foreground">
                    {cargo.container_type && `${cargo.container_count || 1}x ${cargo.container_type}`}
                    {cargo.weight_kg && ` - ${cargo.weight_kg} kg`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator />

        {/* Services */}
        <div>
          <h3 className="font-medium mb-2">Prestations</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead className="text-right">Qté</TableHead>
                <TableHead className="text-right">P.U.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.service_lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{line.service}</p>
                      {line.description && (
                        <p className="text-xs text-muted-foreground">{line.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">
                    {line.rate.toLocaleString()} {line.currency}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {(line.quantity * line.rate).toLocaleString()} {line.currency}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Separator />

        {/* Totaux */}
        <div className="flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Sous-total</span>
              <span>{snapshot.totals.subtotal.toLocaleString()} {snapshot.totals.currency}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span>{snapshot.totals.total.toLocaleString()} {snapshot.totals.currency}</span>
            </div>
          </div>
        </div>

        {/* Mentions légales */}
        <div className="text-xs text-muted-foreground border-t pt-4 mt-4">
          <p>Ce devis est valable 30 jours à compter de sa date d'émission.</p>
          <p>Conditions de paiement : selon accord commercial.</p>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## 6. Page — `src/pages/QuotationSheet.tsx`

### A. Imports additionnels

```typescript
import { QuotationPreview } from '@/features/quotation/components/QuotationPreview';
import type { GeneratedSnapshot } from '@/features/quotation/domain/types';
```

### B. Nouvel état

```typescript
const [generatedSnapshot, setGeneratedSnapshot] = useState<GeneratedSnapshot | null>(null);
```

### C. Fonction `buildSnapshot()` — CORRIGÉE

```typescript
const buildSnapshot = useCallback((): GeneratedSnapshot | null => {
  // ✅ CORRIGÉ: Draft obligatoire, jamais de génération UUID côté client
  if (!currentDraft?.id) {
    toast.error('Veuillez d\'abord sauvegarder le brouillon');
    return null;
  }

  // Validation métier minimale
  if (!projectContext.requesting_party && !projectContext.requesting_company) {
    toast.error('Client requis pour générer le devis');
    return null;
  }

  const validServiceLines = serviceLines.filter(s => s.rate && s.rate > 0);
  if (validServiceLines.length === 0) {
    toast.error('Au moins une ligne de service avec tarif requis');
    return null;
  }

  return {
    meta: {
      quotation_id: currentDraft.id,  // ✅ Toujours l'ID existant
      version: currentDraft.version,
      generated_at: new Date().toISOString(),
      currency: 'FCFA',
    },
    client: {
      name: projectContext.requesting_party || null,
      company: projectContext.requesting_company || null,
      project_name: projectContext.project_name || null,
      incoterm: incoterm || null,
      route_origin: cargoLines[0]?.origin || null,
      route_destination: finalDestination || destination || null,  // ✅ CORRIGÉ: nullable
    },
    cargo_lines: cargoLines.map(c => ({
      id: c.id,
      description: c.description || null,
      cargo_type: c.cargo_type,
      container_type: c.container_type || null,
      container_count: c.container_count || null,
      weight_kg: c.weight_kg || null,
      volume_cbm: c.volume_cbm || null,
    })),
    service_lines: validServiceLines.map(s => ({
      id: s.id,
      service: s.service || '',
      description: s.description || null,
      quantity: s.quantity,
      rate: s.rate || 0,
      currency: s.currency || 'FCFA',
      unit: s.unit || null,
    })),
    totals: {
      subtotal: quotationTotals.subtotal_services,
      total: quotationTotals.total_ht,
      currency: 'FCFA',
    },
  };
}, [currentDraft, projectContext, cargoLines, serviceLines, incoterm, destination, finalDestination, quotationTotals]);
```

### D. Modification `handleGenerateResponse()`

```typescript
const handleGenerateResponse = async () => {
  setIsGenerating(true);
  try {
    // 1. Sauvegarder le draft d'abord
    const draft = await saveDraft({
      route_origin: cargoLines[0]?.origin,
      route_port: 'Dakar',
      route_destination: finalDestination || destination,
      cargo_type: cargoLines[0]?.cargo_type || 'container',
      container_types: cargoLines.filter(c => c.container_type).map(c => c.container_type!),
      client_name: projectContext.requesting_party,
      client_company: projectContext.requesting_company,
      partner_company: projectContext.partner_company,
      project_name: projectContext.project_name,
      incoterm: incoterm,
      tariff_lines: serviceLines.filter(s => s.rate).map(s => ({
        service: s.service,
        description: s.description,
        amount: (s.rate || 0) * s.quantity,
        currency: s.currency,
        unit: s.unit,
      })),
      total_amount: quotationTotals.total_ht,
      total_currency: 'FCFA',
      source_email_id: emailId,
      regulatory_info: regulatoryInfo,
    });

    if (!draft) {
      throw new Error('Échec sauvegarde brouillon');
    }

    // 2. Construire le snapshot figé
    const snapshot = buildSnapshot();
    if (!snapshot) {
      // Erreur de validation déjà affichée
      return;
    }

    // 3. Appeler Edge Function pour transition draft → generated
    const success = await generateQuotation(snapshot);

    if (success) {
      setGeneratedSnapshot(snapshot);
    }

  } catch (error) {
    console.error('Error generating response:', error);
    toast.error('Erreur de génération');
  } finally {
    setIsGenerating(false);
  }
};
```

### E. Affichage conditionnel dans JSX

```typescript
{/* Après le formulaire, si snapshot généré */}
{generatedSnapshot && (
  <div className="mt-6">
    <QuotationPreview snapshot={generatedSnapshot} />
  </div>
)}

{/* Badge statut géré ICI, pas dans QuotationHeader */}
{currentDraft?.status === 'generated' && !generatedSnapshot && (
  <div className="mb-4">
    <Badge className="bg-success/20 text-success">
      <CheckCircle className="h-3 w-3 mr-1" />
      Devis généré
    </Badge>
  </div>
)}
```

### F. Chargement du snapshot existant (reload page)

Dans le `useEffect` de chargement :

```typescript
// Si le draft est déjà généré, charger le snapshot
useEffect(() => {
  if (currentDraft?.status === 'generated') {
    // Récupérer le snapshot depuis la DB
    const loadSnapshot = async () => {
      const { data } = await supabase
        .from('quotation_history')
        .select('generated_snapshot')
        .eq('id', currentDraft.id)
        .single();
      
      if (data?.generated_snapshot) {
        setGeneratedSnapshot(data.generated_snapshot as GeneratedSnapshot);
      }
    };
    loadSnapshot();
  }
}, [currentDraft?.status, currentDraft?.id]);
```

---

## 7. Fichiers modifiés — Récapitulatif

| Fichier | Action | FROZEN |
|---------|--------|--------|
| Migration SQL | Nouvelle | - |
| `supabase/functions/generate-quotation/index.ts` | **Nouveau** | - |
| `supabase/config.toml` | Modifier (ajouter config) | - |
| `src/features/quotation/domain/types.ts` | Modifier | Non |
| `src/features/quotation/hooks/useQuotationDraft.ts` | Modifier | Non |
| `src/features/quotation/components/QuotationPreview.tsx` | **Nouveau** | Non |
| `src/pages/QuotationSheet.tsx` | Modifier | Non |

---

## 8. Fichiers NON modifiés (conformité CTO)

| Fichier | Raison |
|---------|--------|
| `src/components/layout/MainLayout.tsx` | Directive CTO explicite |
| `src/features/quotation/components/QuotationHeader.tsx` | Badge géré dans QuotationSheet |
| Tous composants `FROZEN` | Politique Safe Mode |

---

## 9. Tests obligatoires

| Scénario | Résultat attendu |
|----------|------------------|
| `/quotation/new` → remplir client + services → "Générer" | Preview HTML immédiate |
| Rafraîchir après génération | Preview toujours visible |
| Tenter "Générer" sur devis déjà généré | Message erreur (status 409) |
| Génération sans client | Toast erreur "Client requis" |
| Génération sans services | Toast erreur "service requis" |
| Vérifier `generated_snapshot` en DB | JSON complet figé |
| Console sans erreur | ✅ |

---

## 10. Critères d'acceptation

- [ ] Colonnes `generated_at` et `generated_snapshot` créées
- [ ] Edge Function `generate-quotation` déployée
- [ ] `quotation_id` = ID existant uniquement (jamais UUID frontend)
- [ ] `route_destination` nullable dans le type
- [ ] Transition `draft → generated` via Edge Function
- [ ] Preview HTML affichée immédiatement
- [ ] Snapshot persiste après rafraîchissement
- [ ] `MainLayout.tsx` inchangé
- [ ] `QuotationHeader.tsx` inchangé
- [ ] Composants FROZEN non modifiés

