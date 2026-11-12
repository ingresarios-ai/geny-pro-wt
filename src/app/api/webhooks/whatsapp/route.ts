import { NextRequest, NextResponse, after } from "next/server";
import {
  claimWebhookIdempotency,
  getGenySettings,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { verifyMemberAndDeviceGate } from "@/lib/auth/device-gate";
import {
  downloadWhatsAppMedia,
  sendWhatsAppTextMessage,
  verifyWhatsAppSignature,
} from "@/lib/channels/whatsapp";
import { runGenyBrain } from "@/lib/geny/brain";

export const maxDuration = 60;

// Verificación inicial del Webhook en Meta for Developers
export async function GET(req: NextRequest) {
  if (isSupabaseAdminConfigured()) {
    await getGenySettings();
  }
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedVerifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN?.trim() ||
    "ingresarios_geny_verify_2026";

  if (mode === "subscribe" && token && token === expectedVerifyToken) {
    return new NextResponse(challenge || "", { status: 200 });
  }

  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  if (isSupabaseAdminConfigured()) {
    await getGenySettings();
  }
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyWhatsAppSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ ok: true });
  }

  const payload = JSON.parse(rawBody) as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            id: string;
            from: string;
            type: string;
            text?: { body?: string };
            image?: { id: string; caption?: string; mime_type?: string };
            audio?: { id: string; mime_type?: string };
          }>;
        };
      }>;
    }>;
  };

  const incomingMsg = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!incomingMsg) {
    // Eventos de estado (delivered/read) se responden 200 OK sin procesar IA
    return NextResponse.json({ ok: true });
  }

  const isFirstTime = await claimWebhookIdempotency(
    `wa:${incomingMsg.id}`,
    "whatsapp"
  );
  if (!isFirstTime) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  after(async () => {
    try {
      const settings = await getGenySettings();
      const senderPhone = incomingMsg.from;
      const rawText = (
        incomingMsg.text?.body ||
        incomingMsg.image?.caption ||
        ""
      ).trim();

      const gate = await verifyMemberAndDeviceGate({
        channel: "whatsapp",
        senderIdentifier: senderPhone,
        incomingText: rawText,
        settings,
      });

      if (!gate.allowed) {
        if (!gate.silentDrop) {
          await sendWhatsAppTextMessage(senderPhone, gate.replyText);
        }
        return;
      }

      let inputType: "text" | "audio" | "image" = "text";
      let mediaBuffer: Buffer | undefined;
      let mediaMimeType: string | undefined;

      if (incomingMsg.type === "audio" && incomingMsg.audio?.id) {
        inputType = "audio";
        const downloaded = await downloadWhatsAppMedia(incomingMsg.audio.id);
        mediaBuffer = downloaded.buffer;
        mediaMimeType = downloaded.mimeType;
      } else if (incomingMsg.type === "image" && incomingMsg.image?.id) {
        inputType = "image";
        const downloaded = await downloadWhatsAppMedia(incomingMsg.image.id);
        mediaBuffer = downloaded.buffer;
        mediaMimeType = downloaded.mimeType;
      } else if (incomingMsg.type !== "text") {
        await sendWhatsAppTextMessage(
          senderPhone,
          "Por ahora puedo ayudarte con mensajes de texto, notas de voz y capturas de pantalla de tus gráficos 💜."
        );
        return;
      }

      const result = await runGenyBrain({
        user: gate.user,
        settings,
        channel: "whatsapp",
        inputType,
        text: rawText,
        mediaBuffer,
        mediaMimeType,
      });

      await sendWhatsAppTextMessage(senderPhone, result.replyText);
    } catch (err) {
      console.error("[WHATSAPP WEBHOOK ERROR]", err);
    }
  });

  return NextResponse.json({ ok: true });
}

