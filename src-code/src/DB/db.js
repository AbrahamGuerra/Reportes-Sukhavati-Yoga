import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();
const useSSL = (process.env.PGSSL || '').toLowerCase() === 'true';
const rejectUnauthorized = (process.env.PGSSL_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false';

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: useSSL ? { rejectUnauthorized } : undefined,
});

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
