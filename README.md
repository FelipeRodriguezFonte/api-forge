# API Forge

Cliente HTTP de escritorio (Electron) para trabajar como en Postman, sin depender de instalaciones con permisos de admin.

Pensado para macOS y Windows, con foco en:
- flujo rápido de requests,
- gestión de entornos/variables,
- intercambio con cURL,
- historial útil para depurar.

## Qué puedes hacer hoy

- Enviar requests `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
- Editar URL, nombre de request, headers, query params y body (`json`/`text`).
- Auth tipo Bearer desde UI.
- Definir entornos con sus propias variables y requests.
- Definir variables globales reutilizables entre entornos.
- Resolver variables con sintaxis `{{miVariable}}` en URL, headers, query, body y auth.
- Historial por entorno (últimas 25 ejecuciones), con ventana de detalle:
  - request completa,
  - response completa,
  - botón para copiar request/response,
  - variables capturadas en esa ejecución.
- Reglas de extracción de variables desde respuesta:
  - por header (`authorization`, etc.),
  - por JSONPath (subset útil estilo Postman).
- Importar/Exportar entornos en JSON:
  - todos o selección parcial,
  - incluir/excluir variables globales,
  - presets de selección de entornos.
- Exportar request actual a cURL en ventana independiente (copiar/guardar).
- Importar request desde cURL:
  - crear request nueva o sobrescribir la actual,
  - indicar nombre de la request al importar.
- Ajustes de red:
  - proxy,
  - timeout,
  - tamaño máximo de respuesta,
  - opción de certificados inseguros.

## Stack

- Electron 30
- HTML + CSS + JS vanilla
- Persistencia local en JSON (`app.getPath('userData')`)

## Requisitos

- Node.js 18+ (recomendado LTS)
- npm 9+

## Arranque rápido

```bash
git clone <tu-repo>
cd api-forge
npm install
npm start
```

La app se ejecuta en escritorio (no navegador) y guarda estado local automáticamente.

## Scripts disponibles

```bash
npm start        # Ejecuta API Forge en modo desktop
npm run pack:mac # Empaqueta para macOS (directorio)
npm run pack:win # Empaqueta para Windows (directorio)
```

## Flujo recomendado (2 minutos)

1. Crea o selecciona un entorno.
2. Define `baseUrl` en variables del entorno.
3. Crea una request y usa `{{baseUrl}}/ruta`.
4. Envía.
5. Si necesitas encadenar llamadas, añade extractores en pestaña `Vars`:
   - tipo `header` + `source: authorization` + `target: token`
   - o tipo `json` + `source: $.data.token` + `target: token`
6. En otra request usa `Authorization: Bearer {{token}}`.

## Import/Export de entornos

Desde los botones `Exportar` / `Importar`:
- Selección de uno, varios o todos los entornos.
- Inclusión opcional de variables globales.
- Presets para selecciones frecuentes.
- Opción de reemplazar todos los entornos al importar.

Formato de exportación (simplificado):

```json
{
  "environments": [
    {
      "name": "Default",
      "vars": [],
      "requests": [],
      "history": []
    }
  ],
  "globals": []
}
```

## cURL

### Exportar request a cURL

Botón `cURL` en el editor de request:
- abre una ventana con el comando,
- permite copiar al portapapeles,
- permite guardar a archivo `.curl` / `.txt`.

### Importar request desde cURL

Botón `Import cURL`:
- pega el comando,
- indica nombre de request,
- elige modo:
  - `Crear nueva request`
  - `Sobrescribir request actual`

## Historial de ejecución

Cada entorno mantiene su historial propio:
- timestamp,
- método/nombre/URL,
- status y latencia,
- variables capturadas por extractores.

Al hacer clic en una entrada se abre una ventana de detalle con opción de copiar request y response completas.

## Dónde se guarda el estado

`state.json` se guarda en la carpeta de usuario de Electron:

- macOS: `~/Library/Application Support/api-forge/state.json`
- Windows: `%APPDATA%\\api-forge\\state.json`

Incluye settings, globals, entornos, requests, historial y presets.

## Estructura del proyecto

```text
api-forge/
├── app/
│   ├── main.js         # Proceso principal Electron + IPC + ventanas
│   ├── preload.js      # API segura expuesta al renderer
│   ├── index.html      # UI principal
│   ├── renderer.js     # Lógica principal de la app
│   ├── styles.css      # Estilos UI principal
│   ├── history.html    # Ventana detalle historial
│   ├── history.js
│   ├── curl.html       # Ventana cURL
│   └── curl.js
├── package.json
└── README.md
```

## Notas de seguridad y red

- La opción de certificados inseguros está pensada solo para entornos de desarrollo.
- Si activas certificados inseguros, reinicia la app para aplicarlo.
- El timeout y tamaño máximo de respuesta son configurables para evitar cuelgues en respuestas grandes/lentas.

## Roadmap corto sugerido

- Colecciones/folders de requests.
- Variables secretas con enmascarado.
- Tests automáticos por request (asserts).
- Export/import compatible con colección Postman/Insomnia.

## Licencia

MIT

