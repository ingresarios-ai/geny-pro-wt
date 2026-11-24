import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  claimWebhookIdempotency,
  getGenySettings,
  isSupabaseAdminConfigured,
  MembershipStatus,
  PlanTier,
} from "@/lib/supabase/admin";
import { syncPaymentMembershipEvent } from "@/lib/billing/sync-membership";

function safeCompareSecret(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected.trim());
  const b = Buffer.from(candidate.trim());
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function asCleanString(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  return "";
}

function resolveGhlPlan(rawPlan: string): PlanTier | undefined {
  const norm = rawPlan
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (!norm) return undefined;
  if (norm === "equipo" || norm === "team" || norm === "staff") return "equipo";
  if (norm === "vip" || norm === "becado" || norm === "beca") return "vip";
  if (norm === "anual" || norm === "annual" || norm === "yearly") return "anual";
  if (
    norm === "mensual" ||
    norm === "mensualidad" ||
    norm === "monthly" ||
    norm === "tribu"
  ) {
    return "mensual";
  }
  if (
    norm === "reto" ||
    norm.startsWith("reto") ||
    norm === "challenge" ||
    norm === "r21"
  ) {
    return "reto";
  }
  return undefined;
}

function resolveGhlStatus(rawStatus: string): MembershipStatus {
  const norm = rawStatus.toLowerCase().trim();
  if (!norm) return "active";

  if (
    [
      "cancel",
      "canceled",
      "cancelled",
      "baja",
      "deactivate",
      "deactivated",
      "refund",
      "refunded",
      "chargeback",
      "expired",
      "vencido",
      "inactive",
    ].includes(norm)
  ) {
    return "canceled";
  }

  if (["suspend", "suspended", "suspendido", "blocked", "bloqueado"].includes(norm)) {
    return "suspended";
  }

  if (
    [
      "past_due",
      "overdue",
      "payment_failed",
      "pago_pendiente",
      "mora",
    ].includes(norm)
  ) {
    return "past_due";
  }

  return "active";
}

