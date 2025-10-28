// src/routes/payment-reports.js
import express from 'express'
import { query } from '../DB/db.js'

const router = express.Router()

/* =========================
 * Utils
 * =======================*/
function toIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toLikeOrNull(v) {
  if (!v) return null
  // Si ya viene con % no lo duplicamos; si no, lo envolvemos
  const s = String(v)
  return s.includes('%') ? s : `%${s}%`
}

function handleError(res, err, ctx = '') {
  console.error(`payment-reports ${ctx}:`, err)
  res.status(500).json({ ok: false, error: err.message || String(err) })
}

/* ===========================================================
 * 1) mensual por SEGMENTO x FORMA DE PAGO
 *    -> reportes_sukhavati.fn_rpt_cobranza_mensual_formapago(anio, mes, producto, segmento, metodo, estado)
 * =========================================================*/
router.get('/mensual-formapago', async (req, res) => {
  try {
    const anio     = toIntOrNull(req.query.anio)
    const mes      = toIntOrNull(req.query.mes)
    const producto = toLikeOrNull(req.query.producto)    // patrón ILIKE
    const segmento = toLikeOrNull(req.query.segmento)    // 'SUKHAVATI' | 'BIENESTAR'
    const metodo   = toLikeOrNull(req.query.metodo)      // TARJETA, TRANSFERENCIA, etc.
    const estado   = toLikeOrNull(req.query.estado)      // ACTIVO, CANCELADO, etc.

    const sql = `
      SELECT *
      FROM reportes_sukhavati.fn_rpt_cobranza_mensual_formapago($1,$2,$3,$4,$5,$6)
      ORDER BY anio DESC, mes DESC, segmento, metodo_de_pago;
    `
    const { rows } = await query(sql, [anio, mes, producto, segmento, metodo, estado])
    res.json(rows)
  } catch (err) {
    handleError(res, err, 'mensual-formapago')
  }
})

/* ===========================================================
 * 2) semanal (ISO) por SEGMENTO x FORMA DE PAGO
 *    -> fn_rpt_cobranza_semanal_formapago(iso_anio, iso_semana, producto, segmento, metodo, estado)
 * =========================================================*/
router.get('/semanal-formapago', async (req, res) => {
  try {
    const iso_anio   = toIntOrNull(req.query.iso_anio)
    const iso_semana = toIntOrNull(req.query.iso_semana)
    const producto = toLikeOrNull(req.query.producto)
    const segmento = toLikeOrNull(req.query.segmento)
    const metodo   = toLikeOrNull(req.query.metodo)
    const estado   = toLikeOrNull(req.query.estado)

    const sql = `
      SELECT *
      FROM reportes_sukhavati.fn_rpt_cobranza_semanal_formapago($1,$2,$3,$4,$5,$6)
      ORDER BY iso_anio DESC, iso_semana DESC, segmento, metodo_de_pago;
    `
    const { rows } = await query(sql, [iso_anio, iso_semana, producto, segmento, metodo, estado])
    res.json(rows)
  } catch (err) {
    handleError(res, err, 'semanal-formapago')
  }
})

/* ===========================================================
 * 3) quincena por SEGMENTO x FORMA DE PAGO
 *    -> fn_rpt_cobranza_quincena_formapago(anio, mes, quincena, producto, segmento, metodo, estado)
 * =========================================================*/
router.get('/quincenal-formapago', async (req, res) => {
  try {
    const anio     = toIntOrNull(req.query.anio)
    const mes      = toIntOrNull(req.query.mes)
    const quincena = toIntOrNull(req.query.quincena) // 1 o 2
    const producto = toLikeOrNull(req.query.producto)
    const segmento = toLikeOrNull(req.query.segmento)
    const metodo   = toLikeOrNull(req.query.metodo)
    const estado   = toLikeOrNull(req.query.estado)

    const sql = `
      SELECT *
      FROM reportes_sukhavati.fn_rpt_cobranza_quincenal_formapago($1,$2,$3,$4,$5,$6,$7)
      ORDER BY anio DESC, mes DESC, quincena DESC, segmento, metodo_de_pago;
    `
    const { rows } = await query(sql, [anio, mes, quincena, producto, segmento, metodo, estado])
    res.json(rows)
  } catch (err) {
    handleError(res, err, 'quincenal-formapago')
  }
})

