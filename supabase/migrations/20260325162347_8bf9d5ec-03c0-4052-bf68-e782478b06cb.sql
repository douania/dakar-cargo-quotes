
-- M18d: Secure documents bucket — private + SELECT authenticated only

-- 1. Set bucket to private
UPDATE storage.buckets SET public = false WHERE id = 'documents';

-- 2. Drop overly permissive public policies
DROP POLICY IF EXISTS "documents_storage_public_read" ON storage.objects;
DROP POLICY IF EXISTS "documents_storage_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "documents_storage_public_delete" ON storage.objects;

-- 3. Add SELECT-only policy for authenticated users
-- Writes/deletes remain service_role only (no client-side write path exists)
CREATE POLICY "documents_storage_auth_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents');
