import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  claimWebhookIdempotency,
  getGenySettings,
  MembershipStatus,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { syncPaymentMembershipEvent } from "@/lib/billing/sync-membership";

function verifyStripeSignature(rawBody: string, sigHeader: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!sigHeader) return false;

  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k.trim(), v];
    })
  );

  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  if (v1.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ ok: true });
  }
  await getGenySettings();

  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature");

  if (!verifyStripeSignature(rawBody, sigHeader)) {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as {
    id: string;
    type: string;
    data?: {
      object?: {
        id?: string;
        customer?: string;
        subscription?: string;
        customer_email?: string;
        receipt_email?: string;
        customer_details?: { email?: string; name?: string; phone?: string };
        status?: string;
        current_period_end?: number;
      };
    };
  };

  const firstTime = await claimWebhookIdempotency(`stripe:${event.id}`, "stripe");
  if (!firstTime) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const obj = event.data?.object;
  const email =
    obj?.customer_details?.email || obj?.customer_email || obj?.receipt_email;

  if (!email) {
    return NextResponse.json({ ok: true, note: "no_email_in_stripe_event" });
  }

  let nextStatus: MembershipStatus | null = null;
  if (
    event.type === "checkout.session.completed" ||
    event.type === "invoice.paid" ||
    event.type === "customer.subscription.created"
  ) {
    nextStatus = "active";
  } else if (event.type === "invoice.payment_failed") {
    nextStatus = "past_due";
  } else if (
    event.type === "customer.subscription.deleted" ||
    event.type === "charge.refunded"
  ) {
    nextStatus = "canceled";
  } else if (event.type === "customer.subscription.updated") {
    nextStatus =
      obj?.status === "active" || obj?.status === "trialing"
        ? "active"
        : obj?.status === "past_due"
          ? "past_due"
          : "canceled";
  }

  if (!nextStatus) {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const expiresAt = obj?.current_period_end
    ? new Date(obj.current_period_end * 1000).toISOString()
    : undefined;

  await syncPaymentMembershipEvent({
    provider: "stripe",
    eventType: event.type,
    externalEventId: event.id,
    email,
    fullName: obj?.customer_details?.name || null,
    phone: obj?.customer_details?.phone || null,
    nextStatus,
    expiresAt,
    externalIds: {
      stripe_customer_id:
        typeof obj?.customer === "string" ? obj.customer : null,
      stripe_subscription_id:
        typeof obj?.subscription === "string"
          ? obj.subscription
          : event.type.startsWith("customer.subscription")
            ? obj?.id || null
            : null,
    },
    rawPayload: event as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true });
}

