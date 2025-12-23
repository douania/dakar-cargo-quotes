-- Create storage bucket for generated quotation attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('quotation-attachments', 'quotation-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to quotation attachments
CREATE POLICY "Allow public read access to quotation attachments"
ON storage.objects
FOR SELECT
USING (bucket_id = 'quotation-attachments');

-- Allow service role to insert quotation attachments
CREATE POLICY "Allow service role to insert quotation attachments"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'quotation-attachments');

-- Allow service role to update quotation attachments
CREATE POLICY "Allow service role to update quotation attachments"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'quotation-attachments');

-- Allow service role to delete quotation attachments
CREATE POLICY "Allow service role to delete quotation attachments"
ON storage.objects
FOR DELETE
USING (bucket_id = 'quotation-attachments');