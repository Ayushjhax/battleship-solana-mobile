/**
 * Database types generated from the project schema:
 *
 *   npx supabase gen types typescript --linked > src/net/database.types.ts
 *
 * Regenerate this file after applying migrations in supabase/migrations/.
 * `mode` and `end_reason` come back as plain `string`
 * because they are CHECK constraints, not Postgres enums; narrow them at the
 * call site (see server/src/db.ts) rather than widening this file.
 */
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
      match_events: {
        Row: {
          id: number
          match_id: string
          payload: Json
          seq: number
        }
        Insert: {
          id?: number
          match_id: string
          payload: Json
          seq: number
        }
        Update: {
          id?: number
          match_id?: string
          payload?: Json
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          end_reason: string | null
          ended_at: string | null
          id: string
          is_bot: boolean
          mode: string
          player_a: string | null
          player_b: string | null
          seed: number
          started_at: string | null
          winner: string | null
          wager_points: number
          wager_settled_at: string | null
          wagered: boolean
        }
        Insert: {
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          is_bot?: boolean
          mode: string
          player_a?: string | null
          player_b?: string | null
          seed: number
          started_at?: string | null
          winner?: string | null
          wager_points?: number
          wager_settled_at?: string | null
          wagered?: boolean
        }
        Update: {
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          is_bot?: boolean
          mode?: string
          player_a?: string | null
          player_b?: string | null
          seed?: number
          started_at?: string | null
          winner?: string | null
          wager_points?: number
          wager_settled_at?: string | null
          wagered?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "matches_player_a_fkey"
            columns: ["player_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_player_b_fkey"
            columns: ["player_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_fkey"
            columns: ["winner"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_results: {
        Row: {
          completed_at: string
          id: string
          mode: string
          synced_at: string
          user_id: string
          won: boolean
        }
        Insert: {
          completed_at: string
          id: string
          mode: string
          synced_at?: string
          user_id: string
          won: boolean
        }
        Update: {
          completed_at?: string
          id?: string
          mode?: string
          synced_at?: string
          user_id?: string
          won?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "offline_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      point_accounts: {
        Row: {
          balance: number
          created_at: string
          privy_user_id: string
          updated_at: string
          welcome_awarded_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          privy_user_id: string
          updated_at?: string
          welcome_awarded_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          privy_user_id?: string
          updated_at?: string
          welcome_awarded_at?: string
        }
        Relationships: []
      }
      point_ledger: {
        Row: {
          balance_after: number
          created_at: string
          delta: number
          id: number
          metadata: Json
          privy_user_id: string
          reason: string
          reference_id: string
        }
        Insert: {
          balance_after: number
          created_at?: string
          delta: number
          id?: never
          metadata?: Json
          privy_user_id: string
          reason: string
          reference_id: string
        }
        Update: {
          balance_after?: number
          created_at?: string
          delta?: number
          id?: never
          metadata?: Json
          privy_user_id?: string
          reason?: string
          reference_id?: string
        }
        Relationships: []
      }
      point_trades: {
        Row: {
          blockhash: string | null
          created_at: string
          error: string | null
          kind: string
          lamports: number
          last_valid_block_height: number | null
          points: number
          privy_user_id: string
          profile_id: string
          request_id: string
          signature: string | null
          signed_transaction: string | null
          status: string
          updated_at: string
        }
        Insert: {
          blockhash?: string | null
          created_at?: string
          error?: string | null
          kind: string
          lamports: number
          last_valid_block_height?: number | null
          points: number
          privy_user_id: string
          profile_id: string
          request_id: string
          signature?: string | null
          signed_transaction?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          blockhash?: string | null
          created_at?: string
          error?: string | null
          kind?: string
          lamports?: number
          last_valid_block_height?: number | null
          points?: number
          privy_user_id?: string
          profile_id?: string
          request_id?: string
          signature?: string | null
          signed_transaction?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      point_wager_holds: {
        Row: {
          created_at: string
          match_id: string | null
          privy_user_id: string
          profile_id: string
          request_id: string
          stake: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          match_id?: string | null
          privy_user_id: string
          profile_id: string
          request_id: string
          stake: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          match_id?: string | null
          privy_user_id?: string
          profile_id?: string
          request_id?: string
          stake?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      privy_accounts: {
        Row: {
          auth_provider: string
          created_at: string
          display_name: string | null
          email: string | null
          linked_accounts: Json
          privy_created_at: string
          privy_user_id: string
          profile_id: string
          solana_wallet_address: string | null
          solana_wallet_id: string | null
          updated_at: string
        }
        Insert: {
          auth_provider: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          linked_accounts?: Json
          privy_created_at: string
          privy_user_id: string
          profile_id: string
          solana_wallet_address?: string | null
          solana_wallet_id?: string | null
          updated_at?: string
        }
        Update: {
          auth_provider?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          linked_accounts?: Json
          privy_created_at?: string
          privy_user_id?: string
          profile_id?: string
          solana_wallet_address?: string | null
          solana_wallet_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "privy_accounts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_color: string
          avatar_id: number
          battles_played: number
          battles_won: number
          buildings: number
          coins: number
          country_code: string | null
          created_at: string | null
          gems: number
          has_completed_tutorial: boolean
          id: string
          is_bot: boolean
          name: string
          rank_points: number
          updated_at: string | null
        }
        Insert: {
          avatar_color?: string
          avatar_id?: number
          battles_played?: number
          battles_won?: number
          buildings?: number
          coins?: number
          country_code?: string | null
          created_at?: string | null
          gems?: number
          has_completed_tutorial?: boolean
          id: string
          is_bot?: boolean
          name: string
          rank_points?: number
          updated_at?: string | null
        }
        Update: {
          avatar_color?: string
          avatar_id?: number
          battles_played?: number
          battles_won?: number
          buildings?: number
          coins?: number
          country_code?: string | null
          created_at?: string | null
          gems?: number
          has_completed_tutorial?: boolean
          id?: string
          is_bot?: boolean
          name?: string
          rank_points?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      ranks: {
        Row: {
          id: number
          name: string
          points_required: number
        }
        Insert: {
          id: number
          name: string
          points_required: number
        }
        Update: {
          id?: number
          name?: string
          points_required?: number
        }
        Relationships: []
      }
    }
    Views: {
      leaderboard: {
        Row: {
          avatar_color: string | null
          avatar_id: number | null
          battles_won: number | null
          country_code: string | null
          name: string | null
          rank_points: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      begin_point_sell: {
        Args: {
          p_lamports: number
          p_points: number
          p_profile_id: string
          p_request_id: string
        }
        Returns: { balance: number; ok: boolean; reason: string | null; status: string }[]
      }
      complete_point_buy: {
        Args: {
          p_lamports: number
          p_points: number
          p_profile_id: string
          p_request_id: string
          p_signature: string
        }
        Returns: number
      }
      complete_point_sell: {
        Args: { p_request_id: string; p_signature: string }
        Returns: number
      }
      cancel_wagered_match_before_start: {
        Args: { p_cancelled_by: string; p_match_id: string }
        Returns: { balance: number; cancelled_profile_id: string }[]
      }
      create_wagered_match: {
        Args: {
          p_hold_a: string
          p_hold_b: string | null
          p_is_bot: boolean
          p_match_id: string
          p_mode: string
          p_player_a: string
          p_player_b: string
          p_seed: number
        }
        Returns: undefined
      }
      ensure_point_account: {
        Args: { p_privy_user_id: string; p_profile_id: string }
        Returns: { balance: number; welcome_awarded: boolean }[]
      }
      get_point_balance: { Args: { p_profile_id: string }; Returns: number }
      mark_point_sell_broadcast: {
        Args: {
          p_blockhash: string
          p_last_valid_block_height: number
          p_request_id: string
          p_signature: string
          p_signed_transaction: string
        }
        Returns: undefined
      }
      point_identity_for_profile: { Args: { p_profile_id: string }; Returns: string }
      refund_point_sell: {
        Args: { p_error: string; p_request_id: string }
        Returns: number
      }
      abandon_match: { Args: { p_match_id: string }; Returns: boolean }
      settle_offline_wager: {
        Args: { p_profile_id: string; p_request_id: string; p_won: boolean }
        Returns: { balance: number; settled: boolean }[]
      }
      refund_point_wager: {
        Args: { p_profile_id: string; p_request_id: string }
        Returns: number
      }
      reserve_point_wager: {
        Args: { p_profile_id: string; p_request_id: string; p_stake?: number }
        Returns: { balance: number; hold_id: string; ok: boolean; reason: string | null }[]
      }
      sync_privy_account: {
        Args: {
          p_auth_provider: string
          p_display_name: string | null
          p_email: string | null
          p_linked_accounts: Json
          p_privy_created_at: string
          p_privy_user_id: string
          p_profile_id: string
          p_solana_wallet_address: string | null
          p_solana_wallet_id: string | null
        }
        Returns: undefined
      }
      apply_match_result: {
        Args: {
          p_end_reason: string
          p_loss_coins: number
          p_loss_points: number
          p_match_id: string
          p_win_coins: number
          p_win_points: number
          p_winner: string
        }
        Returns: boolean
      }
      apply_offline_result: {
        Args: {
          p_completed_at: string
          p_id: string
          p_mode: string
          p_user_id: string
          p_won: boolean
        }
        Returns: boolean
      }
      jwt_role: { Args: never; Returns: string }
      my_leaderboard_row: {
        Args: never
        Returns: {
          avatar_color: string
          avatar_id: number
          battles_won: number
          country_code: string
          name: string
          rank_points: number
          rank_position: number
        }[]
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
