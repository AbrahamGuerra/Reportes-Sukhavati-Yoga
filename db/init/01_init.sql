--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.0

-- Started on 2025-10-29 23:02:38

SET statement_timeout = 0;

SET lock_timeout = 0;

SET idle_in_transaction_session_timeout = 0;

SET client_encoding = 'UTF8';

SET standard_conforming_strings = on;

SELECT pg_catalog.set_config ('search_path', '', false);

SET check_function_bodies = false;

SET xmloption = content;

SET client_min_messages = warning;

SET row_security = off;

--
-- TOC entry 4673 (class 1262 OID 17366)
-- Name: sukhavati_yoga; Type: DATABASE; Schema: -; Owner: -
--

\connect sukhavati_yoga

SET statement_timeout = 0;

SET lock_timeout = 0;

SET idle_in_transaction_session_timeout = 0;

SET client_encoding = 'UTF8';

SET standard_conforming_strings = on;

SELECT pg_catalog.set_config ('search_path', '', false);

SET check_function_bodies = false;

SET xmloption = content;

SET client_min_messages = warning;

SET row_security = off;

--
-- TOC entry 4674 (class 0 OID 0)
-- Name: sukhavati_yoga; Type: DATABASE PROPERTIES; Schema: -; Owner: -
--

ALTER DATABASE sukhavati_yoga
SET
    search_path TO 'reportes_sukhavati',
    'public';

\connect sukhavati_yoga

SET statement_timeout = 0;

SET lock_timeout = 0;

SET idle_in_transaction_session_timeout = 0;

SET client_encoding = 'UTF8';

SET standard_conforming_strings = on;

SELECT pg_catalog.set_config ('search_path', '', false);

SET check_function_bodies = false;

SET xmloption = content;

SET client_min_messages = warning;

SET row_security = off;

--
-- TOC entry 10 (class 2615 OID 18461)
-- Name: reportes_sukhavati; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA reportes_sukhavati;

--
-- TOC entry 298 (class 1255 OID 19673)
-- Name: enforce_user_limit(); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.enforce_user_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  max_users integer;
  curr_count integer;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::int, 10) INTO max_users
  FROM reportes_sukhavati.settings WHERE key = 'user_max';

  IF TG_OP = 'INSERT' THEN
    SELECT COUNT(*) INTO curr_count FROM reportes_sukhavati.users WHERE active = true;
    IF curr_count >= max_users THEN
      RAISE EXCEPTION 'USER_LIMIT_REACHED (% >= %)', curr_count, max_users
        USING HINT = 'Ajusta el límite en settings.user_max';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.active = true AND (OLD.active IS DISTINCT FROM NEW.active) THEN
    -- Re-activación cuenta contra el límite
    SELECT COUNT(*) INTO curr_count FROM reportes_sukhavati.users WHERE active = true;
    IF curr_count >= max_users THEN
      RAISE EXCEPTION 'USER_LIMIT_REACHED (% >= %)', curr_count, max_users
        USING HINT = 'Ajusta el límite en settings.user_max';
    END IF;
  END IF;

  RETURN NEW;
END $$;

--
-- TOC entry 246 (class 1255 OID 19490)
-- Name: fn_normaliza_producto(text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_normaliza_producto(txt text) RETURNS text
    LANGUAGE sql
    AS $_$
  SELECT NULLIF(
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(coalesce($1,'')),
              '\bertificacion\b','certificacion','g'  -- corregir typos comunes
            ),
            '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*',
            '', 'i'                                   -- quitar prefijos de cobro
          ),
          '([0-9]+)\s*h\.?\s*r\.?s?\b', '\1hrs', 'g'  -- 200 hr/hrs/h.s/hs → 200hrs
        )
      ),
      'áéíóúüñ','aeiouun'
    ),
    ''
  );
$_$;

--
-- TOC entry 351 (class 1255 OID 19565)
-- Name: fn_rpt_clases_por_suscripcion(date, date, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_clases_por_suscripcion(p_ini date DEFAULT NULL::date, p_fin date DEFAULT NULL::date, p_socio_pattern text DEFAULT NULL::text, p_producto_pattern text DEFAULT NULL::text) RETURNS TABLE(id_suscripcion text, socio text, producto text, producto_norm text, clases_tomadas integer, clases_totales_plan integer, clases_restantes integer)
    LANGUAGE sql
    AS $$
WITH acts AS (
  SELECT a.*
  FROM reportes_sukhavati.actividades a
  WHERE (p_ini IS NULL OR a.fecha_evento::date >= p_ini)
    AND (p_fin IS NULL OR a.fecha_evento::date <= p_fin)
),
clases AS (
  SELECT a.id_suscripcion, COUNT(*) AS clases_tomadas
  FROM acts a
  GROUP BY a.id_suscripcion
)
SELECT
  s.id_suscripcion,
  s.socio,
  s.producto,
  s.producto_norm,
  COALESCE(c.clases_tomadas, 0) AS clases_tomadas,
  s.plan_totales                AS clases_totales_plan,
  CASE
    WHEN s.plan_totales IS NOT NULL THEN GREATEST(s.plan_totales - COALESCE(c.clases_tomadas,0), 0)
    ELSE NULL
  END AS clases_restantes
FROM reportes_sukhavati.vw_suscripciones_norm s
LEFT JOIN clases c ON c.id_suscripcion = s.id_suscripcion
WHERE
  (p_socio_pattern IS NULL
    OR unaccent(lower(s.socio)) LIKE unaccent(lower(p_socio_pattern))
    OR s.socio_key_unaccent     LIKE unaccent(lower(p_socio_pattern)))
  AND (p_producto_pattern IS NULL
        OR s.producto_norm ILIKE p_producto_pattern
        OR s.producto      ILIKE p_producto_pattern)
ORDER BY s.socio, s.producto;
$$;

--
-- TOC entry 320 (class 1255 OID 19489)
-- Name: fn_rpt_cobranza_consecutivo(date, date, text, text, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_cobranza_consecutivo(p_ini date, p_fin date, p_producto_pattern text DEFAULT NULL::text, p_segmento_pattern text DEFAULT NULL::text, p_metodo_pattern text DEFAULT NULL::text, p_estado_pattern text DEFAULT NULL::text) RETURNS TABLE(id_socio text, socio text, concepto text, metodo_pago text, fecha_de_registro timestamp without time zone, total numeric)
    LANGUAGE sql
    AS $$
WITH base AS (
  SELECT
    v.id_socio,
    v.socio,
    COALESCE(v.producto_mostrable, v.concepto_limpio) AS concepto,
    v.metodo_limpio  AS metodo_pago,
    v.fecha_de_registro,
    v.total_mxn      AS total,
    v.producto_mostrable,
    v.concepto_limpio,
    v.linea_producto,
    v.estado
  FROM reportes_sukhavati.vw_pagos_enriquecidos v
  WHERE NOT v.es_cancelado
    AND v.fecha_de_registro::date BETWEEN p_ini AND p_fin
)
, norm AS (
  SELECT
    b.*,
    /* Normalización robusta incl. 300HR -> 300hrs */
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(btrim(coalesce(b.producto_mostrable, b.concepto_limpio, ''))),
                '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*',
                '',
                'i'
              ),
              '\bertificacion\b',
              'certificacion',
              'g'
            ),
            '([0-9]+)\s*h\.?\s*r\.?s?\b',   -- 300HR, 300 HRS, 300 h.r., 300 hr
            '\1hrs',
            'g'
          ),
          '\s+',' ','g'
        )
      ),
      'áéíóúüñ','aeiouun'
    )::text AS producto_normalizado
  FROM base b
)
SELECT
  n.id_socio, n.socio, n.concepto, n.metodo_pago, n.fecha_de_registro, n.total
FROM norm n
WHERE
  (p_producto_pattern IS NULL
    OR n.producto_normalizado ILIKE p_producto_pattern
    OR n.producto_mostrable   ILIKE p_producto_pattern)
  AND (p_metodo_pattern   IS NULL OR n.metodo_pago   ILIKE p_metodo_pattern)
  AND (p_estado_pattern   IS NULL OR n.estado        ILIKE p_estado_pattern)
  AND (p_segmento_pattern IS NULL OR
       (CASE WHEN n.linea_producto = 'BIENESTAR' THEN 'BIENESTAR' ELSE 'SUKHAVATI' END) ILIKE p_segmento_pattern)
ORDER BY n.fecha_de_registro, n.socio;
$$;

--
-- TOC entry 358 (class 1255 OID 19441)
-- Name: fn_rpt_cobranza_detalle_rango(date, date, text, text, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_cobranza_detalle_rango(p_ini date, p_fin date, p_producto_pattern text DEFAULT NULL::text, p_metodo_pattern text DEFAULT NULL::text, p_estado_pattern text DEFAULT NULL::text, p_segmento_pattern text DEFAULT NULL::text) RETURNS TABLE(id_socio text, socio text, concepto text, total numeric, metodo_pago text, notas text, fecha_de_registro date, fecha_de_valor date, estado text, evidencia_pago_url text, precio numeric, descuento numeric, id_transaccion text, id_suscripcion text, id_cargo text)
    LANGUAGE sql
    AS $$
WITH base AS (
  SELECT
    v.*,
    COALESCE(v.producto_mostrable, v.concepto_limpio) AS concepto_detalle
  FROM reportes_sukhavati.vw_pagos_enriquecidos v
  WHERE NOT v.es_cancelado
    AND v.fecha_de_registro::date BETWEEN p_ini AND p_fin
),
norm AS (
  SELECT
    b.*,
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(btrim(COALESCE(b.producto_mostrable, b.concepto_limpio))),
              '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*','',
              'i'
            ),
            '\bertificacion\b','certificacion','g'
          ),
          '([0-9]+)\s*h\.?\s*r\.?s?\b','\1hrs','g'
        )
      ),
      'áéíóúüñ','aeiouun'
    )::text AS producto_normalizado
  FROM base b
)
SELECT
  n.id_socio,
  n.socio,
  n.concepto_detalle AS concepto,
  n.total_mxn        AS total,
  n.metodo_limpio    AS metodo_pago,
  n.notas,
  n.fecha_de_registro,
  n.fecha_de_valor,
  n.estado,
  n.evidencia_pago_url,
  n.precio,
  n.descuento,
  n.id_transaccion,
  n.id_suscripcion,
  n.id_cargo
