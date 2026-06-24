/* Supabase database types — GENERATED, do not edit by hand.
   Source of truth is the live Postgres schema. Regenerate after any
   migration with:  node --env-file=.env.local scripts/gen-types.mjs
   Typing supabaseClient against this turns schema drift into compile
   errors instead of runtime surprises. */

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_deletions: {
        Row: {
          deleted_at: string
          email: string | null
          id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          deleted_at?: string
          email?: string | null
          id?: string
          reason?: string | null
          user_id: string
        }
        Update: {
          deleted_at?: string
          email?: string | null
          id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          ip: string | null
          payload: Json | null
          target_user_id: string | null
          ua: string | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          ip?: string | null
          payload?: Json | null
          target_user_id?: string | null
          ua?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          ip?: string | null
          payload?: Json | null
          target_user_id?: string | null
          ua?: string | null
        }
        Relationships: []
      }
      admin_saved_views: {
        Row: {
          created_at: string
          created_by: string
          filter_state: Json
          id: string
          name: string
          screen: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          filter_state: Json
          id?: string
          name: string
          screen: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          filter_state?: Json
          id?: string
          name?: string
          screen?: string
          updated_at?: string
        }
        Relationships: []
      }
      bug_reports: {
        Row: {
          archived_at: string | null
          created_at: string | null
          description: string | null
          id: string
          logs: Json | null
          screen: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          logs?: Json | null
          screen?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          logs?: Json | null
          screen?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      cron_state: {
        Row: {
          job: string
          last_run_at: string | null
        }
        Insert: {
          job: string
          last_run_at?: string | null
        }
        Update: {
          job?: string
          last_run_at?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string | null
          file_path: string
          file_size: number | null
          file_type: string
          group_id: string | null
          id: string
          kind: string
          name: string
          patient_id: string | null
          session_id: string | null
          updated_at: string | null
          uploaded_by_user_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          file_path: string
          file_size?: number | null
          file_type?: string
          group_id?: string | null
          id?: string
          kind?: string
          name: string
          patient_id?: string | null
          session_id?: string | null
          updated_at?: string | null
          uploaded_by_user_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          file_path?: string
          file_size?: number | null
          file_type?: string
          group_id?: string | null
          id?: string
          kind?: string
          name?: string
          patient_id?: string | null
          session_id?: string | null
          updated_at?: string | null
          uploaded_by_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          cfdi_url: string | null
          cfdi_uuid: string | null
          color_idx: number | null
          created_at: string | null
          date: string
          description: string | null
          id: string
          note: string | null
          payment_method: string | null
          period_month: number | null
          period_year: number | null
          receipt_document_id: string | null
          recurring_id: string | null
          tax_treatment: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          cfdi_url?: string | null
          cfdi_uuid?: string | null
          color_idx?: number | null
          created_at?: string | null
          date: string
          description?: string | null
          id?: string
          note?: string | null
          payment_method?: string | null
          period_month?: number | null
          period_year?: number | null
          receipt_document_id?: string | null
          recurring_id?: string | null
          tax_treatment?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          cfdi_url?: string | null
          cfdi_uuid?: string | null
          color_idx?: number | null
          created_at?: string | null
          date?: string
          description?: string | null
          id?: string
          note?: string | null
          payment_method?: string | null
          period_month?: number | null
          period_year?: number | null
          receipt_document_id?: string | null
          recurring_id?: string | null
          tax_treatment?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_receipt_document_id_fkey"
            columns: ["receipt_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      export_audit: {
        Row: {
          bytes: number | null
          exported_at: string
          id: string
          user_id: string
        }
        Insert: {
          bytes?: number | null
          exported_at?: string
          id?: string
          user_id: string
        }
        Update: {
          bytes?: number | null
          exported_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      group_members: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          joined_at: string | null
          left_at: string | null
          patient_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          joined_at?: string | null
          left_at?: string | null
          patient_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          joined_at?: string | null
          left_at?: string | null
          patient_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          color_idx: number | null
          created_at: string | null
          day: string | null
          duration: number | null
          id: string
          modality: string | null
          name: string
          rate: number | null
          recurrence_frequency: string
          scheduling_mode: string
          status: string
          time: string | null
          user_id: string
          version: number
        }
        Insert: {
          color_idx?: number | null
          created_at?: string | null
          day?: string | null
          duration?: number | null
          id?: string
          modality?: string | null
          name: string
          rate?: number | null
          recurrence_frequency?: string
          scheduling_mode?: string
          status?: string
          time?: string | null
          user_id: string
          version?: number
        }
        Update: {
          color_idx?: number | null
          created_at?: string | null
          day?: string | null
          duration?: number | null
          id?: string
          modality?: string | null
          name?: string
          rate?: number | null
          recurrence_frequency?: string
          scheduling_mode?: string
          status?: string
          time?: string | null
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      influencer_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string | null
          created_by: string | null
          duration: string
          duration_in_months: number | null
          id: string
          influencer_name: string | null
          notes: string | null
          percent_off: number
          stripe_coupon_id: string
          stripe_promotion_code_id: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string | null
          created_by?: string | null
          duration: string
          duration_in_months?: number | null
          id?: string
          influencer_name?: string | null
          notes?: string | null
          percent_off: number
          stripe_coupon_id: string
          stripe_promotion_code_id: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string | null
          created_by?: string | null
          duration?: string
          duration_in_months?: number | null
          id?: string
          influencer_name?: string | null
          notes?: string | null
          percent_off?: number
          stripe_coupon_id?: string
          stripe_promotion_code_id?: string
        }
        Relationships: []
      }
      lifecycle_emails: {
        Row: {
          kind: string
          resend_id: string | null
          sent_at: string
          user_id: string
        }
        Insert: {
          kind: string
          resend_id?: string | null
          sent_at?: string
          user_id: string
        }
        Update: {
          kind?: string
          resend_id?: string | null
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      measurements: {
        Row: {
          basal_metabolic_rate_kcal: number | null
          body_fat_kg: number | null
          body_fat_pct: number | null
          created_at: string | null
          device_model: string | null
          hip_cm: number | null
          id: string
          inbody_score: number | null
          minerals_kg: number | null
          notes: string | null
          patient_id: string
          phase_angle: number | null
          protein_kg: number | null
          raw_extra: Json | null
          scanned_at: string | null
          skeletal_muscle_kg: number | null
          source: string
          taken_at: string
          total_body_water_kg: number | null
          user_id: string
          visceral_fat_level: number | null
          waist_cm: number | null
          weight_kg: number | null
        }
        Insert: {
          basal_metabolic_rate_kcal?: number | null
          body_fat_kg?: number | null
          body_fat_pct?: number | null
          created_at?: string | null
          device_model?: string | null
          hip_cm?: number | null
          id?: string
          inbody_score?: number | null
          minerals_kg?: number | null
          notes?: string | null
          patient_id: string
          phase_angle?: number | null
          protein_kg?: number | null
          raw_extra?: Json | null
          scanned_at?: string | null
          skeletal_muscle_kg?: number | null
          source?: string
          taken_at: string
          total_body_water_kg?: number | null
          user_id: string
          visceral_fat_level?: number | null
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Update: {
          basal_metabolic_rate_kcal?: number | null
          body_fat_kg?: number | null
          body_fat_pct?: number | null
          created_at?: string | null
          device_model?: string | null
          hip_cm?: number | null
          id?: string
          inbody_score?: number | null
          minerals_kg?: number | null
          notes?: string | null
          patient_id?: string
          phase_angle?: number | null
          protein_kg?: number | null
          raw_extra?: Json | null
          scanned_at?: string | null
          skeletal_muscle_kg?: number | null
          source?: string
          taken_at?: string
          total_body_water_kg?: number | null
          user_id?: string
          visceral_fat_level?: number | null
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurements_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      note_attachments: {
        Row: {
          created_at: string
          deleted_at: string | null
          encrypted: boolean
          height: number | null
          id: string
          iv: string | null
          mime: string
          note_id: string
          r2_path: string
          size_bytes: number | null
          user_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          encrypted?: boolean
          height?: number | null
          id?: string
          iv?: string | null
          mime: string
          note_id: string
          r2_path: string
          size_bytes?: number | null
          user_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          encrypted?: boolean
          height?: number | null
          id?: string
          iv?: string | null
          mime?: string
          note_id?: string
          r2_path?: string
          size_bytes?: number | null
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "note_attachments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      note_tag_links: {
        Row: {
          created_at: string
          note_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          note_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          note_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_tag_links_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "note_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      note_tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          label_ciphertext: string
          label_hash: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          label_ciphertext: string
          label_hash: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          label_ciphertext?: string
          label_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      note_versions: {
        Row: {
          content_ciphertext: string | null
          created_at: string
          encrypted: boolean
          id: string
          note_id: string
          title_ciphertext: string | null
          user_id: string
          version_no: number
        }
        Insert: {
          content_ciphertext?: string | null
          created_at?: string
          encrypted?: boolean
          id?: string
          note_id: string
          title_ciphertext?: string | null
          user_id: string
          version_no: number
        }
        Update: {
          content_ciphertext?: string | null
          created_at?: string
          encrypted?: boolean
          id?: string
          note_id?: string
          title_ciphertext?: string | null
          user_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_versions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string | null
          cover_attachment_id: string | null
          created_at: string | null
          encrypted: boolean
          group_id: string | null
          id: string
          patient_id: string | null
          pinned: boolean | null
          search_tsv: unknown
          session_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content?: string | null
          cover_attachment_id?: string | null
          created_at?: string | null
          encrypted?: boolean
          group_id?: string | null
          id?: string
          patient_id?: string | null
          pinned?: boolean | null
          search_tsv?: unknown
          session_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string | null
          cover_attachment_id?: string | null
          created_at?: string | null
          encrypted?: boolean
          group_id?: string | null
          id?: string
          patient_id?: string | null
          pinned?: boolean | null
          search_tsv?: unknown
          session_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_cover_attachment_id_fkey"
            columns: ["cover_attachment_id"]
            isOneToOne: false
            referencedRelation: "note_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          enabled: boolean | null
          id: string
          reminder_minutes: number | null
          timezone: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          enabled?: boolean | null
          id?: string
          reminder_minutes?: number | null
          timezone?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          enabled?: boolean | null
          id?: string
          reminder_minutes?: number | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          patient_id: string | null
          read: boolean
          session_id: string | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          patient_id?: string | null
          read?: boolean
          session_id?: string | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          patient_id?: string | null
          read?: boolean
          session_id?: string | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_invites: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          patient_id: string
          therapist_id: string
          token_hash: string
          token_prefix: string
          used_at: string | null
          used_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          patient_id: string
          therapist_id: string
          token_hash: string
          token_prefix: string
          used_at?: string | null
          used_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          patient_id?: string
          therapist_id?: string
          token_hash?: string
          token_prefix?: string
          used_at?: string | null
          used_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_invites_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_payment_intents: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          paid_by_user_id: string
          patient_id: string
          payment_id: string | null
          status: string
          stripe_account_id: string
          stripe_payment_intent_id: string
          succeeded_at: string | null
          therapist_user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          paid_by_user_id: string
          patient_id: string
          payment_id?: string | null
          status?: string
          stripe_account_id: string
          stripe_payment_intent_id: string
          succeeded_at?: string | null
          therapist_user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          paid_by_user_id?: string
          patient_id?: string
          payment_id?: string | null
          status?: string
          stripe_account_id?: string
          stripe_payment_intent_id?: string
          succeeded_at?: string | null
          therapist_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_payment_intents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_payment_intents_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          allergies: string | null
          billed: number | null
          birthdate: string | null
          color_idx: number | null
          created_at: string | null
          day: string | null
          email: string | null
          external_folder_url: string | null
          goal_body_fat_pct: number | null
          goal_skeletal_muscle_kg: number | null
          goal_weight_kg: number | null
          height_cm: number | null
          id: string
          initials: string
          medical_conditions: string | null
          name: string
          opening_balance: number
          paid: number | null
          parent: string | null
          patient_intake_completed_at: string | null
          patient_user_id: string | null
          phone: string | null
          rate: number | null
          scheduling_mode: string
          sessions: number | null
          start_date: string | null
          status: string | null
          time: string | null
          tutor_frequency: number | null
          user_id: string
          whatsapp_consent_at: string | null
          whatsapp_enabled: boolean
        }
        Insert: {
          allergies?: string | null
          billed?: number | null
          birthdate?: string | null
          color_idx?: number | null
          created_at?: string | null
          day?: string | null
          email?: string | null
          external_folder_url?: string | null
          goal_body_fat_pct?: number | null
          goal_skeletal_muscle_kg?: number | null
          goal_weight_kg?: number | null
          height_cm?: number | null
          id?: string
          initials: string
          medical_conditions?: string | null
          name: string
          opening_balance?: number
          paid?: number | null
          parent?: string | null
          patient_intake_completed_at?: string | null
          patient_user_id?: string | null
          phone?: string | null
          rate?: number | null
          scheduling_mode?: string
          sessions?: number | null
          start_date?: string | null
          status?: string | null
          time?: string | null
          tutor_frequency?: number | null
          user_id: string
          whatsapp_consent_at?: string | null
          whatsapp_enabled?: boolean
        }
        Update: {
          allergies?: string | null
          billed?: number | null
          birthdate?: string | null
          color_idx?: number | null
          created_at?: string | null
          day?: string | null
          email?: string | null
          external_folder_url?: string | null
          goal_body_fat_pct?: number | null
          goal_skeletal_muscle_kg?: number | null
          goal_weight_kg?: number | null
          height_cm?: number | null
          id?: string
          initials?: string
          medical_conditions?: string | null
          name?: string
          opening_balance?: number
          paid?: number | null
          parent?: string | null
          patient_intake_completed_at?: string | null
          patient_user_id?: string | null
          phone?: string | null
          rate?: number | null
          scheduling_mode?: string
          sessions?: number | null
          start_date?: string | null
          status?: string | null
          time?: string | null
          tutor_frequency?: number | null
          user_id?: string
          whatsapp_consent_at?: string | null
          whatsapp_enabled?: boolean
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          color_idx: number | null
          created_at: string | null
          date: string
          id: string
          initials: string
          method: string | null
          note: string | null
          patient: string
          patient_id: string | null
          user_id: string
          version: number
        }
        Insert: {
          amount: number
          color_idx?: number | null
          created_at?: string | null
          date: string
          id?: string
          initials: string
          method?: string | null
          note?: string | null
          patient: string
          patient_id?: string | null
          user_id: string
          version?: number
        }
        Update: {
          amount?: number
          color_idx?: number | null
          created_at?: string | null
          date?: string
          id?: string
          initials?: string
          method?: string | null
          note?: string | null
          patient?: string
          patient_id?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "payments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string | null
          created_at: string | null
          endpoint: string
          id: string
          p256dh: string | null
          platform: string
          resub_token: string | null
          user_id: string
        }
        Insert: {
          auth?: string | null
          created_at?: string | null
          endpoint: string
          id?: string
          p256dh?: string | null
          platform?: string
          resub_token?: string | null
          user_id: string
        }
        Update: {
          auth?: string | null
          created_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string | null
          platform?: string
          resub_token?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          endpoint: string
          hit_at: string
        }
        Insert: {
          bucket: string
          endpoint: string
          hit_at?: string
        }
        Update: {
          bucket?: string
          endpoint?: string
          hit_at?: string
        }
        Relationships: []
      }
      recurring_expenses: {
        Row: {
          active: boolean
          amount: number
          category: string
          created_at: string | null
          day_of_month: number
          description: string | null
          id: string
          paused_at: string | null
          payment_method: string | null
          start_month: number
          start_year: number
          tax_treatment: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          amount: number
          category: string
          created_at?: string | null
          day_of_month: number
          description?: string | null
          id?: string
          paused_at?: string | null
          payment_method?: string | null
          start_month: number
          start_year: number
          tax_treatment?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          category?: string
          created_at?: string | null
          day_of_month?: number
          description?: string | null
          id?: string
          paused_at?: string | null
          payment_method?: string | null
          start_month?: number
          start_year?: number
          tax_treatment?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      referral_credits: {
        Row: {
          amount_cents: number
          credited_at: string
          id: string
          invitee_user_id: string
          inviter_user_id: string
          invoice_id: string | null
        }
        Insert: {
          amount_cents: number
          credited_at?: string
          id?: string
          invitee_user_id: string
          inviter_user_id: string
          invoice_id?: string | null
        }
        Update: {
          amount_cents?: number
          credited_at?: string
          id?: string
          invitee_user_id?: string
          inviter_user_id?: string
          invoice_id?: string | null
        }
        Relationships: []
      }
      resend_events: {
        Row: {
          email_created_at: string | null
          email_id: string | null
          event_at: string
          event_uid: string | null
          id: number
          inserted_at: string
          raw: Json | null
          seconds_since_send: number | null
          subject: string | null
          to_addr: string | null
          type: string
        }
        Insert: {
          email_created_at?: string | null
          email_id?: string | null
          event_at: string
          event_uid?: string | null
          id?: number
          inserted_at?: string
          raw?: Json | null
          seconds_since_send?: number | null
          subject?: string | null
          to_addr?: string | null
          type: string
        }
        Update: {
          email_created_at?: string | null
          email_id?: string | null
          event_at?: string
          event_uid?: string | null
          id?: number
          inserted_at?: string
          raw?: Json | null
          seconds_since_send?: number | null
          subject?: string | null
          to_addr?: string | null
          type?: string
        }
        Relationships: []
      }
      sent_reminders: {
        Row: {
          channel: string
          id: string
          sent_at: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          channel?: string
          id?: string
          sent_at?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          channel?: string
          id?: string
          sent_at?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sent_reminders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sent_tutor_reminders: {
        Row: {
          cycle_anchor_date: string
          id: string
          kind: string
          patient_id: string
          sent_at: string | null
          user_id: string
        }
        Insert: {
          cycle_anchor_date: string
          id?: string
          kind: string
          patient_id: string
          sent_at?: string | null
          user_id: string
        }
        Update: {
          cycle_anchor_date?: string
          id?: string
          kind?: string
          patient_id?: string
          sent_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sent_tutor_reminders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      session_reschedule_requests: {
        Row: {
          approve_token: string | null
          created_at: string | null
          expires_at: string
          id: string
          original_date: string
          original_time: string
          patient_id: string
          patient_note: string | null
          proposed_date: string
          proposed_time: string
          reject_token: string | null
          resolved_at: string | null
          resolved_by: string | null
          session_id: string
          status: string
          submitted_by: string
          therapist_note: string | null
          user_id: string
        }
        Insert: {
          approve_token?: string | null
          created_at?: string | null
          expires_at: string
          id?: string
          original_date: string
          original_time: string
          patient_id: string
          patient_note?: string | null
          proposed_date: string
          proposed_time: string
          reject_token?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id: string
          status?: string
          submitted_by: string
          therapist_note?: string | null
          user_id: string
        }
        Update: {
          approve_token?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          original_date?: string
          original_time?: string
          patient_id?: string
          patient_note?: string | null
          proposed_date?: string
          proposed_time?: string
          reject_token?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string
          status?: string
          submitted_by?: string
          therapist_note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_reschedule_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_reschedule_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          cancel_reason: string | null
          color_idx: number | null
          created_at: string | null
          date: string
          day: string
          duration: number | null
          group_id: string | null
          id: string
          initials: string
          is_recurring: boolean
          last_rescheduled_at: string | null
          last_rescheduled_from: Json | null
          modality: string | null
          patient: string
          patient_id: string | null
          rate: number | null
          recurrence_frequency: string
          session_type: string
          status: string | null
          time: string
          user_id: string
          version: number
          visit_type: string | null
        }
        Insert: {
          cancel_reason?: string | null
          color_idx?: number | null
          created_at?: string | null
          date: string
          day: string
          duration?: number | null
          group_id?: string | null
          id?: string
          initials: string
          is_recurring?: boolean
          last_rescheduled_at?: string | null
          last_rescheduled_from?: Json | null
          modality?: string | null
          patient: string
          patient_id?: string | null
          rate?: number | null
          recurrence_frequency?: string
          session_type?: string
          status?: string | null
          time: string
          user_id: string
          version?: number
          visit_type?: string | null
        }
        Update: {
          cancel_reason?: string | null
          color_idx?: number | null
          created_at?: string | null
          date?: string
          day?: string
          duration?: number | null
          group_id?: string | null
          id?: string
          initials?: string
          is_recurring?: boolean
          last_rescheduled_at?: string | null
          last_rescheduled_from?: Json | null
          modality?: string | null
          patient?: string
          patient_id?: string | null
          rate?: number | null
          recurrence_frequency?: string
          session_type?: string
          status?: string | null
          time?: string
          user_id?: string
          version?: number
          visit_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_invoices: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          hosted_invoice_url: string | null
          id: string
          paid_at: string
          pdf_url: string | null
          stripe_customer_id: string
          stripe_subscription_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          hosted_invoice_url?: string | null
          id: string
          paid_at: string
          pdf_url?: string | null
          stripe_customer_id: string
          stripe_subscription_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          hosted_invoice_url?: string | null
          id?: string
          paid_at?: string
          pdf_url?: string | null
          stripe_customer_id?: string
          stripe_subscription_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          event_id: string
          payload: Json | null
          received_at: string
          type: string
        }
        Insert: {
          event_id: string
          payload?: Json | null
          received_at?: string
          type: string
        }
        Update: {
          event_id?: string
          payload?: Json | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      therapist_connect_accounts: {
        Row: {
          charges_enabled: boolean
          created_at: string
          details_submitted: boolean
          last_event_at: string | null
          payouts_enabled: boolean
          stripe_account_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          last_event_at?: string | null
          payouts_enabled?: boolean
          stripe_account_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          last_event_at?: string | null
          payouts_enabled?: boolean
          stripe_account_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trial_extensions: {
        Row: {
          days: number
          granted_at: string
          id: string
          reason: string
          user_id: string
        }
        Insert: {
          days: number
          granted_at?: string
          id?: string
          reason: string
          user_id: string
        }
        Update: {
          days?: number
          granted_at?: string
          id?: string
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      user_calendar_tokens: {
        Row: {
          created_at: string
          id: string
          last_accessed_at: string | null
          token_hash: string
          token_prefix: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_accessed_at?: string | null
          token_hash: string
          token_prefix?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_accessed_at?: string | null
          token_hash?: string
          token_prefix?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_consents: {
        Row: {
          accepted_at: string
          id: string
          policy_version: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          policy_version: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          id?: string
          policy_version?: string
          user_id?: string
        }
        Relationships: []
      }
      user_encryption_keys: {
        Row: {
          created_at: string
          id: string
          passphrase_iters: number
          passphrase_iv: string
          passphrase_salt: string
          passphrase_wrap: string
          recovery_kid: string
          recovery_wrap: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          passphrase_iters?: number
          passphrase_iv: string
          passphrase_salt: string
          passphrase_wrap: string
          recovery_kid?: string
          recovery_wrap: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          passphrase_iters?: number
          passphrase_iv?: string
          passphrase_salt?: string
          passphrase_wrap?: string
          recovery_kid?: string
          recovery_wrap?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string | null
          profession: string
          signup_source: string | null
          signup_source_detail: string | null
          signup_source_recorded_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          profession: string
          signup_source?: string | null
          signup_source_detail?: string | null
          signup_source_recorded_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          profession?: string
          signup_source?: string | null
          signup_source_detail?: string | null
          signup_source_recorded_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_ratings: {
        Row: {
          comment: string | null
          created_at: string
          prompt_kind: string
          stars: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          prompt_kind: string
          stars: number
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          prompt_kind?: string
          stars?: number
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          cancel_at: string | null
          cancel_at_period_end: boolean | null
          comp_granted: boolean | null
          comp_granted_at: string | null
          comp_granted_by: string | null
          comp_reason: string | null
          created_at: string | null
          current_period_end: string | null
          default_payment_method: string | null
          hosted_invoice_url: string | null
          influencer_code_id: string | null
          last_stripe_event_at: string | null
          latest_invoice_id: string | null
          pending_credit_amount_cents: number
          referral_code: string | null
          referral_reward_credited_at: string | null
          referral_rewards_count: number
          referred_by: string | null
          status: string | null
          stripe_customer_id: string
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          trial_extension_days: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at?: string | null
          cancel_at_period_end?: boolean | null
          comp_granted?: boolean | null
          comp_granted_at?: string | null
          comp_granted_by?: string | null
          comp_reason?: string | null
          created_at?: string | null
          current_period_end?: string | null
          default_payment_method?: string | null
          hosted_invoice_url?: string | null
          influencer_code_id?: string | null
          last_stripe_event_at?: string | null
          latest_invoice_id?: string | null
          pending_credit_amount_cents?: number
          referral_code?: string | null
          referral_reward_credited_at?: string | null
          referral_rewards_count?: number
          referred_by?: string | null
          status?: string | null
          stripe_customer_id: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_extension_days?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at?: string | null
          cancel_at_period_end?: boolean | null
          comp_granted?: boolean | null
          comp_granted_at?: string | null
          comp_granted_by?: string | null
          comp_reason?: string | null
          created_at?: string | null
          current_period_end?: string | null
          default_payment_method?: string | null
          hosted_invoice_url?: string | null
          influencer_code_id?: string | null
          last_stripe_event_at?: string | null
          latest_invoice_id?: string | null
          pending_credit_amount_cents?: number
          referral_code?: string | null
          referral_reward_credited_at?: string | null
          referral_rewards_count?: number
          referred_by?: string | null
          status?: string | null
          stripe_customer_id?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_extension_days?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_influencer_code_id_fkey"
            columns: ["influencer_code_id"]
            isOneToOne: false
            referencedRelation: "influencer_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_audit: {
        Row: {
          created_at: string | null
          error_code: string | null
          error_reason: string | null
          id: string
          meta_message_id: string | null
          patient_id: string | null
          raw_response: Json | null
          recipient_phone: string
          session_id: string | null
          status: string
          template_name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          error_code?: string | null
          error_reason?: string | null
          id?: string
          meta_message_id?: string | null
          patient_id?: string | null
          raw_response?: Json | null
          recipient_phone: string
          session_id?: string | null
          status: string
          template_name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          error_code?: string | null
          error_reason?: string | null
          id?: string
          meta_message_id?: string | null
          patient_id?: string | null
          raw_response?: Json | null
          recipient_phone?: string
          session_id?: string | null
          status?: string
          template_name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_audit_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_events: {
        Row: {
          created_at: string | null
          event_type: string | null
          id: string
          meta_message_id: string | null
          raw: Json | null
          recipient_phone: string | null
        }
        Insert: {
          created_at?: string | null
          event_type?: string | null
          id?: string
          meta_message_id?: string | null
          raw?: Json | null
          recipient_phone?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string | null
          id?: string
          meta_message_id?: string | null
          raw?: Json | null
          recipient_phone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_analytics_daily: {
        Args: { days?: number }
        Returns: {
          active_users: number
          day: string
          payments_created: number
          sessions_created: number
          signups: number
        }[]
      }
      admin_analytics_overview: { Args: never; Returns: Json }
      admin_revenue_overview: { Args: never; Returns: Json }
      admin_set_user_blocked: {
        Args: { blocked: boolean; target_user_id: string }
        Returns: undefined
      }
      archive_bug_reports: {
        Args: { report_ids: string[] }
        Returns: undefined
      }
      create_patient_with_sessions: {
        Args: { p_patient: Json; p_sessions?: Json }
        Returns: Json
      }
      diag_cron_job_state: { Args: never; Returns: Json }
      get_therapists_for_patient: {
        Args: never
        Returns: {
          patient_id: string
          therapist_accepts_online_payments: boolean
          therapist_avatar: string
          therapist_email: string
          therapist_full_name: string
          therapist_profession: string
          therapist_user_id: string
        }[]
      }
      get_user_profiles: {
        Args: never
        Returns: {
          banned_until: string
          created_at: string
          email: string
          full_name: string
          id: string
          is_patient: boolean
          profession: string
        }[]
      }
      infer_short_date_year: {
        Args: { d: number; m: number; p_tz: string; ref: string }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      normalize_short_date: { Args: { raw: string }; Returns: string }
      recalc_patient_paid: {
        Args: { p_patient_id: string }
        Returns: undefined
      }
      recalc_patient_session_counters: {
        Args: { p_patient_id: string }
        Returns: undefined
      }
      search_notes: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          id: string
          rank: number
          updated_at: string
        }[]
      }
      session_counts_at: {
        Args: {
          p_created_at?: string
          p_date: string
          p_status: string
          p_time: string
          p_tz: string
          ref: string
        }
        Returns: boolean
      }
      snapshot_note: {
        Args: {
          p_cap?: number
          p_content_ciphertext: string
          p_debounce_seconds?: number
          p_encrypted: boolean
          p_note_id: string
          p_title_ciphertext: string
        }
        Returns: number
      }
      spanish_month_idx: { Args: { mon: string }; Returns: number }
      update_session_status_atomic: {
        Args: {
          p_cancel_reason: string
          p_expected_version?: number
          p_new_status: string
          p_session_id: string
        }
        Returns: Json
      }
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
