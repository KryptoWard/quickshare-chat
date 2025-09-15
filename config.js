// ------------------------------------------------------------
// Configuration de l'application (FR)
// Application configuration (EN)
// ------------------------------------------------------------
// Toutes les options peuvent être surchargées par des variables
// d'environnement. Ce fichier ne doit contenir aucun secret.
// All options can be overridden via environment variables.
// This file must not contain any secrets.

// Port HTTP sur lequel l'app écoute (défaut 3900)
// HTTP port the app listens on (default 3900)
export const APP_PORT = process.env.PORT || 3900;

// Répertoire de stockage des données côté serveur (sessions, fichiers)
// Server-side storage directory (sessions, uploaded files)
export const DATA_DIR = process.env.DATA_DIR || './data';

// Durée de vie d'une session (en jours)
// Session time-to-live (in days)
export const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '7', 10);

// Quota par session (en octets). Défaut: 5 Go.
// Per-session storage quota (in bytes). Default: 5 GB.
export const SESSION_QUOTA_BYTES = parseInt(process.env.SESSION_QUOTA_BYTES || String(5 * 1024 * 1024 * 1024), 10); // 5 Go

// Taille maximale d'un upload (en octets). Défaut: 500 Mo.
// Maximum single upload size (in bytes). Default: 500 MB.
export const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES || String(500 * 1024 * 1024), 10); // 500 Mo/fichier

// Lien affiché lorsque le quota est dépassé (don/upgrade). Doit être neutre.
// Link shown when the quota is exceeded (donation/upgrade). Should be neutral.
export const PAYPAL_URL = process.env.PAYPAL_URL || 'https://example.com/upgrade';

// Longueur max autorisée pour le code de session côté serveur (sécurité)
// Maximum allowed session code length on server-side (security)
export const MAX_SESS_CODE_LEN = 8; // sécurité côté serveur

// Sous-chemin si l'app est servie derrière un proxy (ex: /quickshare-chat).
// Important: ne pas mettre de slash final (sera normalisé ci-dessous).
// Sub-path when hosted behind a reverse proxy (e.g., /quickshare-chat).
// Important: no trailing slash (normalized below).
export const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');