FROM norm n
WHERE
  (p_producto_pattern IS NULL
    OR n.producto_normalizado ILIKE p_producto_pattern
    OR n.producto_mostrable   ILIKE p_producto_pattern)
  AND (p_metodo_pattern   IS NULL OR n.metodo_limpio ILIKE p_metodo_pattern)
  AND (p_estado_pattern   IS NULL OR n.estado       ILIKE p_estado_pattern)
  AND (p_segmento_pattern IS NULL OR
       (CASE WHEN n.linea_producto = 'BIENESTAR' THEN 'BIENESTAR' ELSE 'SUKHAVATI' END) ILIKE p_segmento_pattern)
ORDER BY n.fecha_de_registro, n.socio;
$$;

--
-- TOC entry 242 (class 1255 OID 19343)
-- Name: fn_rpt_cobranza_mensual_formapago(integer, integer, text, text, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_cobranza_mensual_formapago(p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer, p_producto_pattern text DEFAULT NULL::text, p_segmento_pattern text DEFAULT NULL::text, p_metodo_pattern text DEFAULT NULL::text, p_estado_pattern text DEFAULT NULL::text) RETURNS TABLE(anio integer, mes integer, segmento text, metodo_de_pago text, monto numeric)
    LANGUAGE sql
    AS $$
WITH base AS (
  SELECT
    v.anio, v.mes,
    CASE WHEN v.linea_producto = 'BIENESTAR' THEN 'BIENESTAR' ELSE 'SUKHAVATI' END AS segmento,
    v.metodo_limpio AS metodo_de_pago,
    v.total_mxn,
    v.producto_mostrable,
    v.estado
  FROM reportes_sukhavati.vw_pagos_enriquecidos v
  WHERE NOT v.es_cancelado
    AND (p_anio IS NULL OR v.anio = p_anio)
    AND (p_mes  IS NULL OR v.mes  = p_mes)
),
norm AS (
  SELECT
    b.*,
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(btrim(b.producto_mostrable)),
              '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*','',
              'i'
            ),
            '\bertificacion\b','certificacion','g'
          ),
          '([0-9]+)\s*h\.?\s*r\.?s?\b','\1hrs','g'
        )
      ),
      'áéíóúüñ','aeiouun'
    )::text AS producto_normalizado
  FROM base b
),
seg AS (
  SELECT anio, mes, segmento, metodo_de_pago,
         SUM(total_mxn)::numeric(14,2) AS monto
  FROM norm
  WHERE
    (p_producto_pattern IS NULL
      OR producto_normalizado ILIKE p_producto_pattern
      OR producto_mostrable   ILIKE p_producto_pattern)
    AND (p_metodo_pattern   IS NULL OR metodo_de_pago ILIKE p_metodo_pattern)
    AND (p_estado_pattern   IS NULL OR estado        ILIKE p_estado_pattern)
    AND (p_segmento_pattern IS NULL OR segmento ILIKE p_segmento_pattern)
  GROUP BY anio, mes, segmento, metodo_de_pago
),
tot AS (
  SELECT anio, mes, 'TOTAL'::text AS segmento, metodo_de_pago,
         SUM(monto)::numeric(14,2) AS monto
  FROM seg
  GROUP BY anio, mes, metodo_de_pago
)
SELECT * FROM seg
UNION ALL
SELECT * FROM tot
ORDER BY anio, mes, segmento, metodo_de_pago;
$$;

--
-- TOC entry 261 (class 1255 OID 19344)
-- Name: fn_rpt_cobranza_mensual_producto_formapago(integer, integer, text, text, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_cobranza_mensual_producto_formapago(p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer, p_producto_pattern text DEFAULT NULL::text, p_segmento_pattern text DEFAULT NULL::text, p_metodo_pattern text DEFAULT NULL::text, p_estado_pattern text DEFAULT NULL::text) RETURNS TABLE(anio integer, mes integer, linea_producto text, producto text, metodo_de_pago text, total_por_producto_y_metodo numeric, subtotal_producto numeric, total_mensual numeric)
    LANGUAGE sql
    AS $$
WITH base AS (
  SELECT
    v.anio, v.mes, v.linea_producto,
    v.producto_mostrable AS producto,
    v.metodo_limpio      AS metodo_de_pago,
    v.total_mxn,
    v.estado
  FROM reportes_sukhavati.vw_pagos_enriquecidos v
  WHERE NOT v.es_cancelado
    AND (p_anio IS NULL OR v.anio = p_anio)
    AND (p_mes  IS NULL OR v.mes  = p_mes)
),
norm AS (
  SELECT
    b.*,
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(btrim(b.producto)),
              '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*','',
              'i'
            ),
            '\bertificacion\b','certificacion','g'
          ),
          '([0-9]+)\s*h\.?\s*r\.?s?\b','\1hrs','g'
        )
      ),
      'áéíóúüñ','aeiouun'
    )::text AS producto_normalizado
  FROM base b
)
SELECT
  anio, mes, linea_producto, producto, metodo_de_pago,
  SUM(total_mxn)::numeric(14,2) AS total_por_producto_y_metodo,
  (SUM(SUM(total_mxn)) OVER (PARTITION BY anio, mes, linea_producto, producto))::numeric(14,2) AS subtotal_producto,
  (SUM(SUM(total_mxn)) OVER (PARTITION BY anio, mes))::numeric(14,2) AS total_mensual
FROM norm
WHERE
  (p_producto_pattern IS NULL
    OR producto_normalizado ILIKE p_producto_pattern
    OR producto            ILIKE p_producto_pattern)
  AND (p_metodo_pattern   IS NULL OR metodo_de_pago ILIKE p_metodo_pattern)
  AND (p_estado_pattern   IS NULL OR estado        ILIKE p_estado_pattern)
  AND (p_segmento_pattern IS NULL OR
       (CASE WHEN linea_producto = 'BIENESTAR' THEN 'BIENESTAR' ELSE 'SUKHAVATI' END) ILIKE p_segmento_pattern)
GROUP BY anio, mes, linea_producto, producto, metodo_de_pago
ORDER BY anio, mes, linea_producto, producto, metodo_de_pago;
$$;

--
-- TOC entry 331 (class 1255 OID 19345)
-- Name: fn_rpt_cobranza_quincenal_formapago(integer, integer, integer, text, text, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_cobranza_quincenal_formapago(p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer, p_quincena integer DEFAULT NULL::integer, p_producto_pattern text DEFAULT NULL::text, p_segmento_pattern text DEFAULT NULL::text, p_metodo_pattern text DEFAULT NULL::text, p_estado_pattern text DEFAULT NULL::text) RETURNS TABLE(anio integer, mes integer, quincena integer, quincena_inicio date, quincena_fin date, segmento text, metodo_de_pago text, monto numeric)
    LANGUAGE sql
    AS $$
WITH base AS (
  SELECT
    v.anio, v.mes, v.quincena, v.quincena_inicio, v.quincena_fin,
    CASE WHEN v.linea_producto = 'BIENESTAR' THEN 'BIENESTAR' ELSE 'SUKHAVATI' END AS segmento,
    v.metodo_limpio AS metodo_de_pago,
    v.total_mxn,
    v.producto_mostrable AS producto,
    v.estado
  FROM reportes_sukhavati.vw_pagos_enriquecidos v
  WHERE NOT v.es_cancelado
    AND (p_anio     IS NULL OR v.anio     = p_anio)
    AND (p_mes      IS NULL OR v.mes      = p_mes)
    AND (p_quincena IS NULL OR v.quincena = p_quincena)
),
norm AS (
  SELECT
    b.*,
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(btrim(b.producto)),
              '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*','',
              'i'
            ),
            '\bertificacion\b','certificacion','g'
          ),
          '([0-9]+)\s*h\.?\s*r\.?s?\b','\1hrs','g'
        )
      ),
      'áéíóúüñ','aeiouun'
    )::text AS producto_normalizado
  FROM base b
),
seg AS (
  SELECT
    anio, mes, quincena,
    MIN(quincena_inicio) AS quincena_inicio,
    MIN(quincena_fin)    AS quincena_fin,
    segmento, metodo_de_pago,
    SUM(total_mxn)::numeric(14,2) AS monto
  FROM norm
  WHERE
    (p_producto_pattern IS NULL
      OR producto_normalizado ILIKE p_producto_pattern
      OR producto            ILIKE p_producto_pattern)
    AND (p_metodo_pattern   IS NULL OR metodo_de_pago ILIKE p_metodo_pattern)
    AND (p_estado_pattern   IS NULL OR estado        ILIKE p_estado_pattern)
    AND (p_segmento_pattern IS NULL OR segmento ILIKE p_segmento_pattern)
  GROUP BY anio, mes, quincena, segmento, metodo_de_pago
),
tot AS (
  SELECT
    anio, mes, quincena,
    MIN(quincena_inicio) AS quincena_inicio,
    MIN(quincena_fin)    AS quincena_fin,
    'TOTAL'::text AS segmento, metodo_de_pago,
    SUM(monto)::numeric(14,2) AS monto
  FROM seg
  GROUP BY anio, mes, quincena, metodo_de_pago
)
SELECT * FROM seg
UNION ALL
SELECT * FROM tot
ORDER BY anio, mes, quincena, segmento, metodo_de_pago;
$$;

