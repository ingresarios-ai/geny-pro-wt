import {
  BillingSource,
  GenyUser,
  MembershipStatus,
  PlanTier,
  getSupabaseAdmin,
} from "@/lib/supabase/admin";
import { normalizePhoneE164 } from "@/lib/auth/device-gate";

export async function syncPaymentMembershipEvent(params: {
  provider: "whop" | "stripe" | "hotmart";
  eventType: string;
  externalEventId?: string | null;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  nextStatus: MembershipStatus;
  planTier?: PlanTier;
  expiresAt?: string | null;
  externalIds?: {
    whop_user_id?: string | null;
    whop_membership_id?: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    hotmart_subscriber_code?: string | null;
  };
  rawPayload: Record<string, unknown>;
}): Promise<{ userId: string | null }> {
  const supabase = getSupabaseAdmin();
  const cleanEmail = params.email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from("geny_users")
    .select("*")
    .eq("email", cleanEmail)
    .maybeSingle<GenyUser>();

  // Si un administrador suspendió manualmente la cuenta, respetamos la suspensión manual
  const statusToApply: MembershipStatus =
    existing?.membership_status === "suspended"
      ? "suspended"
      : params.nextStatus;

  const nowIso = new Date().toISOString();
  const normalizedPhone = params.phone
    ? normalizePhoneE164(params.phone)
    : null;

  let userId: string | null = existing?.id ?? null;

  if (existing) {
    const updateData: Record<string, unknown> = {
      membership_status: statusToApply,
      billing_source: params.provider as BillingSource,
      updated_at: nowIso,
    };
    if (params.fullName && !existing.full_name) {
      updateData.full_name = params.fullName;
    }
    if (params.planTier) {
      updateData.plan_tier = params.planTier;
    }
    if (params.expiresAt !== undefined) {
      updateData.expires_at = params.expiresAt;
    }
    // Pre-vincular WhatsApp solo si la ficha aún no tenía número vinculado
    if (normalizedPhone && !existing.whatsapp_phone) {
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
      expires_at: params.expiresAt ?? null,
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

  return { userId };
}

