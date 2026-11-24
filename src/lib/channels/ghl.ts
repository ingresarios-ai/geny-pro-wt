import { getSupabaseAdmin } from "@/lib/supabase/admin";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
const DEFAULT_GHL_LOCATION_ID = "jTugwykceKyJlATOSvkb";

function formatBogotaTimestamp(date = new Date()): string {
  try {
    return date.toLocaleString("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return date.toISOString();
  }
}

async function resolveGhlContactIdByEmail(params: {
  apiKey: string;
  email: string;
  userId?: string | null;
  locationIdHint?: string | null;
}): Promise<string | null> {
  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanEmail) return null;

  const locationId =
    params.locationIdHint?.trim() ||
    process.env.GHL_LOCATION_ID?.trim() ||
    DEFAULT_GHL_LOCATION_ID;

  try {
    const url = new URL(`${GHL_API_BASE}/contacts/`);
    url.searchParams.set("locationId", locationId);
    url.searchParams.set("query", cleanEmail);
    url.searchParams.set("limit", "5");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Version: GHL_API_VERSION,
        Accept: "application/json",
      },
    });

    if (!res.ok) return null;
    const json = (await res.json()) as {
      contacts?: Array<{ id?: string; email?: string }>;
    };

    const exact = (json.contacts || []).find(
      (c) => (c.email || "").trim().toLowerCase() === cleanEmail
    );
    const contactId = exact?.id || json.contacts?.[0]?.id || null;

    if (contactId && params.userId) {
      const supabase = getSupabaseAdmin();
      await supabase
        .from("geny_users")
        .update({ ghl_contact_id: contactId })
        .eq("id", params.userId);
    }

    return contactId;
  } catch {
    return null;
  }
}

/**
 * Agrega una nota informativa en la pestaña "Notes" del contacto en GoHighLevel
 * (sin modificar ni agregar ningún Tag). No bloquea el flujo principal si GHL falla.
 */
export async function appendGhlContactNote(params: {
  ghlContactId?: string | null;
  email?: string | null;
  userId?: string | null;
  locationIdHint?: string | null;
  noteBody: string;
}): Promise<{ posted: boolean }> {
  const apiKey = process.env.GHL_PRIVATE_API_KEY?.trim();
  if (!apiKey) {
    return { posted: false };
  }

  let contactId = params.ghlContactId?.trim() || null;
  if (!contactId && params.email) {
    contactId = await resolveGhlContactIdByEmail({
      apiKey,
      email: params.email,
      userId: params.userId,
      locationIdHint: params.locationIdHint,
    });
  }

  if (!contactId) {
    return { posted: false };
  }

  try {
    const res = await fetch(
      `${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}/notes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: GHL_API_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          body: params.noteBody,
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[GHL NOTE ERROR]", res.status, errText);
      return { posted: false };
    }

    return { posted: true };
  } catch (err) {
    console.error("[GHL NOTE EXCEPTION]", err);
    return { posted: false };
  }
}

export function buildGhlWelcomeNote(params: {
  email: string;
  delivered: boolean;
  resendId?: string;
}): string {
  const stamp = formatBogotaTimestamp();
  if (params.delivered) {
    return (
      `✅ [GENY PRO · Alta y Correo de Bienvenida Enviado]\n` +
      `• Estado en GENY PRO: Membresía ACTIVA\n` +
      `• Correo enviado a: ${params.email}\n` +
      `• Fecha y hora (COL): ${stamp}` +
      (params.resendId ? `\n• ID de entrega (Resend): ${params.resendId}` : "")
    );
  }
  return (
    `⚠️ [GENY PRO · Alerta de Correo]\n` +
    `• La membresía quedó ACTIVA en GENY PRO, pero falló la entrega del correo de bienvenida a: ${params.email}\n` +
    `• Fecha y hora (COL): ${stamp}\n` +
    `• Acción sugerida: Verificar que el correo del contacto esté bien escrito.`
  );
}

export function buildGhlDeactivationNote(params: {
  email: string;
  status: string;
}): string {
  const stamp = formatBogotaTimestamp();
  return (
    `🔒 [GENY PRO · Membresía Desactivada]\n` +
    `• Nuevo estado en GENY PRO: ${params.status.toUpperCase()}\n` +
    `• Usuario: ${params.email}\n` +
    `• Fecha y hora (COL): ${stamp}`
  );
}

export function buildGhlOtpSentNote(params: {
  email: string;
  channel: "telegram" | "whatsapp";
  otpCode: string;
  delivered: boolean;
}): string {
  const stamp = formatBogotaTimestamp();
  const channelLabel = params.channel === "whatsapp" ? "WhatsApp" : "Telegram";
  return (
    `🔐 [GENY PRO · Código de Activación de Dispositivo]\n` +
    `• Canal solicitado: ${channelLabel}\n` +
    `• Código OTP (6 dígitos): ${params.otpCode} (vigente por 15 minutos)\n` +
    `• Enviado al correo: ${params.email} (${params.delivered ? "Entregado" : "Error al enviar correo"})\n` +
    `• Fecha y hora (COL): ${stamp}`
  );
}

export function buildGhlDeviceBoundNote(params: {
  channel: "telegram" | "whatsapp";
  identifier: string;
}): string {
  const stamp = formatBogotaTimestamp();
  const channelLabel = params.channel === "whatsapp" ? "WhatsApp" : "Telegram";
  return (
    `🎉 [GENY PRO · Dispositivo Activado con Éxito]\n` +
    `• El alumno ingresó su código OTP y vinculó su sesión en ${channelLabel} (${params.identifier}).\n` +
    `• Fecha y hora (COL): ${stamp}`
  );
}
