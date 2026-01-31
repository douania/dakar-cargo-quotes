

# PHASE 5C — Export PDF Versionné

## Vue d'ensemble

Implémentation d'un système d'export PDF professionnel et versionné, générant des documents immuables liés à une version spécifique du devis (`quotation_history.id`).

---

## 1. Migration SQL — Table `quotation_documents`

### Objectif
Créer une table de traçabilité pour tous les documents générés (PDF, Excel) avec lien vers la version exacte du devis.

### Schema
```sql
CREATE TABLE IF NOT EXISTS quotation_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotation_history(id) ON DELETE CASCADE,
  root_quotation_id UUID NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('pdf', 'excel')),
  file_path TEXT NOT NULL,
  file_size INTEGER,
  file_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
```

### Sécurité RLS
- Policies alignées sur Phase 5D : `auth.uid() IS NOT NULL`
- Index sur `quotation_id` et `root_quotation_id`

---

## 2. Edge Function — `generate-quotation-pdf`

### Architecture

```
Request { quotationId: UUID }
         │
         ▼
┌────────────────────────────────────┐
│  1. Auth validation (getClaims)    │
│     → user_id pour RLS/traçabilité │
└────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│  2. Fetch quotation_history (id)   │
│     Données figées uniquement      │
└────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│  3. Construire PDF (pdf-lib)       │
│     → Header SODATRA               │
│     → Bloc client/route            │
│     → Tableau services             │
│     → Totaux + footer légal        │
└────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│  4. Upload Storage                  │
│     quotation-attachments/         │
│     Q-{rootId}/v{version}/         │
│     quote-{id}-{ts}.pdf            │
└────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│  5. Insert quotation_documents     │
│     + SHA-256 hash                 │
└────────────────────────────────────┘
         │
         ▼
Response { url, documentId, filePath }
```

### Données SELECT depuis `quotation_history`

| Champ | Utilisation PDF |
|-------|-----------------|
| `id` | Identifiant unique |
| `root_quotation_id` | Chemin storage |
| `version` | Badge "v1", "v2" |
| `status` | Mention légale conditionnelle |
| `client_name` | Bloc client |
| `client_company` | Bloc client |
| `project_name` | Titre projet |
| `route_origin` | Route |
| `route_port` | Route |
| `route_destination` | Route |
| `incoterm` | Conditions |
| `tariff_lines` | Tableau services (JSON) |
| `total_amount` | Total |
| `total_currency` | Devise |
| `created_at` | Date émission |

### Mentions légales par statut

| Statut | Mention |
|--------|---------|
| `draft` | "BROUILLON — Document non contractuel" |
| `sent` | "Offre valable 30 jours à compter de la date d'émission" |
| `accepted` | "Devis accepté" |
| `rejected` | "Offre déclinée" |
| `expired` | "Offre expirée" |

### Librairie PDF
Utilisation de `pdf-lib` via Deno (compatible Edge Functions, pas de DOM requis) :
```typescript
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
```

### Chemin storage (non-écrasant)
```
quotation-attachments/
  Q-{root_quotation_id}/
    v{version}/
      quote-{quotation_id}-{timestamp}.pdf
```

---

## 3. Composant Frontend — `QuotationPdfExport.tsx`

### Props
```typescript
interface QuotationPdfExportProps {
  quotationId: string;
  version: number;
  status: string;
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
}
```

### Comportement
1. Bouton affiche "PDF v{version}"
2. Click → `supabase.functions.invoke('generate-quotation-pdf', { body: { quotationId } })`
3. Loader pendant génération
4. Succès → `window.open(data.url, '_blank')` + toast
5. Erreur → toast error

### Pattern identique à `QuotationExcelExport.tsx`

---

## 4. Intégration `QuotationSheet.tsx`

### Emplacement
À côté du bouton Excel existant (ligne ~947), dans la zone exports :

```typescript
<div className="flex gap-2">
  <QuotationExcelExport ... />
  
  {/* Phase 5C : Export PDF versionné */}
  {currentDraft && (
    <QuotationPdfExport
      quotationId={currentDraft.id}
      version={currentDraft.version}
      status={currentDraft.status}
      variant="outline"
      size="sm"
    />
  )}
</div>
```

### Condition
- Visible uniquement si `currentDraft` existe (après saveDraft via handleGenerateResponse)
- Fonctionne pour status `draft` ET `sent`

---

## 5. Configuration

### `supabase/config.toml`
**NE PAS ajouter** `verify_jwt = false` — on veut l'authentification pour :
- RLS fonctionnelle
- `created_by` dans `quotation_documents`

---

## Fichiers créés/modifiés

| Fichier | Action | Lignes estimées |
|---------|--------|-----------------|
| `supabase/migrations/{ts}_quotation_documents.sql` | CRÉER | ~30 |
| `supabase/functions/generate-quotation-pdf/index.ts` | CRÉER | ~280 |
| `src/components/QuotationPdfExport.tsx` | CRÉER | ~80 |
| `src/pages/QuotationSheet.tsx` | +import, +rendu bouton | ~10 |

