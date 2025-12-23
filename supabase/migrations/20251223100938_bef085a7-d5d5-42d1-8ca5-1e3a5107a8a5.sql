-- Add is_quotation_thread column to email_threads
ALTER TABLE public.email_threads 
ADD COLUMN IF NOT EXISTS is_quotation_thread BOOLEAN DEFAULT false;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_email_threads_is_quotation ON public.email_threads(is_quotation_thread);

-- Initialize existing threads: mark as quotation if they have at least one quotation email
UPDATE public.email_threads t
SET is_quotation_thread = true
WHERE EXISTS (
  SELECT 1 FROM public.emails e 
  WHERE e.thread_ref = t.id 
  AND e.is_quotation_request = true
);