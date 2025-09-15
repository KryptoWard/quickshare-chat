import path from 'path';
import { getDirSize } from './fs-helper.js';
import { SESSION_QUOTA_BYTES } from '../config.js';


export async function withinQuotaOrThrow(sessionDir) {
const size = await getDirSize(sessionDir);
if (size > SESSION_QUOTA_BYTES) {
const err = new Error('Quota exceeded');
err.code = 'QUOTA';
throw err;
}
}