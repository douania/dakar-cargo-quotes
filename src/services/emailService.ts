import { supabase } from '@/integrations/supabase/client';
import type { EmailConfig, Email, EmailDraft } from '@/types';

export async function fetchEmailConfigs() {
  const { data, error } = await supabase
    .from('email_configs')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data as EmailConfig[];
}

export async function fetchEmails(page = 0, pageSize = 20) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  
  const { data, error, count } = await supabase
    .from('emails')
    .select('*', { count: 'exact' })
    .order('sent_at', { ascending: false })
    .range(from, to);
  
  if (error) throw error;
  return { emails: data as Email[], totalCount: count || 0 };
}

export async function fetchEmailDrafts() {
  const { data, error } = await supabase
    .from('email_drafts')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data as EmailDraft[];
}

export async function fetchAttachmentCounts() {
  const { data, error } = await supabase
    .from('email_attachments')
    .select('email_id');
  
  if (error) throw error;
  
  const counts: Record<string, number> = {};
  data?.forEach((att) => {
    if (att.email_id) {
      counts[att.email_id] = (counts[att.email_id] || 0) + 1;
    }
  });
  return counts;
}

export async function addEmailConfig(config: {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
}) {
  const { error } = await supabase.from('email_configs').insert({
    name: config.name,
    host: config.host,
    port: config.port,
    username: config.username,
    password_encrypted: config.password,
  });
  
  if (error) throw error;
}

export async function deleteEmailConfig(id: string) {
  const { error } = await supabase.from('email_configs').delete().eq('id', id);
  if (error) throw error;
}

export async function syncEmails(configId: string) {
  const { data, error } = await supabase.functions.invoke('sync-emails', {
    body: { configId },
  });
  
  if (error) throw error;
  return data;
}

export async function learnFromEmail(emailId: string) {
  const { data, error } = await supabase.functions.invoke('learn-from-content', {
    body: { contentType: 'email', contentId: emailId },
  });
  
  if (error) throw error;
  return data;
}

export async function generateEmailResponse(emailId: string) {
  const { data, error } = await supabase.functions.invoke('generate-response', {
    body: { emailId },
  });
  
  if (error) throw error;
  return data;
}

export async function searchEmails(configId: string, searchType: string, query: string, limit = 50) {
  const { data, error } = await supabase.functions.invoke('search-emails', {
    body: { configId, searchType, query: query.trim(), limit },
  });
  
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data;
}

export async function importThread(configId: string, uids: number[]) {
  const { data, error } = await supabase.functions.invoke('import-thread', {
    body: { configId, uids, learningCase: 'quotation' },
  });
  
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data;
}