function resolveGhlExpiration(params: {
  plan?: PlanTier;
  nextStatus: MembershipStatus;
  rawExpiresAt: string;
  rawDurationDays: string;
  isPermanentFlag: boolean;
}): string | null | undefined {
  const effectivePlan = params.plan ?? "reto";

  if (effectivePlan === "equipo" || params.isPermanentFlag) {
    return null;
  }

  // Opción 1: Fecha fija enviada desde GHL (expires_at / expiration_date / vencimiento)
  if (params.rawExpiresAt) {
    const raw = params.rawExpiresAt.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return new Date(`${raw}T23:59:59.999Z`).toISOString();
    }
    const numericVal = Number(raw);
    if (Number.isFinite(numericVal) && numericVal > 1_000_000_000) {
      const ms = numericVal < 10_000_000_000 ? numericVal * 1000 : numericVal;
      return new Date(ms).toISOString();
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  // Opción 2: Cantidad de días enviada desde GHL (duration_days / days / dias)
  if (params.rawDurationDays) {
    const days = Number(params.rawDurationDays);
    if (Number.isFinite(days) && days > 0 && days <= 3650) {
      return new Date(Date.now() + days * 86_400_000).toISOString();
    }
  }

  // Si es una cancelación o suspensión sin fecha nueva, no sobreescribir expires_at existente
  if (params.nextStatus !== "active") {
    return undefined;
  }

  // Opción 3: Cálculo automático según el plan cuando GHL da de alta sin enviar fecha ni días
  if (effectivePlan === "mensual") {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  }

  if (effectivePlan === "anual") {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString();
  }

  // Por defecto para Reto / VIP desde GHL si no se especificó fecha ni días: +30 días
  return new Date(Date.now() + 30 * 86_400_000).toISOString();
}

async function parseIncomingGhlBody(
  req: NextRequest
): Promise<Record<string, unknown>> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  const rawText = await req.text();
  if (!rawText.trim()) return {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawText);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of params.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  try {
    const parsed = JSON.parse(rawText);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    const params = new URLSearchParams(rawText);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of params.entries()) {
      obj[k] = v;
    }
    return obj;
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "GENY PRO - GoHighLevel (GHL) Provisioning Webhook",
    method: "POST",
  });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase no configurado" },
      { status: 500 }
    );
  }

  await getGenySettings();

  const payload = await parseIncomingGhlBody(req);
  const contactObj =
    payload.contact && typeof payload.contact === "object"
      ? (payload.contact as Record<string, unknown>)
      : {};
  const customDataObj =
    payload.customData && typeof payload.customData === "object"
      ? (payload.customData as Record<string, unknown>)
      : {};

  // Combinar campos raíz de GHL + contact + customData (customData tiene prioridad para plan/días/vencimiento)
  const merged: Record<string, unknown> = {
    ...contactObj,
    ...payload,
    ...customDataObj,
  };

  // Validar secreto GHL_WEBHOOK_SECRET (soporta Header x-ghl-secret, Authorization Bearer, Query ?secret=... o customData.secret)
  const expectedSecret = process.env.GHL_WEBHOOK_SECRET?.trim();
  if (expectedSecret) {
    const headerSecret = req.headers.get("x-ghl-secret") || "";
    const bearerSecret = (req.headers.get("authorization") || "").replace(
      /^Bearer\s+/i,
      ""
    );
    const querySecret = req.nextUrl.searchParams.get("secret") || "";
    const bodySecret =
      asCleanString(merged.secret) || asCleanString(merged.webhook_secret);

    const candidates = [
      headerSecret,
      bearerSecret,
      querySecret,
      bodySecret,
    ].filter(Boolean);

    const authorized = candidates.some((c) =>
      safeCompareSecret(expectedSecret, c)
    );
    if (!authorized) {
      return NextResponse.json(
        {
          error:
            "No autorizado: envía GHL_WEBHOOK_SECRET en el header x-ghl-secret, ?secret=... o customData.secret.",
        },
        { status: 401 }
      );
    }
  }

  const email = (
    asCleanString(merged.email) ||
    asCleanString(merged.contact_email) ||
    asCleanString(merged.customer_email)
  ).toLowerCase();

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "El campo 'email' del contacto es obligatorio." },
      { status: 400 }
    );
  }

  const explicitEventId =
    asCleanString(merged.event_id) ||
    asCleanString(merged.execution_id) ||
    asCleanString(merged.webhook_id);

  if (explicitEventId) {
    const firstTime = await claimWebhookIdempotency(
      `ghl:${explicitEventId}`,
      "ghl"
    );
    if (!firstTime) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  const firstName = asCleanString(merged.first_name || merged.firstName);
  const lastName = asCleanString(merged.last_name || merged.lastName);
  const composedName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const fullName =
    asCleanString(merged.full_name || merged.fullName || merged.name) ||
    composedName ||
    null;

  const phone =
    asCleanString(
      merged.whatsapp_phone ||
        merged.phone ||
        merged.phone_raw ||
        merged.mobile
    ) || null;

  const planTier = resolveGhlPlan(
    asCleanString(merged.plan || merged.plan_tier || merged.membership_plan)
  );

  const rawStatus = asCleanString(
    merged.status || merged.membership_status || merged.action || merged.event
  );
  const nextStatus = resolveGhlStatus(rawStatus);

  const isPermanentFlag =
    merged.permanent === true ||
    asCleanString(merged.permanent).toLowerCase() === "true";

  const expiresAt = resolveGhlExpiration({
    plan: planTier,
    nextStatus,
    rawExpiresAt: asCleanString(
      merged.expires_at || merged.expiration_date || merged.vencimiento
    ),
    rawDurationDays: asCleanString(
      merged.duration_days || merged.days || merged.dias
    ),
    isPermanentFlag,
  });

  const ghlContactId =
    asCleanString(merged.contact_id || merged.contactId || payload.id) || null;

  const workflowInfo =
    payload.workflow && typeof payload.workflow === "object"
      ? asCleanString((payload.workflow as Record<string, unknown>).name)
      : "";
  const adminNotes =
    asCleanString(merged.notes || merged.admin_notes) ||
    (workflowInfo ? `Alta vía GHL Workflow: ${workflowInfo}` : "Alta automática vía GHL");

  const forceReactivate =
    merged.reactivate === true ||
    asCleanString(merged.reactivate).toLowerCase() === "true";

  const forcePhoneUpdate =
    merged.force_update_phone === true ||
    asCleanString(merged.force_update_phone).toLowerCase() === "true";

  // Ocultar el secreto antes de guardar auditoría en geny_payment_events
  const sanitizedRawPayload: Record<string, unknown> = { ...payload };
  delete sanitizedRawPayload.secret;
  delete sanitizedRawPayload.webhook_secret;
  if (
    sanitizedRawPayload.customData &&
    typeof sanitizedRawPayload.customData === "object"
  ) {
    const cleanCustom = {
      ...(sanitizedRawPayload.customData as Record<string, unknown>),
    };
    delete cleanCustom.secret;
    delete cleanCustom.webhook_secret;
    sanitizedRawPayload.customData = cleanCustom;
  }

  const eventType =
    rawStatus || (nextStatus === "active" ? "ghl_member_upsert" : `ghl_${nextStatus}`);

  const synced = await syncPaymentMembershipEvent({
    provider: "ghl",
    eventType,
    externalEventId: explicitEventId || null,
    email,
    fullName,
    phone,
    nextStatus,
    planTier,
    expiresAt,
    adminNotes,
    forceReactivate,
    forcePhoneUpdate,
    externalIds: {
      ghl_contact_id: ghlContactId,
    },
    rawPayload: sanitizedRawPayload,
  });

  return NextResponse.json({
    ok: true,
    provider: "ghl",
    user_id: synced.userId,
    email,
    plan_tier: planTier ?? "reto",
    membership_status: synced.statusApplied,
    expires_at: expiresAt ?? null,
  });
}
