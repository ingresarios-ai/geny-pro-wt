import crypto from "crypto";

const GRAPH_VERSION = "v21.0";

export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true; // Si aún no configuran APP_SECRET en pruebas
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  const sigBuf = Buffer.from(signatureHeader);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export async function sendWhatsAppTextMessage(
  toPhone: string,
  bodyText: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_ACCESS_TOKEN no configurados."
    );
  }

  const cleanRecipient = toPhone.replace(/[^\d]/g, "");
  // Convertir negritas estilo Markdown **texto** a negrita nativa de WhatsApp *texto*
  const waFormatted = bodyText.replace(/\*\*(.+?)\*\*/g, "*$1*");

  const chunks: string[] = [];
  for (let i = 0; i < waFormatted.length; i += 3800) {
    chunks.push(waFormatted.slice(i, i + 3800));
  }

  for (const part of chunks) {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanRecipient,
          type: "text",
          text: { preview_url: false, body: part },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[WHATSAPP SEND ERROR]", errText);
    }
  }
}

export async function downloadWhatsAppMedia(
  mediaId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN no configurado.");
  }

  const metaRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!metaRes.ok) {
    throw new Error("No se pudo obtener la URL del archivo en WhatsApp Cloud API.");
  }

  const metaJson = (await metaRes.json()) as {
    url?: string;
    mime_type?: string;
  };
  if (!metaJson.url) {
    throw new Error("Meta no devolvió URL de descarga.");
  }

  const binRes = await fetch(metaJson.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!binRes.ok) {
    throw new Error("Error descargando binario desde Meta Cloud API.");
  }

  const arr = await binRes.arrayBuffer();
  return {
    buffer: Buffer.from(arr),
    mimeType: metaJson.mime_type || "application/octet-stream",
  };
}

