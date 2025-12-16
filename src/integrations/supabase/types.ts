export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      documents: {
        Row: {
          content_text: string | null
          created_at: string | null
          email_date: string | null
          email_from: string | null
          email_subject: string | null
          extracted_data: Json | null
          file_size: number | null
          file_type: string
          filename: string
          id: string
          source: string | null
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          content_text?: string | null
          created_at?: string | null
          email_date?: string | null
          email_from?: string | null
          email_subject?: string | null
          extracted_data?: Json | null
          file_size?: number | null
          file_type: string
          filename: string
          id?: string
          source?: string | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          content_text?: string | null
          created_at?: string | null
          email_date?: string | null
          email_from?: string | null
          email_subject?: string | null
          extracted_data?: Json | null
          file_size?: number | null
          file_type?: string
          filename?: string
          id?: string
          source?: string | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      email_configs: {
        Row: {
          created_at: string | null
          folder: string | null
          host: string
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          name: string
          password_encrypted: string
          port: number
          use_ssl: boolean | null
          username: string
        }
        Insert: {
          created_at?: string | null
          folder?: string | null
          host: string
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          name: string
          password_encrypted: string
          port?: number
          use_ssl?: boolean | null
          username: string
        }
        Update: {
          created_at?: string | null
          folder?: string | null
          host?: string
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          name?: string
          password_encrypted?: string
          port?: number
          use_ssl?: boolean | null
          username?: string
        }
        Relationships: []
      }
      email_drafts: {
        Row: {
          ai_generated: boolean | null
          body_html: string | null
          body_text: string | null
          cc_addresses: string[] | null
          created_at: string | null
          id: string
          original_email_id: string | null
          sent_at: string | null
          status: string | null
          subject: string
          to_addresses: string[]
        }
        Insert: {
          ai_generated?: boolean | null
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[] | null
          created_at?: string | null
          id?: string
          original_email_id?: string | null
          sent_at?: string | null
          status?: string | null
          subject: string
          to_addresses: string[]
        }
        Update: {
          ai_generated?: boolean | null
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[] | null
          created_at?: string | null
          id?: string
          original_email_id?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string
          to_addresses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_original_email_id_fkey"
            columns: ["original_email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      emails: {
        Row: {
          body_html: string | null
          body_text: string | null
          cc_addresses: string[] | null
          created_at: string | null
          email_config_id: string | null
          extracted_data: Json | null
          from_address: string
          id: string
          is_quotation_request: boolean | null
          is_read: boolean | null
          message_id: string
          received_at: string | null
          sent_at: string | null
          subject: string | null
          thread_id: string | null
          to_addresses: string[]
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[] | null
          created_at?: string | null
          email_config_id?: string | null
          extracted_data?: Json | null
          from_address: string
          id?: string
          is_quotation_request?: boolean | null
          is_read?: boolean | null
          message_id: string
          received_at?: string | null
          sent_at?: string | null
          subject?: string | null
          thread_id?: string | null
          to_addresses: string[]
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[] | null
          created_at?: string | null
          email_config_id?: string | null
          extracted_data?: Json | null
          from_address?: string
          id?: string
          is_quotation_request?: boolean | null
          is_read?: boolean | null
          message_id?: string
          received_at?: string | null
          sent_at?: string | null
          subject?: string | null
          thread_id?: string | null
          to_addresses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "emails_email_config_id_fkey"
            columns: ["email_config_id"]
            isOneToOne: false
            referencedRelation: "email_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      hs_codes: {
        Row: {
          bic: boolean | null
          chapter: number | null
          code: string
          code_normalized: string
          cosec: number
          created_at: string | null
          dd: number
          description: string | null
          id: string
          mercurialis: boolean | null
          pcc: number
          pcs: number
          ref: number | null
          rs: number
          surtaxe: number | null
          t_ciment: number | null
          t_conj: number | null
          t_para: number | null
          t_past: number | null
          ta: number | null
          tev: number | null
          tin: number | null
          tva: number
          uemoa: number | null
          updated_at: string | null
        }
        Insert: {
          bic?: boolean | null
          chapter?: number | null
          code: string
          code_normalized: string
          cosec?: number
          created_at?: string | null
          dd?: number
          description?: string | null
          id?: string
          mercurialis?: boolean | null
          pcc?: number
          pcs?: number
          ref?: number | null
          rs?: number
          surtaxe?: number | null
          t_ciment?: number | null
          t_conj?: number | null
          t_para?: number | null
          t_past?: number | null
          ta?: number | null
          tev?: number | null
          tin?: number | null
          tva?: number
          uemoa?: number | null
          updated_at?: string | null
        }
        Update: {
          bic?: boolean | null
          chapter?: number | null
          code?: string
          code_normalized?: string
          cosec?: number
          created_at?: string | null
          dd?: number
          description?: string | null
          id?: string
          mercurialis?: boolean | null
          pcc?: number
          pcs?: number
          ref?: number | null
          rs?: number
          surtaxe?: number | null
          t_ciment?: number | null
          t_conj?: number | null
          t_para?: number | null
          t_past?: number | null
          ta?: number | null
          tev?: number | null
          tin?: number | null
          tva?: number
          uemoa?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      learned_knowledge: {
        Row: {
          category: string
          confidence: number | null
          created_at: string | null
          data: Json
          description: string | null
          id: string
          is_validated: boolean | null
          last_used_at: string | null
          name: string
          source_id: string | null
          source_type: string | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          category: string
          confidence?: number | null
          created_at?: string | null
          data: Json
          description?: string | null
          id?: string
          is_validated?: boolean | null
          last_used_at?: string | null
          name: string
          source_id?: string | null
          source_type?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          category?: string
          confidence?: number | null
          created_at?: string | null
          data?: Json
          description?: string | null
          id?: string
          is_validated?: boolean | null
          last_used_at?: string | null
          name?: string
          source_id?: string | null
          source_type?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: []
      }
      tax_rates: {
        Row: {
          applies_to: string | null
          base_calculation: string
          code: string
          created_at: string | null
          effective_date: string
          exemptions: string | null
          id: string
          is_active: boolean | null
          name: string
          rate: number
          updated_at: string | null
        }
        Insert: {
          applies_to?: string | null
          base_calculation: string
          code: string
          created_at?: string | null
          effective_date?: string
          exemptions?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          rate: number
          updated_at?: string | null
        }
        Update: {
          applies_to?: string | null
          base_calculation?: string
          code?: string
          created_at?: string | null
          effective_date?: string
          exemptions?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          rate?: number
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
