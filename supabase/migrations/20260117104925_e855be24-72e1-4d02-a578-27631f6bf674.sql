-- Enable realtime for emails table to get notifications for new emails
ALTER PUBLICATION supabase_realtime ADD TABLE public.emails;