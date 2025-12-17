// Common types used across the application

export interface AttachedFile {
  id: string;
  name: string;
  content: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachedFiles?: AttachedFile[];
}

export interface EmailConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  is_active: boolean;
  last_sync_at: string | null;
}

export interface Email {
  id: string;
  from_address: string;
  subject: string;
  body_text: string;
  sent_at: string;
  is_quotation_request: boolean;
  is_read: boolean;
  thread_id: string;
  extracted_data: Record<string, unknown>;
}

export interface EmailDraft {
  id: string;
  subject: string;
  body_text: string;
  to_addresses: string[];
  status: string;
  created_at: string;
  original_email_id: string;
}

export interface LearnedKnowledge {
  id: string;
  name: string;
  category: string;
  description: string | null;
  data: Record<string, unknown>;
  source_type: string | null;
  confidence: number;
  is_validated: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface EmailThread {
  subject: string;
  normalizedSubject: string;
  messageCount: number;
  participants: string[];
  dateRange: { first: string; last: string };
  messages: Array<{
    uid: number;
    seq: number;
    subject: string;
    from: string;
    to: string[];
    date: string;
    messageId: string;
  }>;
}
