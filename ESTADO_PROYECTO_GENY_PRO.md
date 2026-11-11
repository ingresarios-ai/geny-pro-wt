# Estado Actual y Memoria del Proyecto — GENY PRO (INGRESARIOS)

**Última actualización:** 10 de noviembre de 2026  
**Directorio del proyecto:** `/Users/josuegarcia/Antigravity/GENY MODELO`  
**Proyecto Supabase conectado:** `geny-pro` (`gejvutumbannwaltklez`, región `us-east-1`)  

---

## 1. Resumen de Todo lo Construido y Conectado en Supabase

### A. Base de Datos y Seguridad en Supabase (`gejvutumbannwaltklez`)
Todas las tablas están creadas en producción con **Row Level Security (RLS)** activado (0 alertas de seguridad):
1. `public.geny_users`: Miembros, planes (`reto`, `mensual`, `vip`, `equipo`), estado (`active`, `expired`, `suspended`), dispositivos vinculados y fechas del candado de 90 días.
2. `public.geny_device_history`: Historial inmutable de teléfonos WhatsApp y cuentas de Telegram revocadas al cambiar de dispositivo o editar ficha.
3. `public.geny_otp_codes`: Códigos OTP de 6 dígitos con expiración de 15 minutos para validar titularidad por correo.
4. `public.geny_sessions` y `public.geny_messages`: Memoria conversacional por alumno (ventana de 10 mensajes) y auditoría semanal **`GENY COMPLIANT`** + curación de **Dataset Oro (`.jsonl`)**.
5. `public.geny_knowledge_documents` y `public.geny_knowledge_chunks`: Base de conocimiento vectorial a **768 dimensiones** (`pgvector` + búsqueda semántica híbrida `search_geny_knowledge`) con soporte para categorías personalizadas.
6. `public.geny_settings` y `public.geny_settings_snapshots`: Configuración en vivo del motor IA, prompts, bóveda de secretos (`runtime_secrets`) y respaldos automáticos para restauración en 1 clic (`previous_working_snapshot`).
7. `public.geny_payment_events`: Registro de webhooks de Whop, Stripe y Hotmart.

### B. Panel Administrativo (`/admin`) — `src/components/admin/AdminDashboardClient.tsx`
- **Branding `GENY PRO`:** Monograma geométrico `GP` (sin estrellitas genéricas) y nombre `GENY PRO` unificado en toda la plataforma.
- **Gestión Completa de Usuarios y Candado 90d:**
  - Creación manual con reglas de vencimiento por plan (`mensual` = +1 mes automático, `equipo` = permanente, `reto` y `vip` = fecha manual obligatoria).
  - Modal **`Editar / Ficha`** para modificar nombre, correo, teléfono WhatsApp (E.164), Telegram ID/`@username`, plan, estado, fecha de vencimiento, desvinculación de dispositivos y reseteo del candado de 90 días.
  - **Filtros Inteligentes Combinables:** Por Plan, Vencimiento (`Por vencer ≤ 7d / 15d / 30d`, `Vencidos`, `Permanentes`), Estado, Dispositivos / Candado 90d, Origen y Ordenamiento inteligente.
  - **Exportación CSV Dinámica:** Botón **`Exportar Filtrado (X) CSV`** que descarga en Excel exactamente la combinación de filtros activa.
- **Conocimiento RAG (`Cerebro IA Conectado 768 dims`):**
  - Selector de categoría metodológica con opción **`+ Crear nueva categoría...`**.
  - **Opción A (Subida de archivos locales/descargados):** Soporta múltiples `.pdf`, `.docx` (extrayendo texto e imágenes internas), `.png/.jpg/.webp` y `.txt/.md/.csv`, leídos con Visión Multimodal de `gemini-3.8-flash`.
  - **Opción B (Enlaces de Google Drive):** Importa archivos individuales, Google Docs y carpetas públicas de Google Drive pegando sus URLs.
  - Botón **`Ver / Editar`** en cada documento indexado para inspeccionar o corregir el texto extraído y re-vectorizar.
- **Bóveda de Llaves API + Zona de Peligro + Rollback 1-Clic:**
  - Modal de advertencia **`⚠️ Cuidado: Zona de Peligro`** al desbloquear la edición en la pestaña **Motor IA, APIs y Reglas**.
  - Edición en vivo de las 14 llaves y tokens (`GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `WHOP_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `HOTMART_HOTTOK`).
  - Botón **`Restaurar a la Última Versión Funcional`** que revierte cualquier cambio problemático al último snapshot funcional guardado en Supabase.

---

## 2. Dónde Nos Quedamos (Siguiente Paso Inmediato)

El usuario seleccionó continuar con:
> **1. Configurar el Bot de Telegram (`@BotFather`) y preparar el despliegue en Vercel para pruebas reales.**

### Avance del despliegue en vivo:
1. ✅ **Bot de Telegram creado y conectado (`@GenyProIngresariosBot`):** Token guardado en `.env.local` y en `geny_settings.runtime_secrets` de Supabase; textos oficiales de bienvenida, biografía y menú `/start` configurados por API.
2. ⏳ **Desplegar el proyecto en Vercel** (equipo `ingresarios / Reditum Group SAS`, esperando confirmación de contraseña de producción de `/admin`) para obtener la URL pública `https://...` necesaria para los webhooks.
3. **Activar el Webhook en 1 clic** desde `/admin` → **Canales y Pagos** → **Registrar Webhook en Telegram (1 Clic)**.
4. **Siguientes hitos después de Telegram:**
   - Cargar los primeros PDFs / carpetas de Google Drive en **Conocimiento RAG** (y evaluar si se desea también la **Opción C** con Google Service Account para carpetas privadas).
   - Importar la base de alumnos activos por CSV.
   - Conectar WhatsApp Cloud API (piloto 30 de noviembre de 2026) y pasarelas de pago (Whop / Stripe / Hotmart).

