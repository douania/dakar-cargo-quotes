
DO $$
BEGIN
  -- quote_facts: ajouter "document_regex"
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quote_facts_source_type_check'
      AND conrelid = 'quote_facts'::regclass
  ) THEN
    ALTER TABLE quote_facts DROP CONSTRAINT quote_facts_source_type_check;
  END IF;

  ALTER TABLE quote_facts ADD CONSTRAINT quote_facts_source_type_check
  CHECK (source_type IN (
    'email_body', 'email_subject',
    'attachment_pdf', 'attachment_excel', 'attachment_image',
    'manual_input', 'ai_extraction', 'ai_assumption',
    'quotation_engine', 'attachment_extracted', 'operator',
    'document_regex'
  ));

  -- pricing_runs: ajouter "blocked"
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pricing_runs_status_check'
      AND conrelid = 'pricing_runs'::regclass
  ) THEN
    ALTER TABLE pricing_runs DROP CONSTRAINT pricing_runs_status_check;
  END IF;

  ALTER TABLE pricing_runs ADD CONSTRAINT pricing_runs_status_check
  CHECK (status IN (
    'pending', 'running', 'success', 'failed', 'superseded', 'blocked'
  ));
END $$;
