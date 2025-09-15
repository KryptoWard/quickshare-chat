export const APP_PORT = process.env.PORT || 3900;
export const DATA_DIR = process.env.DATA_DIR || './data';
export const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '7', 10);
export const SESSION_QUOTA_BYTES = parseInt(process.env.SESSION_QUOTA_BYTES || String(5 * 1024 * 1024 * 1024), 10); // 5 Go
export const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES || String(500 * 1024 * 1024), 10); // 500 Mo/fichier
export const PAYPAL_URL = process.env.PAYPAL_URL || 'https://example.com/upgrade';
export const MAX_SESS_CODE_LEN = 8; // sécurité côté serveur
export const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');