--
-- TOC entry 275 (class 1255 OID 19346)
-- Name: fn_rpt_cobranza_quincenal_producto_formapago(integer, integer, integer, text, text, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_cobranza_quincenal_producto_formapago(p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer, p_quincena integer DEFAULT NULL::integer, p_producto_pattern text DEFAULT NULL::text, p_segmento_pattern text DEFAULT NULL::text, p_metodo_pattern text DEFAULT NULL::text, p_estado_pattern text DEFAULT NULL::text) RETURNS TABLE(anio integer, mes integer, quincena integer, quincena_inicio date, quincena_fin date, linea_producto text, producto text, metodo_de_pago text, total_por_producto_y_metodo numeric, subtotal_producto numeric, total_quincenal numeric)
    LANGUAGE sql
    AS $$
WITH base AS (
  SELECT
    v.anio, v.mes, v.quincena, v.quincena_inicio, v.quincena_fin,
    v.linea_producto, v.producto_mostrable AS producto, v.metodo_limpio AS metodo_de_pago,
    v.total_mxn, v.estado
  FROM reportes_sukhavati.vw_pagos_enriquecidos v
  WHERE NOT v.es_cancelado
    AND (p_anio     IS NULL OR v.anio     = p_anio)
    AND (p_mes      IS NULL OR v.mes      = p_mes)
    AND (p_quincena IS NULL OR v.quincena = p_quincena)
),
norm AS (
  SELECT
    b.*,
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(btrim(b.producto)),
              '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*','',
              'i'
            ),
            '\bertificacion\b','certificacion','g'
          ),
          '([0-9]+)\s*h\.?\s*r\.?s?\b','\1hrs','g'
        )
      ),
      'áéíóúüñ','aeiouun'
    )::text AS producto_normalizado
  FROM base b
),
seg AS (
  SELECT
    anio, mes, quincena,
    MIN(quincena_inicio) AS quincena_inicio, MIN(quincena_fin) AS quincena_fin,
    linea_producto, producto, metodo_de_pago,
    SUM(total_mxn)::numeric(14,2) AS total_por_producto_y_metodo,
    (SUM(SUM(total_mxn)) OVER (PARTITION BY anio, mes, quincena, linea_producto, producto))::numeric(14,2) AS subtotal_producto,
    (SUM(SUM(total_mxn)) OVER (PARTITION BY anio, mes, quincena))::numeric(14,2) AS total_quincenal
  FROM norm
  WHERE
    (p_producto_pattern IS NULL
      OR producto_normalizado ILIKE p_producto_pattern
      OR producto            ILIKE p_producto_pattern)
    AND (p_metodo_pattern   IS NULL OR metodo_de_pago ILIKE p_metodo_pattern)
    AND (p_estado_pattern   IS NULL OR estado        ILIKE p_estado_pattern)
    AND (p_segmento_pattern IS NULL OR
         (CASE WHEN linea_producto = 'BIENESTAR' THEN 'BIENESTAR' ELSE 'SUKHAVATI' END) ILIKE p_segmento_pattern)
  GROUP BY anio, mes, quincena, linea_producto, producto, metodo_de_pago
)
SELECT * FROM seg
ORDER BY anio, mes, quincena, linea_producto, producto, metodo_de_pago;
$$;

--
-- TOC entry 392 (class 1255 OID 19347)
-- Name: fn_rpt_cobranza_rango(date, date, text, text, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_cobranza_rango(p_ini date, p_fin date, p_producto_pattern text DEFAULT NULL::text, p_segmento_pattern text DEFAULT NULL::text, p_metodo_pattern text DEFAULT NULL::text, p_estado_pattern text DEFAULT NULL::text) RETURNS TABLE(linea_producto text, producto text, metodo_de_pago text, total_mxn numeric)
    LANGUAGE sql
    AS $$
WITH base AS (
  SELECT
    v.linea_producto,
    v.producto_mostrable AS producto,
    v.metodo_limpio      AS metodo_de_pago,
    v.total_mxn,
    v.estado,
    v.fecha_de_registro
  FROM reportes_sukhavati.vw_pagos_enriquecidos v
  WHERE NOT v.es_cancelado
    AND v.fecha_de_registro::date BETWEEN p_ini AND p_fin
),
norm AS (
  SELECT
    b.*,
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(btrim(b.producto)),
              '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*','',
              'i'
            ),
            '\bertificacion\b','certificacion','g'
          ),
          '([0-9]+)\s*h\.?\s*r\.?s?\b','\1hrs','g'
        )
      ),
      'áéíóúüñ','aeiouun'
    )::text AS producto_normalizado
  FROM base b
),
seg AS (
  SELECT
    linea_producto, producto, metodo_de_pago,
    SUM(total_mxn)::numeric(14,2) AS total_mxn
  FROM norm
  WHERE
    (p_producto_pattern IS NULL
      OR producto_normalizado ILIKE p_producto_pattern
      OR producto            ILIKE p_producto_pattern)
    AND (p_metodo_pattern   IS NULL OR metodo_de_pago ILIKE p_metodo_pattern)
    AND (p_estado_pattern   IS NULL OR estado        ILIKE p_estado_pattern)
    AND (p_segmento_pattern IS NULL OR
         (CASE WHEN linea_producto = 'BIENESTAR' THEN 'BIENESTAR' ELSE 'SUKHAVATI' END) ILIKE p_segmento_pattern)
  GROUP BY linea_producto, producto, metodo_de_pago
),
tot AS (
  SELECT
    linea_producto, producto, 'TOTAL'::text AS metodo_de_pago,
    SUM(total_mxn)::numeric(14,2) AS total_mxn
  FROM seg
  GROUP BY linea_producto, producto
)
SELECT * FROM seg
UNION ALL
SELECT * FROM tot
ORDER BY linea_producto, producto, metodo_de_pago;
$$;

--
-- TOC entry 312 (class 1255 OID 19348)
-- Name: fn_rpt_cobranza_semanal_formapago(integer, integer, text, text, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_cobranza_semanal_formapago(p_iso_anio integer DEFAULT NULL::integer, p_iso_semana integer DEFAULT NULL::integer, p_producto_pattern text DEFAULT NULL::text, p_segmento_pattern text DEFAULT NULL::text, p_metodo_pattern text DEFAULT NULL::text, p_estado_pattern text DEFAULT NULL::text) RETURNS TABLE(iso_anio integer, iso_semana integer, semana_inicio date, semana_fin date, segmento text, metodo_de_pago text, monto numeric)
    LANGUAGE sql
    AS $$
WITH base AS (
  SELECT
    v.iso_anio, v.iso_semana, v.semana_inicio, v.semana_fin,
    CASE WHEN v.linea_producto = 'BIENESTAR' THEN 'BIENESTAR' ELSE 'SUKHAVATI' END AS segmento,
    v.metodo_limpio AS metodo_de_pago,
    v.total_mxn,
    v.producto_mostrable,
    v.estado
  FROM reportes_sukhavati.vw_pagos_enriquecidos v
  WHERE NOT v.es_cancelado
    AND (p_iso_anio   IS NULL OR v.iso_anio   = p_iso_anio)
    AND (p_iso_semana IS NULL OR v.iso_semana = p_iso_semana)
),
norm AS (
  SELECT
    b.*,
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(btrim(b.producto_mostrable)),
              '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*','',
              'i'
            ),
            '\bertificacion\b','certificacion','g'
          ),
          '([0-9]+)\s*h\.?\s*r\.?s?\b','\1hrs','g'
        )
      ),
      'áéíóúüñ','aeiouun'
    )::text AS producto_normalizado
  FROM base b
),
seg AS (
  SELECT
    iso_anio, iso_semana,
    MIN(semana_inicio) AS semana_inicio, MIN(semana_fin) AS semana_fin,
    segmento, metodo_de_pago,
    SUM(total_mxn)::numeric(14,2) AS monto
  FROM norm
  WHERE
    (p_producto_pattern IS NULL
      OR producto_normalizado ILIKE p_producto_pattern
      OR producto_mostrable   ILIKE p_producto_pattern)
    AND (p_metodo_pattern   IS NULL OR metodo_de_pago ILIKE p_metodo_pattern)
    AND (p_estado_pattern   IS NULL OR estado        ILIKE p_estado_pattern)
    AND (p_segmento_pattern IS NULL OR segmento ILIKE p_segmento_pattern)
  GROUP BY iso_anio, iso_semana, segmento, metodo_de_pago
),
tot AS (
  SELECT
    iso_anio, iso_semana,
    MIN(semana_inicio) AS semana_inicio, MIN(semana_fin) AS semana_fin,
    'TOTAL'::text AS segmento, metodo_de_pago,
    SUM(monto)::numeric(14,2) AS monto
  FROM seg
  GROUP BY iso_anio, iso_semana, metodo_de_pago
)
SELECT * FROM seg
UNION ALL
SELECT * FROM tot
ORDER BY iso_anio, iso_semana, segmento, metodo_de_pago;
$$;

