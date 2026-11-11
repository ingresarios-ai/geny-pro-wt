import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import { getGenySettings, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (isSupabaseAdminConfigured()) {
    await getGenySettings();
  }

  const rawOrigin = req.nextUrl.origin;
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    (rawOrigin.includes("localhost") || rawOrigin.includes(".vercel.app")
      ? "https://genypro.ingresarios.ai"
      : rawOrigin);
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const telegramSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  const whatsappVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || "";

  let telegramBotInfo: {
    ok: boolean;
    username?: string;
    firstName?: string;
    webhookUrl?: string;
    pendingUpdateCount?: number;
    lastErrorMessage?: string;
  } = { ok: false };

  if (telegramToken) {
    try {
      const [meRes, whRes] = await Promise.all([
        fetch(`https://api.telegram.org/bot${telegramToken}/getMe`, {
          cache: "no-store",
        }),
        fetch(`https://api.telegram.org/bot${telegramToken}/getWebhookInfo`, {
          cache: "no-store",
        }),
      ]);
      const meJson = (await meRes.json()) as {
        ok?: boolean;
        result?: { username?: string; first_name?: string };
      };
      const whJson = (await whRes.json()) as {
        ok?: boolean;
        result?: {
          url?: string;
          pending_update_count?: number;
          last_error_message?: string;
        };
      };

      if (meJson.ok && meJson.result) {
        telegramBotInfo = {
          ok: true,
          username: meJson.result.username,
          firstName: meJson.result.first_name,
          webhookUrl: whJson.result?.url || "",
          pendingUpdateCount: whJson.result?.pending_update_count ?? 0,
          lastErrorMessage: whJson.result?.last_error_message,
        };
      }
    } catch {
      telegramBotInfo = { ok: false };
    }
  }

  return NextResponse.json({
    origin,
    webhooks: {
      telegram: `${origin}/api/webhooks/telegram`,
      whatsapp: `${origin}/api/webhooks/whatsapp`,
      whop: `${origin}/api/webhooks/whop`,
      stripe: `${origin}/api/webhooks/stripe`,
      hotmart: `${origin}/api/webhooks/hotmart`,
    },
    secretsConfigured: {
      telegramToken: Boolean(telegramToken),
      telegramSecret: Boolean(telegramSecret),
      whatsappVerifyToken,
      whopSecret: Boolean(process.env.WHOP_WEBHOOK_SECRET),
      stripeSecret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      hotmartHottok: Boolean(process.env.HOTMART_HOTTOK),
    },
    telegramBotInfo,
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (isSupabaseAdminConfigured()) {
    await getGenySettings();
  }

  const body = (await req.json()) as {
    publicBaseUrl?: string;
  };

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramToken) {
    return NextResponse.json(
      {
        error:
          "Primero agrega TELEGRAM_BOT_TOKEN (de @BotFather) en tu archivo .env.local o en Vercel.",
      },
      { status: 400 }
    );
  }

  const baseUrl = (body.publicBaseUrl || req.nextUrl.origin)
    .trim()
    .replace(/\/+$/, "");

  if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    return NextResponse.json(
      {
        error:
          "Telegram exige una URL pública HTTPS (ej. https://genypro.ingresarios.ai) para registrar el webhook.",
      },
      { status: 400 }
    );
  }

  const webhookUrl = `${baseUrl}/api/webhooks/telegram`;
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

  const res = await fetch(
    `https://api.telegram.org/bot${telegramToken}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        ...(secretToken ? { secret_token: secretToken } : {}),
        allowed_updates: ["message", "edited_message"],
      }),
    }
  );

  const json = (await res.json()) as {
    ok?: boolean;
    description?: string;
  };

  if (!res.ok || !json.ok) {
    return NextResponse.json(
      {
        error:
          json.description ||
          "No fue posible registrar el webhook en Telegram.",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    webhookUrl,
    description: json.description,
  });
}

