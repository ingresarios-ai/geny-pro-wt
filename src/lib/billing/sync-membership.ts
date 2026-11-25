import {
  BillingSource,
  GenyUser,
  MembershipStatus,
  PlanTier,
  getSupabaseAdmin,
} from "@/lib/supabase/admin";
import {
  generateUniqueActivationCode,
  normalizePhoneE164,
} from "@/lib/auth/device-gate";
import { sendMemberWelcomeEmail } from "@/lib/auth/email-otp";
import {
  appendGhlContactNote,
  buildGhlDeactivationNote,
  buildGhlWelcomeNote,
} from "@/lib/channels/ghl";

export async function syncPaymentMembershipEvent(params: {
  provider: "whop" | "stripe" | "hotmart" | "ghl";
  eventType: string;
  externalEventId?: string | null;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  nextStatus: MembershipStatus;
  planTier?: PlanTier;
  expiresAt?: string | null;
  adminNotes?: string | null;
  forceReactivate?: boolean;
  forcePhoneUpdate?: boolean;
  sendWelcomeEmail?: boolean;
  externalIds?: {
    whop_user_id?: string | null;
    whop_membership_id?: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    hotmart_subscriber_code?: string | null;
    ghl_contact_id?: string | null;
  };
  rawPayload: Record<string, unknown>;
}): Promise<{
  userId: string | null;
  statusApplied: MembershipStatus;
  welcomeEmailSent: boolean;
}> {
  const supabase = getSupabaseAdmin();
  const cleanEmail = params.email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from("geny_users")
    .select("*")
    .eq("email", cleanEmail)
    .maybeSingle<GenyUser>();

  // Si un administrador suspendió manualmente la cuenta, respetamos la suspensión salvo que se pida forceReactivate explícito
  const statusToApply: MembershipStatus =
    existing?.membership_status === "suspended" && !params.forceReactivate
      ? "suspended"
      : params.nextStatus;

  const nowIso = new Date().toISOString();
  const normalizedPhone = params.phone
    ? normalizePhoneE164(params.phone)
    : null;

  let userId: string | null = existing?.id ?? null;
  const activationCode =
    existing?.activation_code || (await generateUniqueActivationCode(supabase));

  if (existing) {
    const updateData: Record<string, unknown> = {
      membership_status: statusToApply,
      billing_source: params.provider as BillingSource,
      updated_at: nowIso,
    };
    if (!existing.activation_code) {
      updateData.activation_code = activationCode;
    }
    if (params.fullName && (!existing.full_name || params.provider === "ghl")) {
      updateData.full_name = params.fullName;
    }
    if (params.planTier) {
      updateData.plan_tier = params.planTier;
    }
    if (params.expiresAt !== undefined) {
      updateData.expires_at = params.expiresAt;
    }
    if (params.adminNotes && !existing.admin_notes) {
      updateData.admin_notes = params.adminNotes;
    }
    if (statusToApply === "active" && params.forceReactivate) {
      updateData.suspended_reason = null;
      updateData.suspended_at = null;
    }
    // Pre-vincular WhatsApp si la ficha aún no tenía número (o si GHL fuerza actualización explícita)
    if (normalizedPhone && (!existing.whatsapp_phone || params.forcePhoneUpdate)) {
      updateData.whatsapp_phone = normalizedPhone;
      updateData.whatsapp_bound_at = nowIso;
    }
    if (params.externalIds) {
      for (const [k, v] of Object.entries(params.externalIds)) {
        if (v) updateData[k] = v;
      }
    }

    await supabase.from("geny_users").update(updateData).eq("id", existing.id);
  } else {
    const insertData: Record<string, unknown> = {
      email: cleanEmail,
      full_name: params.fullName ?? null,
      plan_tier: params.planTier ?? "reto",
      membership_status: statusToApply,
      billing_source: params.provider,
      activation_code: activationCode,
      expires_at: params.expiresAt ?? null,
      ...(params.adminNotes ? { admin_notes: params.adminNotes } : {}),
      ...(normalizedPhone
        ? { whatsapp_phone: normalizedPhone, whatsapp_bound_at: nowIso }
        : {}),
      ...(params.externalIds ?? {}),
    };

    const { data: created } = await supabase
      .from("geny_users")
      .insert(insertData)
      .select("id")
      .maybeSingle<{ id: string }>();

    userId = created?.id ?? null;
  }

  await supabase.from("geny_payment_events").insert({
    provider: params.provider,
    event_type: params.eventType,
    external_event_id: params.externalEventId ?? null,
    customer_email: cleanEmail,
    user_id: userId,
    status_applied: statusToApply,
    raw_payload: params.rawPayload,
  });

  // Enviar correo automático de bienvenida cuando es un alta nueva o cuando se reactiva una membresía inactiva
  const shouldSendWelcome =
    statusToApply === "active" &&
    params.sendWelcomeEmail !== false &&
    (!existing ||
      existing.membership_status !== "active" ||
      params.sendWelcomeEmail === true);

  let welcomeEmailSent = false;
  const effectiveGhlContactId =
    params.externalIds?.ghl_contact_id || existing?.ghl_contact_id || null;
  const rawLoc =
    params.rawPayload.location &&
    typeof params.rawPayload.location === "object"
      ? ((params.rawPayload.location as Record<string, unknown>).id as
          | string
          | undefined)
      : undefined;

  if (shouldSendWelcome) {
    const emailRes = await sendMemberWelcomeEmail({
      to: cleanEmail,
      fullName: params.fullName || existing?.full_name || null,
    });
    welcomeEmailSent = emailRes.delivered;

    await appendGhlContactNote({
      ghlContactId: effectiveGhlContactId,
      email: cleanEmail,
      userId,
      locationIdHint: rawLoc || null,
      noteBody: buildGhlWelcomeNote({
        email: cleanEmail,
        delivered: emailRes.delivered,
        activationCode,
        resendId: emailRes.resendId,
      }),
    });
  } else if (statusToApply !== "active" && params.provider === "ghl") {
    await appendGhlContactNote({
      ghlContactId: effectiveGhlContactId,
      email: cleanEmail,
      userId,
      locationIdHint: rawLoc || null,
      noteBody: buildGhlDeactivationNote({
        email: cleanEmail,
        status: statusToApply,
      }),
    });
  }

  return { userId, statusApplied: statusToApply, welcomeEmailSent };
}

