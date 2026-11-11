import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  claimWebhookIdempotency,
  getGenySettings,
  MembershipStatus,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { syncPaymentMembershipEvent } from "@/lib/billing/sync-membership";

function verifyWhopSignature(rawBody: string, headerSig: string | null): boolean {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!headerSig) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const cleanHeader = headerSig.replace(/^sha256=/, "");
  if (cleanHeader.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(cleanHeader),
    Buffer.from(expected)
  );
}

export async function POST(req: NextRequest) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ ok: true });
  }
  await getGenySettings();

  const rawBody = await req.text();
  const sig =
    req.headers.get("whop-signature") ||
    req.headers.get("x-whop-signature") ||
    req.headers.get("webhook-signature");

  if (!verifyWhopSignature(rawBody, sig)) {
    return NextResponse.json({ error: "Invalid Whop signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    id?: string;
    action?: string;
    type?: string;
    data?: {
      id?: string;
      status?: string;
      valid?: boolean;
      renewal_period_end?: number | string;
      expires_at?: number | string;
      user?: { id?: string; email?: string; name?: string; username?: string };
      email?: string;
    };
  };

  const eventType = payload.action || payload.type || "unknown";
  const eventId = payload.id || `${eventType}:${payload.data?.id || Date.now()}`;

  const firstTime = await claimWebhookIdempotency(`whop:${eventId}`, "whop");
  if (!firstTime) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const email = payload.data?.user?.email || payload.data?.email;
  if (!email) {
    return NextResponse.json({ ok: true, note: "no_email_in_whop_event" });
  }

  let nextStatus: MembershipStatus = "active";
  if (
    eventType.includes("went_invalid") ||
    eventType.includes("deactivated") ||
    eventType.includes("canceled") ||
    payload.data?.valid === false
  ) {
    nextStatus = "canceled";
  } else if (eventType.includes("payment_failed") || payload.data?.status === "past_due") {
    nextStatus = "past_due";
  }

  const rawExp = payload.data?.renewal_period_end || payload.data?.expires_at;
  const expiresAt =
    typeof rawExp === "number"
      ? new Date(rawExp * 1000).toISOString()
      : typeof rawExp === "string"
        ? new Date(rawExp).toISOString()
        : undefined;

  await syncPaymentMembershipEvent({
    provider: "whop",
    eventType,
    externalEventId: eventId,
    email,
    fullName: payload.data?.user?.name || payload.data?.user?.username || null,
    nextStatus,
    expiresAt,
    externalIds: {
      whop_user_id: payload.data?.user?.id || null,
      whop_membership_id: payload.data?.id || null,
    },
    rawPayload: payload as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true });
}

