// server.js — Express + Socket.IO — sessions éphémères collaboratives
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';
import { fileURLToPath } from 'url';

import {
	APP_PORT,
	DATA_DIR,
	SESSION_TTL_DAYS,
	MAX_SESS_CODE_LEN,
	MAX_UPLOAD_BYTES,
	PAYPAL_URL,
	BASE_PATH
} from './config.js';

import { ensureDir, readJSON, writeJSON, safeBasename } from './lib/fs-helper.js';
import { withinQuotaOrThrow } from './lib/quota.js';
import { scheduleCleanup } from './lib/cleanup.js';

// Basic setup
await ensureDir(DATA_DIR);
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { path: `${BASE_PATH || ''}/socket.io`, cors: { origin: '*', methods: ['GET','POST','DELETE'] } });

// Middleware
app.use(cors());
app.use(express.json());

// Static files (Windows-safe)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
app.use(BASE_PATH || '/', express.static(publicDir));
// Also expose static under /join so relative links (styles.css, client.js, favicon.svg) work on /join/:code
app.use(`${BASE_PATH || ''}/join`, express.static(publicDir));

// Root & join routes (SPA entry)
app.get(`${BASE_PATH || ''}/`, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get(`${BASE_PATH || ''}/join/:code`, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Health check
app.get(`${BASE_PATH || ''}/healthz`, (_req, res) => res.json({ ok: true }));

// Helpers
function sessionPath(code) { return path.join(DATA_DIR, code); }
function sessionFilesPath(code) { return path.join(sessionPath(code), 'files'); }
// Presence (mémoire process) : { [sessionCode]: { [socketId]: { userId, name, color } } }
const presence = Object.create(null);
async function ensureSession(code) {
	const sdir = sessionPath(code);
	await ensureDir(sdir);
	await ensureDir(sessionFilesPath(code));
	const metaPath = path.join(sdir, 'meta.json');
	if (!fs.existsSync(metaPath)) {
		const meta = { createdAt: Date.now(), public: false, table: { rows: 10, cols: 20, cells: {} }, canvas: { strokes: [] }, text: { content: '' }, files: [], chat: { messages: [] } };
		await writeJSON(metaPath, meta);
	}
	return metaPath;
}

// Multer storage for uploads
const storage = multer.diskStorage({
	destination: async (req, file, cb) => {
		try {
			const code = safeBasename(req.params.code).slice(0, MAX_SESS_CODE_LEN);
			await ensureSession(code);
			const dest = sessionFilesPath(code);
			cb(null, dest);
		} catch (e) { cb(e); }
	},
	filename: (req, file, cb) => {
		// Sanitize and shorten filename to avoid FS limits; preserve extension
		const raw = path.basename(file.originalname).replace(/[/\\]/g, '');
		let ext = path.extname(raw).slice(0, 16);
		// keep only safe chars in ext (., letters, digits, _ -)
		ext = ext.replace(/[^.A-Za-z0-9_-]/g, '');
		let name = path.basename(raw, ext);
		// collapse spaces
		name = name.replace(/\s+/g, ' ').trim();
		// restrict charset to safe URL/FS set
		name = name.replace(/[^A-Za-z0-9._-]+/g, '-');
		// max base length so that final id stays < 180 chars
		const MAX_BASE = 120;
		if (name.length > MAX_BASE) name = name.slice(0, MAX_BASE);
		const stamp = Date.now().toString(36);
		const rnd = Math.random().toString(36).slice(2, 8);
		const finalName = `${name || 'file'}_${stamp}_${rnd}${ext || ''}`;
		cb(null, finalName);
	}
});
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });

// API — List files
app.get(`${BASE_PATH || ''}/api/session/:code/files`, async (req, res) => {
	try {
		const code = safeBasename(req.params.code).slice(0, MAX_SESS_CODE_LEN);
		const metaPath = await ensureSession(code);
		const meta = await readJSON(metaPath);
		return res.json({ files: meta.files || [] });
	} catch (e) {
		console.error(e);
		return res.status(500).json({ error: 'Server error' });
	}
});

