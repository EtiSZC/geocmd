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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      flash_event_responses: {
        Row: {
          chosen_option: Json
          event_id: string
          id: string
          player_id: string
          responded_at: string
          score_deltas: Json | null
        }
        Insert: {
          chosen_option: Json
          event_id: string
          id?: string
          player_id: string
          responded_at?: string
          score_deltas?: Json | null
        }
        Update: {
          chosen_option?: Json
          event_id?: string
          id?: string
          player_id?: string
          responded_at?: string
          score_deltas?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "flash_event_responses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "flash_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flash_event_responses_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      flash_events: {
        Row: {
          created_at: string
          description: string
          event_type: string
          expires_at: string
          id: string
          options: Json
          region: string
          title: string
          urgency: number
        }
        Insert: {
          created_at?: string
          description: string
          event_type: string
          expires_at: string
          id?: string
          options?: Json
          region: string
          title: string
          urgency?: number
        }
        Update: {
          created_at?: string
          description?: string
          event_type?: string
          expires_at?: string
          id?: string
          options?: Json
          region?: string
          title?: string
          urgency?: number
        }
        Relationships: []
      }
      players: {
        Row: {
          callsign: string
          created_at: string
          email: string
          id: string
          influence_score: Json
          updated_at: string
        }
        Insert: {
          callsign: string
          created_at?: string
          email: string
          id?: string
          influence_score?: Json
          updated_at?: string
        }
        Update: {
          callsign?: string
          created_at?: string
          email?: string
          id?: string
          influence_score?: Json
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          id: string
          notify_flash: boolean
          notify_theater: boolean
          player_id: string
          subscription: Json
        }
        Insert: {
          created_at?: string
          id?: string
          notify_flash?: boolean
          notify_theater?: boolean
          player_id: string
          subscription: Json
        }
        Update: {
          created_at?: string
          id?: string
          notify_flash?: boolean
          notify_theater?: boolean
          player_id?: string
          subscription?: Json
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      theaters: {
        Row: {
          consequence: Json | null
          created_at: string
          history: Json
          id: string
          notified_ready: boolean
          player_id: string
          scenario: Json
          updated_at: string
        }
        Insert: {
          consequence?: Json | null
          created_at?: string
          history?: Json
          id?: string
          notified_ready?: boolean
          player_id: string
          scenario: Json
          updated_at?: string
        }
        Update: {
          consequence?: Json | null
          created_at?: string
          history?: Json
          id?: string
          notified_ready?: boolean
          player_id?: string
          scenario?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "theaters_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
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
