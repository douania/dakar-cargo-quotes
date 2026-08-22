-- Réconciliation Git du prérequis live public.email_drafts.created_by.
-- La colonne existe dans Lovable sans migration historique enregistrée.
-- Ce fichier reproduit uniquement son état vérifié : UUID nullable avec
-- DEFAULT auth.uid(), sans FK, index, backfill, politique ni autre DDL/DML.

ALTER TABLE public.email_drafts
  ADD COLUMN IF NOT EXISTS created_by uuid NULL DEFAULT auth.uid();
