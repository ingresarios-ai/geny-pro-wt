import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ChannelType = "telegram" | "whatsapp" | "web";
export type MembershipStatus = "active" | "past_due" | "canceled" | "suspended";
export type PlanTier = "reto" | "mensual" | "anual" | "vip" | "equipo";
export type BillingSource = "whop" | "stripe" | "hotmart" | "csv" | "manual";

export const MANAGED_SECRET_KEYS = [
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
  "WHOP_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_SECRET",
  "HOTMART_HOTTOK",
] as const;

export type ManagedSecretKey = (typeof MANAGED_SECRET_KEYS)[number];
export type RuntimeSecretsMap = Partial<Record<ManagedSecretKey, string>>;

export interface GenySettingsSnapshot {
  active_provider: "gemini" | "claude";
  gemini_model: string;
  claude_model: string;
  whisper_provider: "openai" | "groq";
  daily_message_limit: number;
  device_swap_cooldown_days: number;
  whop_telegram_group_id: string | null;
  payment_checkout_url: string;
  human_support_url: string;
  system_prompt_compliant: string;
  runtime_secrets: RuntimeSecretsMap;
  saved_at?: string;
}

export interface GenySettings {
  id: number;
  active_provider: "gemini" | "claude";
  gemini_model: string;
  claude_model: string;
  whisper_provider: "openai" | "groq";
  daily_message_limit: number;
  device_swap_cooldown_days: number;
  whop_telegram_group_id: string | null;
  payment_checkout_url: string;
  human_support_url: string;
  system_prompt_compliant: string;
  runtime_secrets: RuntimeSecretsMap;
  previous_working_snapshot: GenySettingsSnapshot | null;
  last_snapshot_at: string | null;
  updated_at: string;
}

export interface GenyUser {
  id: string;
  email: string;
  full_name: string | null;
  plan_tier: PlanTier;
  membership_status: MembershipStatus;
  billing_source: BillingSource;
  whop_user_id: string | null;
  whop_membership_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  hotmart_subscriber_code: string | null;
  expires_at: string | null;
  suspended_reason: string | null;
  suspended_at: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  telegram_bound_at: string | null;
  telegram_last_swap_at: string | null;
  whatsapp_phone: string | null;
  whatsapp_bound_at: string | null;
  whatsapp_last_swap_at: string | null;
  daily_message_override: number | null;
  trader_profile_summary: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface GenyDeviceHistory {
  id: string;
  user_id: string;
  channel: "telegram" | "whatsapp";
  previous_identifier: string | null;
  new_identifier: string | null;
  action_type: "initial_bind" | "user_self_swap" | "admin_reset" | "admin_force_swap";
  previous_status: "revoked" | "archived";
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface GenyMessage {
  id: string;
  user_id: string;
  channel: ChannelType;
  input_type: "text" | "audio" | "image";
  user_message: string;
  assistant_response: string;
  provider_used: string;
  model_used: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number | null;
  needs_human_review: boolean;
  review_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  is_gold_dataset: boolean;
  mentor_ideal_response: string | null;
  created_at: string;
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY.trim().length > 10
  );
}

let cachedAdminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Falta configurar NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno."
    );
  }

  if (!cachedAdminClient) {
    cachedAdminClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cachedAdminClient;
}

// Captura los valores iniciales del entorno (.env.local / Vercel) antes de aplicar overrides desde Supabase
const INITIAL_ENV_SECRETS: RuntimeSecretsMap = {};
for (const key of MANAGED_SECRET_KEYS) {
  if (process.env[key]) {
    INITIAL_ENV_SECRETS[key] = process.env[key];
  }
}

export function applyRuntimeSecretsToProcessEnv(
  runtimeSecrets?: RuntimeSecretsMap | null
) {
  for (const key of MANAGED_SECRET_KEYS) {
    const dbVal = runtimeSecrets?.[key]?.trim();
    if (dbVal) {
      process.env[key] = dbVal;
    } else if (INITIAL_ENV_SECRETS[key]) {
      process.env[key] = INITIAL_ENV_SECRETS[key];
    } else {
      delete process.env[key];
    }
  }
}

export function getEffectiveSecretsMap(
  runtimeSecrets?: RuntimeSecretsMap | null
): Record<
  ManagedSecretKey,
  {
    hasValue: boolean;
    source: "supabase" | "env" | "none";
    maskedPreview: string;
    value: string;
  }
> {
  const result = {} as Record<
    ManagedSecretKey,
    {
      hasValue: boolean;
      source: "supabase" | "env" | "none";
      maskedPreview: string;
      value: string;
    }
  >;

  for (const key of MANAGED_SECRET_KEYS) {
    const dbVal = runtimeSecrets?.[key]?.trim();
    const envVal = INITIAL_ENV_SECRETS[key]?.trim();
    const effective = dbVal || envVal || "";
    const source: "supabase" | "env" | "none" = dbVal
      ? "supabase"
      : envVal
        ? "env"
        : "none";

    let maskedPreview = "No configurado";
    if (effective) {
      if (key === "EMAIL_FROM" || key === "WHATSAPP_VERIFY_TOKEN") {
        maskedPreview = effective;
      } else if (effective.length <= 8) {
        maskedPreview = "••••••••";
      } else {
        maskedPreview = `${effective.slice(0, 4)}••••••••${effective.slice(-4)}`;
      }
    }

    result[key] = {
      hasValue: Boolean(effective),
      source,
      maskedPreview,
      value: effective,
    };
  }

  return result;
}

export async function getGenySettings(): Promise<GenySettings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("geny_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) {
    throw new Error(
      `Error leyendo geny_settings: ${error?.message ?? "No encontrado"}`
    );
  }

  const settings = data as GenySettings;
  applyRuntimeSecretsToProcessEnv(settings.runtime_secrets);
  return settings;
}

export async function claimWebhookIdempotency(
  eventKey: string,
  source: string
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("processed_webhook_events")
    .insert({ event_key: eventKey, source });

  if (error) {
    // Unique constraint violation => duplicate webhook retry
    return false;
  }
  return true;
}

