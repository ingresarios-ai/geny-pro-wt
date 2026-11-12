const TG_API_BASE = "https://api.telegram.org";

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN no está configurado.");
  }
  return token;
}

export async function sendTelegramTyping(chatId: string | number): Promise<void> {
  try {
    const token = getBotToken();
    await fetch(`${TG_API_BASE}/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {
    // Non-critical visual indicator
  }
}

function formatTelegramHtml(rawText: string): string {
  // 1. Quitar backticks alrededor de URLs para que Telegram las vuelva enlaces clicables en 1 toque
  const unwrappedUrls = rawText.replace(/`(https?:\/\/[^\s`]+)`/gi, "$1");

  // 2. Escapar caracteres especiales HTML
  let html = unwrappedUrls
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 3. Bloques de código triple ```...``` y código inline `...` (sin atrapar URLs)
  html = html.replace(/```([\s\S]*?)```/g, "<pre>$1</pre>");
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // 4. Enlaces Markdown [texto](https://...) -> <a href="...">texto</a>
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>'
  );

  // 5. Negritas **texto** -> <b>texto</b>
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

  return html;
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string
): Promise<void> {
  const token = getBotToken();
  // Quitar backticks envolviendo URLs también para el fallback de texto plano
  const cleanText = text.replace(/`(https?:\/\/[^\s`]+)`/gi, "$1");

  // Telegram limit is 4096 chars; split safely if longer
  const chunks: string[] = [];
  for (let i = 0; i < cleanText.length; i += 3600) {
    chunks.push(cleanText.slice(i, i + 3600));
  }

  for (const part of chunks) {
    const res = await fetch(`${TG_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatTelegramHtml(part),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      // Fallback sin parse_mode por si algún formato rompe el parser de Telegram
      await fetch(`${TG_API_BASE}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: part.replace(/\*\*/g, ""),
          disable_web_page_preview: true,
        }),
      });
    }
  }
}

export async function downloadTelegramFile(
  fileId: string
): Promise<{ buffer: Buffer; filePath: string }> {
  const token = getBotToken();
  const metaRes = await fetch(
    `${TG_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  if (!metaRes.ok) {
    throw new Error("No se pudo consultar getFile en Telegram.");
  }
  const metaJson = (await metaRes.json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  const filePath = metaJson.result?.file_path;
  if (!filePath) {
    throw new Error("Telegram no devolvió file_path.");
  }

  const binRes = await fetch(`${TG_API_BASE}/file/bot${token}/${filePath}`);
  if (!binRes.ok) {
    throw new Error("Error descargando archivo binario de Telegram.");
  }
  const arr = await binRes.arrayBuffer();
  return { buffer: Buffer.from(arr), filePath };
}

export async function isTelegramUserInWhopGroup(
  groupChatId: string,
  telegramUserId: string | number
): Promise<boolean> {
  try {
    const token = getBotToken();
    const res = await fetch(`${TG_API_BASE}/bot${token}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: groupChatId,
        user_id: Number(telegramUserId),
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      ok: boolean;
      result?: { status?: string };
    };
    const status = data.result?.status;
    return (
      status === "member" ||
      status === "administrator" ||
      status === "creator"
    );
  } catch {
    return false;
  }
}

