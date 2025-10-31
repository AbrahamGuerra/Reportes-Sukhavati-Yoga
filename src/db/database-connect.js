import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();
const useSSL = (process.env.PGSSL || '').toLowerCase() === 'false';
const rejectUnauthorized = (process.env.PGSSL_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false';

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: useSSL ? { rejectUnauthorized } : undefined,
  max: 5,
  idleTimeoutMillis: 240000,
  connectionTimeoutMillis: 10000,
});

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
