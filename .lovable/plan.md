

# Phase 7.0 — Email-Centric Puzzle IA (Foundation)
## Plan d'implémentation avec correctifs CTO

---

## Résumé des correctifs intégrés

| Correctif CTO | Solution appliquée |
|---------------|-------------------|
| UNIQUE ... WHERE inline invalide | Remplacé par `CREATE UNIQUE INDEX ... WHERE` |
| `created_by = auth.uid()` avec service_role | `created_by` nullable + Edge Function renseigne explicitement |
| RLS `FOR ALL` trop permissive | Policies séparées SELECT / INSERT / UPDATE |
| Défaut silencieux Dakar | Gap obligatoire + fact avec confidence=0.4 si assumé |
| `request_type` ambigu | Codes explicites `SEA_FCL_IMPORT`, `AIR_IMPORT` |

---

## 1. Migration SQL — 5 nouvelles tables

### 1.1 Enum pour request_type

```sql
-- Enum explicite pour les types de demande
CREATE TYPE quote_request_type AS ENUM (
  'SEA_FCL_IMPORT',
  'SEA_LCL_IMPORT', 
  'SEA_BREAKBULK_IMPORT',
  'AIR_IMPORT',
  'ROAD_IMPORT',
  'MULTIMODAL_IMPORT'
);

-- Enum pour les statuts de case
CREATE TYPE quote_case_status AS ENUM (
  'NEW_THREAD',
  'RFQ_DETECTED', 
  'FACTS_PARTIAL',
  'NEED_INFO',
  'READY_TO_PRICE',
  'PRICING_RUNNING',
  'PRICED_DRAFT',
  'HUMAN_REVIEW',
  'SENT',
  'ARCHIVED'
);
```

### 1.2 Table `quote_cases`

```sql
CREATE TABLE quote_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  
  -- État machine
  status quote_case_status NOT NULL DEFAULT 'NEW_THREAD',
  
  -- Type de demande (explicite)
  request_type quote_request_type,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  
  -- Références utilisateur (CORRIGÉ: nullable pour service_role)
  assigned_to UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),  -- Nullable, renseigné par Edge Function
  
  -- Compteurs
  facts_count INTEGER DEFAULT 0,
  gaps_count INTEGER DEFAULT 0,
  pricing_runs_count INTEGER DEFAULT 0,
  
  -- Progression
  puzzle_completeness NUMERIC(5,2) DEFAULT 0.00,
  
  -- Tracking
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(thread_id)
);

-- Index
CREATE INDEX idx_quote_cases_status ON quote_cases(status);
CREATE INDEX idx_quote_cases_thread ON quote_cases(thread_id);
CREATE INDEX idx_quote_cases_created_by ON quote_cases(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_quote_cases_assigned ON quote_cases(assigned_to) WHERE assigned_to IS NOT NULL;
```

### 1.3 Table `quote_facts`

```sql
CREATE TABLE quote_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  
  -- Identification du fait
  fact_key TEXT NOT NULL,  -- ex: 'cargo.weight_kg', 'routing.destination_port'
  fact_category TEXT NOT NULL CHECK (fact_category IN (
    'cargo', 'routing', 'timing', 'pricing', 'documents', 'contacts', 'other'
  )),
  
  -- Valeurs typées (une seule renseignée selon le type)
  value_text TEXT,
  value_number NUMERIC,
  value_json JSONB,
  value_date TIMESTAMPTZ,
  
  -- Traçabilité SOURCE DE VÉRITÉ
  source_type TEXT NOT NULL CHECK (source_type IN (
    'email_body', 'email_subject', 'attachment_pdf', 'attachment_excel',
    'attachment_image', 'manual_input', 'ai_extraction', 'ai_assumption',
    'quotation_engine'
  )),
  source_email_id UUID REFERENCES emails(id),
  source_attachment_id UUID REFERENCES email_attachments(id),
  source_excerpt TEXT,  -- Citation exacte
  
  -- Qualité
  confidence NUMERIC(3,2) DEFAULT 0.80 CHECK (confidence BETWEEN 0 AND 1),
  is_validated BOOLEAN DEFAULT false,
  validated_by UUID REFERENCES auth.users(id),
  validated_at TIMESTAMPTZ,
  
  -- Gestion des conflits (supersession)
  supersedes_fact_id UUID REFERENCES quote_facts(id),
  is_current BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index standard
CREATE INDEX idx_quote_facts_case ON quote_facts(case_id);
CREATE INDEX idx_quote_facts_key ON quote_facts(fact_key);
CREATE INDEX idx_quote_facts_source_email ON quote_facts(source_email_id) WHERE source_email_id IS NOT NULL;

-- CORRIGÉ: Unique partiel via CREATE INDEX (pas inline)
CREATE UNIQUE INDEX uq_quote_facts_current_key
ON quote_facts(case_id, fact_key)
WHERE is_current = true;
```

