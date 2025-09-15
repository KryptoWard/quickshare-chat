import fs from 'fs';
import path from 'path';


export async function ensureDir(dir) {
await fs.promises.mkdir(dir, { recursive: true });
}


export async function readJSON(p) {
const raw = await fs.promises.readFile(p, 'utf8');
return JSON.parse(raw);
}


export async function writeJSON(p, obj) {
const tmp = p + '.tmp';
await fs.promises.writeFile(tmp, JSON.stringify(obj, null, 2));
await fs.promises.rename(tmp, p);
}


export async function getDirSize(dir) {
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
return String(name || '').replace(/[^A-Za-z0-9._-]/g, '');
}