/* ==================================================================================
 * 4) mensual por PRODUCTO x FORMA DE PAGO
 *    -> fn_rpt_cobranza_mensual_producto_formapago(anio, mes, producto, segmento, metodo, estado)
 * =================================================================================*/
router.get('/mensual-producto-formapago', async (req, res) => {
  try {
    const anio     = toIntOrNull(req.query.anio)
    const mes      = toIntOrNull(req.query.mes)
    const producto = toLikeOrNull(req.query.producto)
    const segmento = toLikeOrNull(req.query.segmento)
    const metodo   = toLikeOrNull(req.query.metodo)
    const estado   = toLikeOrNull(req.query.estado)

    const sql = `
      SELECT *
      FROM reportes_sukhavati.fn_rpt_cobranza_mensual_producto_formapago($1,$2,$3,$4,$5,$6)
      ORDER BY anio DESC, mes DESC, linea_producto, producto, metodo_de_pago;
    `
    const { rows } = await query(sql, [anio, mes, producto, segmento, metodo, estado])
    res.json(rows)
  } catch (err) {
    handleError(res, err, 'mensual-producto-formapago')
  }
})

/* ==================================================================================
 * 5) semanal por PRODUCTO x FORMA DE PAGO
 *    -> fn_rpt_cobranza_semanal_producto_formapago(iso_anio, iso_semana, producto, segmento, metodo, estado)
 * =================================================================================*/
router.get('/semanal-producto-formapago', async (req, res) => {
  try {
    const iso_anio   = toIntOrNull(req.query.iso_anio)
    const iso_semana = toIntOrNull(req.query.iso_semana)
    const producto = toLikeOrNull(req.query.producto)
    const segmento = toLikeOrNull(req.query.segmento)
    const metodo   = toLikeOrNull(req.query.metodo)
    const estado   = toLikeOrNull(req.query.estado)

    const sql = `
      SELECT *
      FROM reportes_sukhavati.fn_rpt_cobranza_semanal_producto_formapago($1,$2,$3,$4,$5,$6)
      ORDER BY iso_anio DESC, iso_semana DESC, linea_producto, producto, metodo_de_pago;
    `
    const { rows } = await query(sql, [iso_anio, iso_semana, producto, segmento, metodo, estado])
    res.json(rows)
  } catch (err) {
    handleError(res, err, 'semanal-producto-formapago')
  }
})

/* ==================================================================================
 * 6) quincena por PRODUCTO x FORMA DE PAGO
 *    -> fn_rpt_cobranza_quincena_producto_formapago(anio, mes, quincena, producto, segmento, metodo, estado)
 * =================================================================================*/
router.get('/quincena-producto-formapago', async (req, res) => {
  try {
    const anio     = toIntOrNull(req.query.anio)
    const mes      = toIntOrNull(req.query.mes)
    const quincena = toIntOrNull(req.query.quincena)
    const producto = toLikeOrNull(req.query.producto)
    const segmento = toLikeOrNull(req.query.segmento)
    const metodo   = toLikeOrNull(req.query.metodo)
    const estado   = toLikeOrNull(req.query.estado)

    const sql = `
      SELECT *
      FROM reportes_sukhavati.fn_rpt_cobranza_quincena_producto_formapago($1,$2,$3,$4,$5,$6,$7)
      ORDER BY anio DESC, mes DESC, quincena DESC, linea_producto, producto, metodo_de_pago;
    `
    const { rows } = await query(sql, [anio, mes, quincena, producto, segmento, metodo, estado])
    res.json(rows)
  } catch (err) {
    handleError(res, err, 'quincena-producto-formapago')
  }
})

