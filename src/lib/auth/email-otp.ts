export async function sendVerificationOtpEmail(params: {
  to: string;
  fullName?: string | null;
  otpCode: string;
  channel: "telegram" | "whatsapp";
}): Promise<{ delivered: boolean }> {
  const resendKey = process.env.RESEND_API_KEY;
  const from =
    process.env.EMAIL_FROM ||
    "GENY PRO - INGRESARIOS <genypro@mail.ingresarios.net>";
  const channelLabel = params.channel === "whatsapp" ? "WhatsApp" : "Telegram";
  const greeting = params.fullName ? `Hola ${params.fullName},` : "Hola,";

  if (!resendKey) {
    console.info(
      `[GENY OTP DEV] Canal=${channelLabel} | Email=${params.to} | Código=${params.otpCode}`
    );
    return { delivered: true };
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 28px; background: #0f172a; color: #f8fafc; border-radius: 16px;">
      <h2 style="margin: 0 0 12px; color: #a78bfa;">Activación de GENY PRO en ${channelLabel}</h2>
      <p style="color: #cbd5e1; line-height: 1.6;">${greeting}</p>
      <p style="color: #cbd5e1; line-height: 1.6;">Usa el siguiente código de verificación para vincular tu sesión de <strong>${channelLabel}</strong> con tu membresía de INGRESARIOS:</p>
      <div style="margin: 24px 0; padding: 18px; background: #1e293b; border: 1px solid #8b5cf6; border-radius: 12px; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #f8fafc;">
        ${params.otpCode}
      </div>
      <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">Este código vence en 15 minutos. Si no solicitaste este acceso, ignora este correo.</p>
      <p style="color: #a78bfa; font-size: 14px; margin-top: 20px;">¡Yo honro tu proceso!</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: `${params.otpCode} es tu código de acceso a GENY PRO (${channelLabel})`,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[GENY OTP ERROR]", errText);
    return { delivered: false };
  }

  return { delivered: true };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendMemberWelcomeEmail(params: {
  to: string;
  fullName?: string | null;
}): Promise<{ delivered: boolean }> {
  const resendKey = process.env.RESEND_API_KEY;
  const from =
    process.env.EMAIL_FROM ||
    "GENY PRO - INGRESARIOS <genypro@mail.ingresarios.net>";

  const cleanEmail = params.to.trim().toLowerCase();
  const firstName = params.fullName?.trim().split(/\s+/)[0] || "";
  const greeting = firstName
    ? `Hola ${escapeHtml(firstName)},`
    : "Hola,";
  const telegramUrl = "https://t.me/GenyProIngresariosBot";

  if (!resendKey) {
    console.info(
      `[GENY WELCOME DEV] Email=${cleanEmail} | Nombre=${params.fullName || ""}`
    );
    return { delivered: true };
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 28px; background: #0b0e17; color: #f8fafc; border-radius: 20px; border: 1px solid #1e293b;">
      <div style="margin-bottom: 24px;">
        <span style="display: inline-block; width: 42px; height: 42px; line-height: 42px; text-align: center; border-radius: 12px; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: #ffffff; font-family: monospace; font-weight: 800; font-size: 15px; vertical-align: middle;">GP</span>
        <span style="display: inline-block; margin-left: 10px; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; color: #ffffff; vertical-align: middle;">GENY PRO</span>
        <span style="display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 6px; background: rgba(139, 92, 246, 0.18); color: #c4b5fd; font-size: 11px; font-weight: 700; text-transform: uppercase; vertical-align: middle;">INGRESARIOS</span>
      </div>

      <h2 style="margin: 0 0 14px; font-size: 22px; font-weight: 800; color: #ffffff; line-height: 1.3;">
        ¡Tu acceso a GENY PRO ya está activo!
      </h2>

      <p style="margin: 0 0 14px; color: #cbd5e1; font-size: 15px; line-height: 1.65;">
        ${greeting}
      </p>

      <p style="margin: 0 0 20px; color: #cbd5e1; font-size: 15px; line-height: 1.65;">
        Te damos la bienvenida a <strong>GENY PRO</strong>, tu mentora oficial de inteligencia artificial del ecosistema <strong>INGRESARIOS</strong> para acompañarte con criterio propio en tus planes operativos, método PEDEM, La Rueda, análisis de gráficos y psicotrading.
      </p>

      <div style="margin: 22px 0; padding: 20px; background: #131826; border: 1px solid rgba(139, 92, 246, 0.35); border-radius: 16px;">
        <p style="margin: 0 0 12px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #c4b5fd;">
          Cómo activar tu sesión en 3 pasos:
        </p>
        <ol style="margin: 0; padding-left: 20px; color: #e2e8f0; font-size: 14px; line-height: 1.75;">
          <li>Abre el bot oficial haciendo clic en el botón de abajo (o busca <strong>@GenyProIngresariosBot</strong> en Telegram).</li>
          <li>Presiona <strong>Iniciar</strong> y envía tu correo registrado: <strong style="color: #ffffff;">${escapeHtml(cleanEmail)}</strong></li>
          <li>Ingresa el código de seguridad de 6 dígitos que recibirás en este correo para vincular tu dispositivo.</li>
        </ol>
      </div>

      <div style="margin: 28px 0; text-align: center;">
        <a href="${telegramUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 28px; background: linear-gradient(90deg, #7c3aed, #4f46e5); color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 12px;">
          Abrir GENY PRO en Telegram &rarr;
        </a>
      </div>

      <p style="margin: 0 0 16px; color: #94a3b8; font-size: 13px; line-height: 1.6;">
        Una vez vinculada tu cuenta, podrás escribirle tus dudas, enviarle notas de voz contando cómo te sentiste en tu sesión o compartirle capturas de tus gráficos para revisarlos juntos.
      </p>

      <hr style="border: 0; border-top: 1px solid #1e293b; margin: 22px 0;" />

      <p style="margin: 0; color: #a78bfa; font-size: 14px; font-weight: 700;">
        ¡Yo honro tu proceso! 💜
      </p>
      <p style="margin: 4px 0 0; color: #64748b; font-size: 12px;">
        Equipo INGRESARIOS · Enlace directo: ${telegramUrl}
      </p>
    </div>
  `;

  const text =
    `${firstName ? `Hola ${firstName},` : "Hola,"}\n\n` +
    `¡Tu acceso a GENY PRO (INGRESARIOS) ya está activo!\n\n` +
    `Cómo activar tu sesión en 3 pasos:\n` +
    `1. Abre el bot oficial en Telegram: ${telegramUrl}\n` +
    `2. Presiona Iniciar y escribe tu correo registrado: ${cleanEmail}\n` +
    `3. Ingresa el código de seguridad de 6 dígitos que llegará a tu correo.\n\n` +
    `¡Yo honro tu proceso!\n` +
    `Equipo INGRESARIOS`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [cleanEmail],
        subject: "¡Bienvenido a GENY PRO! Tu acceso en INGRESARIOS ya está activo",
        html,
        text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[GENY WELCOME EMAIL ERROR]", errText);
      return { delivered: false };
    }

    return { delivered: true };
  } catch (err) {
    console.error("[GENY WELCOME EMAIL EXCEPTION]", err);
    return { delivered: false };
  }
}

