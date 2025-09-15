import fs from 'fs';
import path from 'path';


export function scheduleCleanup({ DATA_DIR, SESSION_TTL_DAYS }) {
	// Tâche qui supprime les sessions expirées selon TTL
	// Task that removes expired sessions based on TTL
	const ttlMs = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
	async function run() {
		try {
			const dirs = await fs.promises.readdir(DATA_DIR, { withFileTypes: true });
			const now = Date.now();
			for (const d of dirs) {
				if (!d.isDirectory()) continue;
				const sdir = path.join(DATA_DIR, d.name);
				const metaPath = path.join(sdir, 'meta.json');
				if (!fs.existsSync(metaPath)) continue;
				try {
					const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8'));
					if (!meta.createdAt || (now - meta.createdAt) > ttlMs) {
						await fs.promises.rm(sdir, { recursive: true, force: true });
					}
				} catch {}
			}
		} catch (e) { console.error('cleanup error', e); }
	}
	// Au démarrage + toutes les heures / At startup + hourly
	run();
	setInterval(run, 60 * 60 * 1000);
}