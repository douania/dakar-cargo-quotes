-- Supprimer la politique restrictive existante
DROP POLICY IF EXISTS "Deny all client access to email_attachments" ON email_attachments;

-- Créer une politique de lecture publique
CREATE POLICY "email_attachments_public_read" ON email_attachments
  FOR SELECT USING (true);

-- Politique pour les opérations de gestion (insert/update/delete via edge functions)
CREATE POLICY "email_attachments_service_manage" ON email_attachments
  FOR ALL USING (true);