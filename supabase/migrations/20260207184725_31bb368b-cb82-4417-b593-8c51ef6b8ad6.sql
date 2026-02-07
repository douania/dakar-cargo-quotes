ALTER TABLE quote_facts DROP CONSTRAINT IF EXISTS quote_facts_fact_category_check;
ALTER TABLE quote_facts ADD CONSTRAINT quote_facts_fact_category_check
  CHECK (fact_category = ANY (ARRAY[
    'cargo', 'routing', 'timing', 'pricing',
    'documents', 'contacts', 'other',
    'service', 'regulatory'
  ]));