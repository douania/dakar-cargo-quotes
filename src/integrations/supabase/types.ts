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
      customs_regimes: {
        Row: {
          code: string
          cosec: boolean | null
          created_at: string | null
          dd: boolean | null
          fixed_amount: number | null
          id: string
          is_active: boolean | null
          name: string | null
          pcc: boolean | null
          pcs: boolean | null
          rs: boolean | null
          stx: boolean | null
          ta: boolean | null
          tin: boolean | null
          tpast: boolean | null
          tva: boolean | null
          updated_at: string | null
        }
        Insert: {
          code: string
          cosec?: boolean | null
          created_at?: string | null
          dd?: boolean | null
          fixed_amount?: number | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          pcc?: boolean | null
          pcs?: boolean | null
          rs?: boolean | null
          stx?: boolean | null
          ta?: boolean | null
          tin?: boolean | null
          tpast?: boolean | null
          tva?: boolean | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          cosec?: boolean | null
          created_at?: string | null
          dd?: boolean | null
          fixed_amount?: number | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          pcc?: boolean | null
          pcs?: boolean | null
          rs?: boolean | null
          stx?: boolean | null
          ta?: boolean | null
          tin?: boolean | null
          tpast?: boolean | null
          tva?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
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
      email_attachments: {
        Row: {
          content_type: string | null
          created_at: string | null
          email_id: string | null
          extracted_data: Json | null
          extracted_text: string | null
          filename: string
          id: string
          is_analyzed: boolean | null
          size: number | null
          storage_path: string | null
        }
        Insert: {
          content_type?: string | null
          created_at?: string | null
          email_id?: string | null
          extracted_data?: Json | null
          extracted_text?: string | null
          filename: string
          id?: string
          is_analyzed?: boolean | null
          size?: number | null
          storage_path?: string | null
        }
        Update: {
          content_type?: string | null
          created_at?: string | null
          email_id?: string | null
          extracted_data?: Json | null
          extracted_text?: string | null
          filename?: string
          id?: string
          is_analyzed?: boolean | null
          size?: number | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_attachments_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
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
      expert_profiles: {
        Row: {
          communication_style: Json | null
          created_at: string
          email: string
          expertise: string[] | null
          id: string
          is_primary: boolean | null
          last_learned_at: string | null
          learned_from_count: number | null
          name: string
          quotation_templates: Json | null
          response_patterns: Json | null
          role: string | null
          updated_at: string
        }
        Insert: {
          communication_style?: Json | null
          created_at?: string
          email: string
          expertise?: string[] | null
          id?: string
          is_primary?: boolean | null
          last_learned_at?: string | null
          learned_from_count?: number | null
          name: string
          quotation_templates?: Json | null
          response_patterns?: Json | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          communication_style?: Json | null
          created_at?: string
          email?: string
          expertise?: string[] | null
          id?: string
          is_primary?: boolean | null
          last_learned_at?: string | null
          learned_from_count?: number | null
          name?: string
          quotation_templates?: Json | null
          response_patterns?: Json | null
          role?: string | null
          updated_at?: string
        }
        Relationships: []
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
      market_intelligence: {
        Row: {
          category: string
          content: string | null
          created_at: string
          detected_at: string
          id: string
          impact_level: string | null
          is_processed: boolean | null
          processed_at: string | null
          source: string
          summary: string | null
          title: string
          url: string | null
        }
        Insert: {
          category: string
          content?: string | null
          created_at?: string
          detected_at?: string
          id?: string
          impact_level?: string | null
          is_processed?: boolean | null
          processed_at?: string | null
          source: string
          summary?: string | null
          title: string
          url?: string | null
        }
        Update: {
          category?: string
          content?: string | null
          created_at?: string
          detected_at?: string
          id?: string
          impact_level?: string | null
          is_processed?: boolean | null
          processed_at?: string | null
          source?: string
          summary?: string | null
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      surveillance_sources: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean | null
          last_scraped_at: string | null
          name: string
          scrape_frequency: string | null
          selectors: Json | null
          url: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          name: string
          scrape_frequency?: string | null
          selectors?: Json | null
          url: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          name?: string
          scrape_frequency?: string | null
          selectors?: Json | null
          url?: string
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
