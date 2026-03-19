-- CL2-final A+ Complete Migration (retry)

-- 1. Claim tracking column (idempotent)
ALTER TABLE public.email_attachments
  ADD COLUMN IF NOT EXISTS analysis_claimed_at TIMESTAMPTZ;

-- 2. Deduplicate quotation_history then create unique index
DELETE FROM public.quotation_history
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY source_attachment_id, cargo_type
        ORDER BY created_at DESC
      ) AS rn
    FROM public.quotation_history
    WHERE source_attachment_id IS NOT NULL
  ) sub
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_history_attachment_cargo
  ON public.quotation_history (source_attachment_id, cargo_type)
  WHERE source_attachment_id IS NOT NULL;

-- 3. Unique on learned_knowledge
CREATE UNIQUE INDEX IF NOT EXISTS uq_learned_knowledge_source
  ON public.learned_knowledge (source_type, source_id, category)
  WHERE source_type = 'attachment' AND source_id IS NOT NULL;

-- 4. Add source_attachment_id to local_transport_rates
ALTER TABLE public.local_transport_rates
  ADD COLUMN IF NOT EXISTS source_attachment_id UUID;

-- 5. Unique on local_transport_rates
-- Invariant: one attachment produces at most one rate per (destination, container_type, cargo_category)
CREATE UNIQUE INDEX IF NOT EXISTS uq_local_transport_rates_attachment
  ON public.local_transport_rates (source_attachment_id, destination, container_type, cargo_category)
  WHERE source_attachment_id IS NOT NULL;