# FieldConnect Group · Portal de operaciones

Prototipo web estático para demostrar el flujo de tickets de ingeniería de campo entre **RRHH** e **IDC**.

> **Importante:** es una demo frontend. El inicio de sesión acepta credenciales de demostración, y los tickets se guardan en el almacenamiento del navegador. No hay backend, control de acceso real ni sincronización entre dispositivos. No introduzcas información real de clientes, contactos, domicilios, credenciales o sitios.

## Funciones incluidas

- Vista de acceso con selección de perfil RRHH / IDC.
- RRHH puede crear tickets, publicarlos para los IDC o asignarlos directamente.
- Los IDC pueden consultar servicios disponibles, tomar tickets y actualizar sus propios servicios.
- Flujo de estados, checklist de cierre, nota de resultado y registro de evidencia.
- Historial de movimientos por ticket.
- Plantillas de trabajo para tipos de servicio frecuentes.
- Filtros y búsqueda, exportación CSV y respaldo/restauración JSON.
- Persistencia local y actualización entre pestañas que compartan el mismo origen y almacenamiento.
- Diseño adaptable a escritorio y dispositivos móviles.

## Estructura

```text
fieldconnect-group-portal/
├── index.html
├── README.md
├── .gitignore
├── .nojekyll
└── assets/
    ├── css/styles.css
    ├── js/app.js
    └── img/
        ├── favicon.svg
        ├── fieldconnect-mark.webp
        └── login-background.jpg
```

## Probar localmente

La forma más segura de revisar rutas y estilos como en el hosting es servir el directorio con un servidor estático. Con Python instalado:

```bash
python -m http.server 8000
```

Abre `http://localhost:8000` desde el directorio del proyecto. También puedes abrir `index.html` directamente, aunque se recomienda el servidor local.

### Perfiles de demostración

- **RRHH:** usuario `rrhh`.
- **IDC:** elige IDC-001, IDC-002 o IDC-003 en el selector de perfil.
- **Contraseña:** cualquier valor no vacío sirve en esta demo.

Para reiniciar los ejemplos, cierra sesión y borra los datos del sitio desde las herramientas del navegador o elimina la clave `fielddesk_roles_tickets_v1` de `localStorage`. La sesión demo se guarda en `sessionStorage`.

## Publicar en GitHub Pages

El repositorio incluye un workflow en `.github/workflows/pages.yml` que publica el sitio automáticamente cuando haces push a `main`.

1. Crea un repositorio nuevo en GitHub. Para una prueba, puede ser privado si tu plan permite Pages con repositorios privados; si no, crea uno público y conserva exclusivamente información ficticia.
2. Descomprime el proyecto y sube **el contenido de esta carpeta** a la raíz del repositorio. `index.html` debe quedar en la raíz, no dentro de otra carpeta anidada.
3. En GitHub, abre **Settings → Pages** y configura **Build and deployment → Source: GitHub Actions**.
4. Comprueba la pestaña **Actions**. El workflow se ejecuta al recibir cambios en la rama `main`; al terminar, su resumen muestra la URL de GitHub Pages.
5. Abre esa URL para probar la app. Cada nuevo push a `main` volverá a publicar el sitio.

Si prefieres no usar el workflow, puedes quitar `.github/workflows/pages.yml` y elegir `Deploy from a branch`, con la rama `main` y la carpeta `/(root)`.

### Publicar con Git

Desde la carpeta del proyecto, después de crear un repositorio vacío en GitHub:

```bash
git init
git add .
git commit -m "Initial FieldConnect portal prototype"
git branch -M main
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

Sustituye `USUARIO/REPOSITORIO` por el destino real.

## Límites de esta versión

GitHub Pages publica archivos estáticos. No convierte el login en autenticación real ni comparte tickets entre usuarios o teléfonos. `localStorage` y `sessionStorage` pertenecen al navegador/origen de cada usuario. Para una operación real se requiere backend, base de datos, autenticación y autorización por roles, control concurrente al tomar tickets y almacenamiento seguro de evidencias.

Los datos iniciales del tablero son ejemplos ficticios. Revisa también los tickets creados durante las pruebas antes de publicar capturas o respaldos.
