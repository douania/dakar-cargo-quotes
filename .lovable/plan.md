

# PHASE DOCS-P0 — Gestion documentaire par dossier

## Rapport d'audit

| Element | Statut | Detail |
|---------|--------|--------|
| Table liee a quote_cases | NON | `documents` existe (generique, sans case_id). `quotation_documents` liee a quotation_id. |
| UI upload dans CaseView | NON | 4 onglets existants (Taches, Resultats, Entrees, Historique). Aucun onglet Documents. |
| Bucket Storage dedie | NON | Buckets existants : `documents` (public, generique), `quotation-attachments` (cotations PDF). |

**Verdict : Ajout necessaire.**

---

## Plan d'implementation (3 etapes)

### Etape 1 — Migration SQL : table `case_documents` + bucket `case-documents`

Creer la table `case_documents` :
- `id` (uuid, pk, default gen_random_uuid())
- `case_id` (uuid, FK vers quote_cases.id ON DELETE CASCADE, NOT NULL)
- `document_type` (text, NOT NULL) — BL, Facture commerciale, Declaration douane, DPI, Ordre de transit, Liste de colisage, Autre
- `file_name` (text, NOT NULL)
- `storage_path` (text, NOT NULL)
- `mime_type` (text)
- `file_size` (integer)
- `uploaded_by` (uuid, NOT NULL)
- `created_at` (timestamptz, default now())

Index sur `case_id`.

RLS :
- SELECT : `TO authenticated USING (true)` — coherent avec la politique mono-tenant existante (meme logique que quote_cases, quote_facts, pricing_runs)
- INSERT : `TO authenticated WITH CHECK (auth.uid() = uploaded_by)` — tracabilite
- DELETE : `TO authenticated USING (auth.uid() = uploaded_by)`

Bucket Storage :
- Nom : `case-documents`
- Public : **NON** (prive, acces via signed URLs)
- Policies storage.objects : SELECT/INSERT/DELETE pour authenticated sur `bucket_id = 'case-documents'`

Structure fichiers : `{case_id}/{document_id}-{file_name}`

### Etape 2 — Composant UI : `CaseDocumentsTab`

Nouveau fichier : `src/components/case/CaseDocumentsTab.tsx`

Contenu :
- Props : `caseId: string`
- Query les `case_documents` filtres par `case_id`
- Affiche un tableau : Type | Nom fichier | Taille | Date upload
- Bouton "Ajouter un document" ouvrant un Dialog
- Dialog d'upload :
  - Select pour le type de document (BL, Facture commerciale, Declaration douane, DPI, Ordre de transit, Liste de colisage, Autre)
  - Zone de drop / bouton fichier (input file standard)
  - Upload vers bucket `case-documents` via Supabase Storage
  - Insert dans `case_documents`
  - Insert event timeline dans `case_timeline_events` avec `event_type = 'document_uploaded'`
- Lien de telechargement via signed URL (1h)

### Etape 3 — Integration dans CaseView

Modifier `src/pages/CaseView.tsx` :
- Ajouter un 5eme onglet "Documents" dans le TabsList (grid passe de 4 a 5 colonnes)
- Importer et rendre `CaseDocumentsTab` dans le TabsContent correspondant
- Icone : `Paperclip` de lucide-react

---

## Fichiers modifies/crees

| Fichier | Action |
|---------|--------|
| Migration SQL | CREER — table `case_documents`, bucket `case-documents`, RLS, policies storage |
| `src/components/case/CaseDocumentsTab.tsx` | CREER — composant onglet documents |
| `src/pages/CaseView.tsx` | MODIFIER — ajout 5eme onglet Documents (lignes 192-210 uniquement) |

## Composants FROZEN impactes : AUCUN

## Section technique

### Migration SQL

```sql
-- Table case_documents
CREATE TABLE public.case_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_case_documents_case_id ON public.case_documents(case_id);

ALTER TABLE public.case_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "case_documents_select" ON public.case_documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "case_documents_insert" ON public.case_documents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "case_documents_delete" ON public.case_documents
  FOR DELETE TO authenticated USING (auth.uid() = uploaded_by);

-- Bucket prive
INSERT INTO storage.buckets (id, name, public)
VALUES ('case-documents', 'case-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "case_docs_storage_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'case-documents');

CREATE POLICY "case_docs_storage_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'case-documents');

CREATE POLICY "case_docs_storage_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'case-documents');
```

### CaseDocumentsTab.tsx — Architecture

- Hook `useQuery` pour charger les documents du case
- `useMutation` pour upload (Storage + insert DB + timeline event)
- Dialog Radix pour le formulaire d'ajout
- Table shadcn/ui pour l'affichage
- Signed URL pour telechargement (pas de bucket public)

### CaseView.tsx — Diff prevu

- Ligne 1 : ajout import `Paperclip` depuis lucide-react
- Ligne ~5 : ajout import `CaseDocumentsTab`
- Ligne 192 : `grid-cols-4` devient `grid-cols-5`
- Apres ligne 210 : ajout TabsTrigger "Documents"
- Apres le dernier TabsContent : ajout TabsContent avec `CaseDocumentsTab`