--
-- TOC entry 391 (class 1255 OID 19349)
-- Name: fn_rpt_cobranza_semanal_producto_formapago(integer, integer, text, text, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_cobranza_semanal_producto_formapago(p_iso_anio integer DEFAULT NULL::integer, p_iso_semana integer DEFAULT NULL::integer, p_producto_pattern text DEFAULT NULL::text, p_segmento_pattern text DEFAULT NULL::text, p_metodo_pattern text DEFAULT NULL::text, p_estado_pattern text DEFAULT NULL::text) RETURNS TABLE(iso_anio integer, iso_semana integer, semana_inicio date, semana_fin date, linea_producto text, producto text, metodo_de_pago text, total_por_producto_y_metodo numeric, subtotal_producto numeric, total_semanal numeric)
    LANGUAGE sql
    AS $$
WITH base AS (
  SELECT
    v.iso_anio, v.iso_semana, v.semana_inicio, v.semana_fin,
    v.linea_producto,
    v.producto_mostrable AS producto,
    v.metodo_limpio      AS metodo_de_pago,
    v.total_mxn,
    v.estado
  FROM reportes_sukhavati.vw_pagos_enriquecidos v
  WHERE NOT v.es_cancelado
    AND (p_iso_anio   IS NULL OR v.iso_anio   = p_iso_anio)
    AND (p_iso_semana IS NULL OR v.iso_semana = p_iso_semana)
),
norm AS (
  SELECT
    b.*,
    translate(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(btrim(b.producto)),
              '^(pago|abono|anticipo)\s*(parcial|final|inicial|primero|segundo|tercero|\d+)?\s*(de)?\s*','',
              'i'
            ),
            '\bertificacion\b','certificacion','g'
          ),
          '([0-9]+)\s*h\.?\s*r\.?s?\b','\1hrs','g'
        )
      ),
      'áéíóúüñ','aeiouun'
    )::text AS producto_normalizado
  FROM base b
),
seg AS (
  SELECT
    iso_anio, iso_semana,
    MIN(semana_inicio) AS semana_inicio, MIN(semana_fin) AS semana_fin,
    linea_producto, producto, metodo_de_pago,
    SUM(total_mxn)::numeric(14,2) AS total_por_producto_y_metodo,
    (SUM(SUM(total_mxn)) OVER (PARTITION BY iso_anio, iso_semana, linea_producto, producto))::numeric(14,2) AS subtotal_producto,
    (SUM(SUM(total_mxn)) OVER (PARTITION BY iso_anio, iso_semana))::numeric(14,2) AS total_semanal
  FROM norm
  WHERE
    (p_producto_pattern IS NULL
      OR producto_normalizado ILIKE p_producto_pattern
      OR producto            ILIKE p_producto_pattern)
    AND (p_metodo_pattern   IS NULL OR metodo_de_pago ILIKE p_metodo_pattern)
    AND (p_estado_pattern   IS NULL OR estado        ILIKE p_estado_pattern)
    AND (p_segmento_pattern IS NULL OR
         (CASE WHEN linea_producto = 'BIENESTAR' THEN 'BIENESTAR' ELSE 'SUKHAVATI' END) ILIKE p_segmento_pattern)
  GROUP BY iso_anio, iso_semana, linea_producto, producto, metodo_de_pago
)
SELECT * FROM seg
ORDER BY iso_anio, iso_semana, linea_producto, producto, metodo_de_pago;
$$;

--
-- TOC entry 248 (class 1255 OID 19564)
-- Name: fn_rpt_pagos_vs_plan(date, date, text, text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.fn_rpt_pagos_vs_plan(p_ini date, p_fin date, p_socio_pattern text, p_producto_pattern text) RETURNS TABLE(id_suscripcion text, socio text, producto text, metodo_de_pago text, periodicidad text, sesiones_disponibles_txt text, plan_llevados integer, plan_totales integer, pagos_exitosos integer, monto_pagado numeric, precio_total numeric, saldo_restante numeric)
    LANGUAGE sql
    AS $$
WITH pagos_filtrados AS (
  SELECT *
  FROM reportes_sukhavati.vw_pagos_resueltos v
  WHERE (p_ini IS NULL OR v.fecha::date >= p_ini)
    AND (p_fin IS NULL OR v.fecha::date <= p_fin)
    AND (
      p_socio_pattern IS NULL
      OR unaccent(lower(v.socio)) LIKE unaccent(lower(p_socio_pattern))
      OR v.socio_key_unaccent     LIKE unaccent(lower(p_socio_pattern))
    )
),
pagos_por_sus AS (
  SELECT
    v.id_suscripcion_resuelta AS id_suscripcion,
    COUNT(*) AS pagos_exitosos,
    COALESCE(SUM(reportes_sukhavati.to_numeric_sane(v.total::text)), 0) AS monto_pagado
  FROM pagos_filtrados v
  GROUP BY v.id_suscripcion_resuelta
)
SELECT
  s.id_suscripcion,
  s.socio,
  s.producto,
  s.metodo_de_pago,
  s.periodicidad,
  s.sesiones_disponibles_txt,
  s.plan_llevados,
  s.plan_totales,
  COALESCE(pp.pagos_exitosos, 0)                      AS pagos_exitosos,
  COALESCE(pp.monto_pagado, 0)::numeric(14,2)         AS monto_pagado,
  COALESCE(reportes_sukhavati.to_numeric_sane(s.precio), 0)::numeric(14,2) AS precio_total,
  (COALESCE(reportes_sukhavati.to_numeric_sane(s.precio), 0) - COALESCE(pp.monto_pagado, 0))::numeric(14,2) AS saldo_restante
FROM reportes_sukhavati.vw_suscripciones_norm s
LEFT JOIN pagos_por_sus pp
  ON pp.id_suscripcion = s.id_suscripcion
WHERE (p_producto_pattern IS NULL
        OR s.producto_norm ILIKE p_producto_pattern
        OR s.producto      ILIKE p_producto_pattern)
ORDER BY s.socio, s.producto;
$$;

--
-- TOC entry 357 (class 1255 OID 19350)
-- Name: set_default_role_views(); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.set_default_role_views() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.rol_id IS NULL THEN
    SELECT r.id INTO NEW.rol_id
    FROM sukhavati.roles r
    WHERE r.codigo = 'views';
  END IF;
  RETURN NEW;
END;
$$;

--
-- TOC entry 325 (class 1255 OID 19351)
-- Name: set_updated_at(); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END; $$;

--
-- TOC entry 336 (class 1255 OID 19552)
-- Name: to_numeric_sane(text); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.to_numeric_sane(p_text text) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
           WHEN p_text IS NULL OR btrim(p_text) = '' THEN NULL
           ELSE NULLIF(
                  replace(                       -- quita comas de miles
                    regexp_replace(              -- quita todo lo NO numérico (excepto punto y signo)
                      p_text, '[^0-9.\-]', '', 'g'
                    ),
                    ',', ''
                  ),
                  ''
                )::numeric
         END;
$$;

--
-- TOC entry 305 (class 1255 OID 19442)
-- Name: trg_clean_expired_tokens(); Type: FUNCTION; Schema: reportes_sukhavati; Owner: -
--

CREATE FUNCTION reportes_sukhavati.trg_clean_expired_tokens() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Limpia todo lo expirado en ambas tablas (seguro e idempotente)
  DELETE FROM reportes_sukhavati.auth_tokens_register r
   WHERE r.expires_in <= now();

  DELETE FROM reportes_sukhavati.auth_tokens_reset r
   WHERE r.expires_in <= now();

  -- (Opcional) además, por higiene, borra tokens ya usados del mismo usuario en la tabla correspondiente
  IF TG_TABLE_NAME = 'auth_tokens_register' THEN
    DELETE FROM reportes_sukhavati.auth_tokens_register r
     WHERE r.id_user = NEW.id_user
       AND r.used_in IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'auth_tokens_reset' THEN
    DELETE FROM reportes_sukhavati.auth_tokens_reset r
     WHERE r.id_user = NEW.id_user
       AND r.used_in IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 226 (class 1259 OID 18486)
-- Name: actividades; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.actividades (
    img text,
    nombre text,
    apellidos text,
    fecha_registro date,
    evento text,
    fecha_evento timestamp without time zone,
    canje text,
    producto text,
    estado text,
    id_suscripcion text,
    ingest_sig text
);

--
-- TOC entry 241 (class 1259 OID 19676)
-- Name: auth_audit_log; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.auth_audit_log (
    id bigint NOT NULL,
    occurred_at timestamp
    with
        time zone DEFAULT now() NOT NULL,
        user_id uuid,
        email public.citext,
        action text NOT NULL,
        outcome text NOT NULL,
        reason text,
        route text,
        http_status integer,
        ip inet,
        user_agent text,
        latency_ms integer,
        meta jsonb
);

--
-- TOC entry 240 (class 1259 OID 19675)
-- Name: auth_audit_log_id_seq; Type: SEQUENCE; Schema: reportes_sukhavati; Owner: -
--

CREATE SEQUENCE reportes_sukhavati.auth_audit_log_id_seq START
WITH
    1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

--
-- TOC entry 4675 (class 0 OID 0)
-- Dependencies: 240
-- Name: auth_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: reportes_sukhavati; Owner: -
--

ALTER SEQUENCE reportes_sukhavati.auth_audit_log_id_seq OWNED BY reportes_sukhavati.auth_audit_log.id;

--
-- TOC entry 232 (class 1259 OID 19284)
-- Name: auth_tokens_register; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.auth_tokens_register (
    token uuid DEFAULT gen_random_uuid () NOT NULL,
    id_user uuid NOT NULL,
    expires_in timestamp
    with
        time zone NOT NULL,
        used_in timestamp
    with
        time zone,
        created_in timestamp
    with
        time zone DEFAULT now() NOT NULL
);

--
-- TOC entry 233 (class 1259 OID 19297)
-- Name: auth_tokens_reset; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.auth_tokens_reset (
    token uuid DEFAULT gen_random_uuid () NOT NULL,
    id_user uuid NOT NULL,
    expires_in timestamp
    with
        time zone NOT NULL,
        used_in timestamp
    with
        time zone,
        created_in timestamp
    with
        time zone DEFAULT now() NOT NULL
);

--
-- TOC entry 223 (class 1259 OID 18462)
-- Name: cupones; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.cupones (
    cupon text,
    condiciones text,
    canjes text,
    estado text,
    caducidad date,
    ingest_sig text
);

--
-- TOC entry 228 (class 1259 OID 18582)
-- Name: pagos; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.pagos (
    factura text,
    id_cargo text,
    cod_autorizacion text,
    socio text,
    nombre text,
    apellidos text,
    email text,
    ine_curp text,
    producto text,
    tipo_producto text,
    concepto text,
    tipo text,
    precio numeric(12, 2),
    cantidad numeric(12, 2),
    descuento numeric(12, 2),
    subtotal numeric(12, 2),
    bruto numeric(12, 2),
    impuesto_porcentaje numeric(6, 2),
    impuesto numeric(12, 2),
    total numeric(12, 2),
    cupon_codigo text,
    cupon_porcentaje numeric(6, 2),
    cupon_monto numeric(12, 2),
    metodo_de_pago text,
    tipo_de_pago text,
    tipo_de_tarjeta text,
    tarjeta text,
    no_de_tarjeta text,
    origen_de_pago text,
    canal text,
    centro text,
    empleado text,
    estado text,
    facturado text,
    fecha_de_registro date,
    fecha_de_valor date,
    hora time without time zone,
    notas text,
    img text,
    ingest_sig text,
    id_transaccion text,
    id_suscripcion text,
    evidencia_pago_url text,
    id_socio text
);

--
-- TOC entry 224 (class 1259 OID 18468)
-- Name: productos; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.productos (
    producto text,
    precio text,
    tipo text,
    pago text,
    caracteristicas text,
    suscritos text,
    stock text,
    disponibilidad text,
    ingest_sig text
);

--
-- TOC entry 235 (class 1259 OID 19311)
-- Name: requests_change_role; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.requests_change_role (
    id bigint NOT NULL,
    id_user uuid NOT NULL,
    id_requested_role integer NOT NULL,
    reason text,
    status text DEFAULT 'pendiente'::text NOT NULL,
    create_in timestamp with time zone DEFAULT now() NOT NULL,
    solved_in timestamp with time zone,
    solved_by_id uuid,
    CONSTRAINT solicitudes_cambio_rol_estado_check CHECK ((status = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text])))
);

