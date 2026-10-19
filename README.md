# FieldConnect Group · Portal operativo con Supabase

Versión de migración del prototipo FieldConnect Group. Conserva la interfaz, los tres perfiles operativos y el flujo de tickets, reemplazando el almacenamiento local por Supabase Auth, PostgreSQL, RLS, RPC y Storage privado.

## Qué incluye

- Inicio de sesión real por correo y contraseña mediante **Supabase Auth**.
- Tres roles asignados en la base de datos: `HR`, `SUPPORT` e `IDC`. El selector de la pantalla solo comprueba el rol esperado; no concede permisos.
- Tickets compartidos, con historial de movimientos y sincronización entre usuarios mediante Supabase Realtime.
- Flujo predeterminado: Personal administrativo publica → Ingeniería de apoyo toma la logística → IDC toma el servicio.
- Reclamación atómica de tickets mediante funciones SQL; dos usuarios no deberían poder tomar el mismo ticket.
- Reglas de acceso RLS para perfiles, tickets y evidencias.
- Evidencias reales en un bucket privado (`ticket-evidence`): JPEG, PNG, WebP o PDF, máximo 10 MB por archivo. Se requieren seis puntos del checklist, una nota y al menos una evidencia antes de cerrar un servicio como completado.
- Exportación CSV de los tickets que el usuario autenticado tiene permiso para consultar.
- Flujo de despliegue incluido para GitHub Pages.

## Estructura

```text
fieldconnect-supabase/
├── index.html
├── README.md
├── assets/
│   ├── css/styles.css
│   ├── js/app.js
│   ├── js/supabase-config.js
│   └── img/
├── supabase/
│   ├── migrations/20261019000100_fieldconnect_initial.sql
│   └── examples/seed-profiles.example.sql
└── .github/workflows/pages.yml
```

## Paso 1. Crear el proyecto Supabase

1. Crea un proyecto nuevo en [Supabase](https://supabase.com/dashboard).
2. Abre **SQL Editor → New query**.
3. Copia y ejecuta todo el contenido de `supabase/migrations/20261019000100_fieldconnect_initial.sql`.
4. Verifica que no haya errores. Esta migración crea tablas, índices, políticas RLS, funciones RPC, bucket privado y la suscripción de tickets a Realtime.

No insertes una clave `service_role` ni una clave `secret` en los archivos del frontend. La aplicación web solo debe usar la URL y una **publishable key** (o la antigua `anon` key si ese es el formato disponible en tu proyecto).

## Paso 2. Configurar el cliente del navegador

1. En Supabase abre **Connect** o **Project Settings → API Keys**.
2. Copia la **Project URL** y la **Publishable key**.
3. Edita `assets/js/supabase-config.js` y reemplaza los dos valores de ejemplo:

```js
window.FIELD_CONNECT_SUPABASE = {
  url: 'https://TU_PROJECT_REF.supabase.co',
  publishableKey: 'TU_CLAVE_PUBLISHABLE_DE_SUPABASE'
};
```

La URL y la publishable key son datos públicos del cliente. No publiques nunca las credenciales de base de datos, la `service_role` ni una `secret key`. Las políticas RLS son obligatorias y no deben desactivarse.

## Paso 3. Crear cuentas y asignar perfiles

No hay registro público desde la interfaz. El administrador crea cada usuario desde **Authentication → Users** y le asigna una contraseña. Después, edita `supabase/examples/seed-profiles.example.sql`: cambia los correos de ejemplo, los nombres y los códigos de empleado por los reales, y ejecútalo en SQL Editor.

Perfiles admitidos:

| Rol interno | Perfil visible |
|---|---|
| `HR` | Personal administrativo |
| `SUPPORT` | Ingeniería de apoyo |
| `IDC` | Ingeniero de campo |

El archivo de ejemplo registra un usuario administrativo, dos ingenieros de apoyo y tres IDC. Si solo necesitas menos usuarios, elimina los bloques que no vayas a utilizar. Cada correo usado en el SQL debe corresponder a un usuario ya creado en Authentication.

**Importante:** los perfiles operativos se guardan en `public.profiles`. El usuario no puede autoasignarse un rol ni modificar su perfil desde el frontend. Haz estos cambios únicamente desde el panel administrativo de Supabase.

## Paso 4. Probar localmente

Se recomienda servir los archivos por HTTP en vez de abrir el HTML como archivo. Desde la carpeta raíz del proyecto ejecuta:

```bash
python -m http.server 8000
```

Abre `http://localhost:8000`, configura previamente `assets/js/supabase-config.js` y prueba con las cuentas que creaste en Supabase. Comprueba el flujo completo:

1. `HR` crea un ticket.
2. `SUPPORT` inicia sesión y pulsa **Tomar logística**.
3. `IDC` ve ese ticket en **Servicios disponibles** y lo toma.
4. `IDC` inicia el servicio, guarda el checklist y la nota, sube una evidencia y lo cierra.
5. Abre FieldConnect en otro navegador o dispositivo y verifica que solo aparezcan los tickets permitidos para ese perfil.

## Paso 5. Publicar en GitHub Pages

1. Crea un repositorio de GitHub y sube **el contenido** de esta carpeta a su raíz. `index.html` debe quedar en la raíz del repositorio.
2. Configura `assets/js/supabase-config.js` con la URL y publishable key del proyecto que usarás para el sitio publicado.
3. Haz commit y push a la rama `main`.
4. En GitHub abre **Settings → Pages** y elige **Build and deployment → Source: GitHub Actions**.
5. Abre la pestaña **Actions** y espera a que termine `Deploy FieldConnect to GitHub Pages`.
6. Copia la URL publicada. En Supabase abre **Authentication → URL Configuration** y configura la URL del sitio como `Site URL`; añade también esa URL a los redirect URLs permitidos si vas a usar enlaces de invitación o recuperación de contraseña.

La configuración `supabase-config.js` contiene solamente valores públicos, así que se debe incluir en el despliegue. Si tu repositorio es público, cualquiera podrá ver la URL y la publishable key; eso es esperado. La seguridad proviene de Auth, permisos SQL y RLS, no de ocultar la clave pública.

## Datos del prototipo anterior

Los tickets que existieran en `localStorage` del navegador no se importan automáticamente y los cuatro tickets de demostración del prototipo no se insertan en la base de datos. Revisa los datos previos antes de migrar información operativa real. Para una primera prueba, crea un ticket ficticio desde la nueva aplicación.

## Límites y próximos pasos recomendados

- La interfaz es estática y se sirve desde GitHub Pages; las credenciales y autorización las gestiona Supabase.
- Antes de usar datos sensibles de clientes, valida los permisos con cuentas de prueba de cada rol, activa la confirmación/recuperación de correo que necesite tu organización y acuerda políticas de copias de seguridad y retención.
- Esta primera migración registra la evidencia en un bucket privado, pero todavía no incorpora OCR, firma de conformidad ni una función de generación de PDF.
- Si la empresa necesita separar de forma estricta datos de contacto y domicilios de los tickets visibles antes de la asignación, conviene mover esos campos a una tabla restringida de detalles operativos en una siguiente migración.
- No se ejecutó esta migración contra una instancia Supabase real porque todavía no existe tu proyecto. Primero crea el proyecto y ejecuta el SQL; después se debe probar con las cuentas reales de prueba.

## Documentación oficial

- [Instalación de supabase-js (incluye CDN)](https://supabase.com/docs/reference/javascript/installing)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Migración de API keys a publishable/secret](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