// API — Create/ensure session
app.put(`${BASE_PATH || ''}/api/session/:code`, async (req, res) => {
	try {
		const code = safeBasename(req.params.code).slice(0, MAX_SESS_CODE_LEN);
		const metaPath = await ensureSession(code);
		const meta = await readJSON(metaPath);
		const expiresAt = meta.createdAt + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
		return res.json({ ok: true, code, createdAt: meta.createdAt, expiresAt, public: !!meta.public });
	} catch (e) {
		console.error(e);
		return res.status(500).json({ error: 'Cannot ensure session' });
	}
});

// API — Basculer public/privé pour une session
app.put(`${BASE_PATH || ''}/api/session/:code/public`, async (req, res) => {
	try {
		const code = safeBasename(req.params.code).slice(0, MAX_SESS_CODE_LEN);
		const metaPath = await ensureSession(code);
		const meta = await readJSON(metaPath);
		meta.public = !!req.body?.public;
		await writeJSON(metaPath, meta);
		io.to(`sess:${code}`).emit('session:public', { public: !!meta.public });
		res.json({ ok: true, public: !!meta.public });
	} catch (e) {
		console.error(e);
		res.status(500).json({ error: 'Cannot toggle public' });
	}
});

// API — lister sessions publiques (limité)
app.get(`${BASE_PATH || ''}/api/public-sessions`, async (_req, res) => {
	try {
		const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
		const out = [];
		for (const dirent of entries) {
			const code = dirent.name;
			const metaPath = path.join(sessionPath(code), 'meta.json');
			if (!fs.existsSync(metaPath)) continue;
			const meta = await readJSON(metaPath);
			if (!meta.public) continue;
			const expiresAt = meta.createdAt + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
			if (Date.now() > expiresAt) continue; // skip expired
			out.push({ code, createdAt: meta.createdAt, expiresAt });
			if (out.length >= 200) break; // hard cap
		}
		// Tri plus récent d'abord
		out.sort((a,b) => b.createdAt - a.createdAt);
		res.json({ sessions: out });
	} catch (e) {
		console.error(e);
		res.status(500).json({ error: 'Cannot list public sessions' });
	}
});

// API — Upload file (with explicit Multer error handling)
app.post(`${BASE_PATH || ''}/api/session/:code/upload`, (req, res) => {
	const handler = upload.single('file');
	handler(req, res, async (err) => {
		try {
			if (err) {
				// Multer errors (e.g. LIMIT_FILE_SIZE)
				if (err.code === 'LIMIT_FILE_SIZE') {
					return res.status(413).json({ error: 'File too large', limit: MAX_UPLOAD_BYTES });
				}
				console.error('Upload error:', err);
				return res.status(400).json({ error: 'Upload error' });
			}

			const code = safeBasename(req.params.code).slice(0, MAX_SESS_CODE_LEN);
			const sdir = sessionPath(code);
			const metaPath = path.join(sdir, 'meta.json');
			const meta = await readJSON(metaPath);

			if (!req.file) {
				return res.status(400).json({ error: 'No file provided' });
			}

			// Quota check after save; rollback if exceeded
			try {
				await withinQuotaOrThrow(sdir);
			} catch (qerr) {
				if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
				return res.status(413).json({ error: 'Quota exceeded', upgradeUrl: PAYPAL_URL });
			}

			const record = {
				id: path.basename(req.file.filename),
				originalName: req.file.originalname,
				size: req.file.size,
				mimetype: req.file.mimetype,
				uploadedAt: Date.now()
			};
			meta.files = meta.files || [];
			meta.files.push(record);
			await writeJSON(metaPath, meta);
			io.to(`sess:${code}`).emit('files:update');
			return res.json({ ok: true, file: record });
		} catch (e) {
			console.error('Upload failed:', e);
			return res.status(500).json({ error: 'Upload failed' });
		}
	});
});