--
-- TOC entry 230 (class 1259 OID 19251)
-- Name: roles; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.roles (
    id integer NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text
);

--
-- TOC entry 229 (class 1259 OID 19250)
-- Name: roles_id_seq; Type: SEQUENCE; Schema: reportes_sukhavati; Owner: -
--

CREATE SEQUENCE reportes_sukhavati.roles_id_seq AS integer START
WITH
    1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

--
-- TOC entry 4676 (class 0 OID 0)
-- Dependencies: 229
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: reportes_sukhavati; Owner: -
--

ALTER SEQUENCE reportes_sukhavati.roles_id_seq OWNED BY reportes_sukhavati.roles.id;

--
-- TOC entry 239 (class 1259 OID 19665)
-- Name: settings; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_in timestamp without time zone DEFAULT now()
);

--
-- TOC entry 225 (class 1259 OID 18474)
-- Name: socios; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.socios (
    id_socio text,
    id_socio_externo text,
    socio text,
    fecha_de_nacimiento date,
    nif text,
    email text,
    movil text,
    direccion text,
    ciudad text,
    codigo_postal bigint,
    fecha_de_alta date,
    fecha_de_baja text,
    sexo text,
    grupo_socio text,
    perfil_socio text,
    ingest_sig text
);

--
-- TOC entry 234 (class 1259 OID 19310)
-- Name: solicitudes_cambio_rol_id_seq; Type: SEQUENCE; Schema: reportes_sukhavati; Owner: -
--

CREATE SEQUENCE reportes_sukhavati.solicitudes_cambio_rol_id_seq START
WITH
    1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

--
-- TOC entry 4677 (class 0 OID 0)
-- Dependencies: 234
-- Name: solicitudes_cambio_rol_id_seq; Type: SEQUENCE OWNED BY; Schema: reportes_sukhavati; Owner: -
--

ALTER SEQUENCE reportes_sukhavati.solicitudes_cambio_rol_id_seq OWNED BY reportes_sukhavati.requests_change_role.id;

--
-- TOC entry 227 (class 1259 OID 18495)
-- Name: suscripciones; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.suscripciones (
    nombre text,
    apellidos text,
    producto text,
    precio text,
    metodo_de_pago text,
    periodicidad text,
    sesiones_disponibles text,
    fecha_de_inicio date,
    proximo_pago text,
    fecha_de_fin date,
    estado text,
    empleado text,
    id_suscripcion text,
    ingest_sig text
);

--
-- TOC entry 231 (class 1259 OID 19261)
-- Name: users; Type: TABLE; Schema: reportes_sukhavati; Owner: -
--

CREATE TABLE reportes_sukhavati.users (
    id uuid DEFAULT gen_random_uuid () NOT NULL,
    name text,
    email public.citext NOT NULL,
    password_hash text,
    id_role integer NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_in timestamp
    with
        time zone DEFAULT now() NOT NULL,
        updated_in timestamp
    with
        time zone DEFAULT now() NOT NULL
);

--
-- TOC entry 236 (class 1259 OID 19447)
-- Name: vw_pagos_enriquecidos; Type: VIEW; Schema: reportes_sukhavati; Owner: -
--

CREATE VIEW reportes_sukhavati.vw_pagos_enriquecidos AS
 SELECT id_cargo,
    cod_autorizacion,
    factura,
    id_socio,
    socio,
    nombre,
    apellidos,
    email,
    ine_curp,
    producto,
    tipo_producto,
    concepto,
    tipo,
    precio,
    cantidad,
    descuento,
    subtotal,
    bruto,
    impuesto_porcentaje,
    impuesto,
    total,
    cupon_codigo,
    cupon_porcentaje,
    cupon_monto,
    metodo_de_pago,
    tipo_de_pago,
    tipo_de_tarjeta,
    tarjeta,
    no_de_tarjeta,
    origen_de_pago,
    canal,
    centro,
    empleado,
    estado,
    facturado,
    fecha_de_registro,
    fecha_de_valor,
    hora,
    notas,
    img,
    evidencia_pago_url,
    ingest_sig,
    id_transaccion,
    id_suscripcion,
    NULLIF(btrim(nombre), ''::text) AS nombre_limpio,
    NULLIF(btrim(apellidos), ''::text) AS apellidos_limpio,
    NULLIF(btrim(producto), ''::text) AS producto_limpio,
    NULLIF(btrim(concepto), ''::text) AS concepto_limpio,
    NULLIF(upper(btrim(metodo_de_pago)), ''::text) AS metodo_limpio,
    (COALESCE(total, (0)::numeric))::numeric(12,2) AS total_mxn,
    COALESCE(NULLIF(btrim(producto), ''::text), NULLIF(btrim(concepto), ''::text)) AS producto_mostrable,
    (COALESCE(estado, ''::text) ~~* 'cancel%'::text) AS es_cancelado,
    fecha_de_registro AS fecha,
    (EXTRACT(year FROM fecha_de_registro))::integer AS anio,
    (EXTRACT(month FROM fecha_de_registro))::integer AS mes,
    (EXTRACT(isoyear FROM fecha_de_registro))::integer AS iso_anio,
    (EXTRACT(week FROM fecha_de_registro))::integer AS iso_semana,
    (date_trunc('week'::text, (fecha_de_registro)::timestamp with time zone))::date AS semana_inicio,
    ((date_trunc('week'::text, (fecha_de_registro)::timestamp with time zone) + '6 days'::interval))::date AS semana_fin,
        CASE
            WHEN ((EXTRACT(day FROM fecha_de_registro))::integer <= 15) THEN 1
            ELSE 2
        END AS quincena,
    ((fecha_de_registro - ((((EXTRACT(day FROM fecha_de_registro))::integer - 1))::double precision * '1 day'::interval)))::date AS mes_inicio,
    (((date_trunc('month'::text, (fecha_de_registro)::timestamp with time zone))::date +
        CASE
            WHEN ((EXTRACT(day FROM fecha_de_registro))::integer <= 15) THEN '14 days'::interval
            ELSE ((date_trunc('month'::text, (fecha_de_registro)::timestamp with time zone) + '1 mon -1 days'::interval) - date_trunc('month'::text, (fecha_de_registro)::timestamp with time zone))
        END))::date AS quincena_fin,
        CASE
            WHEN ((EXTRACT(day FROM fecha_de_registro))::integer <= 15) THEN (date_trunc('month'::text, (fecha_de_registro)::timestamp with time zone))::date
            ELSE (((date_trunc('month'::text, (fecha_de_registro)::timestamp with time zone))::date + '15 days'::interval))::date
        END AS quincena_inicio,
        CASE
            WHEN ((COALESCE(producto, ''::text) ~~* '%ACUPUNTURA%'::text) OR (COALESCE(concepto, ''::text) ~~* '%ACUPUNTURA%'::text) OR (COALESCE(producto, ''::text) ~~* '%SHIATSU%'::text) OR (COALESCE(concepto, ''::text) ~~* '%SHIATSU%'::text)) THEN 'BIENESTAR'::text
            WHEN ((COALESCE(producto, ''::text) ~~* '%CERTIFICACION%'::text) OR (COALESCE(concepto, ''::text) ~~* '%CERTIFICACION%'::text) OR (COALESCE(concepto, ''::text) ~~* '%1A Y 2A SERIE%'::text)) THEN 'CERTIFICACIONES'::text
            WHEN ((COALESCE(producto, ''::text) ~~* '%RENTA%'::text) OR (COALESCE(concepto, ''::text) ~~* '%RENTA%'::text)) THEN 'RENTAS'::text
            WHEN ((COALESCE(producto, ''::text) ~~* '%TALLER%'::text) OR (COALESCE(concepto, ''::text) ~~* '%TALLER%'::text) OR (COALESCE(concepto, ''::text) ~~* '%INTRODUCCI%ON A LA NO DUALIDAD%'::text) OR (COALESCE(concepto, ''::text) ~~* '%ANTROPOLOGIA DEL CUERPO%'::text) OR (COALESCE(concepto, ''::text) ~~* '%MINDFULLNES%'::text) OR (COALESCE(concepto, ''::text) ~~* '%COLUMNA%'::text) OR (COALESCE(concepto, ''::text) ~~* '%AJUSTES%'::text)) THEN 'TALLERES'::text
            WHEN ((COALESCE(concepto, ''::text) ~~* '%CLASE MUESTRA%'::text) OR (COALESCE(producto, ''::text) ~~* '%CLASE MUESTRA%'::text)) THEN 'CLASES MUESTRA'::text
            ELSE 'CLASES REGULARES'::text
        END AS linea_producto
   FROM reportes_sukhavati.pagos p;

