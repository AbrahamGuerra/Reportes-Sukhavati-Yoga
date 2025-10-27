import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config()

export function authRequired(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ ok: false, error: 'TOKEN_REQUIRED' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(403).json({ ok: false, error: 'INVALID_TOKEN' })
  }
}
