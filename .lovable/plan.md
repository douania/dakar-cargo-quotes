

# FIX UX BUG — RLS INSERT Bloqué + Spinner Infini

## Diagnostic

### Cause racine identifiée

1. **RLS `quotation_history_owner_insert`** impose `WITH CHECK (auth.uid() = created_by)`
2. Le hook `useQuotationDraft.ts` (lignes 131-143) fait un `INSERT` direct via le client Supabase frontend
3. En mode **STRICT_OWNERSHIP**, si la propagation de session échoue ou si le JWT expire pendant l'opération, l'INSERT est bloqué silencieusement
4. Le hook ne gère pas explicitement les erreurs RLS → `isSaving` reste `true` → **spinner infini**

### Policies actuelles (confirmées par query)

```sql
-- INSERT policy
quotation_history_owner_insert: WITH CHECK (auth.uid() = created_by)

-- SELECT/UPDATE/DELETE policies
quotation_history_owner_select: USING (auth.uid() = created_by)
quotation_history_owner_update: USING (auth.uid() = created_by), WITH CHECK (auth.uid() = created_by)
quotation_history_owner_delete: USING (auth.uid() = created_by)
```

---

## Solution en 3 parties

### PARTIE 1 — Edge Function `create-quotation-draft`

Créer une Edge Function sécurisée qui :
1. Valide le JWT de l'utilisateur
2. Extrait l'`user_id` du token
3. Exécute l'INSERT avec **service role** (bypass RLS)
4. Retourne le draft créé ou une erreur explicite

