-- Phase 6D.1: Add columns for generated snapshot
ALTER TABLE quotation_history
ADD COLUMN generated_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE quotation_history
ADD COLUMN generated_snapshot JSONB DEFAULT NULL;

-- Documentation (CTO recommendation)
COMMENT ON COLUMN quotation_history.generated_snapshot 
IS 'Snapshot figé du devis au moment de la génération';