--
-- TOC entry 237 (class 1259 OID 19583)
-- Name: vw_suscripciones_norm; Type: VIEW; Schema: reportes_sukhavati; Owner: -
--

CREATE VIEW reportes_sukhavati.vw_suscripciones_norm AS
 WITH s_base AS (
         SELECT s.id_suscripcion,
            NULLIF(btrim(s.nombre), ''::text) AS nombre_raw,
            NULLIF(btrim(s.apellidos), ''::text) AS apellidos_raw,
            s.producto,
            reportes_sukhavati.fn_normaliza_producto(s.producto) AS producto_norm,
            s.metodo_de_pago,
            s.periodicidad,
            s.sesiones_disponibles AS sesiones_disponibles_txt,
            s.precio,
            s.fecha_de_inicio,
            s.fecha_de_fin,
            ((COALESCE(s.fecha_de_inicio, '1900-01-01'::date) - '15 days'::interval))::date AS ini_tol,
            ((COALESCE(s.fecha_de_fin, '2999-12-31'::date) + '15 days'::interval))::date AS fin_tol,
            reportes_sukhavati.unaccent(lower(btrim(((COALESCE(s.nombre, ''::text) || ' '::text) || COALESCE(s.apellidos, ''::text))))) AS name_key_unaccent
           FROM reportes_sukhavati.suscripciones s
        ), soc_norm AS (
         SELECT so.id_socio,
            so.socio AS socio_full,
            reportes_sukhavati.unaccent(lower(btrim(so.socio))) AS socio_key_unaccent
           FROM reportes_sukhavati.socios so
        ), joined AS (
         SELECT sb.id_suscripcion,
            sb.nombre_raw,
            sb.apellidos_raw,
            sb.producto,
            sb.producto_norm,
            sb.metodo_de_pago,
            sb.periodicidad,
            sb.sesiones_disponibles_txt,
            sb.precio,
            sb.fecha_de_inicio,
            sb.fecha_de_fin,
            sb.ini_tol,
            sb.fin_tol,
            sb.name_key_unaccent,
            so.id_socio,
            so.socio_full,
            so.socio_key_unaccent
           FROM (s_base sb
             LEFT JOIN soc_norm so ON ((false OR (so.socio_key_unaccent = sb.name_key_unaccent))))
        )
 SELECT id_suscripcion,
    COALESCE(socio_full, NULLIF(btrim(((COALESCE(nombre_raw, ''::text) || ' '::text) || COALESCE(apellidos_raw, ''::text))), ''::text)) AS socio,
    lower(btrim(COALESCE(socio_full, ((COALESCE(nombre_raw, ''::text) || ' '::text) || COALESCE(apellidos_raw, ''::text))))) AS socio_key,
    COALESCE(socio_key_unaccent, name_key_unaccent) AS socio_key_unaccent,
    nombre_raw AS nombre,
    apellidos_raw AS apellidos,
    producto,
    producto_norm,
    metodo_de_pago,
    periodicidad,
    sesiones_disponibles_txt,
    precio,
    fecha_de_inicio,
    fecha_de_fin,
    ini_tol,
    fin_tol,
        CASE
            WHEN (lower(sesiones_disponibles_txt) ~~ '%ilimitad%'::text) THEN NULL::integer
            WHEN (sesiones_disponibles_txt ~ '^\s*\d+\s*/\s*\d+\s*$'::text) THEN ((regexp_match(sesiones_disponibles_txt, '(\d+)\s*/\s*(\d+)'::text))[1])::integer
            ELSE NULL::integer
        END AS plan_llevados,
        CASE
            WHEN (lower(sesiones_disponibles_txt) ~~ '%ilimitad%'::text) THEN NULL::integer
            WHEN (sesiones_disponibles_txt ~ '^\s*\d+\s*/\s*\d+\s*$'::text) THEN ((regexp_match(sesiones_disponibles_txt, '(\d+)\s*/\s*(\d+)'::text))[2])::integer
            ELSE NULL::integer
        END AS plan_totales
   FROM joined;

--
-- TOC entry 238 (class 1259 OID 19588)
-- Name: vw_pagos_resueltos; Type: VIEW; Schema: reportes_sukhavati; Owner: -
--

CREATE VIEW reportes_sukhavati.vw_pagos_resueltos AS
 WITH p AS (
         SELECT v.id_cargo,
            v.cod_autorizacion,
            v.factura,
            v.id_socio,
            v.socio,
            v.nombre,
            v.apellidos,
            v.email,
            v.ine_curp,
            v.producto,
            v.tipo_producto,
            v.concepto,
            v.tipo,
            v.precio,
            v.cantidad,
            v.descuento,
            v.subtotal,
            v.bruto,
            v.impuesto_porcentaje,
            v.impuesto,
            v.total,
            v.cupon_codigo,
            v.cupon_porcentaje,
            v.cupon_monto,
            v.metodo_de_pago,
            v.tipo_de_pago,
            v.tipo_de_tarjeta,
            v.tarjeta,
            v.no_de_tarjeta,
            v.origen_de_pago,
            v.canal,
            v.centro,
            v.empleado,
            v.estado,
            v.facturado,
            v.fecha_de_registro,
            v.fecha_de_valor,
            v.hora,
            v.notas,
            v.img,
            v.evidencia_pago_url,
            v.ingest_sig,
            v.id_transaccion,
            v.id_suscripcion,
            v.nombre_limpio,
            v.apellidos_limpio,
            v.producto_limpio,
            v.concepto_limpio,
            v.metodo_limpio,
            v.total_mxn,
            v.producto_mostrable,
            v.es_cancelado,
            v.fecha,
            v.anio,
            v.mes,
            v.iso_anio,
            v.iso_semana,
            v.semana_inicio,
            v.semana_fin,
            v.quincena,
            v.mes_inicio,
            v.quincena_fin,
            v.quincena_inicio,
            v.linea_producto,
            lower(btrim(((COALESCE(v.nombre_limpio, ''::text) || ' '::text) || COALESCE(v.apellidos_limpio, ''::text)))) AS socio_nomkey,
            v.metodo_limpio AS metodo_pago_limpio
           FROM reportes_sukhavati.vw_pagos_enriquecidos v
          WHERE (NOT v.es_cancelado)
        ), cand AS (
         SELECT p_1.ingest_sig,
            p_1.id_suscripcion AS id_suscripcion_original,
            s.id_suscripcion AS id_suscripcion_candidata,
            p_1.socio,
            p_1.nombre,
            p_1.apellidos,
            p_1.email,
            p_1.metodo_pago_limpio,
            s.metodo_de_pago,
            s.periodicidad,
            p_1.total_mxn AS total,
            p_1.fecha_de_registro AS fecha,
                CASE
                    WHEN ((s.metodo_de_pago IS NOT NULL) AND (p_1.metodo_pago_limpio IS NOT NULL) AND (upper(s.metodo_de_pago) = p_1.metodo_pago_limpio)) THEN 0
                    ELSE 1
                END AS w_metodo,
                CASE
                    WHEN ((s.periodicidad IS NOT NULL) AND (s.periodicidad <> ''::text)) THEN 0
                    ELSE 1
                END AS w_period,
                CASE
                    WHEN ((p_1.fecha >= s.ini_tol) AND (p_1.fecha <= s.fin_tol)) THEN 0
                    ELSE LEAST(abs((p_1.fecha - s.ini_tol)), abs((p_1.fecha - s.fin_tol)))
                END AS w_fecha,
            s.fecha_de_inicio,
            s.fecha_de_fin
           FROM (p p_1
             LEFT JOIN reportes_sukhavati.vw_suscripciones_norm s ON (((p_1.socio_nomkey = s.socio_key) AND ((p_1.fecha >= s.ini_tol) AND (p_1.fecha <= s.fin_tol)))))
        ), ranked AS (
         SELECT c.ingest_sig,
            c.id_suscripcion_original,
            c.id_suscripcion_candidata,
            c.socio,
            c.nombre,
            c.apellidos,
            c.email,
            c.metodo_pago_limpio,
            c.metodo_de_pago,
            c.periodicidad,
            c.total,
            c.fecha,
            c.w_metodo,
            c.w_period,
            c.w_fecha,
            c.fecha_de_inicio,
            c.fecha_de_fin,
            row_number() OVER (PARTITION BY c.ingest_sig ORDER BY c.w_metodo, c.w_period, c.w_fecha, c.fecha_de_inicio DESC NULLS LAST) AS rn,
            count(*) OVER (PARTITION BY c.ingest_sig) AS candidatas_cnt
           FROM cand c
        ), best AS (
         SELECT ranked.ingest_sig,
            ranked.id_suscripcion_original,
            ranked.id_suscripcion_candidata,
            ranked.socio,
            ranked.nombre,
            ranked.apellidos,
            ranked.email,
            ranked.metodo_pago_limpio,
            ranked.metodo_de_pago,
            ranked.periodicidad,
            ranked.total,
            ranked.fecha,
            ranked.w_metodo,
            ranked.w_period,
            ranked.w_fecha,
            ranked.fecha_de_inicio,
            ranked.fecha_de_fin,
            ranked.rn,
            ranked.candidatas_cnt
           FROM ranked
          WHERE (ranked.rn = 1)
        )
 SELECT p.id_cargo,
    p.id_transaccion,
    p.id_suscripcion AS id_suscripcion_original,
    COALESCE(p.id_suscripcion, b.id_suscripcion_candidata) AS id_suscripcion_resuelta,
    p.socio,
    p.nombre,
    p.apellidos,
    p.email,
    p.metodo_pago_limpio AS metodo_de_pago,
    p.total_mxn AS total,
    p.fecha_de_registro AS fecha,
    p.estado,
        CASE
            WHEN (p.id_suscripcion IS NOT NULL) THEN 'directa:id_suscripcion'::text
            WHEN (b.candidatas_cnt = 0) THEN 'sin_coincidencias'::text
            WHEN ((b.w_metodo = 0) AND (b.w_fecha = 0)) THEN 'socio+fecha+metodo'::text
            WHEN (b.w_metodo = 0) THEN 'socio+metodo'::text
            WHEN (b.w_fecha = 0) THEN 'socio+fecha'::text
            ELSE 'socio_only'::text
        END AS match_source,
        CASE
            WHEN (p.id_suscripcion IS NOT NULL) THEN 'alta'::text
            WHEN ((b.candidatas_cnt = 1) AND (b.w_fecha = 0)) THEN 'alta'::text
            WHEN ((b.w_metodo = 0) AND (b.w_fecha = 0)) THEN 'alta'::text
            WHEN ((b.w_metodo = 0) OR (b.w_fecha = 0)) THEN 'media'::text
            WHEN ((b.candidatas_cnt >= 2) AND (b.candidatas_cnt <= 3)) THEN 'media'::text
            ELSE 'baja'::text
        END AS match_confidence,
    b.fecha_de_inicio AS suscripcion_inicio,
    b.fecha_de_fin AS suscripcion_fin,
    COALESCE(NULLIF(btrim(p.socio), ''::text), NULLIF(btrim(((p.nombre || ' '::text) || p.apellidos)), ''::text)) AS socio_resuelto,
    lower(btrim(COALESCE(p.socio, ((p.nombre || ' '::text) || p.apellidos)))) AS socio_key,
    reportes_sukhavati.unaccent(lower(btrim(COALESCE(p.socio, ((p.nombre || ' '::text) || p.apellidos))))) AS socio_key_unaccent,
    p.socio_nomkey
   FROM (p
     LEFT JOIN best b ON ((b.ingest_sig = p.ingest_sig)));

