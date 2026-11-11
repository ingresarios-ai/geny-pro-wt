import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import {
  GenyUser,
  MembershipStatus,
  PlanTier,
  getSupabaseAdmin,
} from "@/lib/supabase/admin";
import { normalizePhoneE164 } from "@/lib/auth/device-gate";

function getOneMonthFromNowIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function getOneYearFromNowIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}

function resolvePlanExpiration(
  plan: PlanTier,
  rawExpiresAt?: string | null,
  requireAdminDate = true
): { ok: true; expiresAtIso: string | null } | { ok: false; error: string } {
  if (plan === "equipo") {
    // Equipo INGRESARIOS: siempre permanente
    return { ok: true, expiresAtIso: null };
  }

  if (plan === "mensual") {
    // Mensual: 1 mes después de la fecha actual
    return { ok: true, expiresAtIso: getOneMonthFromNowIso() };
  }

  if (plan === "anual") {
    return {
      ok: true,
      expiresAtIso: rawExpiresAt
        ? new Date(rawExpiresAt).toISOString()
        : getOneYearFromNowIso(),
    };
  }

  // Reto y VIP / Becado: Fecha de vencimiento seteada por el admin
  if (!rawExpiresAt || !rawExpiresAt.trim()) {
    if (requireAdminDate) {
      return {
        ok: false,
        error:
          plan === "reto"
            ? "En el plan Reto debes seleccionar la fecha de vencimiento."
            : "En el plan VIP / Becado debes seleccionar la fecha de vencimiento.",
      };
    }
    return { ok: true, expiresAtIso: null };
  }

  return { ok: true, expiresAtIso: new Date(rawExpiresAt).toISOString() };
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const body = (await req.json()) as {
    mode?: "single" | "csv";
    email?: string;
    full_name?: string;
    whatsapp_phone?: string;
    plan_tier?: PlanTier;
    membership_status?: MembershipStatus;
    expires_at?: string | null;
    admin_notes?: string;
    csvText?: string;
  };

  if (body.mode === "csv" && body.csvText) {
    // Formato esperado por línea: email,nombre,telefono_opcional,plan_opcional,vencimiento_iso_opcional
    const lines = body.csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.toLowerCase().startsWith("email,"));

    let imported = 0;
    for (const line of lines) {
      const [rawEmail, rawName, rawPhone, rawPlan, rawExp] = line
        .split(",")
        .map((s) => s?.trim() || "");
      if (!rawEmail || !rawEmail.includes("@")) continue;

      const phone = rawPhone ? normalizePhoneE164(rawPhone) : null;
      const plan: PlanTier = [
        "reto",
        "mensual",
        "anual",
        "vip",
        "equipo",
      ].includes(rawPlan.toLowerCase())
        ? (rawPlan.toLowerCase() as PlanTier)
        : "reto";

      const expResult = resolvePlanExpiration(plan, rawExp || null, false);
      const expiresAtIso = expResult.ok ? expResult.expiresAtIso : null;

      const { error } = await supabase.from("geny_users").upsert(
        {
          email: rawEmail.toLowerCase(),
          full_name: rawName || null,
          ...(phone
            ? {
                whatsapp_phone: phone,
                whatsapp_bound_at: new Date().toISOString(),
              }
            : {}),
          plan_tier: plan,
          membership_status: "active",
          billing_source: "csv",
          expires_at: expiresAtIso,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "email" }
      );
      if (!error) imported++;
    }

    return NextResponse.json({ ok: true, imported });
  }

  if (!body.email || !body.email.includes("@")) {
    return NextResponse.json(
      { error: "Ingresa un correo electrónico válido." },
      { status: 400 }
    );
  }

  const selectedPlan: PlanTier = body.plan_tier || "reto";
  const expResolution = resolvePlanExpiration(
    selectedPlan,
    body.expires_at,
    true
  );

  if (!expResolution.ok) {
    return NextResponse.json({ error: expResolution.error }, { status: 400 });
  }

  const cleanPhone = body.whatsapp_phone?.trim()
    ? normalizePhoneE164(body.whatsapp_phone)
    : null;

  const { data, error } = await supabase
    .from("geny_users")
    .upsert(
      {
        email: body.email.trim().toLowerCase(),
        full_name: body.full_name?.trim() || null,
        plan_tier: selectedPlan,
        membership_status: body.membership_status || "active",
        billing_source: "manual",
        expires_at: expResolution.expiresAtIso,
        admin_notes: body.admin_notes?.trim() || null,
        ...(cleanPhone
          ? {
              whatsapp_phone: cleanPhone,
              whatsapp_bound_at: new Date().toISOString(),
            }
          : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, user: data });
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const body = (await req.json()) as {
    userId: string;
    action?:
      | "update_fields"
      | "unlink_whatsapp"
      | "unlink_telegram"
      | "reset_swap_cooldown";
    email?: string;
    full_name?: string | null;
    whatsapp_phone?: string | null;
    telegram_id?: string | null;
    telegram_username?: string | null;
    membership_status?: MembershipStatus;
    suspended_reason?: string | null;
    plan_tier?: PlanTier;
    expires_at?: string | null;
    daily_message_override?: number | null;
    admin_notes?: string | null;
  };

  if (!body.userId) {
    return NextResponse.json({ error: "Falta userId" }, { status: 400 });
  }

  const { data: currentUser } = await supabase
    .from("geny_users")
    .select("*")
    .eq("id", body.userId)
    .single<GenyUser>();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Usuario no encontrado" },
      { status: 404 }
    );
  }

  const nowIso = new Date().toISOString();

  if (body.action === "unlink_whatsapp") {
    if (currentUser.whatsapp_phone) {
      await supabase.from("geny_device_history").insert({
        user_id: currentUser.id,
        channel: "whatsapp",
        previous_identifier: currentUser.whatsapp_phone,
        new_identifier: null,
        action_type: "admin_reset",
        previous_status: "revoked",
        reason: "Desvinculación manual desde Panel Admin",
      });
    }
    await supabase
      .from("geny_users")
      .update({
        whatsapp_phone: null,
        whatsapp_bound_at: null,
        whatsapp_last_swap_at: null,
        updated_at: nowIso,
      })
      .eq("id", currentUser.id);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "unlink_telegram") {
    if (currentUser.telegram_id) {
      await supabase.from("geny_device_history").insert({
        user_id: currentUser.id,
        channel: "telegram",
        previous_identifier: currentUser.telegram_id,
        new_identifier: null,
        action_type: "admin_reset",
        previous_status: "revoked",
        reason: "Desvinculación manual desde Panel Admin",
      });
    }
    await supabase
      .from("geny_users")
      .update({
        telegram_id: null,
        telegram_username: null,
        telegram_bound_at: null,
        telegram_last_swap_at: null,
        updated_at: nowIso,
      })
      .eq("id", currentUser.id);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reset_swap_cooldown") {
    await supabase
      .from("geny_users")
      .update({
        whatsapp_last_swap_at: null,
        telegram_last_swap_at: null,
        updated_at: nowIso,
      })
      .eq("id", currentUser.id);
    return NextResponse.json({ ok: true });
  }

  const updates: Record<string, unknown> = { updated_at: nowIso };

  if (body.email !== undefined) {
    const cleanEmail = body.email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return NextResponse.json(
        { error: "Ingresa un correo electrónico válido." },
        { status: 400 }
      );
    }
    updates.email = cleanEmail;
  }

  if (body.full_name !== undefined) {
    updates.full_name = body.full_name?.trim() || null;
  }

  if (body.whatsapp_phone !== undefined) {
    const cleanPhone = body.whatsapp_phone?.trim()
      ? normalizePhoneE164(body.whatsapp_phone)
      : null;
    if (cleanPhone !== currentUser.whatsapp_phone) {
      if (currentUser.whatsapp_phone) {
        await supabase.from("geny_device_history").insert({
          user_id: currentUser.id,
          channel: "whatsapp",
          previous_identifier: currentUser.whatsapp_phone,
          new_identifier: cleanPhone,
          action_type: "admin_reset",
          previous_status: "revoked",
          reason: "Edición manual de teléfono desde Panel Admin",
        });
      }
      updates.whatsapp_phone = cleanPhone;
      updates.whatsapp_bound_at = cleanPhone ? nowIso : null;
    }
  }

  if (body.telegram_id !== undefined) {
    const cleanTgId = body.telegram_id?.trim() || null;
    if (cleanTgId !== currentUser.telegram_id) {
      if (currentUser.telegram_id) {
        await supabase.from("geny_device_history").insert({
          user_id: currentUser.id,
          channel: "telegram",
          previous_identifier: currentUser.telegram_id,
          new_identifier: cleanTgId,
          action_type: "admin_reset",
          previous_status: "revoked",
          reason: "Edición manual de Telegram ID desde Panel Admin",
        });
      }
      updates.telegram_id = cleanTgId;
      updates.telegram_bound_at = cleanTgId ? nowIso : null;
    }
  }

  if (body.telegram_username !== undefined) {
    updates.telegram_username =
      body.telegram_username?.trim().replace(/^@/, "") || null;
  }

  if (body.membership_status) {
    updates.membership_status = body.membership_status;
    updates.suspended_at =
      body.membership_status === "suspended" ? nowIso : null;
    if (body.suspended_reason !== undefined) {
      updates.suspended_reason = body.suspended_reason;
    }
  }

  if (body.plan_tier) {
    updates.plan_tier = body.plan_tier;
    const expResolution = resolvePlanExpiration(
      body.plan_tier,
      body.expires_at,
      true
    );
    if (!expResolution.ok) {
      return NextResponse.json({ error: expResolution.error }, { status: 400 });
    }
    updates.expires_at = expResolution.expiresAtIso;
  } else if (body.expires_at !== undefined) {
    updates.expires_at = body.expires_at
      ? new Date(body.expires_at).toISOString()
      : null;
  }

  if (body.daily_message_override !== undefined) {
    updates.daily_message_override = body.daily_message_override;
  }
  if (body.admin_notes !== undefined) {
    updates.admin_notes = body.admin_notes;
  }

  const { error } = await supabase
    .from("geny_users")
    .update(updates)
    .eq("id", currentUser.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("geny_users").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
