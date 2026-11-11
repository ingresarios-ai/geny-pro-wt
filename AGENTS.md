# Memoria y Reglas del Proyecto GENY PRO (INGRESARIOS)

Este archivo se carga automáticamente como memoria persistente del espacio de trabajo `/Users/josuegarcia/Antigravity/GENY MODELO`. Si una sesión se reinicia o el computador se apaga, lee este documento y `ESTADO_PROYECTO_GENY_PRO.md` antes de realizar cualquier cambio.

## 1. Identidad y Reglas de Marca
- **Nombre oficial:** Siempre escribir **`GENY PRO`** (en mayúsculas) en toda la interfaz, correos transaccionales, prompts del sistema y respuestas de bots.
- **Iconografía:** No usar el ícono genérico de estrellitas de IA (`Sparkles`) en el logotipo; usar siempre el monograma geométrico **`GP`**.
- **Idioma:** Español conciso y claro.

## 2. Infraestructura Activa (100% en la Nube)
- **Dominio Oficial en Producción:** **`https://genypro.ingresarios.ai/`** (desplegado en **Vercel Pro · Fluid Compute**, región `iad1` / `us-east-1`).
- **Repositorio GitHub:** `https://github.com/ingresarios-ai/geny-pro-wt` (rama `main`, despliegue automático en Vercel).
- **Bot Oficial de Telegram:** `@GenyProIngresariosBot` (Webhook activo en `https://genypro.ingresarios.ai/api/webhooks/telegram`).
- **Framework:** Next.js 15 (App Router, TypeScript, Tailwind CSS v4) ejecutándose localmente en el puerto `3005` (`npx next dev -p 3005`).
- **Base de Datos Supabase (Producción):**
  - **Proyecto:** `geny-pro` (Project ID: `gejvutumbannwaltklez`, Región: `us-east-1`, Organización: `Ingresarios` `yhmhwvcmpllqiaziliji`).
  - **Seguridad:** Las 10 tablas del esquema `public` tienen RLS habilitado (`service_role` exclusivo desde el servidor).
- **Correo Transaccional (OTP Anti-Piratería):**
  - **Resend API** activa y verificada.
  - **Remitente oficial (`EMAIL_FROM`):** `GENY PRO - INGRESARIOS <genypro@mail.ingresarios.net>`.
- **Motor IA (`src/lib/geny/brain.ts`):**
  - **Motor Principal:** Google Gemini (`gemini-3.8-flash` con failover automático a `gemini-3.5-flash` y `gemini-3.5-flash-lite`, `maxTokens: 4096`, `thinkingBudget: 256`).
  - **Motor Secundario (Conmutable en 1 clic):** Anthropic Claude (`claude-sonnet-5-5` / `claude-haiku-5-5`) + Whisper (Groq / OpenAI).
  - **RAG Vectorial:** `gemini-embedding-001` a **768 dimensiones** (`vector(768)` en `public.geny_knowledge_chunks` + función RPC `search_geny_knowledge`).

## 3. Reglas de Negocio Implementadas
1. **Planes y Vencimientos (`geny_users`):**
   - `reto` (Reto): Fecha de vencimiento manual obligatoria.
   - `mensual` (Mensual): Vencimiento automático a +1 mes desde la fecha de alta.
   - `vip` (VIP / Becado): Fecha de vencimiento manual obligatoria.
   - `equipo` (Equipo INGRESARIOS): Permanente (`expires_at = null`).
2. **Candado Anti-Piratería de 90 Días (`src/lib/auth/device-gate.ts`):**
   - `1 Membresía = 1 Telegram activo + 1 WhatsApp activo`.
   - Vinculación mediante código OTP de 6 dígitos enviado por correo.
   - Si el miembro cambia de dispositivo, se respalda el anterior en `geny_device_history` (`previous_status = 'revoked'`), se bloquea de inmediato el dispositivo viejo y se activa el candado de 90 días (`last_whatsapp_change_at` / `last_telegram_change_at`).
3. **Gestión Completa de Usuarios y Filtros Inteligentes (`/admin`):**
   - Edición completa de usuario en modal (`Editar / Ficha`): nombre, email, teléfono WhatsApp (normalizado a E.164 con respaldo automático en historial), Telegram ID y `@username`, plan, estado y fecha de vencimiento.
   - Filtros combinables en **Usuarios y Candado 90d**: Plan, Vencimiento (`≤ 7d`, `≤ 15d`, `≤ 30d`, `Vencidos`, `Permanentes`), Estado, Dispositivos/Candado 90d, Origen, Ordenamiento inteligente y **Exportación CSV de la vista filtrada** (`handleExportFilteredCsv`).
4. **Ingesta Multimodal RAG en Segundo Plano (Opciones A y B en `/api/admin/knowledge/ingest`):**
   - **Categorización Automática IA por defecto (`__auto__`):** Opción predeterminada `"Colocar en categoría automáticamente (IA analiza o crea una nueva)"` mediante `resolveOrAutoClassifyCategory`, además de categorías existentes o manuales (`+ Crear otra categoría...`).
   - **Opción A (Drag & Drop + Libros Pesados hasta 100 MB):** Subida directa firmada a Supabase Storage (`geny-knowledge-temp`) con barra de progreso real (`0–100%`) + Gemini File API para archivos > 5 MB (`maxDuration = 300`).
   - **Opción B (URLs Web + Documentos o Carpetas Completas de Google Drive):** Soporta páginas web públicas, enlaces directos de documentos y carpetas públicas completas de Drive (ej. 20+ archivos expandidos con `expand_targets` y procesados 1 por 1 en cola) + botón `Re-leer`.
   - **Monitor Persistente en 2.º Plano:** Cajón flotante global en `/admin` (`Subiendo %` → `Analizando IA` → `Completado` / `Error`) activo aunque se cambie de pestaña, más visor/editor (`Ver / Editar`) e insignia **`Cerebro IA Conectado 768 dims`**.
5. **Bóveda de APIs en Tiempo Real + Zona de Peligro (`/admin` → Motor IA, APIs y Reglas):**
   - Las 14 llaves/tokens (`MANAGED_SECRET_KEYS`) se pueden actualizar desde `/admin` y se guardan en `geny_settings.runtime_secrets` en Supabase con hot-reload inmediato.
   - Alerta obligatoria de **Zona de Peligro** antes de desbloquear la edición y botón **`Restaurar a la Última Versión Funcional`** (`geny_settings_snapshots` / `previous_working_snapshot`).

## 4. Punto Exacto Donde Nos Quedamos (Próximo Paso Seleccionado)
- **Estado actual:** **Producción en vivo en `https://genypro.ingresarios.ai/`** con `@GenyProIngresariosBot` conectado por Webhook HTTPS seguro (`iad1`). Listo para **Paso 4: Prueba real en vivo en Telegram** (alta/verificación de miembro con OTP por correo + conversación real con `GENY PRO`).
- **Pendientes posteriores en hoja de ruta:**
  - Ofrecer/implementar la **Opción C de Google Drive** (sincronización con carpetas privadas vía Google Service Account) si el usuario lo requiere tras probar las Opciones A y B.
  - Carga de manuales reales en el RAG e importación de alumnos activos por CSV.
  - Conexión de webhooks en producción (Whop, Stripe, Hotmart y WhatsApp Cloud API para el piloto del 30 de noviembre de 2026).