--
-- TOC entry 4434 (class 2604 OID 19679)
-- Name: auth_audit_log id; Type: DEFAULT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.auth_audit_log ALTER COLUMN id SET DEFAULT nextval('reportes_sukhavati.auth_audit_log_id_seq'::regclass);

--
-- TOC entry 4430 (class 2604 OID 19314)
-- Name: requests_change_role id; Type: DEFAULT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.requests_change_role ALTER COLUMN id SET DEFAULT nextval('reportes_sukhavati.solicitudes_cambio_rol_id_seq'::regclass);

--
-- TOC entry 4420 (class 2604 OID 19254)
-- Name: roles id; Type: DEFAULT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.roles ALTER COLUMN id SET DEFAULT nextval('reportes_sukhavati.roles_id_seq'::regclass);

--
-- TOC entry 4509 (class 2606 OID 19684)
-- Name: auth_audit_log auth_audit_log_pkey; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.auth_audit_log
ADD CONSTRAINT auth_audit_log_pkey PRIMARY KEY (id);

--
-- TOC entry 4494 (class 2606 OID 19290)
-- Name: auth_tokens_register auth_tokens_registro_pkey; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.auth_tokens_register
ADD CONSTRAINT auth_tokens_registro_pkey PRIMARY KEY (token);

--
-- TOC entry 4497 (class 2606 OID 19303)
-- Name: auth_tokens_reset auth_tokens_reset_pkey; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.auth_tokens_reset
ADD CONSTRAINT auth_tokens_reset_pkey PRIMARY KEY (token);

--
-- TOC entry 4484 (class 2606 OID 19260)
-- Name: roles roles_codigo_key; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.roles
ADD CONSTRAINT roles_codigo_key UNIQUE (code);

--
-- TOC entry 4486 (class 2606 OID 19258)
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.roles
ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

--
-- TOC entry 4505 (class 2606 OID 19672)
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.settings
ADD CONSTRAINT settings_pkey PRIMARY KEY (key);

--
-- TOC entry 4503 (class 2606 OID 19321)
-- Name: requests_change_role solicitudes_cambio_rol_pkey; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.requests_change_role
ADD CONSTRAINT solicitudes_cambio_rol_pkey PRIMARY KEY (id);

--
-- TOC entry 4460 (class 2606 OID 18554)
-- Name: actividades uq_actividades_ingest_sig; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.actividades
ADD CONSTRAINT uq_actividades_ingest_sig UNIQUE (ingest_sig);

--
-- TOC entry 4439 (class 2606 OID 18548)
-- Name: cupones uq_cupones_ingest_sig; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.cupones
ADD CONSTRAINT uq_cupones_ingest_sig UNIQUE (ingest_sig);

--
-- TOC entry 4481 (class 2606 OID 18665)
-- Name: pagos uq_pagos_ingest_sig; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.pagos
ADD CONSTRAINT uq_pagos_ingest_sig UNIQUE (ingest_sig);

--
-- TOC entry 4443 (class 2606 OID 18550)
-- Name: productos uq_productos_ingest_sig; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.productos
ADD CONSTRAINT uq_productos_ingest_sig UNIQUE (ingest_sig);

--
-- TOC entry 4453 (class 2606 OID 18552)
-- Name: socios uq_socios_ingest_sig; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.socios
ADD CONSTRAINT uq_socios_ingest_sig UNIQUE (ingest_sig);

--
-- TOC entry 4468 (class 2606 OID 18556)
-- Name: suscripciones uq_suscripciones_ingest_sig; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.suscripciones
ADD CONSTRAINT uq_suscripciones_ingest_sig UNIQUE (ingest_sig);

--
-- TOC entry 4490 (class 2606 OID 19274)
-- Name: users usuarios_email_key; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.users
ADD CONSTRAINT usuarios_email_key UNIQUE (email);

--
-- TOC entry 4492 (class 2606 OID 19272)
-- Name: users usuarios_pkey; Type: CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.users
ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);

--
-- TOC entry 4506 (class 1259 OID 19687)
-- Name: auth_audit_log_action_idx; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX auth_audit_log_action_idx ON reportes_sukhavati.auth_audit_log USING btree (action);

--
-- TOC entry 4507 (class 1259 OID 19685)
-- Name: auth_audit_log_occurred_at_idx; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX auth_audit_log_occurred_at_idx ON reportes_sukhavati.auth_audit_log USING btree (occurred_at);

--
-- TOC entry 4510 (class 1259 OID 19686)
-- Name: auth_audit_log_user_id_idx; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX auth_audit_log_user_id_idx ON reportes_sukhavati.auth_audit_log USING btree (user_id);

--
-- TOC entry 4455 (class 1259 OID 18491)
-- Name: idx_actividades_apellidos; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_actividades_apellidos ON reportes_sukhavati.actividades USING btree (apellidos);

--
-- TOC entry 4456 (class 1259 OID 18493)
-- Name: idx_actividades_fecha_evento; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_actividades_fecha_evento ON reportes_sukhavati.actividades USING btree (fecha_evento);

--
-- TOC entry 4457 (class 1259 OID 18492)
-- Name: idx_actividades_fecha_registro; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_actividades_fecha_registro ON reportes_sukhavati.actividades USING btree (fecha_registro);

--
-- TOC entry 4458 (class 1259 OID 18494)
-- Name: idx_actividades_id_suscripción; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX "idx_actividades_id_suscripción" ON reportes_sukhavati.actividades USING btree (id_suscripcion);

--
-- TOC entry 4437 (class 1259 OID 18467)
-- Name: idx_cupones_caducidad; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_cupones_caducidad ON reportes_sukhavati.cupones USING btree (caducidad);

--
-- TOC entry 4470 (class 1259 OID 18595)
-- Name: idx_pagos_centro; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_centro ON reportes_sukhavati.pagos USING btree (centro);

--
-- TOC entry 4471 (class 1259 OID 18591)
-- Name: idx_pagos_concepto; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_concepto ON reportes_sukhavati.pagos USING btree (concepto);

--
-- TOC entry 4472 (class 1259 OID 18590)
-- Name: idx_pagos_email; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_email ON reportes_sukhavati.pagos USING btree (email);

--
-- TOC entry 4473 (class 1259 OID 18589)
-- Name: idx_pagos_estado; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_estado ON reportes_sukhavati.pagos USING btree (estado);

--
-- TOC entry 4474 (class 1259 OID 19210)
-- Name: idx_pagos_evidencia_pago_url; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_evidencia_pago_url ON reportes_sukhavati.pagos USING btree (evidencia_pago_url);

--
-- TOC entry 4475 (class 1259 OID 18587)
-- Name: idx_pagos_fecha_de_registro; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_fecha_de_registro ON reportes_sukhavati.pagos USING btree (fecha_de_registro);

--
-- TOC entry 4476 (class 1259 OID 18588)
-- Name: idx_pagos_fecha_de_valor; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_fecha_de_valor ON reportes_sukhavati.pagos USING btree (fecha_de_valor);

--
-- TOC entry 4477 (class 1259 OID 18592)
-- Name: idx_pagos_producto; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_producto ON reportes_sukhavati.pagos USING btree (producto);

--
-- TOC entry 4478 (class 1259 OID 18994)
-- Name: idx_pagos_producto_trgm; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_producto_trgm ON reportes_sukhavati.pagos USING gin (
    producto reportes_sukhavati.gin_trgm_ops
);

--
-- TOC entry 4479 (class 1259 OID 18594)
-- Name: idx_pagos_socio; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_pagos_socio ON reportes_sukhavati.pagos USING btree (socio);

--
-- TOC entry 4441 (class 1259 OID 18473)
-- Name: idx_productos_disponibilidad; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_productos_disponibilidad ON reportes_sukhavati.productos USING btree (disponibilidad);

