import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import {
  GenySettingsSnapshot,
  MANAGED_SECRET_KEYS,
  ManagedSecretKey,
  RuntimeSecretsMap,
  applyRuntimeSecretsToProcessEnv,
  getGenySettings,
  getSupabaseAdmin,
} from "@/lib/supabase/admin";

export async function PATCH(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const current = await getGenySettings();
  const nowIso = new Date().toISOString();

  const body = (await req.json()) as {
    action?: "save" | "restore_last_working";
    active_provider?: "gemini" | "claude";
    gemini_model?: string;
    claude_model?: string;
    whisper_provider?: "openai" | "groq";
    daily_message_limit?: number;
    device_swap_cooldown_days?: number;
    whop_telegram_group_id?: string | null;
    payment_checkout_url?: string;
    human_support_url?: string;
    system_prompt_compliant?: string;
    runtime_secrets_updates?: Partial<Record<ManagedSecretKey, string>>;
  };

  // ACCIÓN 1: RESTAURAR A LA ÚLTIMA VERSIÓN FUNCIONAL
  if (body.action === "restore_last_working") {
    const snap = current.previous_working_snapshot;

    if (!snap) {
      // Si no había snapshot previo, restauramos a los valores base del entorno (.env.local / Vercel)
      applyRuntimeSecretsToProcessEnv({});
      const { error } = await supabase
        .from("geny_settings")
        .update({
          runtime_secrets: {},
          updated_at: nowIso,
        })
        .eq("id", 1);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        restoredFrom: "env_defaults",
      });
    }

    applyRuntimeSecretsToProcessEnv(snap.runtime_secrets || {});

    const { error } = await supabase
      .from("geny_settings")
      .update({
        active_provider: snap.active_provider,
        gemini_model: snap.gemini_model,
        claude_model: snap.claude_model,
        whisper_provider: snap.whisper_provider,
        daily_message_limit: snap.daily_message_limit,
        device_swap_cooldown_days: snap.device_swap_cooldown_days,
        whop_telegram_group_id: snap.whop_telegram_group_id,
        payment_checkout_url: snap.payment_checkout_url,
        human_support_url: snap.human_support_url,
        system_prompt_compliant: snap.system_prompt_compliant,
        runtime_secrets: snap.runtime_secrets || {},
        updated_at: nowIso,
      })
      .eq("id", 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      restoredFrom: snap.saved_at || current.last_snapshot_at || nowIso,
    });
  }

  // ACCIÓN 2: GUARDAR CAMBIOS (CON RESPALDO AUTOMÁTICO DE LA VERSIÓN FUNCIONAL ANTERIOR)
  const workingSnapshot: GenySettingsSnapshot = {
    active_provider: current.active_provider,
    gemini_model: current.gemini_model,
    claude_model: current.claude_model,
    whisper_provider: current.whisper_provider,
    daily_message_limit: current.daily_message_limit,
    device_swap_cooldown_days: current.device_swap_cooldown_days,
    whop_telegram_group_id: current.whop_telegram_group_id,
    payment_checkout_url: current.payment_checkout_url,
    human_support_url: current.human_support_url,
    system_prompt_compliant: current.system_prompt_compliant,
    runtime_secrets: { ...(current.runtime_secrets || {}) },
    saved_at: nowIso,
  };

  // Guardar snapshot en tabla histórica
  await supabase.from("geny_settings_snapshots").insert({
    snapshot: workingSnapshot,
    reason: body.runtime_secrets_updates
      ? "Respaldo automático antes de actualizar Llaves API / Tokens"
      : "Respaldo automático antes de actualizar configuración del Motor IA",
  });

  // Calcular nuevo mapa de runtime_secrets
  const nextSecrets: RuntimeSecretsMap = { ...(current.runtime_secrets || {}) };
  if (body.runtime_secrets_updates) {
    for (const key of MANAGED_SECRET_KEYS) {
      const incoming = body.runtime_secrets_updates[key];
      if (incoming === undefined) continue;
      if (incoming === "__CLEAR__") {
        delete nextSecrets[key];
      } else if (incoming.trim().length > 0) {
        nextSecrets[key] = incoming.trim();
      }
    }
  }

  applyRuntimeSecretsToProcessEnv(nextSecrets);

  const updates: Record<string, unknown> = {
    previous_working_snapshot: workingSnapshot,
    last_snapshot_at: nowIso,
    runtime_secrets: nextSecrets,
    updated_at: nowIso,
  };

  if (body.active_provider !== undefined) {
    updates.active_provider = body.active_provider;
  }
  if (body.gemini_model !== undefined) {
    updates.gemini_model = body.gemini_model;
  }
  if (body.claude_model !== undefined) {
    updates.claude_model = body.claude_model;
  }
  if (body.whisper_provider !== undefined) {
    updates.whisper_provider = body.whisper_provider;
  }
  if (body.daily_message_limit !== undefined) {
    updates.daily_message_limit = body.daily_message_limit;
  }
  if (body.device_swap_cooldown_days !== undefined) {
    updates.device_swap_cooldown_days = body.device_swap_cooldown_days;
  }
  if (body.whop_telegram_group_id !== undefined) {
    updates.whop_telegram_group_id = body.whop_telegram_group_id;
  }
  if (body.payment_checkout_url !== undefined) {
    updates.payment_checkout_url = body.payment_checkout_url;
  }
  if (body.human_support_url !== undefined) {
    updates.human_support_url = body.human_support_url;
  }
  if (body.system_prompt_compliant !== undefined) {
    updates.system_prompt_compliant = body.system_prompt_compliant;
  }

  const { error } = await supabase
    .from("geny_settings")
    .update(updates)
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, snapshotSavedAt: nowIso });
}
