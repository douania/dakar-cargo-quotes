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
      email_threads: {
        Row: {
          client_company: string | null
          client_email: string | null
          created_at: string | null
          email_count: number | null
          first_message_at: string | null
          id: string
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
