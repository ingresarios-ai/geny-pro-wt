# GENY Pro · Motor Central IA & Panel Administrativo (INGRESARIOS)

Arquitectura propia en **Next.js (App Router, TypeScript)** lista para desplegar en **Vercel (Fluid Compute)** y conectada al proyecto exclusivo de **Supabase (`geny-pro` / `gejvutumbannwaltklez` en `us-east-1`)**.

## Qué incluye este repositorio

1. **Un solo cerebro multicanal (`src/lib/geny/brain.ts`)**:
   - Activo por defecto con **Gemini 3.8 Flash** (`@ai-sdk/google`: texto, notas de voz y capturas de gráficos de forma nativa).
   - Listo para conmutar en 1 clic desde `/admin` hacia **Claude 5.5 + Whisper** (`@ai-sdk/anthropic` con *Prompt Caching* + transcripción automática en Groq/OpenAI).
   - Protocolo maestro **`GENY COMPLIANT`**, memoria de los últimos 10 mensajes del alumno y **RAG híbrido** (`pgvector` + búsqueda en español) sobre *PEDEM*, *La Rueda*, *Reditum Sniper*, *Geny Trend* y *FAQs*.
2. **Candado Anti-Piratería con cambio de dispositivo cada 90 días (`src/lib/auth/device-gate.ts`)**:
   - **1 Membresía = 1 Telegram + 1 WhatsApp activo**.
   - Validación por código OTP de 6 dígitos enviado al correo del miembro.
   - Si ya tiene un teléfono/dispositivo registrado, pregunta si desea transferir su sesión advirtiendo que **el número anterior quedará bloqueado de inmediato** (guardado como respaldo en `geny_device_history`) y que solo se permite **1 cambio cada 90 días**.
   - Cero consumo de tokens de IA para usuarios no registrados, vencidos o suspendidos.
3. **Cobros automatizados en tiempo real (3 pasarelas listas)**:
   - `POST /api/webhooks/whop`
   - `POST /api/webhooks/stripe`
   - `POST /api/webhooks/hotmart`
4. **Panel de Control (`/admin`)**:
   - Gestión de usuarios: alta manual, importación masiva CSV, activar, dar de baja, suspender en 1 clic, editar vencimiento, desvincular teléfono/Telegram, liberar bloqueo de 90 días por robo/extravío y consultar historial de teléfonos anteriores respaldados.
   - Carga y vectorización directa de documentos de conocimiento (sin depender de Google Drive en vivo).
   - Bandeja de **Revisión Semanal** (`needs_human_review`) + botón para curar y exportar tu dataset propio en formato **`.jsonl`** para futuro *fine-tuning*.

---

## Puesta en marcha rápida

### 1. Variables de entorno (`.env.local` y Vercel)
Ya tienes preconfigurada la URL y llave pública de tu proyecto `geny-pro` en `.env.local`. Completa:
- `SUPABASE_SERVICE_ROLE_KEY`: Cópiala en **Supabase Dashboard → `geny-pro` → Project Settings → API Keys**.
- `ADMIN_ACCESS_PASSWORD` y `ADMIN_SESSION_SECRET`: Tu clave segura para entrar a `/admin`.
- `GOOGLE_GENERATIVE_AI_API_KEY` (y opcionalmente `ANTHROPIC_API_KEY` + `GROQ_API_KEY` / `OPENAI_API_KEY`).
- `RESEND_API_KEY` y `EMAIL_FROM`: Para enviar los códigos OTP de vinculación al correo del alumno.

Ejecuta en local:
```bash
npm run dev
```
Abre `http://localhost:3000/admin`.

### 2. Conectar el Bot de Telegram (`@BotFather`) para el 16–20 de noviembre
Una vez desplegado tu proyecto en Vercel (`https://tu-dominio.vercel.app`), registra el webhook con tu token y `TELEGRAM_WEBHOOK_SECRET`:

```bash
curl -X POST "https://api.telegram.org/bot<TU_TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://tu-dominio.vercel.app/api/webhooks/telegram",
    "secret_token": "<TU_TELEGRAM_WEBHOOK_SECRET>"
  }'
```

### 3. Conectar WhatsApp Cloud API (Meta for Developers)
- **Callback URL:** `https://tu-dominio.vercel.app/api/webhooks/whatsapp`
- **Verify Token:** El mismo valor que pongas en `WHATSAPP_VERIFY_TOKEN`.
- Suscríbete al campo **`messages`**.

### 4. Conectar Webhooks de Cobro
- **Whop:** `https://tu-dominio.vercel.app/api/webhooks/whop` (`WHOP_WEBHOOK_SECRET`)
- **Stripe:** `https://tu-dominio.vercel.app/api/webhooks/stripe` (`STRIPE_WEBHOOK_SECRET`)
- **Hotmart:** `https://tu-dominio.vercel.app/api/webhooks/hotmart` (`HOTMART_HOTTOK`)