### 1.4 Table `quote_gaps`

```sql
CREATE TABLE quote_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  
  -- Identification
  gap_key TEXT NOT NULL,  -- Même namespace que fact_key
  gap_category TEXT NOT NULL CHECK (gap_category IN (
    'cargo', 'routing', 'timing', 'pricing', 'documents', 'contacts', 'other'
  )),
  
  -- Importance
  is_blocking BOOLEAN DEFAULT true,  -- true = empêche pricing
  priority TEXT DEFAULT 'high' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  
  -- Question à poser au client
  question_fr TEXT NOT NULL,
  question_en TEXT,
  
  -- Résolution
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'pending_response', 'resolved', 'waived')),
  resolved_by_fact_id UUID REFERENCES quote_facts(id),
  resolved_at TIMESTAMPTZ,
  waived_by UUID REFERENCES auth.users(id),
  waived_reason TEXT,
  
  -- Email de clarification envoyé
  clarification_sent_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index standard
CREATE INDEX idx_quote_gaps_case ON quote_gaps(case_id);
CREATE INDEX idx_quote_gaps_status ON quote_gaps(status);
CREATE INDEX idx_quote_gaps_blocking ON quote_gaps(case_id, is_blocking) WHERE is_blocking = true AND status = 'open';

-- CORRIGÉ: Unique partiel via CREATE INDEX
CREATE UNIQUE INDEX uq_quote_gaps_open_key
ON quote_gaps(case_id, gap_key)
WHERE status = 'open';
```

### 1.5 Table `pricing_runs`

```sql
CREATE TABLE pricing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  
  -- Version
  run_number INTEGER NOT NULL DEFAULT 1,
  
  -- Entrées (snapshot figé des facts)
  inputs_json JSONB NOT NULL,
  facts_snapshot JSONB NOT NULL,  -- Copie figée des facts
  
  -- Appel quotation-engine
  engine_request JSONB,
  engine_response JSONB,
  engine_version TEXT,
  
  -- Résultats
  outputs_json JSONB,  -- Résultat formaté final
  tariff_lines JSONB,  -- Lignes de cotation
  
  -- Totaux
  total_ht NUMERIC,
  total_ttc NUMERIC,
  currency TEXT DEFAULT 'XOF',
  
  -- Statut
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'success', 'failed', 'superseded'
  )),
  error_message TEXT,
  
  -- Traçabilité des sources tarifaires
  tariff_sources JSONB,  -- Références vers port_tariffs, carrier_billing_templates, etc.
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),  -- Nullable pour service_role
  
  UNIQUE(case_id, run_number)
);

-- Index
CREATE INDEX idx_pricing_runs_case ON pricing_runs(case_id);
CREATE INDEX idx_pricing_runs_status ON pricing_runs(status);
CREATE INDEX idx_pricing_runs_latest ON pricing_runs(case_id, run_number DESC);
```

### 1.6 Table `case_timeline_events`

```sql
CREATE TABLE case_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  
  -- Type d'événement
  event_type TEXT NOT NULL CHECK (event_type IN (
    'case_created', 'status_changed', 'fact_added', 'fact_updated', 'fact_superseded',
    'gap_identified', 'gap_resolved', 'gap_waived', 'pricing_started', 'pricing_completed',
    'pricing_failed', 'output_generated', 'human_approved', 'human_rejected',
    'sent', 'archived', 'email_received', 'email_sent', 'attachment_analyzed',
    'clarification_sent', 'manual_action'
  )),
  
  -- Détails
  event_data JSONB,
  previous_value TEXT,
  new_value TEXT,
  
  -- Contexte (références)
  related_email_id UUID REFERENCES emails(id),
  related_fact_id UUID REFERENCES quote_facts(id),
  related_gap_id UUID REFERENCES quote_gaps(id),
  related_pricing_run_id UUID REFERENCES pricing_runs(id),
  
  -- Acteur
  actor_type TEXT DEFAULT 'system' CHECK (actor_type IN ('system', 'user', 'ai')),
  actor_user_id UUID REFERENCES auth.users(id),
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX idx_timeline_case ON case_timeline_events(case_id);
CREATE INDEX idx_timeline_type ON case_timeline_events(event_type);
CREATE INDEX idx_timeline_created ON case_timeline_events(created_at DESC);
```

### 1.7 RLS Policies (CORRIGÉES: pas de FOR ALL)

