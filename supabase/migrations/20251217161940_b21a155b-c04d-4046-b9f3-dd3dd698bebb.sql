-- Create email_attachments table
CREATE TABLE public.email_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email_id UUID REFERENCES public.emails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  storage_path TEXT,
  extracted_text TEXT,
  extracted_data JSONB,
  is_analyzed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_attachments ENABLE ROW LEVEL SECURITY;

-- Public access policies (same as other tables)
CREATE POLICY "attachments_public_read" ON public.email_attachments FOR SELECT USING (true);
CREATE POLICY "attachments_public_insert" ON public.email_attachments FOR INSERT WITH CHECK (true);
CREATE POLICY "attachments_public_update" ON public.email_attachments FOR UPDATE USING (true);
CREATE POLICY "attachments_public_delete" ON public.email_attachments FOR DELETE USING (true);

-- Index for fast lookups
CREATE INDEX idx_email_attachments_email_id ON public.email_attachments(email_id);