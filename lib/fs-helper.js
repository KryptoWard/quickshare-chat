import fs from 'fs';
import path from 'path';

// Utilitaires fichiers (FR) / File helpers (EN)
// - Fonctions asynchrones qui gèrent les erreurs courantes.
// - Pas de logique métier ici, uniquement des primitives sûres.


export async function ensureDir(dir) {
	// Crée le dossier s'il n'existe pas (récursif) / Create directory if missing (recursive)
	await fs.promises.mkdir(dir, { recursive: true });
}


export async function readJSON(p) {
	// Lit un JSON en UTF-8 et le parse / Read UTF-8 JSON and parse
	const raw = await fs.promises.readFile(p, 'utf8');
	return JSON.parse(raw);
}


export async function writeJSON(p, obj) {
	// Écrit de façon atomique via un fichier temporaire / Atomic write via temp file
	const tmp = p + '.tmp';
	await fs.promises.writeFile(tmp, JSON.stringify(obj, null, 2));
	await fs.promises.rename(tmp, p);
}


export async function getDirSize(dir) {
	// Calcule la taille récursive d'un dossier / Compute recursive directory size
	let total = 0;
	async function walk(d) {
		const entries = await fs.promises.readdir(d, { withFileTypes: true });
		for (const e of entries) {
			const fp = path.join(d, e.name);
			if (e.isDirectory()) await walk(fp);
			else {
				try { const st = await fs.promises.stat(fp); total += st.size; } catch {}
			}
		}
	}
	if (fs.existsSync(dir)) await walk(dir);
	return total;
}


export function safeBasename(name) {
	// Nettoie une valeur pour usage en nom de fichier / Sanitize for filesystem-safe base name
	return String(name || '').replace(/[^A-Za-z0-9._-]/g, '');
}