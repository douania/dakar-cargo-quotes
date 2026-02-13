-- Add 'attachment_extracted' to the allowed source_type values
ALTER TABLE public.quote_facts DROP CONSTRAINT quote_facts_source_type_check;

ALTER TABLE public.quote_facts ADD CONSTRAINT quote_facts_source_type_check 
CHECK (source_type = ANY (ARRAY[
  'email_body'::text, 
  'email_subject'::text, 
  'attachment_pdf'::text, 
  'attachment_excel'::text, 
  'attachment_image'::text, 
  'manual_input'::text, 
  'ai_extraction'::text, 
  'ai_assumption'::text, 
  'quotation_engine'::text,
  'attachment_extracted'::text,
  'operator'::text
]));