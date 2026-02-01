
-- Phase 6D.1: Ajouter le statut 'generated' à la contrainte CHECK
ALTER TABLE quotation_history 
DROP CONSTRAINT quotation_history_status_check;

ALTER TABLE quotation_history 
ADD CONSTRAINT quotation_history_status_check 
CHECK (status = ANY (ARRAY['draft', 'generated', 'sent', 'accepted', 'rejected', 'expired']));
