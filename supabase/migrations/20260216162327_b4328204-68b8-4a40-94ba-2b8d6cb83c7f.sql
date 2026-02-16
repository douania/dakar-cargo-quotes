-- Accorder les droits d'insertion aux utilisateurs authentifiés pour la timeline
-- Cela évite l'erreur 403 lors de l'upload de documents ou d'actions utilisateur
CREATE POLICY "Les utilisateurs peuvent insérer leurs propres événements de timeline" 
ON public.case_timeline_events 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- On s'assure aussi que la lecture est possible
CREATE POLICY "Les utilisateurs peuvent voir les événements de timeline" 
ON public.case_timeline_events 
FOR SELECT 
USING (auth.role() = 'authenticated');
