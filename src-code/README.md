# Sukhavati Uploader (Node.js)

Web app sencilla (frontend + backend) para subir archivos **.xlsx** y cargarlos en PostgreSQL
(BD `sukhavati_yoga`, esquema `sukhavati`).

## Cómo correr

1. Requisitos: Node 18+, PostgreSQL 14+
2. Clona y entra a la carpeta del proyecto
3. Instala dependencias: `npm i`
4. Copia `.env.sample` a `.env` y ajusta credenciales
5. Arranca: `npm run start` (o `npm run dev` con nodemon)

El sitio quedará en `http://localhost:5173`

## Endpoint

`POST /api/upload`

- form-data:
  - `type`: uno de `subscriptions | partners | products | coupons | activities`
  - `business-unit`: texto libre (se devuelve tal cual en la respuesta)
  - `file`: archivo `.xlsx`

## Funcionamiento

- Se lee la **primera hoja** del Excel.
- Se normalizan los encabezados para que coincidan con los nombres de columnas creados en SQL
  (minúsculas, sin acentos, espacios → `_`, etc.).
- Inserta en la tabla del esquema `sukhavati` según el `type`.
- Inserción por lotes (chunks de 500 filas).

## Notas

- Las tablas deben existir previamente (creadas con el SQL que generamos).
- No hay claves foráneas; sólo índices simples.
- No se hacen UPSERTS (no hay PK). Si necesitas evitar duplicados, podemos agregar una
  columna `ingested_at TIMESTAMP DEFAULT now()` o una clave compuesta con `ON CONFLICT DO NOTHING`.