```sql
-- quote_cases
ALTER TABLE quote_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_cases_select_owner"
  ON quote_cases FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid());

CREATE POLICY "quote_cases_insert_authenticated"
  ON quote_cases FOR INSERT TO authenticated
  WITH CHECK (true);  -- Edge Function renseigne created_by explicitement

CREATE POLICY "quote_cases_update_owner"
  ON quote_cases FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid())
  WITH CHECK (created_by = auth.uid() OR assigned_to = auth.uid());

-- quote_facts (via case ownership)
ALTER TABLE quote_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_facts_select"
  ON quote_facts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

CREATE POLICY "quote_facts_insert"
  ON quote_facts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

CREATE POLICY "quote_facts_update"
  ON quote_facts FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

-- quote_gaps (via case ownership)
ALTER TABLE quote_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_gaps_select"
  ON quote_gaps FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

CREATE POLICY "quote_gaps_insert"
  ON quote_gaps FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

CREATE POLICY "quote_gaps_update"
  ON quote_gaps FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

-- pricing_runs (SELECT seulement pour user, INSERT/UPDATE via service_role)
ALTER TABLE pricing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pricing_runs_select"
  ON pricing_runs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

-- INSERT/UPDATE via Edge Function service_role uniquement

-- case_timeline_events (SELECT only)
ALTER TABLE case_timeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "timeline_select"
  ON case_timeline_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

-- INSERT via Edge Function service_role uniquement
```

---

## 2. Edge Functions — 4 orchestrateurs

### 2.1 `ensure-quote-case`

**Fichier** : `supabase/functions/ensure-quote-case/index.ts`

**Responsabilité** : Créer ou récupérer un quote_case pour un thread email

**Logique** :
1. Valider l'utilisateur via JWT (extraire user_id)
2. Vérifier que thread_id existe dans `email_threads`
3. Chercher un case existant pour ce thread
   - Si existe → retourner
4. Insérer un nouveau case (service_role) avec :
   - `created_by = user_id` (explicite, pas default)
   - `status = 'NEW_THREAD'`
5. Si `email_threads.is_quotation_thread = true` → transition `RFQ_DETECTED`
6. Insérer événement `case_created` dans timeline
7. Retourner `{ case_id, status, is_new }`

**Config TOML** :
```toml
[functions.ensure-quote-case]
verify_jwt = true
```