// API — Enregistrer une note (texte) comme fichier .txt sous quota
app.post(`${BASE_PATH || ''}/api/session/:code/save-note`, async (req, res) => {
	try {
		const code = safeBasename(req.params.code).slice(0, MAX_SESS_CODE_LEN);
		const sdir = sessionPath(code);
		const metaPath = await ensureSession(code);
		const meta = await readJSON(metaPath);
		const text = String(req.body?.text || '');
		const preferredName = String(req.body?.filename || '').replace(/[/\\]/g, '').slice(0, 128);
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const baseName = preferredName || `note_${stamp}.txt`;
		const fileId = `${baseName}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
		const filePath = path.join(sdir, 'files', fileId);
		// écrire le fichier, puis vérifier le quota et rollback si nécessaire
		fs.writeFileSync(filePath, text, 'utf8');
		try {
			await withinQuotaOrThrow(sdir);
		} catch (err) {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
			return res.status(413).json({ error: 'Quota exceeded', upgradeUrl: PAYPAL_URL });
		}
		const stats = fs.statSync(filePath);
		const record = {
			id: path.basename(fileId),
			originalName: baseName,
			size: stats.size,
			mimetype: 'text/plain',
			uploadedAt: Date.now()
		};
		meta.files = meta.files || [];
		meta.files.push(record);
		await writeJSON(metaPath, meta);
		io.to(`sess:${code}`).emit('files:update');
		return res.json({ ok: true, file: record });
	} catch (e) {
		console.error(e);
		return res.status(500).json({ error: 'Save note failed' });
	}
});

// Télécharger fichier
app.get(`${BASE_PATH || ''}/api/session/:code/file/:id`, async (req, res) => {
	try {
		const code = safeBasename(req.params.code).slice(0, MAX_SESS_CODE_LEN);
		const id = safeBasename(req.params.id);
		const sdir = sessionPath(code);
		const filePath = path.join(sdir, 'files', id);
		if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

		// Try to look up originalName and mimetype from meta.json for better headers
		let originalName = undefined;
		let mimetype = undefined;
		const metaPath = path.join(sdir, 'meta.json');
		if (fs.existsSync(metaPath)) {
			try {
				const meta = await readJSON(metaPath);
				const rec = (meta.files || []).find(f => f.id === id);
				if (rec) { originalName = rec.originalName; mimetype = rec.mimetype; }
			} catch {}
		}

		// Set headers: inline for images, attachment otherwise
		if (mimetype && /^image\//i.test(mimetype)) {
			res.setHeader('Content-Type', mimetype);
			// no attachment -> allows <img> previews
		} else {
			const safeName = (originalName || id.split('_')[0] || 'download').replace(/[\r\n"']/g, '');
			res.setHeader('Content-Type', 'application/octet-stream');
			res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
		}
		res.setHeader('X-Content-Type-Options', 'nosniff');
		return res.sendFile(path.resolve(filePath));
	} catch (e) {
		console.error('download failed', e);
		return res.status(500).send('Server error');
	}
});

// Supprimer fichier
app.delete(`${BASE_PATH || ''}/api/session/:code/file/:id`, async (req, res) => {
	const code = safeBasename(req.params.code).slice(0, MAX_SESS_CODE_LEN);
	const id = safeBasename(req.params.id);
	const sdir = sessionPath(code);
	const filePath = path.join(sdir, 'files', id);
	const metaPath = path.join(sdir, 'meta.json');
	if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Not found' });
	const meta = await readJSON(metaPath);
	meta.files = (meta.files || []).filter(f => f.id !== id);
	await writeJSON(metaPath, meta);
	if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
	io.to(`sess:${code}`).emit('files:update');
	return res.json({ ok: true });
});

// Supprimer entièrement une session (dossier + fichiers)
app.delete(`${BASE_PATH || ''}/api/session/:code`, async (req, res) => {
    try {
        const code = safeBasename(req.params.code).slice(0, MAX_SESS_CODE_LEN);
        const sdir = sessionPath(code);
        if (!fs.existsSync(sdir)) return res.status(404).json({ error: 'Not found' });
        // Supprimer récursivement
        fs.rmSync(sdir, { recursive: true, force: true });
        io.to(`sess:${code}`).emit('session:deleted');
        return res.json({ ok: true });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Delete failed' });
    }
});

// Socket.IO — synchronisation table & canvas
io.on('connection', (socket) => {
	socket.on('join', async ({ code, userId, name, color }) => {
		const safe = safeBasename(code).slice(0, MAX_SESS_CODE_LEN);
		const metaPath = path.join(sessionPath(safe), 'meta.json');
		if (!fs.existsSync(metaPath)) return; // ignore
		socket.join(`sess:${safe}`);
		// mémoriser la session pour ce socket
		socket.data.session = safe;

		// Presence add
		presence[safe] = presence[safe] || {};
		const uid = String(userId || '').slice(0, 64) || `u_${socket.id.slice(-6)}`;
		const uname = String(name || '').slice(0, 50);
		const ucolor = (typeof color === 'string' && /^#?[0-9A-Fa-f]{6}$/.test(color)) ? (color.startsWith('#') ? color : '#' + color) : undefined;
		presence[safe][socket.id] = { userId: uid, name: uname || undefined, color: ucolor };

		// Envoyer l’état initial
		const meta = await readJSON(metaPath);
		// La sélection d'onglet n'est plus partagée; on n'envoie que les états des données
		socket.emit('state:init', { table: meta.table, canvas: meta.canvas, text: meta.text, chat: meta.chat || { messages: [] }, presence: Object.values(presence[safe] || {}), public: !!meta.public });
		io.to(`sess:${safe}`).emit('presence:update', { users: Object.values(presence[safe] || {}) });
	});

	socket.on('table:update', async ({ code, r, c, value }) => {
		const safe = safeBasename(code).slice(0, MAX_SESS_CODE_LEN);
		const metaPath = path.join(sessionPath(safe), 'meta.json');
		if (!fs.existsSync(metaPath)) return;
		const meta = await readJSON(metaPath);
		const key = `${r},${c}`;
		meta.table = meta.table || { rows: 10, cols: 20, cells: {} };
		meta.table.cells[key] = String(value || '').slice(0, 1024);
		await writeJSON(metaPath, meta);
		socket.to(`sess:${safe}`).emit('table:patch', { r, c, value: meta.table.cells[key] });
	});

	socket.on('canvas:stroke', async ({ code, stroke }) => {
		const safe = safeBasename(code).slice(0, MAX_SESS_CODE_LEN);
		const metaPath = path.join(sessionPath(safe), 'meta.json');
		if (!fs.existsSync(metaPath)) return;
		const meta = await readJSON(metaPath);
		meta.canvas = meta.canvas || { strokes: [] };
		// limite la taille d’un stroke
		const safeStroke = {
			width: Math.min(Math.max(stroke.width || 2, 1), 20),
			color: String(stroke.color || '#000000').slice(0, 16),
			points: (stroke.points || []).slice(0, 200).map(p => ({ x: Math.floor(p.x), y: Math.floor(p.y) }))
		};
		meta.canvas.strokes.push(safeStroke);
		// garde au plus 2000 strokes
		if (meta.canvas.strokes.length > 2000) meta.canvas.strokes.shift();
		await writeJSON(metaPath, meta);
		socket.to(`sess:${safe}`).emit('canvas:stroke', safeStroke);
	});

	    // Effacer tout le canvas
	    socket.on('canvas:clear', async ({ code }) => {
	        const safe = safeBasename(code).slice(0, MAX_SESS_CODE_LEN);
	        const metaPath = path.join(sessionPath(safe), 'meta.json');
	        if (!fs.existsSync(metaPath)) return;
	        const meta = await readJSON(metaPath);
	        meta.canvas = { strokes: [] };
	        await writeJSON(metaPath, meta);
	        io.to(`sess:${safe}`).emit('canvas:clear');
	    });

		// Annuler dernier trait
		socket.on('canvas:undo', async ({ code }) => {
			const safe = safeBasename(code).slice(0, MAX_SESS_CODE_LEN);
			const metaPath = path.join(sessionPath(safe), 'meta.json');
			if (!fs.existsSync(metaPath)) return;
			const meta = await readJSON(metaPath);
			meta.canvas = meta.canvas || { strokes: [] };
			if (meta.canvas.strokes.length) meta.canvas.strokes.pop();
			await writeJSON(metaPath, meta);
			io.to(`sess:${safe}`).emit('canvas:undo');
		});

	// La sélection d'onglet n'est plus partagée; suppression de l'événement 'view:select'

	// Mettre à jour son profil (nom, couleur)
	socket.on('presence:set', ({ name, color }) => {
		try {
			const safe = socket.data.session;
			if (!safe || !presence[safe]) return;
			const entry = presence[safe][socket.id];
			if (!entry) return;
			const uname = String(name || '').slice(0, 50);
			const ucolor = (typeof color === 'string' && /^#?[0-9A-Fa-f]{6}$/.test(color)) ? (color.startsWith('#') ? color : '#' + color) : undefined;
			entry.name = uname || undefined;
			entry.color = ucolor;
			io.to(`sess:${safe}`).emit('presence:update', { users: Object.values(presence[safe]) });
		} catch (e) { console.error('presence:set failed', e); }
	});

	// Chat temps réel — messages stockés côté serveur (cap à 1000)
	socket.on('chat:message', async ({ code, message }) => {
		try {
			const safe = safeBasename(code).slice(0, MAX_SESS_CODE_LEN);
			const metaPath = path.join(sessionPath(safe), 'meta.json');
			if (!fs.existsSync(metaPath)) return;
			const meta = await readJSON(metaPath);
			meta.chat = meta.chat || { messages: [] };
			const clean = {
				id: (message?.id && String(message.id)) || Math.random().toString(36).slice(2),
				at: Date.now(),
				authorId: String(message?.authorId || '').slice(0, 64) || 'anon',
				text: String(message?.text || '').slice(0, 5000),
				authorName: String(message?.authorName || '').slice(0, 50) || undefined,
				authorColor: (typeof message?.authorColor === 'string' && /^#?[0-9A-Fa-f]{6}$/.test(message.authorColor)) ? (message.authorColor.startsWith('#') ? message.authorColor : '#' + message.authorColor) : undefined,
				attachments: []
			};
			// Valider pièces jointes: uniquement des fichiers connus de la session
			const files = meta.files || [];
			const reqAtt = Array.isArray(message?.attachments) ? message.attachments.slice(0, 10) : [];
			for (const a of reqAtt) {
				const id = a && String(a.id || a.fileId || '').replace(/[^A-Za-z0-9._-]/g, '');
				if (!id) continue;
				const f = files.find(x => x.id === id);
				if (!f) continue;
				clean.attachments.push({ id: f.id, originalName: f.originalName, mimetype: f.mimetype, size: f.size });
			}
			// Ajouter et borner l'historique
			meta.chat.messages.push(clean);
			if (meta.chat.messages.length > 1000) meta.chat.messages.splice(0, meta.chat.messages.length - 1000);
			await writeJSON(metaPath, meta);
			io.to(`sess:${safe}`).emit('chat:message', clean);
		} catch (e) {
			console.error('chat:message failed', e);
		}
	});

	// Éditeur de texte collaboratif
	socket.on('text:update', async ({ code, text, origin }) => {
		const safe = safeBasename(code).slice(0, MAX_SESS_CODE_LEN);
		const metaPath = path.join(sessionPath(safe), 'meta.json');
		if (!fs.existsSync(metaPath)) return;
		const meta = await readJSON(metaPath);
		meta.text = meta.text || { content: '' };
		const safeText = String(text || '');
		// limitation simple de taille (256 Ko)
		meta.text.content = safeText.slice(0, 256 * 1024);
		await writeJSON(metaPath, meta);
		io.to(`sess:${safe}`).emit('text:update', { text: meta.text.content, origin });
	});

	socket.on('disconnect', () => {
		// Retirer des presences et notifier
		for (const [sess, users] of Object.entries(presence)) {
			if (users[socket.id]) {
				delete users[socket.id];
				io.to(`sess:${sess}`).emit('presence:update', { users: Object.values(users) });
			}
		}
	});
});

// Tâche de nettoyage périodique
scheduleCleanup({ DATA_DIR, SESSION_TTL_DAYS });

server.listen(APP_PORT, () => {
	console.log(`QuickShare Chat listening on :${APP_PORT}${BASE_PATH || ''}`);
});