## Fichiers NON modifiés

| Fichier | Statut |
|---------|--------|
| `CargoLinesForm.tsx` | FROZEN |
| `ServiceLinesForm.tsx` | FROZEN |
| `useQuotationDraft.ts` | Aucun changement |
| `quotation_history` (schema) | Aucune modification |

---

## Structure du PDF (V1)

```
┌─────────────────────────────────────────────────────────────┐
│  SODATRA SHIPPING & LOGISTICS                               │
│  ───────────────────────────────────────────────────────    │
│  DEVIS N° Q-{short_id}              [v2] [BROUILLON]       │
│  Date: 31/01/2026                                           │
├─────────────────────────────────────────────────────────────┤
│  CLIENT                                                     │
│  Nom: John Doe                                              │
│  Société: ACME Corp                                         │
│  Projet: Équipement industriel                              │
├─────────────────────────────────────────────────────────────┤
│  ROUTE                                                      │
│  Shanghai → Dakar → Bamako                                  │
│  Incoterm: DAP                                              │
├─────────────────────────────────────────────────────────────┤
│  SERVICES                                                   │
│  ┌────────────────────────────────────────────────────────┐│
│  │ Service          │ Description    │ Montant   │ Devise ││
│  │ THC              │ Container 40HC │  350,000  │ FCFA   ││
│  │ Transit          │ Dakar-Bamako   │  850,000  │ FCFA   ││
│  │ ...              │ ...            │ ...       │ ...    ││
│  └────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│  TOTAL:  1,200,000 FCFA                                    │
├─────────────────────────────────────────────────────────────┤
│  BROUILLON — Document non contractuel                      │
│  Généré le 31/01/2026 à 22:30                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Workflow utilisateur

```
┌─────────────────────────────────────────────────────────────┐
│                    QuotationSheet                           │
│                                                             │
│  [Générer réponse] ──▶ saveDraft() ──▶ currentDraft.id     │
│                              │                              │
│                              ▼                              │
│              ┌─────────────────────────────────┐           │
│              │ Réponse générée visible         │           │
│              │                                 │           │
│              │ [Excel] [PDF v1] [Confirmer]   │           │
│              └─────────────────────────────────┘           │
│                              │                              │
│                        [PDF v1] cliqué                      │
│                              │                              │
│                              ▼                              │
│            generate-quotation-pdf(quotationId)             │
│                              │                              │
│         ┌────────────────────┼────────────────────┐        │
│         │                    │                    │        │
│         ▼                    ▼                    ▼        │
│  Fetch history       Render PDF         Upload Storage     │
│  (données figées)    (pdf-lib)          Insert trace       │
│                              │                              │
│                              ▼                              │
│                     Téléchargement auto                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Sécurité

| Point | Implémentation |
|-------|----------------|
| Authentification | JWT requis (pas verify_jwt=false) |
| RLS | `auth.uid() IS NOT NULL` sur `quotation_documents` |
| Source unique | Lecture exclusive `quotation_history` (pas de recalcul) |
| Traçabilité | `created_by` = user_id, hash SHA-256 |
| Stockage | Bucket `quotation-attachments` existant |

---

## Critères de sortie Phase 5C

- [ ] Table `quotation_documents` créée avec RLS
- [ ] Edge function `generate-quotation-pdf` déployée
- [ ] PDF généré depuis `quotation_history` uniquement (source figée)
- [ ] Version et statut visibles dans le PDF
- [ ] Fichier stocké dans bucket avec chemin versionné
- [ ] Trace insérée dans `quotation_documents` avec hash
- [ ] Signed URL retournée et téléchargement automatique
- [ ] Bouton "PDF v{version}" visible après génération réponse
- [ ] Build TypeScript OK
- [ ] Aucun composant FROZEN modifié

---

## Section technique détaillée

### Edge Function — Gestion Auth

```typescript
// Validation JWT (pas de verify_jwt=false dans config)
const authHeader = req.headers.get('Authorization');
if (!authHeader?.startsWith('Bearer ')) {
  return errorResponse('Unauthorized', 401);
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { global: { headers: { Authorization: authHeader } } }
);

const { data: { user }, error: authError } = await supabase.auth.getUser();
if (authError || !user) {
  return errorResponse('Unauthorized', 401);
}
```

### Hash SHA-256

```typescript
async function sha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### Upload Storage + Signed URL

```typescript
const filePath = `Q-${rootId}/v${version}/quote-${quotationId}-${Date.now()}.pdf`;

const { error: uploadError } = await supabase.storage
  .from('quotation-attachments')
  .upload(filePath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: false,
  });

const { data: signedData } = await supabase.storage
  .from('quotation-attachments')
  .createSignedUrl(filePath, 3600); // 1 heure
```