### 2.2 `build-case-puzzle`

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`

**Responsabilité** : Analyser le thread et peupler facts/gaps

**Logique** :
1. Vérifier ownership du case (user_id = created_by ou assigned_to)
2. Charger tous les emails du thread (via `email_threads.id` ou `emails.thread_ref`)
3. Charger tous les attachments des emails
4. Pré-analyser les attachments non analysés (appel `analyze-attachments`)
5. Réutiliser `learn-quotation-puzzle` pour extraction IA :
   - `extract_request` → cargo, routing, timing
   - `extract_clarifications` → corrections
   - `extract_quotation` → tariff_lines existantes
   - `extract_contacts` → participants
6. Pour chaque fait extrait :
   - Mapper vers `fact_key` normalisé (ex: `routing.origin_port`)
   - Vérifier si existe déjà (même clé, is_current=true)
   - Si nouveau → INSERT avec source tracée
   - Si différent → `UPDATE is_current=false` sur ancien, INSERT nouveau
7. **CORRIGÉ: destination_port** :
   - Si non explicite mais assumé Dakar → créer fact avec :
     - `source_type = 'ai_assumption'`
     - `confidence = 0.40`
   - ET créer gap obligatoire : "Veuillez confirmer le port de destination"
8. Identifier les gaps vs mandatory facts (selon `request_type`)
9. Calculer `puzzle_completeness`
10. Mettre à jour `case.status` :
    - Tous facts obligatoires présents → `READY_TO_PRICE`
    - Gaps bloquants → `NEED_INFO`
    - Sinon → `FACTS_PARTIAL`
11. Insérer événements timeline

**Config TOML** :
```toml
[functions.build-case-puzzle]
verify_jwt = true
```

### 2.3 `run-pricing`

**Fichier** : `supabase/functions/run-pricing/index.ts`

**Responsabilité** : Exécuter le moteur de pricing déterministe

**Logique** :
1. Vérifier ownership et `status = READY_TO_PRICE`
2. Transition → `PRICING_RUNNING`
3. Charger tous les facts actuels (`is_current = true`)
4. Construire `inputs_json` depuis les facts :
   ```json
   {
     "originPort": "facts['routing.origin_port'].value_text",
     "finalDestination": "facts['routing.destination_city'].value_text",
     "incoterm": "facts['routing.incoterm'].value_text",
     "containers": "facts['cargo.containers'].value_json",
     "cargoWeight": "facts['cargo.weight_kg'].value_number",
     "cargoValue": "facts['cargo.value'].value_number"
   }
   ```
5. Insérer `pricing_run` avec :
   - `status = 'running'`
   - `inputs_json`
   - `facts_snapshot` (copie figée complète)
6. Appeler `quotation-engine` (fetch interne)
7. Parser la réponse :
   - `lines` → `tariff_lines`
   - `totals` → `total_ht`, `total_ttc`
   - `metadata` → `tariff_sources`
8. Mettre à jour pricing_run :
   - `status = 'success'`
   - `outputs_json`, `tariff_sources`, `completed_at`, `duration_ms`
9. Transition case → `PRICED_DRAFT`
10. Insérer événements timeline

**Config TOML** :
```toml
[functions.run-pricing]
verify_jwt = true
```

### 2.4 `generate-case-outputs`

**Fichier** : `supabase/functions/generate-case-outputs/index.ts`

**Responsabilité** : Générer draft email + PDF depuis pricing_run

**Logique** :
1. Vérifier ownership et `status = PRICED_DRAFT`
2. Charger `pricing_runs.outputs_json` (source unique de vérité)
3. Charger les facts pour contexte (client, routing)
4. Générer draft email :
   - Prompt IA avec `outputs_json` + règles métier
   - Aucun montant inventé (tous depuis outputs_json)
   - Stocker dans nouvelle table ou champ JSON sur case
5. Générer PDF :
   - Construire `GeneratedSnapshot` compatible avec `generate-quotation-pdf`
   - Appeler la fonction existante
   - Stocker dans `quotation_documents`
6. Transition case → `HUMAN_REVIEW`
7. Insérer événements timeline

**Config TOML** :
```toml
[functions.generate-case-outputs]
verify_jwt = true
```

---

## 3. Facts & Gaps — Définition V1

### 3.1 SEA_FCL_IMPORT — Facts obligatoires

| fact_key | Type | Obligatoire | Source |
|----------|------|-------------|--------|
| `routing.origin_port` | TEXT | ✅ | email/attachment |
| `routing.destination_port` | TEXT | ✅ (gap si assumé) | email |
| `routing.destination_city` | TEXT | ✅ | email |
| `routing.incoterm` | TEXT | ✅ | email |
| `cargo.description` | TEXT | ✅ | email |
| `cargo.containers` | JSON[] | ✅ | email (array) |
| `cargo.weight_kg` | NUMBER | ❌ (souhaité) | email/packing_list |
| `cargo.value` | NUMBER | ✅ si DDP/CIF | email/invoice |
| `cargo.value_currency` | TEXT | ✅ si value | email |
| `contacts.client_email` | TEXT | ✅ | email.from_address |

### 3.2 AIR_IMPORT — Facts obligatoires

| fact_key | Type | Obligatoire | Source |
|----------|------|-------------|--------|
| `routing.origin_airport` | TEXT | ✅ | email |
| `routing.destination_airport` | TEXT | ✅ (DSS si assumé + gap) | email |
| `routing.destination_city` | TEXT | ✅ | email |
| `routing.incoterm` | TEXT | ✅ | email |
| `cargo.description` | TEXT | ✅ | email |
| `cargo.weight_kg` | NUMBER | ✅ | email/AWB |
| `cargo.volume_cbm` | NUMBER | ✅ si non express | email |
| `cargo.pieces_count` | NUMBER | ✅ | email |
| `cargo.value` | NUMBER | ✅ | email/invoice |
| `contacts.client_email` | TEXT | ✅ | email.from_address |

### 3.3 Gaps et questions de clarification

| gap_key | Priorité | Question FR |
|---------|----------|-------------|
| `routing.incoterm` | CRITICAL | "Quel Incoterm souhaitez-vous ? (FOB, CFR, CIF, DAP, DDP...)" |
| `routing.destination_city` | CRITICAL | "Quelle est la destination finale des marchandises ?" |
| `routing.destination_port` | HIGH | "Veuillez confirmer le port de destination (Dakar ou autre)" |
| `cargo.containers` | CRITICAL (FCL) | "Merci de préciser type et nombre de conteneurs (ex: 2x40HC)" |
| `cargo.weight_kg` | HIGH (Air) | "Quel est le poids total en kg ?" |
| `cargo.value` | HIGH (DDP) | "Valeur déclarée des marchandises et devise ?" |

**Règle** : Maximum 1 email de clarification regroupant tous les gaps ouverts.

---

## 4. Diagramme de séquence

```text
┌──────────┐    ┌──────────────────┐    ┌────────────────────┐    ┌─────────────┐    ┌────────────────────┐
│  User    │    │ ensure-quote-case│    │ build-case-puzzle  │    │ run-pricing │    │generate-case-outputs│
└────┬─────┘    └────────┬─────────┘    └─────────┬──────────┘    └──────┬──────┘    └──────────┬─────────┘
     │                   │                        │                      │                      │
     │  Import Thread    │                        │                      │                      │
     │──────────────────>│                        │                      │                      │
     │                   │                        │                      │                      │
     │                   │  CREATE quote_case     │                      │                      │
     │                   │  (created_by=user_id)  │                      │                      │
     │                   │                        │                      │                      │
     │<──────────────────│                        │                      │                      │
     │  {case_id, NEW}   │                        │                      │                      │
     │                   │                        │                      │                      │
     │  Analyze Thread   │                        │                      │                      │
     │───────────────────────────────────────────>│                      │                      │
     │                   │                        │                      │                      │
     │                   │                        │  Extract facts (IA)  │                      │
     │                   │                        │  Identify gaps       │                      │
     │                   │                        │  Update status       │                      │
     │                   │                        │                      │                      │
     │<───────────────────────────────────────────│                      │                      │
     │  {facts, gaps, completeness}               │                      │                      │
     │                   │                        │                      │                      │
     │  [if READY_TO_PRICE] Run Pricing           │                      │                      │
     │────────────────────────────────────────────────────────────────-->│                      │
     │                   │                        │                      │                      │
     │                   │                        │                      │ Build inputs_json    │
     │                   │                        │                      │ Call quotation-engine│
     │                   │                        │                      │ Store pricing_run    │
     │                   │                        │                      │                      │
     │<──────────────────────────────────────────────────────────────────│                      │
     │  {pricing_run_id, total_ht}                │                      │                      │
     │                   │                        │                      │                      │
     │  Generate Outputs │                        │                      │                      │
     │─────────────────────────────────────────────────────────────────────────────────────────>│
     │                   │                        │                      │                      │
     │                   │                        │                      │                      │ Draft email
     │                   │                        │                      │                      │ Generate PDF
     │                   │                        │                      │                      │ → HUMAN_REVIEW
     │                   │                        │                      │                      │
     │<─────────────────────────────────────────────────────────────────────────────────────────│
     │  {draft_email, pdf_url}                    │                      │                      │
     │                   │                        │                      │                      │
     │  [HUMAN APPROVAL] │                        │                      │                      │
     │  → SENT           │                        │                      │                      │
     │                   │                        │                      │                      │
