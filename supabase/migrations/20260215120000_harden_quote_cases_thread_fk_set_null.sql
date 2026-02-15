-- Harden FK to prevent cascade deletion of quote cases when email_threads are deleted
ALTER TABLE public.quote_cases
  DROP CONSTRAINT IF EXISTS quote_cases_thread_id_fkey;

ALTER TABLE public.quote_cases
  ADD CONSTRAINT quote_cases_thread_id_fkey
  FOREIGN KEY (thread_id)
  REFERENCES public.email_threads(id)
  ON DELETE SET NULL;
