import { NextRequest, NextResponse } from "next/server";
import {
  claimWebhookIdempotency,
  getGenySettings,
  MembershipStatus,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { syncPaymentMembershipEvent } from "@/lib/billing/sync-membership";

export async function POST(req: NextRequest) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ ok: true });
  }
  await getGenySettings();

  const expectedHottok = process.env.HOTMART_HOTTOK;
  if (expectedHottok) {
    const incomingHottok = req.headers.get("x-hotmart-hottok");
    if (incomingHottok !== expectedHottok) {
      return NextResponse.json({ error: "Invalid Hotmart Hottok" }, { status: 401 });
    }
  }

  const payload = (await req.json()) as {
    id?: string;
    event?: string;
    data?: {
      buyer?: {
        email?: string;
        name?: string;
        checkout_phone?: string;
        phone?: string;
      };
      subscription?: {
        subscriber?: { code?: string };
      };
      purchase?: {
        transaction?: string;
        date_next_charge?: number;
      };
    };
  };

  const eventType = payload.event || "UNKNOWN";
  const eventId =
    payload.id ||
    `${eventType}:${payload.data?.purchase?.transaction || Date.now()}`;

  const firstTime = await claimWebhookIdempotency(
    `hotmart:${eventId}`,
    "hotmart"
  );
  if (!firstTime) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const email = payload.data?.buyer?.email;
  if (!email) {
    return NextResponse.json({ ok: true, note: "no_buyer_email" });
  }

  let nextStatus: MembershipStatus | null = null;
  if (
    eventType === "PURCHASE_APPROVED" ||
    eventType === "PURCHASE_COMPLETE" ||
    eventType === "SWITCH_PLAN"
  ) {
    nextStatus = "active";
  } else if (
    eventType === "PURCHASE_DELAYED" ||
    eventType === "PURCHASE_OVERDUE"
  ) {
    nextStatus = "past_due";
  } else if (
    eventType === "PURCHASE_CANCELED" ||
    eventType === "PURCHASE_REFUNDED" ||
    eventType === "PURCHASE_CHARGEBACK" ||
    eventType === "SUBSCRIPTION_CANCELLATION"
  ) {
    nextStatus = "canceled";
  }

  if (!nextStatus) {
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  const nextCharge = payload.data?.purchase?.date_next_charge;
  const expiresAt =
    typeof nextCharge === "number"
      ? new Date(nextCharge).toISOString()
      : undefined;

  await syncPaymentMembershipEvent({
    provider: "hotmart",
    eventType,
    externalEventId: eventId,
    email,
    fullName: payload.data?.buyer?.name || null,
    phone:
      payload.data?.buyer?.checkout_phone ||
      payload.data?.buyer?.phone ||
      null,
    nextStatus,
    expiresAt,
    externalIds: {
      hotmart_subscriber_code:
        payload.data?.subscription?.subscriber?.code || null,
    },
    rawPayload: payload as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true });
}