--
-- TOC entry 4499 (class 1259 OID 19338)
-- Name: idx_scr_estado; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_scr_estado ON reportes_sukhavati.requests_change_role USING btree (status);

--
-- TOC entry 4500 (class 1259 OID 19339)
-- Name: idx_scr_rol_solicitado; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_scr_rol_solicitado ON reportes_sukhavati.requests_change_role USING btree (id_requested_role);

--
-- TOC entry 4501 (class 1259 OID 19337)
-- Name: idx_scr_usuario; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_scr_usuario ON reportes_sukhavati.requests_change_role USING btree (id_user);

--
-- TOC entry 4445 (class 1259 OID 18483)
-- Name: idx_socios_código_postal; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX "idx_socios_código_postal" ON reportes_sukhavati.socios USING btree (codigo_postal);

--
-- TOC entry 4446 (class 1259 OID 18482)
-- Name: idx_socios_email; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_socios_email ON reportes_sukhavati.socios USING btree (email);

--
-- TOC entry 4447 (class 1259 OID 18484)
-- Name: idx_socios_fecha_de_alta; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_socios_fecha_de_alta ON reportes_sukhavati.socios USING btree (fecha_de_alta);

--
-- TOC entry 4448 (class 1259 OID 18485)
-- Name: idx_socios_fecha_de_baja; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_socios_fecha_de_baja ON reportes_sukhavati.socios USING btree (fecha_de_baja);

--
-- TOC entry 4449 (class 1259 OID 18481)
-- Name: idx_socios_fecha_de_nacimiento; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_socios_fecha_de_nacimiento ON reportes_sukhavati.socios USING btree (fecha_de_nacimiento);

--
-- TOC entry 4450 (class 1259 OID 18479)
-- Name: idx_socios_id_socio; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_socios_id_socio ON reportes_sukhavati.socios USING btree (id_socio);

--
-- TOC entry 4451 (class 1259 OID 18480)
-- Name: idx_socios_id_socio_externo; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_socios_id_socio_externo ON reportes_sukhavati.socios USING btree (id_socio_externo);

--
-- TOC entry 4462 (class 1259 OID 18500)
-- Name: idx_suscripciones_apellidos; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_suscripciones_apellidos ON reportes_sukhavati.suscripciones USING btree (apellidos);

--
-- TOC entry 4463 (class 1259 OID 18503)
-- Name: idx_suscripciones_fecha_de_fin; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_suscripciones_fecha_de_fin ON reportes_sukhavati.suscripciones USING btree (fecha_de_fin);

--
-- TOC entry 4464 (class 1259 OID 18502)
-- Name: idx_suscripciones_fecha_de_inicio; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_suscripciones_fecha_de_inicio ON reportes_sukhavati.suscripciones USING btree (fecha_de_inicio);

--
-- TOC entry 4465 (class 1259 OID 18504)
-- Name: idx_suscripciones_id_suscripción; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX "idx_suscripciones_id_suscripción" ON reportes_sukhavati.suscripciones USING btree (id_suscripcion);

--
-- TOC entry 4466 (class 1259 OID 18501)
-- Name: idx_suscripciones_periodicidad; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_suscripciones_periodicidad ON reportes_sukhavati.suscripciones USING btree (periodicidad);

--
-- TOC entry 4487 (class 1259 OID 19281)
-- Name: idx_usuarios_activo; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_usuarios_activo ON reportes_sukhavati.users USING btree (active);

--
-- TOC entry 4488 (class 1259 OID 19280)
-- Name: idx_usuarios_rol_id; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE INDEX idx_usuarios_rol_id ON reportes_sukhavati.users USING btree (id_role);

--
-- TOC entry 4495 (class 1259 OID 19296)
-- Name: uq_auth_tokens_registro_usuario_activo; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE UNIQUE INDEX uq_auth_tokens_registro_usuario_activo ON reportes_sukhavati.auth_tokens_register USING btree (id_user)
WHERE (used_in IS NULL);

--
-- TOC entry 4498 (class 1259 OID 19309)
-- Name: uq_auth_tokens_reset_usuario_activo; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE UNIQUE INDEX uq_auth_tokens_reset_usuario_activo ON reportes_sukhavati.auth_tokens_reset USING btree (id_user)
WHERE (used_in IS NULL);

--
-- TOC entry 4461 (class 1259 OID 18646)
-- Name: ux_actividades_ingest_sig; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE UNIQUE INDEX ux_actividades_ingest_sig ON reportes_sukhavati.actividades USING btree (ingest_sig)
WHERE (ingest_sig IS NOT NULL);

--
-- TOC entry 4440 (class 1259 OID 18644)
-- Name: ux_cupones_ingest_sig; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE UNIQUE INDEX ux_cupones_ingest_sig ON reportes_sukhavati.cupones USING btree (ingest_sig)
WHERE (ingest_sig IS NOT NULL);

--
-- TOC entry 4482 (class 1259 OID 18666)
-- Name: ux_pagos_ingest_sig; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE UNIQUE INDEX ux_pagos_ingest_sig ON reportes_sukhavati.pagos USING btree (ingest_sig)
WHERE (ingest_sig IS NOT NULL);

--
-- TOC entry 4444 (class 1259 OID 18642)
-- Name: ux_productos_ingest_sig; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE UNIQUE INDEX ux_productos_ingest_sig ON reportes_sukhavati.productos USING btree (ingest_sig)
WHERE (ingest_sig IS NOT NULL);

--
-- TOC entry 4454 (class 1259 OID 18637)
-- Name: ux_socios_ingest_sig; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE UNIQUE INDEX ux_socios_ingest_sig ON reportes_sukhavati.socios USING btree (ingest_sig)
WHERE (ingest_sig IS NOT NULL);

--
-- TOC entry 4469 (class 1259 OID 18636)
-- Name: ux_suscripciones_ingest_sig; Type: INDEX; Schema: reportes_sukhavati; Owner: -
--

CREATE UNIQUE INDEX ux_suscripciones_ingest_sig ON reportes_sukhavati.suscripciones USING btree (ingest_sig)
WHERE (ingest_sig IS NOT NULL);

--
-- TOC entry 4518 (class 2620 OID 19443)
-- Name: auth_tokens_register biu_clean_expired_on_auth_tokens_register; Type: TRIGGER; Schema: reportes_sukhavati; Owner: -
--

CREATE TRIGGER biu_clean_expired_on_auth_tokens_register BEFORE INSERT OR UPDATE ON reportes_sukhavati.auth_tokens_register FOR EACH ROW EXECUTE FUNCTION reportes_sukhavati.trg_clean_expired_tokens();

--
-- TOC entry 4519 (class 2620 OID 19444)
-- Name: auth_tokens_reset biu_clean_expired_on_auth_tokens_reset; Type: TRIGGER; Schema: reportes_sukhavati; Owner: -
--

CREATE TRIGGER biu_clean_expired_on_auth_tokens_reset BEFORE INSERT OR UPDATE ON reportes_sukhavati.auth_tokens_reset FOR EACH ROW EXECUTE FUNCTION reportes_sukhavati.trg_clean_expired_tokens();

--
-- TOC entry 4517 (class 2620 OID 19674)
-- Name: users trg_enforce_user_limit; Type: TRIGGER; Schema: reportes_sukhavati; Owner: -
--

CREATE TRIGGER trg_enforce_user_limit BEFORE INSERT OR UPDATE OF active ON reportes_sukhavati.users FOR EACH ROW EXECUTE FUNCTION reportes_sukhavati.enforce_user_limit();

--
-- TOC entry 4512 (class 2606 OID 19291)
-- Name: auth_tokens_register auth_tokens_registro_usuario_id_fkey; Type: FK CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.auth_tokens_register
ADD CONSTRAINT auth_tokens_registro_usuario_id_fkey FOREIGN KEY (id_user) REFERENCES reportes_sukhavati.users (id) ON DELETE CASCADE;

--
-- TOC entry 4513 (class 2606 OID 19304)
-- Name: auth_tokens_reset auth_tokens_reset_usuario_id_fkey; Type: FK CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.auth_tokens_reset
ADD CONSTRAINT auth_tokens_reset_usuario_id_fkey FOREIGN KEY (id_user) REFERENCES reportes_sukhavati.users (id) ON DELETE CASCADE;

--
-- TOC entry 4514 (class 2606 OID 19332)
-- Name: requests_change_role solicitudes_cambio_rol_resuelto_por_id_fkey; Type: FK CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.requests_change_role
ADD CONSTRAINT solicitudes_cambio_rol_resuelto_por_id_fkey FOREIGN KEY (solved_by_id) REFERENCES reportes_sukhavati.users (id);

--
-- TOC entry 4515 (class 2606 OID 19327)
-- Name: requests_change_role solicitudes_cambio_rol_rol_solicitado_id_fkey; Type: FK CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.requests_change_role
ADD CONSTRAINT solicitudes_cambio_rol_rol_solicitado_id_fkey FOREIGN KEY (id_requested_role) REFERENCES reportes_sukhavati.roles (id);

--
-- TOC entry 4516 (class 2606 OID 19322)
-- Name: requests_change_role solicitudes_cambio_rol_usuario_id_fkey; Type: FK CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.requests_change_role
ADD CONSTRAINT solicitudes_cambio_rol_usuario_id_fkey FOREIGN KEY (id_user) REFERENCES reportes_sukhavati.users (id) ON DELETE CASCADE;

--
-- TOC entry 4511 (class 2606 OID 19275)
-- Name: users usuarios_rol_id_fkey; Type: FK CONSTRAINT; Schema: reportes_sukhavati; Owner: -
--

ALTER TABLE ONLY reportes_sukhavati.users
ADD CONSTRAINT usuarios_rol_id_fkey FOREIGN KEY (id_role) REFERENCES reportes_sukhavati.roles (id);

-- Completed on 2025-10-29 23:02:46

--
-- PostgreSQL database dump complete
--