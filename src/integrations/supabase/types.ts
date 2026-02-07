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
      border_clearing_rates: {
        Row: {
          amount_20ft: number | null
          amount_40ft: number | null
          calculation_method: string | null
          charge_code: string
          charge_name: string
          corridor: string
          country: string
          created_at: string | null
          currency: string | null
          effective_date: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          source_document: string | null
        }
        Insert: {
          amount_20ft?: number | null
          amount_40ft?: number | null
          calculation_method?: string | null
          charge_code: string
          charge_name: string
          corridor: string
          country: string
          created_at?: string | null
          currency?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          source_document?: string | null
        }
        Update: {
          amount_20ft?: number | null
          amount_40ft?: number | null
          calculation_method?: string | null
          charge_code?: string
          charge_name?: string
          corridor?: string
          country?: string
          created_at?: string | null
          currency?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          source_document?: string | null
        }
        Relationships: []
      }
      carrier_billing_templates: {
        Row: {
          base_reference: string | null
          calculation_method: string
          carrier: string
          charge_code: string
          charge_name: string
          created_at: string | null
          currency: string | null
          default_amount: number | null
          effective_date: string | null
          id: string
          invoice_sequence: number | null
          invoice_type: string | null
          is_active: boolean | null
          is_variable: boolean | null
          notes: string | null
          operation_type: string | null
          source_documents: string[] | null
          updated_at: string | null
          variable_unit: string | null
          vat_rate: number | null
        }
        Insert: {
          base_reference?: string | null
          calculation_method: string
          carrier: string
          charge_code: string
          charge_name: string
          created_at?: string | null
          currency?: string | null
          default_amount?: number | null
          effective_date?: string | null
          id?: string
          invoice_sequence?: number | null
          invoice_type?: string | null
          is_active?: boolean | null
          is_variable?: boolean | null
          notes?: string | null
          operation_type?: string | null
          source_documents?: string[] | null
          updated_at?: string | null
          variable_unit?: string | null
          vat_rate?: number | null
        }
        Update: {
          base_reference?: string | null
          calculation_method?: string
          carrier?: string
          charge_code?: string
          charge_name?: string
          created_at?: string | null
          currency?: string | null
          default_amount?: number | null
          effective_date?: string | null
          id?: string
          invoice_sequence?: number | null
          invoice_type?: string | null
          is_active?: boolean | null
          is_variable?: boolean | null
          notes?: string | null
          operation_type?: string | null
          source_documents?: string[] | null
          updated_at?: string | null
          variable_unit?: string | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      case_timeline_events: {
        Row: {
          actor_type: string | null
          actor_user_id: string | null
          case_id: string
          created_at: string | null
          event_data: Json | null
          event_type: string
          id: string
          new_value: string | null
          previous_value: string | null
          related_email_id: string | null
          related_fact_id: string | null
          related_gap_id: string | null
          related_pricing_run_id: string | null
        }
        Insert: {
          actor_type?: string | null
          actor_user_id?: string | null
          case_id: string
          created_at?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          new_value?: string | null
          previous_value?: string | null
          related_email_id?: string | null
          related_fact_id?: string | null
          related_gap_id?: string | null
          related_pricing_run_id?: string | null
        }
        Update: {
          actor_type?: string | null
          actor_user_id?: string | null
          case_id?: string
          created_at?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          new_value?: string | null
          previous_value?: string | null
          related_email_id?: string | null
          related_fact_id?: string | null
          related_gap_id?: string | null
          related_pricing_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_timeline_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "quote_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_timeline_events_related_email_id_fkey"
            columns: ["related_email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_timeline_events_related_fact_id_fkey"
            columns: ["related_fact_id"]
            isOneToOne: false
            referencedRelation: "quote_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_timeline_events_related_gap_id_fkey"
            columns: ["related_gap_id"]
            isOneToOne: false
            referencedRelation: "quote_gaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_timeline_events_related_pricing_run_id_fkey"
            columns: ["related_pricing_run_id"]
            isOneToOne: false
            referencedRelation: "pricing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company: string | null
          country: string | null
          created_at: string | null
          email: string
          id: string
          interaction_count: number | null
          is_trusted: boolean | null
          last_interaction_at: string | null
          name: string | null
          notes: string | null
          role: string | null
          updated_at: string | null
        }
        Insert: {
          company?: string | null
          country?: string | null
          created_at?: string | null
          email: string
          id?: string
          interaction_count?: number | null
          is_trusted?: boolean | null
          last_interaction_at?: string | null
          name?: string | null
          notes?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          company?: string | null
          country?: string | null
          created_at?: string | null
          email?: string
          id?: string
          interaction_count?: number | null
          is_trusted?: boolean | null
          last_interaction_at?: string | null
          name?: string | null
          notes?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      container_specifications: {
        Row: {
          created_at: string | null
          door_height_m: number
          door_width_m: number
          external_height_m: number
          external_length_m: number
          external_width_m: number
          id: string
          internal_height_m: number
          internal_length_m: number
          internal_volume_cbm: number
          internal_width_m: number
          is_high_cube: boolean | null
          is_open_top: boolean | null
          is_refrigerated: boolean | null
          length_ft: number
          max_gross_weight_kg: number
          max_payload_kg: number
          tare_weight_kg: number
          type_code: string
          type_name_en: string
          type_name_fr: string
        }
        Insert: {
          created_at?: string | null
          door_height_m: number
          door_width_m: number
          external_height_m: number
          external_length_m: number
          external_width_m: number
          id?: string
          internal_height_m: number
          internal_length_m: number
          internal_volume_cbm: number
          internal_width_m: number
          is_high_cube?: boolean | null
          is_open_top?: boolean | null
          is_refrigerated?: boolean | null
          length_ft: number
          max_gross_weight_kg: number
          max_payload_kg: number
          tare_weight_kg: number
          type_code: string
          type_name_en: string
          type_name_fr: string
        }
        Update: {
          created_at?: string | null
          door_height_m?: number
          door_width_m?: number
          external_height_m?: number
          external_length_m?: number
          external_width_m?: number
          id?: string
          internal_height_m?: number
          internal_length_m?: number
          internal_volume_cbm?: number
          internal_width_m?: number
          is_high_cube?: boolean | null
          is_open_top?: boolean | null
          is_refrigerated?: boolean | null
          length_ft?: number
          max_gross_weight_kg?: number
          max_payload_kg?: number
          tare_weight_kg?: number
          type_code?: string
          type_name_en?: string
          type_name_fr?: string
        }
        Relationships: []
      }
      customs_regimes: {
        Row: {
          category: string | null
          code: string
          cosec: boolean | null
          created_at: string | null
          dd: boolean | null
          fixed_amount: number | null
          id: string
          is_active: boolean | null
          keywords: string[] | null
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
          use_case: string | null
        }
        Insert: {
          category?: string | null
          code: string
          cosec?: boolean | null
          created_at?: string | null
          dd?: boolean | null
          fixed_amount?: number | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
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
          use_case?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          cosec?: boolean | null
          created_at?: string | null
          dd?: boolean | null
          fixed_amount?: number | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
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
          use_case?: string | null
        }
        Relationships: []
      }
      decision_proposals: {
        Row: {
          case_id: string
          committed_at: string | null
          committed_by: string | null
          created_at: string
          decision_type: Database["public"]["Enums"]["decision_type"]
          facts_hash: string | null
          gaps_hash: string | null
          generated_at: string
          generated_by: string
          id: string
          options_json: Json
          proposal_batch_id: string
        }
        Insert: {
          case_id: string
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          decision_type: Database["public"]["Enums"]["decision_type"]
          facts_hash?: string | null
          gaps_hash?: string | null
          generated_at?: string
          generated_by?: string
          id?: string
          options_json: Json
          proposal_batch_id?: string
        }
        Update: {
          case_id?: string
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          decision_type?: Database["public"]["Enums"]["decision_type"]
          facts_hash?: string | null
          gaps_hash?: string | null
          generated_at?: string
          generated_by?: string
          id?: string
          options_json?: Json
          proposal_batch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_proposals_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "quote_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_zones: {
        Row: {
          additional_days: number | null
          country: string
          created_at: string | null
          distance_from_port_km: number
          example_cities: string[] | null
          id: string
          is_active: boolean | null
          is_transit: boolean | null
          multiplier: number
          requires_special_permit: boolean | null
          zone_code: string
          zone_name: string
        }
        Insert: {
          additional_days?: number | null
          country?: string
          created_at?: string | null
          distance_from_port_km?: number
          example_cities?: string[] | null
          id?: string
          is_active?: boolean | null
          is_transit?: boolean | null
          multiplier?: number
          requires_special_permit?: boolean | null
          zone_code: string
          zone_name: string
        }
        Update: {
          additional_days?: number | null
          country?: string
          created_at?: string | null
          distance_from_port_km?: number
          example_cities?: string[] | null
          id?: string
          is_active?: boolean | null
          is_transit?: boolean | null
          multiplier?: number
          requires_special_permit?: boolean | null
          zone_code?: string
          zone_name?: string
        }
        Relationships: []
      }
      demurrage_rates: {
        Row: {
          carrier: string
          container_type: string
          created_at: string | null
          currency: string
          day_1_7_rate: number
          day_15_plus_rate: number
          day_8_14_rate: number
          effective_date: string
          expiry_date: string | null
          free_days_export: number
          free_days_import: number
          id: string
          is_active: boolean | null
          notes: string | null
          source_document: string | null
          updated_at: string | null
        }
        Insert: {
          carrier: string
          container_type?: string
          created_at?: string | null
          currency?: string
          day_1_7_rate?: number
          day_15_plus_rate?: number
          day_8_14_rate?: number
          effective_date?: string
          expiry_date?: string | null
          free_days_export?: number
          free_days_import?: number
          id?: string
          is_active?: boolean | null
          notes?: string | null
          source_document?: string | null
          updated_at?: string | null
        }
        Update: {
          carrier?: string
          container_type?: string
          created_at?: string | null
          currency?: string
          day_1_7_rate?: number
          day_15_plus_rate?: number
          day_8_14_rate?: number
          effective_date?: string
          expiry_date?: string | null
          free_days_export?: number
          free_days_import?: number
          id?: string
          is_active?: boolean | null
          notes?: string | null
          source_document?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      destination_terminal_rates: {
        Row: {
          calculation_method: string | null
          charge_code: string
          charge_name: string
          country: string
          created_at: string | null
          currency: string | null
          effective_date: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          rate_fixed: number | null
          rate_per_cnt: number | null
          rate_per_tonne: number | null
          rate_per_truck: number | null
          source_document: string | null
          terminal_name: string
        }
        Insert: {
          calculation_method?: string | null
          charge_code: string
          charge_name: string
          country: string
          created_at?: string | null
          currency?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          rate_fixed?: number | null
          rate_per_cnt?: number | null
          rate_per_tonne?: number | null
          rate_per_truck?: number | null
          source_document?: string | null
          terminal_name: string
        }
        Update: {
          calculation_method?: string | null
          charge_code?: string
          charge_name?: string
          country?: string
          created_at?: string | null
          currency?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          rate_fixed?: number | null
          rate_per_cnt?: number | null
          rate_per_tonne?: number | null
          rate_per_truck?: number | null
          source_document?: string | null
          terminal_name?: string
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
          created_by: string | null
          id: string
          original_email_id: string | null
          quotation_version_id: string | null
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
          created_by?: string | null
          id?: string
          original_email_id?: string | null
          quotation_version_id?: string | null
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
          created_by?: string | null
          id?: string
          original_email_id?: string | null
          quotation_version_id?: string | null
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
          {
            foreignKeyName: "email_drafts_quotation_version_id_fkey"
            columns: ["quotation_version_id"]
            isOneToOne: false
            referencedRelation: "quotation_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_version_fk"
            columns: ["quotation_version_id"]
            isOneToOne: false
            referencedRelation: "quotation_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          client_company: string | null
          client_email: string | null
          created_at: string | null
          email_count: number | null
          first_message_at: string | null
          id: string
          is_quotation_thread: boolean | null
          last_message_at: string | null
          our_role: string | null
          participants: Json | null
          partner_email: string | null
          project_name: string | null
          status: string | null
          subject_normalized: string
          updated_at: string | null
        }
        Insert: {
          client_company?: string | null
          client_email?: string | null
          created_at?: string | null
          email_count?: number | null
          first_message_at?: string | null
          id?: string
          is_quotation_thread?: boolean | null
          last_message_at?: string | null
          our_role?: string | null
          participants?: Json | null
          partner_email?: string | null
          project_name?: string | null
          status?: string | null
          subject_normalized: string
          updated_at?: string | null
        }
        Update: {
          client_company?: string | null
          client_email?: string | null
          created_at?: string | null
          email_count?: number | null
          first_message_at?: string | null
          id?: string
          is_quotation_thread?: boolean | null
          last_message_at?: string | null
          our_role?: string | null
          participants?: Json | null
          partner_email?: string | null
          project_name?: string | null
          status?: string | null
          subject_normalized?: string
          updated_at?: string | null
        }
        Relationships: []
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
          thread_ref: string | null
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
          thread_ref?: string | null
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
          thread_ref?: string | null
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
          {
            foreignKeyName: "emails_thread_ref_fkey"
            columns: ["thread_ref"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      exceptional_transport_categories: {
        Row: {
          authorization_required: boolean | null
          category_id: string
          category_name: string
          created_at: string | null
          escort_type: string
          estimated_escort_cost_fcfa: number | null
          id: string
          length_max_m: number | null
          length_min_m: number | null
          notes: string | null
          weight_max_t: number | null
          weight_min_t: number | null
          width_max_m: number | null
          width_min_m: number | null
        }
        Insert: {
          authorization_required?: boolean | null
          category_id: string
          category_name: string
          created_at?: string | null
          escort_type: string
          estimated_escort_cost_fcfa?: number | null
          id?: string
          length_max_m?: number | null
          length_min_m?: number | null
          notes?: string | null
          weight_max_t?: number | null
          weight_min_t?: number | null
          width_max_m?: number | null
          width_min_m?: number | null
        }
        Update: {
          authorization_required?: boolean | null
          category_id?: string
          category_name?: string
          created_at?: string | null
          escort_type?: string
          estimated_escort_cost_fcfa?: number | null
          id?: string
          length_max_m?: number | null
          length_min_m?: number | null
          notes?: string | null
          weight_max_t?: number | null
          weight_min_t?: number | null
          width_max_m?: number | null
          width_min_m?: number | null
        }
        Relationships: []
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
      fuel_price_tracking: {
        Row: {
          country: string
          created_at: string | null
          currency: string | null
          fuel_type: string | null
          id: string
          is_crisis_price: boolean | null
          notes: string | null
          price_per_liter: number
          recorded_date: string
          source: string | null
        }
        Insert: {
          country: string
          created_at?: string | null
          currency?: string | null
          fuel_type?: string | null
          id?: string
          is_crisis_price?: boolean | null
          notes?: string | null
          price_per_liter: number
          recorded_date: string
          source?: string | null
        }
        Update: {
          country?: string
          created_at?: string | null
          currency?: string | null
          fuel_type?: string | null
          id?: string
          is_crisis_price?: boolean | null
          notes?: string | null
          price_per_liter?: number
          recorded_date?: string
          source?: string | null
        }
        Relationships: []
      }
      historical_quotation_lines: {
        Row: {
          amount: number | null
          bloc: string | null
          category: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          id: string
          quotation_id: string
          source_type: string | null
        }
        Insert: {
          amount?: number | null
          bloc?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          quotation_id: string
          source_type?: string | null
        }
        Update: {
          amount?: number | null
          bloc?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          quotation_id?: string
          source_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_quotation_lines_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "historical_quotation_profiles"
            referencedColumns: ["quotation_id"]
          },
          {
            foreignKeyName: "historical_quotation_lines_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "historical_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_quotation_metadata: {
        Row: {
          carrier: string | null
          container_count: number | null
          container_types: string[] | null
          created_at: string | null
          hs_code: string | null
          id: string
          notes: string | null
          quotation_id: string
          special_flags: Json | null
        }
        Insert: {
          carrier?: string | null
          container_count?: number | null
          container_types?: string[] | null
          created_at?: string | null
          hs_code?: string | null
          id?: string
          notes?: string | null
          quotation_id: string
          special_flags?: Json | null
        }
        Update: {
          carrier?: string | null
          container_count?: number | null
          container_types?: string[] | null
          created_at?: string | null
          hs_code?: string | null
          id?: string
          notes?: string | null
          quotation_id?: string
          special_flags?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_quotation_metadata_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "historical_quotation_profiles"
            referencedColumns: ["quotation_id"]
          },
          {
            foreignKeyName: "historical_quotation_metadata_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "historical_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_quotations: {
        Row: {
          cargo_description: string | null
          client_name: string | null
          created_at: string | null
          currency: string | null
          destination_country: string | null
          final_destination: string | null
          id: string
          incoterm: string | null
          is_transit: boolean | null
          origin_country: string | null
          source_reference: string | null
          source_type: string
          total_value: number | null
          total_volume_cbm: number | null
          total_weight_kg: number | null
          transport_mode: string | null
        }
        Insert: {
          cargo_description?: string | null
          client_name?: string | null
          created_at?: string | null
          currency?: string | null
          destination_country?: string | null
          final_destination?: string | null
          id?: string
          incoterm?: string | null
          is_transit?: boolean | null
          origin_country?: string | null
          source_reference?: string | null
          source_type: string
          total_value?: number | null
          total_volume_cbm?: number | null
          total_weight_kg?: number | null
          transport_mode?: string | null
        }
        Update: {
          cargo_description?: string | null
          client_name?: string | null
          created_at?: string | null
          currency?: string | null
          destination_country?: string | null
          final_destination?: string | null
          id?: string
          incoterm?: string | null
          is_transit?: boolean | null
          origin_country?: string | null
          source_reference?: string | null
          source_type?: string
          total_value?: number | null
          total_volume_cbm?: number | null
          total_weight_kg?: number | null
          transport_mode?: string | null
        }
        Relationships: []
      }
      holidays_pad: {
        Row: {
          created_at: string | null
          holiday_date: string
          id: string
          is_recurring: boolean | null
          name_en: string | null
          name_fr: string
        }
        Insert: {
          created_at?: string | null
          holiday_date: string
          id?: string
          is_recurring?: boolean | null
          name_en?: string | null
          name_fr: string
        }
        Update: {
          created_at?: string | null
          holiday_date?: string
          id?: string
          is_recurring?: boolean | null
          name_en?: string | null
          name_fr?: string
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
      imo_classes: {
        Row: {
          class_code: string
          created_at: string
          description: string | null
          division: string | null
          examples: string[] | null
          handling_notes: string | null
          id: string
          max_stacking_height: number | null
          name_en: string
          name_fr: string
          placard_required: boolean
          port_surcharge_percent: number
          requires_imo_declaration: boolean
          requires_msds: boolean
          requires_segregation: boolean
          requires_special_storage: boolean
          storage_surcharge_percent: number
        }
        Insert: {
          class_code: string
          created_at?: string
          description?: string | null
          division?: string | null
          examples?: string[] | null
          handling_notes?: string | null
          id?: string
          max_stacking_height?: number | null
          name_en: string
          name_fr: string
          placard_required?: boolean
          port_surcharge_percent?: number
          requires_imo_declaration?: boolean
          requires_msds?: boolean
          requires_segregation?: boolean
          requires_special_storage?: boolean
          storage_surcharge_percent?: number
        }
        Update: {
          class_code?: string
          created_at?: string
          description?: string | null
          division?: string | null
          examples?: string[] | null
          handling_notes?: string | null
          id?: string
          max_stacking_height?: number | null
          name_en?: string
          name_fr?: string
          placard_required?: boolean
          port_surcharge_percent?: number
          requires_imo_declaration?: boolean
          requires_msds?: boolean
          requires_segregation?: boolean
          requires_special_storage?: boolean
          storage_surcharge_percent?: number
        }
        Relationships: []
      }
      incoterms_reference: {
        Row: {
          buyer_pays_import_customs: boolean
          caf_calculation_method: string | null
          code: string
          created_at: string | null
          group_name: string
          id: string
          name_en: string
          name_fr: string
          notes_en: string | null
          notes_fr: string | null
          seller_pays_export_customs: boolean
          seller_pays_insurance: boolean
          seller_pays_loading: boolean
          seller_pays_transport: boolean
          seller_pays_unloading: boolean
          transfer_risk_point: string
          transport_modes: string
        }
        Insert: {
          buyer_pays_import_customs?: boolean
          caf_calculation_method?: string | null
          code: string
          created_at?: string | null
          group_name: string
          id?: string
          name_en: string
          name_fr: string
          notes_en?: string | null
          notes_fr?: string | null
          seller_pays_export_customs?: boolean
          seller_pays_insurance?: boolean
          seller_pays_loading?: boolean
          seller_pays_transport?: boolean
          seller_pays_unloading?: boolean
          transfer_risk_point: string
          transport_modes: string
        }
        Update: {
          buyer_pays_import_customs?: boolean
          caf_calculation_method?: string | null
          code?: string
          created_at?: string | null
          group_name?: string
          id?: string
          name_en?: string
          name_fr?: string
          notes_en?: string | null
          notes_fr?: string | null
          seller_pays_export_customs?: boolean
          seller_pays_insurance?: boolean
          seller_pays_loading?: boolean
          seller_pays_transport?: boolean
          seller_pays_unloading?: boolean
          transfer_risk_point?: string
          transport_modes?: string
        }
        Relationships: []
      }
      known_business_contacts: {
        Row: {
          company_name: string
          country: string | null
          created_at: string | null
          default_role: string
          domain_pattern: string
          id: string
          is_active: boolean | null
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          company_name: string
          country?: string | null
          created_at?: string | null
          default_role: string
          domain_pattern: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          company_name?: string
          country?: string | null
          created_at?: string | null
          default_role?: string
          domain_pattern?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
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
          knowledge_type: string | null
          last_used_at: string | null
          matching_criteria: Json | null
          name: string
          source_id: string | null
          source_type: string | null
          updated_at: string | null
          usage_count: number | null
          valid_until: string | null
        }
        Insert: {
          category: string
          confidence?: number | null
          created_at?: string | null
          data: Json
          description?: string | null
          id?: string
          is_validated?: boolean | null
          knowledge_type?: string | null
          last_used_at?: string | null
          matching_criteria?: Json | null
          name: string
          source_id?: string | null
          source_type?: string | null
          updated_at?: string | null
          usage_count?: number | null
          valid_until?: string | null
        }
        Update: {
          category?: string
          confidence?: number | null
          created_at?: string | null
          data?: Json
          description?: string | null
          id?: string
          is_validated?: boolean | null
          knowledge_type?: string | null
          last_used_at?: string | null
          matching_criteria?: Json | null
          name?: string
          source_id?: string | null
          source_type?: string | null
          updated_at?: string | null
          usage_count?: number | null
          valid_until?: string | null
        }
        Relationships: []
      }
      lifting_equipment: {
        Row: {
          axle_count: number | null
          boom_length_m: number | null
          brand: string
          capacity_at_radius_t: Json | null
          capacity_t: number
          category: string
          created_at: string | null
          equipment_id: string
          id: string
          is_available_port_dakar: boolean | null
          is_available_west_africa: boolean | null
          max_height_m: number | null
          min_radius_m: number | null
          model: string
          notes: string | null
          origin_country: string | null
          price_category: string | null
          reach_rows: number | null
          stacking_height: number | null
        }
        Insert: {
          axle_count?: number | null
          boom_length_m?: number | null
          brand: string
          capacity_at_radius_t?: Json | null
          capacity_t: number
          category: string
          created_at?: string | null
          equipment_id: string
          id?: string
          is_available_port_dakar?: boolean | null
          is_available_west_africa?: boolean | null
          max_height_m?: number | null
          min_radius_m?: number | null
          model: string
          notes?: string | null
          origin_country?: string | null
          price_category?: string | null
          reach_rows?: number | null
          stacking_height?: number | null
        }
        Update: {
          axle_count?: number | null
          boom_length_m?: number | null
          brand?: string
          capacity_at_radius_t?: Json | null
          capacity_t?: number
          category?: string
          created_at?: string | null
          equipment_id?: string
          id?: string
          is_available_port_dakar?: boolean | null
          is_available_west_africa?: boolean | null
          max_height_m?: number | null
          min_radius_m?: number | null
          model?: string
          notes?: string | null
          origin_country?: string | null
          price_category?: string | null
          reach_rows?: number | null
          stacking_height?: number | null
        }
        Relationships: []
      }
      local_transport_rates: {
        Row: {
          cargo_category: string | null
          container_type: string
          created_at: string | null
          destination: string
          id: string
          is_active: boolean | null
          notes: string | null
          origin: string
          provider: string | null
          rate_amount: number
          rate_currency: string | null
          rate_includes: string[] | null
          source_document: string | null
          updated_at: string | null
          validity_end: string | null
          validity_start: string | null
        }
        Insert: {
          cargo_category?: string | null
          container_type: string
          created_at?: string | null
          destination: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          origin?: string
          provider?: string | null
          rate_amount: number
          rate_currency?: string | null
          rate_includes?: string[] | null
          source_document?: string | null
          updated_at?: string | null
          validity_end?: string | null
          validity_start?: string | null
        }
        Update: {
          cargo_category?: string | null
          container_type?: string
          created_at?: string | null
          destination?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          origin?: string
          provider?: string | null
          rate_amount?: number
          rate_currency?: string | null
          rate_includes?: string[] | null
          source_document?: string | null
          updated_at?: string | null
          validity_end?: string | null
          validity_start?: string | null
        }
        Relationships: []
      }
      mali_transport_zones: {
        Row: {
          alternative_route: string | null
          alternative_route_km: number | null
          country: string | null
          created_at: string | null
          distance_from_dakar_km: number
          estimated_transit_days: number | null
          id: string
          is_accessible: boolean | null
          last_security_update: string | null
          region: string
          route_description: string | null
          security_level: string | null
          security_surcharge_percent: number | null
          updated_at: string | null
          zone_name: string
        }
        Insert: {
          alternative_route?: string | null
          alternative_route_km?: number | null
          country?: string | null
          created_at?: string | null
          distance_from_dakar_km: number
          estimated_transit_days?: number | null
          id?: string
          is_accessible?: boolean | null
          last_security_update?: string | null
          region: string
          route_description?: string | null
          security_level?: string | null
          security_surcharge_percent?: number | null
          updated_at?: string | null
          zone_name: string
        }
        Update: {
          alternative_route?: string | null
          alternative_route_km?: number | null
          country?: string | null
          created_at?: string | null
          distance_from_dakar_km?: number
          estimated_transit_days?: number | null
          id?: string
          is_accessible?: boolean | null
          last_security_update?: string | null
          region?: string
          route_description?: string | null
          security_level?: string | null
          security_surcharge_percent?: number | null
          updated_at?: string | null
          zone_name?: string
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
      operational_costs_senegal: {
        Row: {
          amount: number | null
          calculation_base: string | null
          condition_text: string | null
          cost_id: string
          cost_type: string
          created_at: string | null
          effective_date: string | null
          id: string
          is_active: boolean | null
          max_amount: number | null
          min_amount: number | null
          name_fr: string
          notes: string | null
          source: string | null
          unit: string
        }
        Insert: {
          amount?: number | null
          calculation_base?: string | null
          condition_text?: string | null
          cost_id: string
          cost_type: string
          created_at?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          name_fr: string
          notes?: string | null
          source?: string | null
          unit: string
        }
        Update: {
          amount?: number | null
          calculation_base?: string | null
          condition_text?: string | null
          cost_id?: string
          cost_type?: string
          created_at?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          name_fr?: string
          notes?: string | null
          source?: string | null
          unit?: string
        }
        Relationships: []
      }
      operator_decisions: {
        Row: {
          case_id: string
          created_at: string
          decided_at: string
          decided_by: string
          decision_type: Database["public"]["Enums"]["decision_type"]
          decision_version: number | null
          facts_hash: string | null
          gaps_hash: string | null
          id: string
          idempotency_key: string | null
          is_final: boolean
          override_reason: string | null
          override_value: string | null
          proposal_id: string
          selected_key: string
          superseded_by: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          decided_at?: string
          decided_by: string
          decision_type: Database["public"]["Enums"]["decision_type"]
          decision_version?: number | null
          facts_hash?: string | null
          gaps_hash?: string | null
          id?: string
          idempotency_key?: string | null
          is_final?: boolean
          override_reason?: string | null
          override_value?: string | null
          proposal_id: string
          selected_key: string
          superseded_by?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          decided_at?: string
          decided_by?: string
          decision_type?: Database["public"]["Enums"]["decision_type"]
          decision_version?: number | null
          facts_hash?: string | null
          gaps_hash?: string | null
          id?: string
          idempotency_key?: string | null
          is_final?: boolean
          override_reason?: string | null
          override_value?: string | null
          proposal_id?: string
          selected_key?: string
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_decisions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "quote_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_decisions_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "decision_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_decisions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "operator_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      port_tariffs: {
        Row: {
          amount: number
          cargo_type: string | null
          category: string
          classification: string
          created_at: string | null
          effective_date: string
          expiry_date: string | null
          id: string
          is_active: boolean | null
          operation_type: string
          provider: string
          source_document: string | null
          surcharge_conditions: string | null
          surcharge_percent: number | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          cargo_type?: string | null
          category: string
          classification: string
          created_at?: string | null
          effective_date: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean | null
          operation_type: string
          provider: string
          source_document?: string | null
          surcharge_conditions?: string | null
          surcharge_percent?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          cargo_type?: string | null
          category?: string
          classification?: string
          created_at?: string | null
          effective_date?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean | null
          operation_type?: string
          provider?: string
          source_document?: string | null
          surcharge_conditions?: string | null
          surcharge_percent?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pricing_runs: {
        Row: {
          case_id: string
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          duration_ms: number | null
          engine_request: Json | null
          engine_response: Json | null
          engine_version: string | null
          error_message: string | null
          facts_snapshot: Json
          id: string
          inputs_json: Json
          outputs_json: Json | null
          run_number: number
          started_at: string | null
          status: string | null
          tariff_lines: Json | null
          tariff_sources: Json | null
          total_ht: number | null
          total_ttc: number | null
        }
        Insert: {
          case_id: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          duration_ms?: number | null
          engine_request?: Json | null
          engine_response?: Json | null
          engine_version?: string | null
          error_message?: string | null
          facts_snapshot: Json
          id?: string
          inputs_json: Json
          outputs_json?: Json | null
          run_number?: number
          started_at?: string | null
          status?: string | null
          tariff_lines?: Json | null
          tariff_sources?: Json | null
          total_ht?: number | null
          total_ttc?: number | null
        }
        Update: {
          case_id?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          duration_ms?: number | null
          engine_request?: Json | null
          engine_response?: Json | null
          engine_version?: string | null
          error_message?: string | null
          facts_snapshot?: Json
          id?: string
          inputs_json?: Json
          outputs_json?: Json | null
          run_number?: number
          started_at?: string | null
          status?: string | null
          tariff_lines?: Json | null
          tariff_sources?: Json | null
          total_ht?: number | null
          total_ttc?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_runs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "quote_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      puzzle_jobs: {
        Row: {
          attachment_count: number | null
          attempt: number | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          current_phase: string | null
          duration_ms: number | null
          email_count: number | null
          email_id: string | null
          emails_analyzed_ids: string[] | null
          error_message: string | null
          error_phase: string | null
          final_puzzle: Json | null
          id: string
          knowledge_stored: number | null
          last_heartbeat: string | null
          partial_results: Json | null
          phases_completed: string[] | null
          progress: number | null
          started_at: string | null
          status: string
          thread_id: string
        }
        Insert: {
          attachment_count?: number | null
          attempt?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_phase?: string | null
          duration_ms?: number | null
          email_count?: number | null
          email_id?: string | null
          emails_analyzed_ids?: string[] | null
          error_message?: string | null
          error_phase?: string | null
          final_puzzle?: Json | null
          id?: string
          knowledge_stored?: number | null
          last_heartbeat?: string | null
          partial_results?: Json | null
          phases_completed?: string[] | null
          progress?: number | null
          started_at?: string | null
          status?: string
          thread_id: string
        }
        Update: {
          attachment_count?: number | null
          attempt?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_phase?: string | null
          duration_ms?: number | null
          email_count?: number | null
          email_id?: string | null
          emails_analyzed_ids?: string[] | null
          error_message?: string | null
          error_phase?: string | null
          final_puzzle?: Json | null
          id?: string
          knowledge_stored?: number | null
          last_heartbeat?: string | null
          partial_results?: Json | null
          phases_completed?: string[] | null
          progress?: number | null
          started_at?: string | null
          status?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "puzzle_jobs_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puzzle_jobs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_clauses: {
        Row: {
          clause_code: string
          clause_content: string
          clause_title: string
          created_at: string | null
          destination_type: string
          id: string
          is_active: boolean | null
          is_exclusion: boolean | null
          is_warning: boolean | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          clause_code: string
          clause_content: string
          clause_title: string
          created_at?: string | null
          destination_type: string
          id?: string
          is_active?: boolean | null
          is_exclusion?: boolean | null
          is_warning?: boolean | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          clause_code?: string
          clause_content?: string
          clause_title?: string
          created_at?: string | null
          destination_type?: string
          id?: string
          is_active?: boolean | null
          is_exclusion?: boolean | null
          is_warning?: boolean | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      quotation_documents: {
        Row: {
          created_at: string | null
          created_by: string | null
          document_type: string
          file_hash: string | null
          file_path: string
          file_size: number | null
          id: string
          quotation_id: string | null
          quotation_version_id: string | null
          root_quotation_id: string | null
          status: string
          version: number
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          document_type: string
          file_hash?: string | null
          file_path: string
          file_size?: number | null
          id?: string
          quotation_id?: string | null
          quotation_version_id?: string | null
          root_quotation_id?: string | null
          status: string
          version: number
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          document_type?: string
          file_hash?: string | null
          file_path?: string
          file_size?: number | null
          id?: string
          quotation_id?: string | null
          quotation_version_id?: string | null
          root_quotation_id?: string | null
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_documents_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotation_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_documents_quotation_version_id_fkey"
            columns: ["quotation_version_id"]
            isOneToOne: false
            referencedRelation: "quotation_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_history: {
        Row: {
          cargo_type: string
          client_company: string | null
          client_name: string | null
          container_types: string[] | null
          created_at: string
          created_by: string
          generated_at: string | null
          generated_snapshot: Json | null
          id: string
          incoterm: string | null
          margin_percent: number | null
          parent_quotation_id: string | null
          partner_company: string | null
          project_name: string | null
          quotation_lines: Json | null
          regulatory_info: Json | null
          root_quotation_id: string | null
          route_destination: string
          route_hash: string | null
          route_origin: string | null
          route_port: string
          source_attachment_id: string | null
          source_breakdown: Json | null
          source_email_id: string | null
          status: string | null
          tariff_lines: Json
          total_amount: number | null
          total_currency: string | null
          updated_at: string
          version: number | null
          was_accepted: boolean | null
        }
        Insert: {
          cargo_type: string
          client_company?: string | null
          client_name?: string | null
          container_types?: string[] | null
          created_at?: string
          created_by?: string
          generated_at?: string | null
          generated_snapshot?: Json | null
          id?: string
          incoterm?: string | null
          margin_percent?: number | null
          parent_quotation_id?: string | null
          partner_company?: string | null
          project_name?: string | null
          quotation_lines?: Json | null
          regulatory_info?: Json | null
          root_quotation_id?: string | null
          route_destination: string
          route_hash?: string | null
          route_origin?: string | null
          route_port?: string
          source_attachment_id?: string | null
          source_breakdown?: Json | null
          source_email_id?: string | null
          status?: string | null
          tariff_lines?: Json
          total_amount?: number | null
          total_currency?: string | null
          updated_at?: string
          version?: number | null
          was_accepted?: boolean | null
        }
        Update: {
          cargo_type?: string
          client_company?: string | null
          client_name?: string | null
          container_types?: string[] | null
          created_at?: string
          created_by?: string
          generated_at?: string | null
          generated_snapshot?: Json | null
          id?: string
          incoterm?: string | null
          margin_percent?: number | null
          parent_quotation_id?: string | null
          partner_company?: string | null
          project_name?: string | null
          quotation_lines?: Json | null
          regulatory_info?: Json | null
          root_quotation_id?: string | null
          route_destination?: string
          route_hash?: string | null
          route_origin?: string | null
          route_port?: string
          source_attachment_id?: string | null
          source_breakdown?: Json | null
          source_email_id?: string | null
          status?: string | null
          tariff_lines?: Json
          total_amount?: number | null
          total_currency?: string | null
          updated_at?: string
          version?: number | null
          was_accepted?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_history_parent_quotation_id_fkey"
            columns: ["parent_quotation_id"]
            isOneToOne: false
            referencedRelation: "quotation_history"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_version_lines: {
        Row: {
          amount: number
          breakdown: Json | null
          created_at: string
          currency: string
          description: string | null
          id: string
          line_order: number
          quantity: number
          quotation_version_id: string
          service_code: string
          unit_price: number
        }
        Insert: {
          amount?: number
          breakdown?: Json | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          line_order?: number
          quantity?: number
          quotation_version_id: string
          service_code: string
          unit_price?: number
        }
        Update: {
          amount?: number
          breakdown?: Json | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          line_order?: number
          quantity?: number
          quotation_version_id?: string
          service_code?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_version_lines_quotation_version_id_fkey"
            columns: ["quotation_version_id"]
            isOneToOne: false
            referencedRelation: "quotation_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_versions: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          id: string
          is_selected: boolean
          pricing_run_id: string
          snapshot: Json
          status: string
          version_number: number
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_selected?: boolean
          pricing_run_id: string
          snapshot: Json
          status?: string
          version_number?: number
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_selected?: boolean
          pricing_run_id?: string
          snapshot?: Json
          status?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_versions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "quote_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_versions_pricing_run_id_fkey"
            columns: ["pricing_run_id"]
            isOneToOne: false
            referencedRelation: "pricing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_cases: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          created_by: string | null
          facts_count: number | null
          gaps_count: number | null
          id: string
          last_activity_at: string | null
          last_email_seen_at: string | null
          pricing_runs_count: number | null
          priority: string | null
          puzzle_completeness: number | null
          request_type: Database["public"]["Enums"]["quote_request_type"] | null
          status: Database["public"]["Enums"]["quote_case_status"]
          thread_id: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          created_by?: string | null
          facts_count?: number | null
          gaps_count?: number | null
          id?: string
          last_activity_at?: string | null
          last_email_seen_at?: string | null
          pricing_runs_count?: number | null
          priority?: string | null
          puzzle_completeness?: number | null
          request_type?:
            | Database["public"]["Enums"]["quote_request_type"]
            | null
          status?: Database["public"]["Enums"]["quote_case_status"]
          thread_id: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          created_by?: string | null
          facts_count?: number | null
          gaps_count?: number | null
          id?: string
          last_activity_at?: string | null
          last_email_seen_at?: string | null
          pricing_runs_count?: number | null
          priority?: string | null
          puzzle_completeness?: number | null
          request_type?:
            | Database["public"]["Enums"]["quote_request_type"]
            | null
          status?: Database["public"]["Enums"]["quote_case_status"]
          thread_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_cases_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_facts: {
        Row: {
          case_id: string
          confidence: number | null
          created_at: string | null
          fact_category: string
          fact_key: string
          id: string
          is_current: boolean | null
          is_validated: boolean | null
          source_attachment_id: string | null
          source_email_id: string | null
          source_excerpt: string | null
          source_type: string
          supersedes_fact_id: string | null
          updated_at: string | null
          validated_at: string | null
          validated_by: string | null
          value_date: string | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          case_id: string
          confidence?: number | null
          created_at?: string | null
          fact_category: string
          fact_key: string
          id?: string
          is_current?: boolean | null
          is_validated?: boolean | null
          source_attachment_id?: string | null
          source_email_id?: string | null
          source_excerpt?: string | null
          source_type: string
          supersedes_fact_id?: string | null
          updated_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
          value_date?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          case_id?: string
          confidence?: number | null
          created_at?: string | null
          fact_category?: string
          fact_key?: string
          id?: string
          is_current?: boolean | null
          is_validated?: boolean | null
          source_attachment_id?: string | null
          source_email_id?: string | null
          source_excerpt?: string | null
          source_type?: string
          supersedes_fact_id?: string | null
          updated_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
          value_date?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_facts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "quote_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_facts_source_attachment_id_fkey"
            columns: ["source_attachment_id"]
            isOneToOne: false
            referencedRelation: "email_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_facts_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_facts_supersedes_fact_id_fkey"
            columns: ["supersedes_fact_id"]
            isOneToOne: false
            referencedRelation: "quote_facts"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_gaps: {
        Row: {
          case_id: string
          clarification_sent_at: string | null
          created_at: string | null
          gap_category: string
          gap_key: string
          id: string
          is_blocking: boolean | null
          priority: string | null
          question_en: string | null
          question_fr: string
          resolved_at: string | null
          resolved_by_fact_id: string | null
          status: string | null
          updated_at: string | null
          waived_by: string | null
          waived_reason: string | null
        }
        Insert: {
          case_id: string
          clarification_sent_at?: string | null
          created_at?: string | null
          gap_category: string
          gap_key: string
          id?: string
          is_blocking?: boolean | null
          priority?: string | null
          question_en?: string | null
          question_fr: string
          resolved_at?: string | null
          resolved_by_fact_id?: string | null
          status?: string | null
          updated_at?: string | null
          waived_by?: string | null
          waived_reason?: string | null
        }
        Update: {
          case_id?: string
          clarification_sent_at?: string | null
          created_at?: string | null
          gap_category?: string
          gap_key?: string
          id?: string
          is_blocking?: boolean | null
          priority?: string | null
          question_en?: string | null
          question_fr?: string
          resolved_at?: string | null
          resolved_by_fact_id?: string | null
          status?: string | null
          updated_at?: string | null
          waived_by?: string | null
          waived_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_gaps_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "quote_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_gaps_resolved_by_fact_id_fkey"
            columns: ["resolved_by_fact_id"]
            isOneToOne: false
            referencedRelation: "quote_facts"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          function_name: string
          id: string
          request_count: number | null
          user_id: string
          window_start: string
        }
        Insert: {
          function_name: string
          id?: string
          request_count?: number | null
          user_id: string
          window_start: string
        }
        Update: {
          function_name?: string
          id?: string
          request_count?: number | null
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      runtime_events: {
        Row: {
          correlation_id: string | null
          duration_ms: number | null
          error_code: string | null
          function_name: string
          http_status: number | null
          id: string
          meta: Json | null
          op: string | null
          status: string | null
          ts: string | null
          user_id: string | null
        }
        Insert: {
          correlation_id?: string | null
          duration_ms?: number | null
          error_code?: string | null
          function_name: string
          http_status?: number | null
          id?: string
          meta?: Json | null
          op?: string | null
          status?: string | null
          ts?: string | null
          user_id?: string | null
        }
        Update: {
          correlation_id?: string | null
          duration_ms?: number | null
          error_code?: string | null
          function_name?: string
          http_status?: number | null
          id?: string
          meta?: Json | null
          op?: string | null
          status?: string | null
          ts?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      security_alerts: {
        Row: {
          affected_zones: string[] | null
          alert_level: string
          alert_type: string | null
          country: string
          created_at: string | null
          description: string | null
          effective_from: string
          effective_until: string | null
          id: string
          is_active: boolean | null
          recommended_action: string | null
          source_url: string | null
          title: string
        }
        Insert: {
          affected_zones?: string[] | null
          alert_level: string
          alert_type?: string | null
          country: string
          created_at?: string | null
          description?: string | null
          effective_from: string
          effective_until?: string | null
          id?: string
          is_active?: boolean | null
          recommended_action?: string | null
          source_url?: string | null
          title: string
        }
        Update: {
          affected_zones?: string[] | null
          alert_level?: string
          alert_type?: string | null
          country?: string
          created_at?: string | null
          description?: string | null
          effective_from?: string
          effective_until?: string | null
          id?: string
          is_active?: boolean | null
          recommended_action?: string | null
          source_url?: string | null
          title?: string
        }
        Relationships: []
      }
      sodatra_fee_rules: {
        Row: {
          base_amount: number
          calculation_method: string
          complexity_factors: Json | null
          created_at: string | null
          currency: string
          effective_date: string
          expiry_date: string | null
          fee_code: string
          id: string
          is_active: boolean | null
          max_amount: number | null
          min_amount: number | null
          notes: string | null
          rate_percent: number | null
          source_document: string | null
          transport_mode: string
          value_factor: number | null
        }
        Insert: {
          base_amount?: number
          calculation_method: string
          complexity_factors?: Json | null
          created_at?: string | null
          currency?: string
          effective_date?: string
          expiry_date?: string | null
          fee_code: string
          id?: string
          is_active?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          notes?: string | null
          rate_percent?: number | null
          source_document?: string | null
          transport_mode?: string
          value_factor?: number | null
        }
        Update: {
          base_amount?: number
          calculation_method?: string
          complexity_factors?: Json | null
          created_at?: string | null
          currency?: string
          effective_date?: string
          expiry_date?: string | null
          fee_code?: string
          id?: string
          is_active?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          notes?: string | null
          rate_percent?: number | null
          source_document?: string | null
          transport_mode?: string
          value_factor?: number | null
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
      tariff_category_rules: {
        Row: {
          carrier: string | null
          category_code: string
          category_name: string
          created_at: string | null
          id: string
          is_active: boolean | null
          match_patterns: string[]
          notes: string | null
          priority: number
          source_document: string
        }
        Insert: {
          carrier?: string | null
          category_code: string
          category_name: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          match_patterns?: string[]
          notes?: string | null
          priority?: number
          source_document: string
        }
        Update: {
          carrier?: string | null
          category_code?: string
          category_name?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          match_patterns?: string[]
          notes?: string | null
          priority?: number
          source_document?: string
        }
        Relationships: []
      }
      tariff_documents: {
        Row: {
          created_at: string | null
          document_type: string
          effective_date: string | null
          expiry_date: string | null
          filename: string
          id: string
          is_current: boolean | null
          notes: string | null
          provider: string
          storage_path: string | null
          version: string | null
        }
        Insert: {
          created_at?: string | null
          document_type: string
          effective_date?: string | null
          expiry_date?: string | null
          filename: string
          id?: string
          is_current?: boolean | null
          notes?: string | null
          provider: string
          storage_path?: string | null
          version?: string | null
        }
        Update: {
          created_at?: string | null
          document_type?: string
          effective_date?: string | null
          expiry_date?: string | null
          filename?: string
          id?: string
          is_current?: boolean | null
          notes?: string | null
          provider?: string
          storage_path?: string | null
          version?: string | null
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
      tender_contingents: {
        Row: {
          cargo_cbm: number | null
          cargo_readiness: string | null
          cargo_teus: number | null
          cargo_tonnes: number | null
          cargo_vehicles: number | null
          contingent_name: string
          created_at: string | null
          deadline_ddd: string | null
          destination_port: string | null
          destination_site: string | null
          id: string
          loading_date_pol: string | null
          margin_percent: number | null
          notes: string | null
          origin_location: string | null
          rfps_number: string | null
          segment_costs: Json | null
          selling_price: number | null
          status: string | null
          tender_id: string | null
          total_cost_estimate: number | null
          updated_at: string | null
        }
        Insert: {
          cargo_cbm?: number | null
          cargo_readiness?: string | null
          cargo_teus?: number | null
          cargo_tonnes?: number | null
          cargo_vehicles?: number | null
          contingent_name: string
          created_at?: string | null
          deadline_ddd?: string | null
          destination_port?: string | null
          destination_site?: string | null
          id?: string
          loading_date_pol?: string | null
          margin_percent?: number | null
          notes?: string | null
          origin_location?: string | null
          rfps_number?: string | null
          segment_costs?: Json | null
          selling_price?: number | null
          status?: string | null
          tender_id?: string | null
          total_cost_estimate?: number | null
          updated_at?: string | null
        }
        Update: {
          cargo_cbm?: number | null
          cargo_readiness?: string | null
          cargo_teus?: number | null
          cargo_tonnes?: number | null
          cargo_vehicles?: number | null
          contingent_name?: string
          created_at?: string | null
          deadline_ddd?: string | null
          destination_port?: string | null
          destination_site?: string | null
          id?: string
          loading_date_pol?: string | null
          margin_percent?: number | null
          notes?: string | null
          origin_location?: string | null
          rfps_number?: string | null
          segment_costs?: Json | null
          selling_price?: number | null
          status?: string | null
          tender_id?: string | null
          total_cost_estimate?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_contingents_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tender_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_projects: {
        Row: {
          cargo_summary: Json | null
          client: string | null
          created_at: string | null
          deadline: string | null
          id: string
          notes: string | null
          origin_country: string | null
          reference: string
          source_attachment_id: string | null
          source_email_id: string | null
          status: string | null
          tender_type: string | null
          updated_at: string | null
        }
        Insert: {
          cargo_summary?: Json | null
          client?: string | null
          created_at?: string | null
          deadline?: string | null
          id?: string
          notes?: string | null
          origin_country?: string | null
          reference: string
          source_attachment_id?: string | null
          source_email_id?: string | null
          status?: string | null
          tender_type?: string | null
          updated_at?: string | null
        }
        Update: {
          cargo_summary?: Json | null
          client?: string | null
          created_at?: string | null
          deadline?: string | null
          id?: string
          notes?: string | null
          origin_country?: string | null
          reference?: string
          source_attachment_id?: string | null
          source_email_id?: string | null
          status?: string | null
          tender_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_projects_source_attachment_id_fkey"
            columns: ["source_attachment_id"]
            isOneToOne: false
            referencedRelation: "email_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_projects_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_segments: {
        Row: {
          additional_charges: Json | null
          created_at: string | null
          currency: string | null
          destination_location: string
          exclusions: string[] | null
          id: string
          inclusions: string[] | null
          notes: string | null
          origin_location: string
          partner_company: string | null
          partner_email: string | null
          rate_per_unit: number | null
          rate_unit: string | null
          segment_order: number
          segment_type: string
          source_email_id: string | null
          source_learned_knowledge_id: string | null
          status: string | null
          tender_id: string | null
          updated_at: string | null
        }
        Insert: {
          additional_charges?: Json | null
          created_at?: string | null
          currency?: string | null
          destination_location: string
          exclusions?: string[] | null
          id?: string
          inclusions?: string[] | null
          notes?: string | null
          origin_location: string
          partner_company?: string | null
          partner_email?: string | null
          rate_per_unit?: number | null
          rate_unit?: string | null
          segment_order?: number
          segment_type: string
          source_email_id?: string | null
          source_learned_knowledge_id?: string | null
          status?: string | null
          tender_id?: string | null
          updated_at?: string | null
        }
        Update: {
          additional_charges?: Json | null
          created_at?: string | null
          currency?: string | null
          destination_location?: string
          exclusions?: string[] | null
          id?: string
          inclusions?: string[] | null
          notes?: string | null
          origin_location?: string
          partner_company?: string | null
          partner_email?: string | null
          rate_per_unit?: number | null
          rate_unit?: string | null
          segment_order?: number
          segment_type?: string
          source_email_id?: string | null
          source_learned_knowledge_id?: string | null
          status?: string | null
          tender_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_segments_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_segments_source_learned_knowledge_id_fkey"
            columns: ["source_learned_knowledge_id"]
            isOneToOne: false
            referencedRelation: "learned_knowledge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_segments_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tender_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      trailer_types: {
        Row: {
          axle_count_max: number | null
          axle_count_min: number | null
          category: string
          container_compatible: string[] | null
          created_at: string | null
          deck_height_m: number | null
          gooseneck_type: string | null
          id: string
          internal_height_m: number | null
          is_available_senegal: boolean | null
          length_extended_m: number | null
          length_m: number | null
          payload_max_t: number | null
          payload_min_t: number | null
          requires_escort_if_width_gt_m: number | null
          requires_permit_if_weight_gt_t: number | null
          subtype: string | null
          trailer_id: string
          type_name: string
          usage_description: string | null
          volume_m3: number | null
          width_m: number | null
        }
        Insert: {
          axle_count_max?: number | null
          axle_count_min?: number | null
          category: string
          container_compatible?: string[] | null
          created_at?: string | null
          deck_height_m?: number | null
          gooseneck_type?: string | null
          id?: string
          internal_height_m?: number | null
          is_available_senegal?: boolean | null
          length_extended_m?: number | null
          length_m?: number | null
          payload_max_t?: number | null
          payload_min_t?: number | null
          requires_escort_if_width_gt_m?: number | null
          requires_permit_if_weight_gt_t?: number | null
          subtype?: string | null
          trailer_id: string
          type_name: string
          usage_description?: string | null
          volume_m3?: number | null
          width_m?: number | null
        }
        Update: {
          axle_count_max?: number | null
          axle_count_min?: number | null
          category?: string
          container_compatible?: string[] | null
          created_at?: string | null
          deck_height_m?: number | null
          gooseneck_type?: string | null
          id?: string
          internal_height_m?: number | null
          is_available_senegal?: boolean | null
          length_extended_m?: number | null
          length_m?: number | null
          payload_max_t?: number | null
          payload_min_t?: number | null
          requires_escort_if_width_gt_m?: number | null
          requires_permit_if_weight_gt_t?: number | null
          subtype?: string | null
          trailer_id?: string
          type_name?: string
          usage_description?: string | null
          volume_m3?: number | null
          width_m?: number | null
        }
        Relationships: []
      }
      transport_rate_formula: {
        Row: {
          base_rate_per_km: number
          container_type: string
          corridor: string
          created_at: string | null
          effective_date: string
          expiry_date: string | null
          fixed_costs: number | null
          fuel_reference_price: number | null
          id: string
          includes_return: boolean | null
          is_active: boolean | null
          notes: string | null
          source: string | null
        }
        Insert: {
          base_rate_per_km: number
          container_type: string
          corridor: string
          created_at?: string | null
          effective_date: string
          expiry_date?: string | null
          fixed_costs?: number | null
          fuel_reference_price?: number | null
          id?: string
          includes_return?: boolean | null
          is_active?: boolean | null
          notes?: string | null
          source?: string | null
        }
        Update: {
          base_rate_per_km?: number
          container_type?: string
          corridor?: string
          created_at?: string | null
          effective_date?: string
          expiry_date?: string | null
          fixed_costs?: number | null
          fuel_reference_price?: number | null
          id?: string
          includes_return?: boolean | null
          is_active?: boolean | null
          notes?: string | null
          source?: string | null
        }
        Relationships: []
      }
      transport_regulations: {
        Row: {
          action_if_exceeded: string | null
          category: string
          created_at: string | null
          id: string
          is_active: boolean | null
          max_value: number
          min_value: number | null
          notes: string | null
          oog_trigger: number | null
          parameter: string
          regulation_id: string
          source_reference: string | null
          unit: string
          vehicle_type: string | null
          zone: string
        }
        Insert: {
          action_if_exceeded?: string | null
          category: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          max_value: number
          min_value?: number | null
          notes?: string | null
          oog_trigger?: number | null
          parameter: string
          regulation_id: string
          source_reference?: string | null
          unit: string
          vehicle_type?: string | null
          zone?: string
        }
        Update: {
          action_if_exceeded?: string | null
          category?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          max_value?: number
          min_value?: number | null
          notes?: string | null
          oog_trigger?: number | null
          parameter?: string
          regulation_id?: string
          source_reference?: string | null
          unit?: string
          vehicle_type?: string | null
          zone?: string
        }
        Relationships: []
      }
      vehicle_brands: {
        Row: {
          brand_name: string
          countries_present: string[] | null
          created_at: string | null
          id: string
          notes: string | null
          origin_country: string | null
          parts_availability: string | null
          popular_models: string[] | null
          price_category: string | null
          sav_availability: string | null
        }
        Insert: {
          brand_name: string
          countries_present?: string[] | null
          created_at?: string | null
          id?: string
          notes?: string | null
          origin_country?: string | null
          parts_availability?: string | null
          popular_models?: string[] | null
          price_category?: string | null
          sav_availability?: string | null
        }
        Update: {
          brand_name?: string
          countries_present?: string[] | null
          created_at?: string | null
          id?: string
          notes?: string | null
          origin_country?: string | null
          parts_availability?: string | null
          popular_models?: string[] | null
          price_category?: string | null
          sav_availability?: string | null
        }
        Relationships: []
      }
      vehicle_types: {
        Row: {
          axle_count: number
          category: string
          config: string
          created_at: string | null
          driven_wheels: number | null
          id: string
          is_available_senegal: boolean | null
          notes: string | null
          payload_t: number | null
          power_hp_max: number | null
          power_hp_min: number | null
          ptac_max_t: number | null
          ptac_min_t: number | null
          ptra_max_t: number | null
          ptra_min_t: number | null
          saddle_load_t: number | null
          terrain_type: string | null
          usage_primary: string | null
          vehicle_id: string
          wheel_count: number | null
        }
        Insert: {
          axle_count: number
          category: string
          config: string
          created_at?: string | null
          driven_wheels?: number | null
          id?: string
          is_available_senegal?: boolean | null
          notes?: string | null
          payload_t?: number | null
          power_hp_max?: number | null
          power_hp_min?: number | null
          ptac_max_t?: number | null
          ptac_min_t?: number | null
          ptra_max_t?: number | null
          ptra_min_t?: number | null
          saddle_load_t?: number | null
          terrain_type?: string | null
          usage_primary?: string | null
          vehicle_id: string
          wheel_count?: number | null
        }
        Update: {
          axle_count?: number
          category?: string
          config?: string
          created_at?: string | null
          driven_wheels?: number | null
          id?: string
          is_available_senegal?: boolean | null
          notes?: string | null
          payload_t?: number | null
          power_hp_max?: number | null
          power_hp_min?: number | null
          ptac_max_t?: number | null
          ptac_min_t?: number | null
          ptra_max_t?: number | null
          ptra_min_t?: number | null
          saddle_load_t?: number | null
          terrain_type?: string | null
          usage_primary?: string | null
          vehicle_id?: string
          wheel_count?: number | null
        }
        Relationships: []
      }
      warehouse_franchise: {
        Row: {
          cargo_type: string
          container_type: string | null
          created_at: string | null
          effective_date: string
          expiry_date: string | null
          free_days: number
          id: string
          is_active: boolean | null
          notes: string | null
          provider: string
          rate_per_day: number
          rate_unit: string
          source_document: string | null
          storage_zone: string | null
          updated_at: string | null
        }
        Insert: {
          cargo_type: string
          container_type?: string | null
          created_at?: string | null
          effective_date?: string
          expiry_date?: string | null
          free_days?: number
          id?: string
          is_active?: boolean | null
          notes?: string | null
          provider?: string
          rate_per_day: number
          rate_unit?: string
          source_document?: string | null
          storage_zone?: string | null
          updated_at?: string | null
        }
        Update: {
          cargo_type?: string
          container_type?: string | null
          created_at?: string | null
          effective_date?: string
          expiry_date?: string | null
          free_days?: number
          id?: string
          is_active?: boolean | null
          notes?: string | null
          provider?: string
          rate_per_day?: number
          rate_unit?: string
          source_document?: string | null
          storage_zone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      historical_quotation_profiles: {
        Row: {
          cargo_description: string | null
          carrier: string | null
          container_count: number | null
          container_types: string[] | null
          created_at: string | null
          destination_country: string | null
          final_destination: string | null
          hs_code: string | null
          incoterm: string | null
          origin_country: string | null
          quotation_id: string | null
          total_weight_kg: number | null
          transport_mode: string | null
        }
        Relationships: []
      }
      v_quotation_documents_safe: {
        Row: {
          created_at: string | null
          document_type: string | null
          file_size: number | null
          id: string | null
          quotation_id: string | null
          root_quotation_id: string | null
          status: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          document_type?: string | null
          file_size?: number | null
          id?: string | null
          quotation_id?: string | null
          root_quotation_id?: string | null
          status?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          document_type?: string | null
          file_size?: number | null
          id?: string | null
          quotation_id?: string | null
          root_quotation_id?: string | null
          status?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_documents_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotation_history"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      check_quotation_ownership_status: {
        Args: never
        Returns: {
          metric: string
          value: string
        }[]
      }
      commit_decision_atomic: {
        Args: {
          p_case_id: string
          p_decision_type: string
          p_facts_hash?: string
          p_gaps_hash?: string
          p_idempotency_key: string
          p_override_reason?: string
          p_override_value?: string
          p_proposal_id: string
          p_selected_key: string
          p_user_id?: string
        }
        Returns: Json
      }
      finalize_quotation_ownership: { Args: never; Returns: string }
      get_next_pricing_run_number: {
        Args: { p_case_id: string }
        Returns: number
      }
      get_next_quotation_version_number: {
        Args: { p_case_id: string }
        Returns: number
      }
      insert_historical_quotation_atomic: {
        Args: { p_lines: Json; p_metadata?: Json; p_quotation: Json }
        Returns: string
      }
      insert_quotation_version_atomic: {
        Args: {
          p_case_id: string
          p_created_by: string
          p_id: string
          p_pricing_run_id: string
          p_snapshot: Json
          p_version_number: number
        }
        Returns: string
      }
      migrate_legacy_quotations: {
        Args: { owner_user_id: string }
        Returns: string
      }
      select_quotation_version: {
        Args: { p_case_id: string; p_version_id: string }
        Returns: undefined
      }
      supersede_fact: {
        Args: {
          p_case_id: string
          p_confidence?: number
          p_fact_category: string
          p_fact_key: string
          p_source_attachment_id?: string
          p_source_email_id?: string
          p_source_excerpt?: string
          p_source_type?: string
          p_value_date?: string
          p_value_json?: Json
          p_value_number?: number
          p_value_text?: string
        }
        Returns: string
      }
      upsert_rate_limit_bucket: {
        Args: {
          p_function_name: string
          p_user_id: string
          p_window_start: string
        }
        Returns: number
      }
    }
    Enums: {
      confidence_level: "low" | "medium" | "high"
      decision_type:
        | "regime"
        | "routing"
        | "services"
        | "incoterm"
        | "container"
      quote_case_status:
        | "NEW_THREAD"
        | "RFQ_DETECTED"
        | "FACTS_PARTIAL"
        | "NEED_INFO"
        | "READY_TO_PRICE"
        | "PRICING_RUNNING"
        | "PRICED_DRAFT"
        | "HUMAN_REVIEW"
        | "SENT"
        | "ARCHIVED"
        | "DECISIONS_PENDING"
        | "DECISIONS_COMPLETE"
        | "ACK_READY_FOR_PRICING"
        | "QUOTED_VERSIONED"
      quote_request_type:
        | "SEA_FCL_IMPORT"
        | "SEA_LCL_IMPORT"
        | "SEA_BREAKBULK_IMPORT"
        | "AIR_IMPORT"
        | "ROAD_IMPORT"
        | "MULTIMODAL_IMPORT"
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
    Enums: {
      confidence_level: ["low", "medium", "high"],
      decision_type: ["regime", "routing", "services", "incoterm", "container"],
      quote_case_status: [
        "NEW_THREAD",
        "RFQ_DETECTED",
        "FACTS_PARTIAL",
        "NEED_INFO",
        "READY_TO_PRICE",
        "PRICING_RUNNING",
        "PRICED_DRAFT",
        "HUMAN_REVIEW",
        "SENT",
        "ARCHIVED",
        "DECISIONS_PENDING",
        "DECISIONS_COMPLETE",
        "ACK_READY_FOR_PRICING",
        "QUOTED_VERSIONED",
      ],
      quote_request_type: [
        "SEA_FCL_IMPORT",
        "SEA_LCL_IMPORT",
        "SEA_BREAKBULK_IMPORT",
        "AIR_IMPORT",
        "ROAD_IMPORT",
        "MULTIMODAL_IMPORT",
      ],
    },
  },
} as const
