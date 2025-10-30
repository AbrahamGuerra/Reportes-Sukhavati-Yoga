import { query } from '../db/database-connect.js';

export function audit(action) {
  return (req, res, next) => {
    const t0 = Date.now();
    res.on('finish', async () => {
      try {
        const latency = Date.now() - t0;
        const user = req.user || null;
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

        // Enmascarar IP opcionalmente
        // const maskedIp = ip.replace(/\d+$/, '0');
        const statusCode = String(res.statusCode);
        const result = (statusCode.startsWith('2') || statusCode === '304') 
          ? 'success' 
          : 'fail';
        await query(
          `INSERT INTO reportes_sukhavati.auth_audit_log
           (user_id, email, action, outcome, reason, route, http_status, ip, user_agent, latency_ms, meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            user?.id || null,
            user?.email || (req.body?.email || null),
            action,
            result,
            res.locals.failReason || null,
            req.originalUrl,
            res.statusCode,
            ip || null,
            req.headers['user-agent'] || null,
            latency,
            JSON.stringify({
              method: req.method,
              role: user?.role || null,
            })
          ]
        );
      } catch (e) {
        // no romper el flujo por fallas de logging
        console.error('audit-log error:', e.message);
      }
    });
    next();
  };
}