/* =======================================
 * 7) rango de fechas (producto/segmento/metodo/estado)
 *    -> fn_rpt_cobranza_rango(ini, fin, producto, segmento, metodo, estado)
 *    Acepta ini/fin o fecha_inicio/fecha_fin desde el front
 * =======================================*/
router.get('/rango', async (req, res) => {
  try {
    const iniParam = req.query.ini || req.query.fecha_inicio || null; // YYYY-MM-DD
    const finParam = req.query.fin || req.query.fecha_fin || null;    // YYYY-MM-DD

    const producto = toLikeOrNull(req.query.producto);
    const segmento = toLikeOrNull(req.query.segmento);
    const metodo   = toLikeOrNull(req.query.metodo);
    const estado   = toLikeOrNull(req.query.estado);

    if (!iniParam || !finParam) {
      return res.status(400).json({ ok: false, error: 'Debes enviar fecha_inicio y fecha_fin (YYYY-MM-DD)' });
    }

    const sql = `
      SELECT *
      FROM reportes_sukhavati.fn_rpt_cobranza_rango($1,$2,$3,$4,$5,$6)
      ORDER BY linea_producto, producto, metodo_de_pago;
    `;
    const { rows } = await query(sql, [iniParam, finParam, producto, segmento, metodo, estado]);
    res.json(rows);
  } catch (err) {
    handleError(res, err, 'rango');
  }
});

/* =======================================
 * 8) rango de fechas (producto/segmento/metodo/estado)
 *    -> fn_rpt_cobranza_detalle_rango
 * =======================================*/
router.get('/consecutivo', async (req, res) => {
  try {
    const iniParam = req.query.ini || req.query.fecha_inicio || null; // YYYY-MM-DD
    const finParam = req.query.fin || req.query.fecha_fin || null;    // YYYY-MM-DD

    const producto = toLikeOrNull(req.query.producto);
    const segmento = toLikeOrNull(req.query.segmento);
    const metodo   = toLikeOrNull(req.query.metodo);
    const estado   = toLikeOrNull(req.query.estado);
    
    if (!iniParam || !finParam) {
      return res.status(400).json({ ok: false, error: 'Debes enviar fecha_inicio y fecha_fin (YYYY-MM-DD)' });
    }
    const sql = `
      SELECT *
      FROM reportes_sukhavati.fn_rpt_cobranza_detalle_rango($1, $2, $3, $4, $5, $6)
      ORDER BY fecha_de_registro, socio
    `;
    const { rows } = await query(sql, [iniParam, finParam, producto, metodo, estado, segmento]);
    res.json(rows);
  } catch (err) {
    handleError(res, err, 'consecutivo');
  }
});

/* =======================================
 * 9) Catálogo de products
 * =======================================*/
router.get('/products', async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT
        producto AS producto
      FROM reportes_sukhavati.pagos
      WHERE producto IS NOT NULL
      ORDER BY producto;
    `
    const { rows } = await query(sql)
    res.json(rows.map(r => r.producto))
  } catch (err) {
    handleError(res, err, 'products')
  }
})

/* =======================================
 * 10) Catálogo de Estados
 * =======================================*/
router.get('/estados', async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT estado
      FROM reportes_sukhavati.pagos
      WHERE estado IS NOT NULL AND btrim(estado) <> ''
      ORDER BY estado;
    `;
    const { rows } = await query(sql);
    res.json(rows.map(r => r.estado));
  } catch (err) {
    handleError(res, err, 'estados');
  }
});

/* =======================================
 * 11) Catálogo de Formas de pagos
 * =======================================*/
router.get('/formapago', async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT INITCAP(LOWER(btrim(metodo_de_pago))) AS metodo_pago
      FROM reportes_sukhavati.pagos
      WHERE metodo_de_pago IS NOT NULL AND btrim(metodo_de_pago) <> ''
      ORDER BY metodo_pago;
    `;
    const { rows } = await query(sql);
    res.json(rows.map(r => r.metodo_pago));
  } catch (err) {
    handleError(res, err, 'formapago');
  }
});

export default router
