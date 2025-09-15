import path from 'path';
import { getDirSize } from './fs-helper.js';
import { SESSION_QUOTA_BYTES } from '../config.js';

// Vérifie que la taille d'une session ne dépasse pas le quota /
// Ensure session directory size doesn't exceed the configured quota


export async function withinQuotaOrThrow(sessionDir) {
	const size = await getDirSize(sessionDir);
	if (size > SESSION_QUOTA_BYTES) {
		const err = new Error('Quota exceeded');
		// Code d'erreur spécifique pour tests/gestion / Specific error code for callers
		err.code = 'QUOTA';
		throw err;
	}
}