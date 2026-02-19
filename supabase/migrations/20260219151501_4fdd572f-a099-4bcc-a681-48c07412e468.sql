
DO $$
BEGIN
  -- Ajouter "hs_resolution" à la contrainte CHECK quote_facts_source_type_check
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quote_facts_source_type_check'
      AND conrelid = 'quote_facts'::regclass
  ) THEN
    ALTER TABLE quote_facts DROP CONSTRAINT quote_facts_source_type_check;
  END IF;

  ALTER TABLE quote_facts ADD CONSTRAINT quote_facts_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'email_body','email_subject',
    'attachment_pdf','attachment_excel','attachment_image',
    'manual_input','ai_extraction','ai_assumption',
    'quotation_engine','attachment_extracted','operator',
    'document_regex','hs_resolution','known_contact_match'
  ]));
END $$;
