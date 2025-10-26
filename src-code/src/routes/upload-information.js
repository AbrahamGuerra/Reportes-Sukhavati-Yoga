import express from 'express'
import multer from 'multer'
import { upsertPartnersFromXlsx } from '../mappers/partners.js'
import { upsertCouponsFromXlsx } from '../mappers/coupons.js'
import { upsertProductsFromXlsx } from '../mappers/products.js'
import { upsertSubscriptionsFromXlsx } from '../mappers/subscriptions.js'
import { upsertActivitiesFromXlsx } from '../mappers/activities.js'
import { mergeAndUpsertpayments } from '../mappers/payments.js'
import { authRequired } from '../auth/middleware.js'

const router = express.Router()
const uploadAny = multer({ storage: multer.memoryStorage() }).any()

router.post('/upload', authRequired, uploadAny, async (req, res) => {
  const badRequest = (msg) => res.status(400).json({ ok: false, error: msg });
  const serverError = (err, scope = 'upload') => {
    console.error(`${scope} error:`, err);
    return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
  };

  try {
    const schema = String(req.body.schema || '').trim().toLowerCase();
    const table  = String(req.body.table || '').trim().toLowerCase();
    const role   = String(req.user?.role || '').trim().toLowerCase();
    
    if (!schema || !table) return badRequest('Debes enviar schema y table');
    if (!req.files || !req.files.length) return badRequest('No se recibieron archivos');

    if (schema !== 'reportes_sukhavati') return badRequest('Schema no permitido');

    const HANDLERS = {
      partners: {
        filesRequired: 1,
        run: async (files) =>
          upsertPartnersFromXlsx(files[0].buffer, { sheet: 'Export', schema }),
        successMessage: 'Socios actualizados correctamente',
      },
      coupons: {
        filesRequired: 1,
        run: async (files) =>
          upsertCouponsFromXlsx(files[0].buffer, { sheet: 'Export', schema }),
        successMessage: 'Cupones actualizados correctamente',
      },
      products: {
        filesRequired: 1,
        run: async (files) =>
          upsertProductsFromXlsx(files[0].buffer, { sheet: 'Export', schema }),
        successMessage: 'Productos actualizados correctamente',
      },
      subscriptions: {
        filesRequired: 1,
        run: async (files) =>
          upsertSubscriptionsFromXlsx(files[0].buffer, { sheet: 'Export', schema }),
        successMessage: 'Suscripciones actualizadas correctamente',
      },
      activities: {
        filesRequired: 1,
        run: async (files) =>
          upsertActivitiesFromXlsx(files[0].buffer, { sheet: 'Export', schema, role }),
        successMessage: 'Actividades actualizadas correctamente',
      },
      payments: {
        filesRequired: 2,
        run: async (files) => {
          const [fileA, fileB] = files;
          return mergeAndUpsertpayments(fileA, fileB, { schema, role });
        },
        successMessage: 'Pagos actualizados correctamente',
      },
    };

    const handler = HANDLERS[table];

    if (handler) {
      if (req.files.length < handler.filesRequired) {
        return badRequest(
          `Se requieren ${handler.filesRequired} archivo(s) para "${table}" y se recibieron ${req.files.length}.`
        );
      }
      
      try {
        const result = await handler.run(req.files);
        return res.json({ ok: true, ...result, message: handler.successMessage });
      } catch (err) {
        return serverError(err, `upsert ${table}`);
      }
    }
  } catch (err) {
    return serverError(err);
  }
});


export default router
