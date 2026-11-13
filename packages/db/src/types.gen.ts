export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  kortex: {
    Tables: {
      action_items: {
        Row: {
          assignee: string | null;
          completed_at: string | null;
          created_at: string;
          description: string | null;
          due_date: string | null;
          id: string;
          priority: string;
          source_item_id: string | null;
          source_timestamp_sec: number | null;
          project_item_id: string | null;
          timeframe: string | null;
          context: string | null;
          exported_at: string | null;
          external_ref: string | null;
          status: string;
          title: string;
          user_id: string;
        };
        Insert: {
          assignee?: string | null;
          completed_at?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: string;
          source_item_id?: string | null;
          source_timestamp_sec?: number | null;
          project_item_id?: string | null;
          timeframe?: string | null;
          context?: string | null;
          exported_at?: string | null;
          external_ref?: string | null;
          status?: string;
          title: string;
          user_id: string;
        };
        Update: {
          assignee?: string | null;
          completed_at?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: string;
          source_item_id?: string | null;
          source_timestamp_sec?: number | null;
          project_item_id?: string | null;
          timeframe?: string | null;
          context?: string | null;
          exported_at?: string | null;
          external_ref?: string | null;
          status?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "action_items_project_item_id_fkey";
            columns: ["project_item_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_items_source_item_id_fkey";
            columns: ["source_item_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_items";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_jobs: {
        Row: {
          action_item_id: string | null;
          autonomy: string;
          created_at: string;
          error: string | null;
          finished_at: string | null;
          id: string;
          origin: string;
          prompt: string;
          result: Json | null;
          skill: string | null;
          standing_order_id: string | null;
          started_at: string | null;
          status: string;
          title: string;
          user_id: string;
        };
        Insert: {
          action_item_id?: string | null;
          autonomy?: string;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          origin?: string;
          prompt: string;
          result?: Json | null;
          skill?: string | null;
          standing_order_id?: string | null;
          started_at?: string | null;
          status?: string;
          title: string;
          user_id: string;
        };
        Update: {
          action_item_id?: string | null;
          autonomy?: string;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          origin?: string;
          prompt?: string;
          result?: Json | null;
          skill?: string | null;
          standing_order_id?: string | null;
          started_at?: string | null;
          status?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      agent_standing_orders: {
        Row: {
          autonomy: string;
          cadence: string;
          created_at: string;
          enabled: boolean;
          hour: number;
          id: string;
          last_period: string | null;
          prompt: string;
          skill: string | null;
          title: string;
          user_id: string;
          weekday: number | null;
        };
        Insert: {
          autonomy?: string;
          cadence: string;
          created_at?: string;
          enabled?: boolean;
          hour: number;
          id?: string;
          last_period?: string | null;
          prompt: string;
          skill?: string | null;
          title: string;
          user_id: string;
          weekday?: number | null;
        };
        Update: {
          autonomy?: string;
          cadence?: string;
          created_at?: string;
          enabled?: boolean;
          hour?: number;
          id?: string;
          last_period?: string | null;
          prompt?: string;
          skill?: string | null;
          title?: string;
          user_id?: string;
          weekday?: number | null;
        };
        Relationships: [];
      };
      ai_model_catalog: {
        Row: {
          capabilities: string[];
          context_length: number | null;
          display_name: string | null;
          embedding_dimensions: number | null;
          fetched_at: string;
          is_available: boolean;
          model_id: string;
          pricing: Json;
          provider: string;
          raw: Json;
        };
        Insert: {
          capabilities?: string[];
          context_length?: number | null;
          display_name?: string | null;
          embedding_dimensions?: number | null;
          fetched_at?: string;
          is_available?: boolean;
          model_id: string;
          pricing?: Json;
          provider: string;
          raw?: Json;
        };
        Update: {
          capabilities?: string[];
          context_length?: number | null;
          display_name?: string | null;
          embedding_dimensions?: number | null;
          fetched_at?: string;
          is_available?: boolean;
          model_id?: string;
          pricing?: Json;
          provider?: string;
          raw?: Json;
        };
        Relationships: [];
      };
      ai_usage: {
        Row: {
          cost_usd: number;
          created_at: string;
          day: string;
          estimated: boolean;
          id: number;
          input_tokens: number;
          model_id: string | null;
          output_tokens: number;
          provider: string;
          task: string;
          user_id: string;
        };
        Insert: {
          cost_usd?: number;
          created_at?: string;
          day: string;
          estimated?: boolean;
          id?: never;
          input_tokens?: number;
          model_id?: string | null;
          output_tokens?: number;
          provider: string;
          task: string;
          user_id: string;
        };
        Update: {
          cost_usd?: number;
          created_at?: string;
          day?: string;
          estimated?: boolean;
          id?: never;
          input_tokens?: number;
          model_id?: string | null;
          output_tokens?: number;
          provider?: string;
          task?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      allowed_users: {
        Row: {
          email: string | null;
          invited_at: string;
          invited_by: string | null;
          note: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          email?: string | null;
          invited_at?: string;
          invited_by?: string | null;
          note?: string | null;
          role?: string;
          user_id: string;
        };
        Update: {
          email?: string | null;
          invited_at?: string;
          invited_by?: string | null;
          note?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      allowlist_invites: {
        Row: {
          email: string;
          invited_at: string;
          invited_by: string | null;
          role: string;
        };
        Insert: {
          email: string;
          invited_at?: string;
          invited_by?: string | null;
          role?: string;
        };
        Update: {
          email?: string;
          invited_at?: string;
          invited_by?: string | null;
          role?: string;
        };
        Relationships: [];
      };
      api_tokens: {
        Row: {
          created_at: string;
          expires_at: string | null;
          id: string;
          last_used_at: string | null;
          name: string;
          revoked_at: string | null;
          scopes: string[];
          token_hash: string;
          token_prefix: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          last_used_at?: string | null;
          name: string;
          revoked_at?: string | null;
          scopes?: string[];
          token_hash: string;
          token_prefix: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          last_used_at?: string | null;
          name?: string;
          revoked_at?: string | null;
          scopes?: string[];
          token_hash?: string;
          token_prefix?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      cron_runs: {
        Row: {
          attempts: number;
          error: string | null;
          finished_at: string | null;
          job: string;
          period: string;
          result: Json | null;
          started_at: string;
          status: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          error?: string | null;
          finished_at?: string | null;
          job: string;
          period: string;
          result?: Json | null;
          started_at?: string;
          status?: string;
          user_id: string;
        };
        Update: {
          attempts?: number;
          error?: string | null;
          finished_at?: string | null;
          job?: string;
          period?: string;
          result?: Json | null;
          started_at?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      external_connections: {
        Row: {
          access: string | null;
          connected_at: string | null;
          created_at: string;
          provider: string;
          secrets: Json;
          server_url: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access?: string | null;
          connected_at?: string | null;
          created_at?: string;
          provider: string;
          secrets?: Json;
          server_url: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access?: string | null;
          connected_at?: string | null;
          created_at?: string;
          provider?: string;
          secrets?: Json;
          server_url?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      folders: {
        Row: {
          color: string | null;
          created_at: string;
          folder_path: string;
          icon: string | null;
          id: string;
          is_system_default: boolean | null;
          name: string;
          parent_id: string | null;
          slug: string;
          sort_order: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          folder_path: string;
          icon?: string | null;
          id?: string;
          is_system_default?: boolean | null;
          name: string;
          parent_id?: string | null;
          slug: string;
          sort_order?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          folder_path?: string;
          icon?: string | null;
          id?: string;
          is_system_default?: boolean | null;
          name?: string;
          parent_id?: string | null;
          slug?: string;
          sort_order?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "folders_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      ingest_jobs: {
        Row: {
          attempts: number;
          created_at: string;
          finished_at: string | null;
          id: string;
          item_id: string | null;
          kind: string;
          last_error: string | null;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          payload: Json;
          run_after: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          item_id?: string | null;
          kind: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          payload?: Json;
          run_after?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          item_id?: string | null;
          kind?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          payload?: Json;
          run_after?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ingest_jobs_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_items";
            referencedColumns: ["id"];
          },
        ];
      };
      item_chunks: {
        Row: {
          chunk_heading: string | null;
          chunk_index: number;
          chunk_text: string;
          embedding: string | null;
          id: string;
          item_id: string;
          metadata: Json | null;
          page_or_timestamp: string | null;
          user_id: string;
        };
        Insert: {
          chunk_heading?: string | null;
          chunk_index: number;
          chunk_text: string;
          embedding?: string | null;
          id?: string;
          item_id: string;
          metadata?: Json | null;
          page_or_timestamp?: string | null;
          user_id: string;
        };
        Update: {
          chunk_heading?: string | null;
          chunk_index?: number;
          chunk_text?: string;
          embedding?: string | null;
          id?: string;
          item_id?: string;
          metadata?: Json | null;
          page_or_timestamp?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_chunks_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_items";
            referencedColumns: ["id"];
          },
        ];
      };
      item_highlights: {
        Row: {
          color: string | null;
          created_at: string;
          id: string;
          item_id: string;
          locator: Json;
          note_text: string | null;
          quote_text: string;
          user_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          id?: string;
          item_id: string;
          locator?: Json;
          note_text?: string | null;
          quote_text: string;
          user_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          id?: string;
          item_id?: string;
          locator?: Json;
          note_text?: string | null;
          quote_text?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_highlights_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_items";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_items: {
        Row: {
          cluster_name: string | null;
          content_md: string;
          cover_image_url: string | null;
          created_at: string;
          entities: string[] | null;
          file_mime_type: string | null;
          file_size_bytes: number | null;
          file_storage_path: string | null;
          flashcards: Json | null;
          folder_id: string | null;
          folder_path: string;
          fts: unknown;
          icon: string | null;
          id: string;
          is_favorite: boolean | null;
          is_manual_placement: boolean | null;
          is_pinned: boolean | null;
          local_file_hash: string | null;
          remind_at: string | null;
          source_url_norm: string | null;
          content_hash: string | null;
          metadata: Json | null;
          parent_item_id: string | null;
          reading_state: Json | null;
          related_item_ids: string[] | null;
          slug: string;
          source_platform: string;
          source_url: string | null;
          status: string;
          summary: string | null;
          tags: string[] | null;
          title: string;
          type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cluster_name?: string | null;
          content_md?: string;
          cover_image_url?: string | null;
          created_at?: string;
          entities?: string[] | null;
          file_mime_type?: string | null;
          file_size_bytes?: number | null;
          file_storage_path?: string | null;
          flashcards?: Json | null;
          folder_id?: string | null;
          folder_path?: string;
          fts?: unknown;
          icon?: string | null;
          id?: string;
          is_favorite?: boolean | null;
          is_manual_placement?: boolean | null;
          is_pinned?: boolean | null;
          local_file_hash?: string | null;
          remind_at?: string | null;
          source_url_norm?: string | null;
          content_hash?: string | null;
          metadata?: Json | null;
          parent_item_id?: string | null;
          reading_state?: Json | null;
          related_item_ids?: string[] | null;
          slug: string;
          source_platform?: string;
          source_url?: string | null;
          status?: string;
          summary?: string | null;
          tags?: string[] | null;
          title: string;
          type?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cluster_name?: string | null;
          content_md?: string;
          cover_image_url?: string | null;
          created_at?: string;
          entities?: string[] | null;
          file_mime_type?: string | null;
          file_size_bytes?: number | null;
          file_storage_path?: string | null;
          flashcards?: Json | null;
          folder_id?: string | null;
          folder_path?: string;
          fts?: unknown;
          icon?: string | null;
          id?: string;
          is_favorite?: boolean | null;
          is_manual_placement?: boolean | null;
          is_pinned?: boolean | null;
          local_file_hash?: string | null;
          remind_at?: string | null;
          source_url_norm?: string | null;
          content_hash?: string | null;
          metadata?: Json | null;
          parent_item_id?: string | null;
          reading_state?: Json | null;
          related_item_ids?: string[] | null;
          slug?: string;
          source_platform?: string;
          source_url?: string | null;
          status?: string;
          summary?: string | null;
          tags?: string[] | null;
          title?: string;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_items_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_items_parent_item_id_fkey";
            columns: ["parent_item_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_items";
            referencedColumns: ["id"];
          },
        ];
      };
      sync_status: {
        Row: {
          created_at: string;
          daemon_version: string | null;
          device_id: string;
          device_name: string | null;
          items_tracked: number | null;
          last_error: string | null;
          last_error_at: string | null;
          last_heartbeat_at: string;
          last_success_at: string | null;
          last_sync_at: string | null;
          pending_ingest: number;
          pending_local: number;
          realtime: string | null;
          state: string;
          stats: Json;
          sync_handled_at: string | null;
          sync_requested_at: string | null;
          updated_at: string;
          user_id: string;
          vault_path: string | null;
        };
        Insert: {
          created_at?: string;
          daemon_version?: string | null;
          device_id: string;
          device_name?: string | null;
          items_tracked?: number | null;
          last_error?: string | null;
          last_error_at?: string | null;
          last_heartbeat_at?: string;
          last_success_at?: string | null;
          last_sync_at?: string | null;
          pending_ingest?: number;
          pending_local?: number;
          realtime?: string | null;
          state?: string;
          stats?: Json;
          sync_handled_at?: string | null;
          sync_requested_at?: string | null;
          updated_at?: string;
          user_id: string;
          vault_path?: string | null;
        };
        Update: {
          created_at?: string;
          daemon_version?: string | null;
          device_id?: string;
          device_name?: string | null;
          items_tracked?: number | null;
          last_error?: string | null;
          last_error_at?: string | null;
          last_heartbeat_at?: string;
          last_success_at?: string | null;
          last_sync_at?: string | null;
          pending_ingest?: number;
          pending_local?: number;
          realtime?: string | null;
          state?: string;
          stats?: Json;
          sync_handled_at?: string | null;
          sync_requested_at?: string | null;
          updated_at?: string;
          user_id?: string;
          vault_path?: string | null;
        };
        Relationships: [];
      };
      tags: {
        Row: {
          color: string | null;
          created_at: string;
          id: string;
          is_manual: boolean | null;
          name: string;
          usage_count: number | null;
          user_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          id?: string;
          is_manual?: boolean | null;
          name: string;
          usage_count?: number | null;
          user_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          id?: string;
          is_manual?: boolean | null;
          name?: string;
          usage_count?: number | null;
          user_id?: string;
        };
        Relationships: [];
      };
      user_insights: {
        Row: {
          created_at: string;
          input_hash: string | null;
          key: string;
          kind: string;
          payload: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          input_hash?: string | null;
          key?: string;
          kind: string;
          payload?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          input_hash?: string | null;
          key?: string;
          kind?: string;
          payload?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_settings: {
        Row: {
          accent: string | null;
          ai_routing_config: Json;
          auto_cluster_enabled: boolean;
          auto_place_threshold: number;
          auto_tag_enabled: boolean;
          custom_taxonomy: Json | null;
          daily_ai_budget_eur: number;
          embedding_lock: Json | null;
          embedding_model: string;
          enabled_connectors: string[] | null;
          habits: Json;
          inbound_mail_rotated_at: string | null;
          inbound_mail_token: string | null;
          locale: string;
          mcp_token_created_at: string | null;
          mcp_token_hash: string | null;
          mcp_token_hint: string | null;
          media_max_minutes: number;
          preferred_chat_model: string;
          preferred_fast_model: string;
          subscription_tier: string;
          theme_pack: string;
          updated_at: string;
          user_id: string;
          weekly_digest_day: number;
        };
        Insert: {
          accent?: string | null;
          ai_routing_config?: Json;
          auto_cluster_enabled?: boolean;
          auto_place_threshold?: number;
          auto_tag_enabled?: boolean;
          custom_taxonomy?: Json | null;
          daily_ai_budget_eur?: number;
          embedding_lock?: Json | null;
          embedding_model?: string;
          enabled_connectors?: string[] | null;
          habits?: Json;
          inbound_mail_rotated_at?: string | null;
          inbound_mail_token?: string | null;
          locale?: string;
          mcp_token_created_at?: string | null;
          mcp_token_hash?: string | null;
          mcp_token_hint?: string | null;
          media_max_minutes?: number;
          preferred_chat_model?: string;
          preferred_fast_model?: string;
          subscription_tier?: string;
          theme_pack?: string;
          updated_at?: string;
          user_id: string;
          weekly_digest_day?: number;
        };
        Update: {
          accent?: string | null;
          ai_routing_config?: Json;
          auto_cluster_enabled?: boolean;
          auto_place_threshold?: number;
          auto_tag_enabled?: boolean;
          custom_taxonomy?: Json | null;
          daily_ai_budget_eur?: number;
          embedding_lock?: Json | null;
          embedding_model?: string;
          enabled_connectors?: string[] | null;
          habits?: Json;
          inbound_mail_rotated_at?: string | null;
          inbound_mail_token?: string | null;
          locale?: string;
          mcp_token_created_at?: string | null;
          mcp_token_hash?: string | null;
          mcp_token_hint?: string | null;
          media_max_minutes?: number;
          preferred_chat_model?: string;
          preferred_fast_model?: string;
          subscription_tier?: string;
          theme_pack?: string;
          updated_at?: string;
          user_id?: string;
          weekly_digest_day?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _bootstrap_user: { Args: { p_user_id: string }; Returns: undefined };
      _caller_access_role: { Args: never; Returns: string };
      _caller_confirmed_email: { Args: never; Returns: string };
      _match_knowledge_hybrid: {
        Args: {
          filter_embedding_model?: string;
          filter_folder_path?: string;
          filter_type?: string;
          match_count?: number;
          p_user_id: string;
          query_embedding: string;
          query_text: string;
          rrf_k?: number;
        };
        Returns: {
          chunk_text: string;
          cluster_name: string;
          combined_score: number;
          folder_path: string;
          item_id: string;
          page_or_timestamp: string;
          source_platform: string;
          source_url: string;
          summary: string;
          tags: string[];
          title: string;
          type: string;
        }[];
      };
      access_invite: {
        Args: { p_email: string; p_role?: string };
        Returns: string;
      };
      access_list: {
        Args: never;
        Returns: {
          email: string;
          invited_at: string;
          is_self: boolean;
          role: string;
          status: string;
          user_id: string;
        }[];
      };
      access_remove: { Args: { p_email: string }; Returns: boolean };
      bootstrap_user: { Args: never; Returns: undefined };
      claim_ingest_jobs: {
        Args: { p_limit?: number; p_worker: string };
        Returns: {
          attempts: number;
          created_at: string;
          finished_at: string | null;
          id: string;
          item_id: string | null;
          kind: string;
          last_error: string | null;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          payload: Json;
          run_after: string;
          status: string;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "ingest_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      graph_semantic_edges: {
        Args: {
          p_embedding_model?: string;
          p_item_limit?: number;
          p_k?: number;
          p_min_similarity?: number;
          p_user_id: string;
        };
        Returns: {
          item_a: string;
          item_b: string;
          similarity: number;
        }[];
      };
      graph_wiki_edges: {
        Args: { p_item_limit?: number; p_user_id: string };
        Returns: {
          source_id: string;
          target_id: string;
        }[];
      };
      is_allowed: { Args: never; Returns: boolean };
      match_knowledge_hybrid: {
        Args: {
          filter_embedding_model?: string;
          filter_folder_path?: string;
          filter_type?: string;
          match_count?: number;
          query_embedding: string;
          query_text: string;
          rrf_k?: number;
        };
        Returns: {
          chunk_text: string;
          cluster_name: string;
          combined_score: number;
          folder_path: string;
          item_id: string;
          page_or_timestamp: string;
          source_platform: string;
          source_url: string;
          summary: string;
          tags: string[];
          title: string;
          type: string;
        }[];
      };
      match_knowledge_hybrid_for_user: {
        Args: {
          filter_embedding_model?: string;
          filter_folder_path?: string;
          filter_type?: string;
          match_count?: number;
          p_user_id: string;
          query_embedding: string;
          query_text: string;
          rrf_k?: number;
        };
        Returns: {
          chunk_text: string;
          cluster_name: string;
          combined_score: number;
          folder_path: string;
          item_id: string;
          page_or_timestamp: string;
          source_platform: string;
          source_url: string;
          summary: string;
          tags: string[];
          title: string;
          type: string;
        }[];
      };
      release_ingest_jobs: {
        Args: { p_ids: string[]; p_worker: string };
        Returns: number;
      };
      requeue_stale_ingest_jobs: {
        Args: { p_stale_seconds?: number };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  kortex: {
    Enums: {},
  },
} as const;