```

---

## 5. Plan d'exécution

### Phase 7.0.1 — Infrastructure DB (immédiat)
- [ ] Migration SQL pour enums + 5 tables
- [ ] RLS policies (séparées SELECT/INSERT/UPDATE)
- [ ] Unique indexes partiels

### Phase 7.0.2 — ensure-quote-case
- [ ] Edge Function avec gestion explicite `created_by`
- [ ] Timeline event `case_created`
- [ ] Tests via `curl_edge_functions`

### Phase 7.0.3 — build-case-puzzle
- [ ] Intégration avec `learn-quotation-puzzle` existant
- [ ] Mapping facts normalisés
- [ ] Gestion des assumptions (confidence=0.4 + gap)
- [ ] Detection gaps bloquants

### Phase 7.0.4 — run-pricing
- [ ] Facts → inputs_json mapping
- [ ] Appel quotation-engine
- [ ] Facts snapshot figé
- [ ] Traçabilité sources tarifaires

### Phase 7.0.5 — generate-case-outputs
- [ ] Draft email depuis outputs_json
- [ ] PDF via generate-quotation-pdf existant
- [ ] Transition HUMAN_REVIEW

### Phase 7.0.6 — UI Integration (ultérieur)
- [ ] Vue `/cases` liste des dossiers
- [ ] Timeline d'un case
- [ ] Bouton approbation humaine

---

## 6. Risques et hypothèses

### Hypothèses
1. Un thread = une demande unique (pas de multi-projets)
2. `learn-quotation-puzzle` est stable et réutilisable
3. `quotation-engine` répond en <10s

### Risques mitigés

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Défaut silencieux sur POD | Cotation erronée | Assumption + gap obligatoire |
| service_role + auth.uid() | Échec INSERT | `created_by` nullable, renseigné explicitement |
| UNIQUE inline invalide | Migration crash | Remplacé par CREATE UNIQUE INDEX |
| RLS FOR ALL | Sécurité | Policies séparées SELECT/INSERT/UPDATE |