```text
supabase/functions/create-quotation-draft/index.ts
```

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validate Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Create anon client to verify JWT
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
        JSON.stringify({ error: 'Invalid or expired token', details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Parse request body
    const body = await req.json();
    const {
      route_origin, route_port, route_destination, cargo_type,
      container_types, client_name, client_company, partner_company,
      project_name, incoterm, tariff_lines, total_amount, total_currency,
      source_email_id, regulatory_info
    } = body;

    // 4. Validate required fields
    if (!route_port || !route_destination || !cargo_type) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: route_port, route_destination, cargo_type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Create service role client (bypass RLS)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 6. Check for existing draft (idempotent by source_email_id)
    if (source_email_id) {
      const { data: existingDraft, error: searchError } = await serviceClient
        .from('quotation_history')
        .select('id, version, status, parent_quotation_id, root_quotation_id')
        .eq('source_email_id', source_email_id)
        .eq('status', 'draft')
        .eq('created_by', user.id)
        .maybeSingle();

      if (searchError) throw searchError;

      if (existingDraft) {
        // Update existing draft
        const { data: updated, error: updateError } = await serviceClient
          .from('quotation_history')
          .update({
            route_origin, route_port, route_destination, cargo_type,
            container_types, client_name, client_company, partner_company,
            project_name, incoterm, tariff_lines, total_amount, total_currency,
            regulatory_info, updated_at: new Date().toISOString()
          })
          .eq('id', existingDraft.id)
          .select('id, version, status, parent_quotation_id, root_quotation_id')
          .single();

        if (updateError) throw updateError;

        return new Response(
          JSON.stringify({ success: true, draft: updated, action: 'updated' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 7. Insert new draft with service role
    const { data: newDraft, error: insertError } = await serviceClient
      .from('quotation_history')
      .insert({
        route_origin, route_port, route_destination, cargo_type,
        container_types, client_name, client_company, partner_company,
        project_name, incoterm, tariff_lines, total_amount, total_currency,
        source_email_id, regulatory_info,
        version: 1,
        status: 'draft',
        root_quotation_id: null,
        parent_quotation_id: null,
        created_by: user.id  // Ownership explicite
      })
      .select('id, version, status, parent_quotation_id, root_quotation_id')
      .single();

    if (insertError) throw insertError;

    // 8. Update root_quotation_id = id (self-reference for v1)
    await serviceClient
      .from('quotation_history')
      .update({ root_quotation_id: newDraft.id })
      .eq('id', newDraft.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        draft: { ...newDraft, root_quotation_id: newDraft.id },
        action: 'created'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('create-quotation-draft error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to create draft', 
        details: error.message,
        code: error.code || 'UNKNOWN'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

---

### PARTIE 2 — Modifier `useQuotationDraft.ts`

Remplacer l'INSERT direct par un appel à l'Edge Function :

```typescript
// AVANT (ligne 131-143)
const { data, error } = await supabase
  .from('quotation_history')
  .insert({ ... })

// APRÈS
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  toast.error('Session expirée, veuillez vous reconnecter');
  setIsSaving(false);
  return null;
}

const response = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-quotation-draft`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dbPayload),
  }
);

if (!response.ok) {
  const errorData = await response.json();
  throw new Error(errorData.error || 'Failed to create draft');
}

const result = await response.json();
const draft = result.draft as DraftQuotation;
```

**Gestion d'erreur explicite :**
- Timeout après 10 secondes
- Toast avec message clair en cas d'erreur RLS
- `isSaving` toujours remis à `false` (finally block)

---

### PARTIE 3 — Améliorer le hook pour UPDATE/REVISION

Le même pattern doit être appliqué pour :
1. `createRevision` (ligne 241-252) — INSERT aussi bloqué par RLS
2. Les UPDATE sont OK car ils ne créent pas de nouvelle ligne

---

## Fichiers modifiés

| Fichier | Action | Description |
|---------|--------|-------------|
| `supabase/functions/create-quotation-draft/index.ts` | CRÉER | Edge Function service role |
| `src/features/quotation/hooks/useQuotationDraft.ts` | MODIFIER | Appel Edge Function + gestion erreurs |

## Fichiers NON modifiés (FROZEN)

| Fichier | Statut |
|---------|--------|
| `CargoLinesForm.tsx` | FROZEN |
| `ServiceLinesForm.tsx` | FROZEN |
| `QuotationTotalsCard.tsx` | FROZEN |
| `QuotationSheet.tsx` | Non modifié (hook abstrait la logique) |

---

## Architecture finale

```text
┌─────────────────────────────────────────────────────────────┐
│  FLUX CRÉATION DEVIS (POST-FIX)                            │
│                                                             │
│  QuotationSheet                                            │
│      │                                                      │
│      ▼                                                      │
│  useQuotationDraft.saveDraft()                             │
│      │                                                      │
│      ├── Vérifie session active                            │
│      │   └── ✗ Toast "Session expirée" + stop              │
│      │                                                      │
│      ▼                                                      │
│  fetch('/functions/v1/create-quotation-draft')             │
│      │                                                      │
│      ▼                                                      │
│  Edge Function                                              │
│      ├── Valide JWT (401 si invalide)                      │
│      ├── Extrait user.id                                   │
│      ├── Service Role INSERT (bypass RLS)                  │
│      └── Retourne { draft } ou { error }                   │
│                                                             │
│      ▼                                                      │
│  useQuotationDraft                                         │
│      ├── ✓ Success → setCurrentDraft(draft)               │
│      └── ✗ Error → toast.error() + stop loading            │
└─────────────────────────────────────────────────────────────┘
```

---

## Séquence de déploiement

1. Créer `supabase/functions/create-quotation-draft/index.ts`
2. Modifier `useQuotationDraft.ts` pour appeler l'Edge Function
3. Tester flux complet :
   - Login → Dashboard → "Nouvelle cotation"
   - Remplir formulaire → Sauvegarder
   - Vérifier toast "Brouillon sauvegardé" ✓
   - Vérifier pas de spinner infini ✓
   - Vérifier devis visible dans l'historique ✓

---

## Sécurité préservée

| Élément | État |
|---------|------|
| RLS policies | **INCHANGÉES** — Toujours strictes |
| `quotation_history_owner_insert` | WITH CHECK (auth.uid() = created_by) |
| Edge Function | Valide JWT avant toute action |
| Service Role | Utilisé uniquement après validation JWT |
| Ownership | `created_by = user.id` du token validé |

---

## Critères de sortie

- [ ] Edge Function `create-quotation-draft` créée et déployée
- [ ] Hook `useQuotationDraft` appelle l'Edge Function
- [ ] Gestion d'erreur explicite (toast + stop loading)
- [ ] Plus de spinner infini
- [ ] Création de devis fonctionne pour utilisateur authentifié
- [ ] RLS policies inchangées (strictes)
- [ ] Test e2e : login → nouvelle cotation → sauvegarde → vérification historique

