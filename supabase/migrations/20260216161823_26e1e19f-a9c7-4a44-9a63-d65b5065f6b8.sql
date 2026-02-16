-- Supprimer la contrainte de clé étrangère qui bloque l'attachement de documents pour les dossiers externes (Railway)
ALTER TABLE public.case_documents 
DROP CONSTRAINT IF EXISTS case_documents_case_id_fkey;

-- Ajouter une contrainte de validation simple pour éviter les IDs invalides sans forcer la présence dans quote_cases
-- On cast en text pour pouvoir utiliser length() sur un type UUID
ALTER TABLE public.case_documents 
ADD CONSTRAINT case_documents_case_id_not_empty 
CHECK (length(case_id::text) > 10);

-- Note d'architecture : l'intégrité référentielle est désormais gérée au niveau applicatif 
-- car les dossiers peuvent résider dans des systèmes externes.
