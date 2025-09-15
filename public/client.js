// client.js — logique front pour créer/rejoindre et collaborer

// Helpers DOM
const $ = (sel) => document.querySelector(sel);
const joinParams = (() => {
	const m = location.pathname.match(/\/join\/([A-Za-z0-9]{1,8})/);
	return m ? m[1].toUpperCase() : null;
})();

// Compute basePath (supports hosting under any subpath like /quickshare or /quickshare-chat)
const pathParts = location.pathname.split('/').filter(Boolean);
const basePath = pathParts.length && pathParts[0] !== 'join' ? '/' + pathParts[0] : '';

// State global
const state = {
	code: null,
	type: null, // type de session à la création (conservé pour l'UX), mais la vue active est partagée
	socket: null,
	activeView: 'table', // 'table' | 'canvas' | 'storage' | 'text'
	_listenersBound: { canvas: false, storage: false, text: false },
	_refreshingFiles: false,
	_pendingSelectView: null,
	clientId: (() => {
		try {
			const k = 'qs_clientId';
			let v = localStorage.getItem(k);
			if (!v) { v = Math.random().toString(36).slice(2); localStorage.setItem(k, v); }
			return v;
		} catch {
			return Math.random().toString(36).slice(2);
		}
	})()
};

// API client
const api = {
	ensure: async (code) => {
		const r = await fetch(`${basePath}/api/session/${encodeURIComponent(code)}`, { method: 'PUT' });
		if (!r.ok) throw new Error('Impossible de créer la session');
		return r.json();
	},
	listFiles: async (code) => {
		const r = await fetch(`${basePath}/api/session/${encodeURIComponent(code)}/files`);
		if (!r.ok) throw new Error('Erreur de liste des fichiers');
		return r.json();
	}
};

// Views
const welcome = $('#welcome');
const sessionView = $('#session');
const codeSpan = $('#codeSpan');
const typeSpan = $('#typeSpan');
const presenceBar = document.createElement('div');
presenceBar.id = 'presenceBar';
presenceBar.className = 'presence-bar';
document.addEventListener('DOMContentLoaded', () => {
	const header = document.querySelector('#session header');
	if (header) header.appendChild(presenceBar);
});
const expiresDiv = $('#expires');
// Profile inputs
const profileNameInput = $('#profileName');
const profileColorInput = $('#profileColor');
const profileSaveBtn = $('#profileSave');

// Specific containers
const tableView = $('#view-table');
const grid = $('#grid');

const canvasView = $('#view-canvas');
const board = $('#board');
const color = $('#color');
const width = $('#width');

const storageView = $('#view-storage');
const textView = $('#view-text');
const chatView = $('#view-chat');
const textArea = $('#textArea');
const tabs = $('#tabs');
const deleteBtn = $('#deleteSession');
const copyLinkBtn = $('#copyLink');
const clearCanvasBtn = $('#clearCanvas');
const undoCanvasBtn = $('#undoCanvas');
const toolPenBtn = $('#toolPen');
const toolEraserBtn = $('#toolEraser');
const boldBtn = $('#boldBtn');
const italicBtn = $('#italicBtn');
const underlineBtn = $('#underlineBtn');
const saveNoteBtn = $('#saveNoteBtn');
const publicToggle = $('#publicToggle');

// Chat elements
const chatMessagesEl = $('#chatMessages');
const chatForm = $('#chatForm');
const chatInput = $('#chatInput');
const chatFile = $('#chatFile');

// Socket and init
function connectSocket(code) {
	state.socket = io({ path: `${basePath}/socket.io` });

	// Join the session room on connect and reconnect
	state.socket.on('connect', () => {
		const prof = getProfile();
		try { state.socket.emit('join', { code, userId: state.clientId, name: prof.name, color: prof.color }); } catch {}
	});

	// Init payload (view selection is now local-only)
	state.socket.on('state:init', ({ table, canvas, text, chat, presence, public: isPublic }) => {
		// construire toutes les vues une fois
		buildTable(table);
		initCanvas(canvas);
		initStorage();
		initText(text);
		initChat(chat);
		updatePresence(presence || []);
		if (publicToggle) publicToggle.checked = !!isPublic;
		// appliquer une vue locale (par défaut 'table' ou celle choisie lors de la création)
		selectView(state.activeView);
		// Si le créateur avait choisi une vue initiale, l'appliquer localement
		if (state._pendingSelectView) {
			const v = state._pendingSelectView; state._pendingSelectView = null;
			selectView(v);
		}
	});
	// Table patches
	state.socket.on('table:patch', ({ r, c, value }) => {
		const cell = grid.querySelector(`[data-r="${r}"][data-c="${c}"]`);
		if (cell) cell.textContent = value;
	});
	// Storage refresh notification
	state.socket.on('files:update', () => {
		if (state.activeView === 'storage') refreshFiles();
	});
	// Canvas strokes
	state.socket.on('canvas:stroke', (s) => { localStrokes.push(s); drawStroke(s); });

	// Canvas undo
	state.socket.on('canvas:undo', () => {
		if (localStrokes.length) localStrokes.pop();
		redrawAllStrokes();
	});
	// plus d'écoute pour 'view:selected' (sélection locale uniquement)

	// Chat message events
	state.socket.on('chat:message', (msg) => {
		appendChatMessage(msg);
	});

	state.socket.on('presence:update', ({ users }) => {
		updatePresence(users || []);
	});

	// Text updates
	state.socket.on('text:update', ({ text, origin }) => {
		if (origin === state.clientId) return; // ignore echo
		if (!textArea) return;
		const incoming = typeof text === 'string' ? text : '';
		if (textArea.value !== incoming) {
			const pos = textArea.selectionStart;
			textArea.value = incoming;
			// tentative: restaurer le curseur si possible
			if (typeof pos === 'number') {
				const newPos = Math.min(pos, textArea.value.length);
				try { textArea.setSelectionRange(newPos, newPos); } catch {}
			}
		}
	});

	// Canvas cleared
	state.socket.on('canvas:clear', () => {
		clearCanvas();
		localStrokes = [];
	});

	// Session deleted
	state.socket.on('session:deleted', () => {
		alert('Cette session a été supprimée.');
		location.href = `${basePath}/`;
	});

	state.socket.on('session:public', ({ public: isPublic }) => {
		if (publicToggle) publicToggle.checked = !!isPublic;
	});
}

// Table
function buildTable(table) {
	grid.innerHTML = '';
	const rows = table?.rows ?? 10;
	const cols = table?.cols ?? 20;
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const div = document.createElement('div');
			div.className = 'cell';
			div.contentEditable = 'true';
			div.dataset.r = String(r);
			div.dataset.c = String(c);
			const key = `${r},${c}`;
			div.textContent = table?.cells?.[key] || '';
			div.addEventListener('input', () => {
				const value = div.textContent || '';
				state.socket.emit('table:update', { code: state.code, r, c, value });
			});
			grid.appendChild(div);
		}
	}
}

// Canvas
const ctx = board.getContext('2d');
let drawing = false;
let points = [];
let tool = 'pen'; // 'pen' | 'eraser'
let localStrokes = [];

function clearCanvas() {
	ctx.clearRect(0, 0, board.width, board.height);
}
function drawStroke({ points, color, width }) {
	if (!points || points.length < 2) return;
	const isEraser = color === 'eraser';
	ctx.save();
	ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
	ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : (color || '#000');
	ctx.lineWidth = width || 2;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
	ctx.stroke();
	ctx.restore();
}

function initCanvas(canvasState) {
	if (state._listenersBound.canvas) return;
	state._listenersBound.canvas = true;
	// redraw existing
	clearCanvas();
	localStrokes = [...(canvasState?.strokes || [])];
	for (const s of localStrokes) drawStroke(s);
	// listeners once
	board.addEventListener('mousedown', (e) => {
		drawing = true; points = [{ x: e.offsetX, y: e.offsetY }];
	}, { passive: true });
	board.addEventListener('mousemove', (e) => {
		if (!drawing) return;
		points.push({ x: e.offsetX, y: e.offsetY });
		const stroke = { points: points.slice(-2), width: +width.value, color: tool === 'eraser' ? 'eraser' : color.value };
		drawStroke(stroke);
	}, { passive: true });
	board.addEventListener('mouseup', () => {
		if (!drawing) return; drawing = false;
		const stroke = { points, width: +width.value, color: tool === 'eraser' ? 'eraser' : color.value };
		localStrokes.push(stroke);
		state.socket.emit('canvas:stroke', { code: state.code, stroke });
	});
}

// STORAGE
function initStorage() {
	if (state._listenersBound.storage) return;
	state._listenersBound.storage = true;
	$('#upForm').addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = $('#file').files[0];
		if (!f) return;
		const btn = $('#upForm button');
		const msg = $('#quotaMsg');
		if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
		if (btn) btn.disabled = true;
		const fd = new FormData();
		fd.append('file', f);
		try {
			const r = await fetch(`${basePath}/api/session/${encodeURIComponent(state.code)}/upload`, { method: 'POST', body: fd });
			const j = await r.json().catch(() => ({}));
			if (!r.ok) {
				if (r.status === 413 && j.error === 'Quota exceeded') {
					if (msg) {
						msg.classList.remove('hidden');
						msg.innerHTML = `Quota dépassé — <a href="${j.upgradeUrl}" target="_blank" rel="noopener">Passer Premium</a>`;
					}
				} else if (r.status === 413 && j.error === 'File too large') {
					if (msg) {
						const lim = j.limit ? ` (max ${prettyBytes(j.limit)})` : '';
						msg.classList.remove('hidden');
						msg.textContent = `Fichier trop volumineux${lim}.`;
					} else {
						alert('Fichier trop volumineux');
					}
				} else {
					alert(j.error || 'Upload refusé');
				}
				return;
			}
			if (msg) msg.classList.add('hidden');
			$('#file').value = '';
			refreshFiles();
		} catch (err) {
			alert('Erreur réseau');
		} finally {
			if (btn) btn.disabled = false;
		}
	});
}

async function refreshFiles() {
	if (state._refreshingFiles) return; // éviter doublons intercalés
	state._refreshingFiles = true;
	const ul = $('#files');
	ul.innerHTML = '';
	const { files } = await api.listFiles(state.code);
	for (const f of files) {
		const li = document.createElement('li');
		const left = document.createElement('div');
		const right = document.createElement('div');

		const link = document.createElement('a');
		link.href = `${basePath}/api/session/${encodeURIComponent(state.code)}/file/${encodeURIComponent(f.id)}`;
		link.textContent = `${f.originalName} (${prettyBytes(f.size)})`;
		link.setAttribute('download', '');
		left.appendChild(link);

		if ((f.mimetype || '').startsWith('image/')) {
			const img = document.createElement('img');
			img.src = link.href;
			img.alt = f.originalName;
			img.style.maxHeight = '60px';
			img.style.borderRadius = '8px';
			img.style.marginLeft = '8px';
			left.appendChild(img);
		}

		const del = document.createElement('button');
		del.textContent = 'Supprimer';
		del.onclick = async () => {
			const r = await fetch(`${basePath}/api/session/${encodeURIComponent(state.code)}/file/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
			if (r.ok) refreshFiles(); else alert('Suppression refusée');
		};
		right.appendChild(del);

		li.appendChild(left); li.appendChild(right); ul.appendChild(li);
	}
	state._refreshingFiles = false;
}

function prettyBytes(n) {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0; let v = n;
	while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
	return v.toFixed(1) + ' ' + units[i];
}

// Navigation
function showWelcome() {
	sessionView.classList.add('hidden');
	welcome.classList.remove('hidden');
}
function showSession() {
	welcome.classList.add('hidden');
	sessionView.classList.remove('hidden');
}

function startSession({ code, type, expiresAt }) {
	state.code = code; state.type = type;
	codeSpan.textContent = code;
	typeSpan.textContent = viewLabel(state.activeView);
	if (expiresAt) {
		const d = new Date(expiresAt);
		expiresDiv.textContent = `Expire le ${d.toLocaleString()}`;
	} else { expiresDiv.textContent = ''; }

	showSession();
	connectSocket(code);
	// La vue active est locale à chaque participant désormais
	history.pushState({}, '', `${basePath}/join/${encodeURIComponent(code)}`);
}

// Create / Join / Back handlers
document.addEventListener('DOMContentLoaded', () => {
	$('#createBtn').addEventListener('click', async () => {
		const type = $('#type').value;
		const code = Math.random().toString(36).slice(2, 8).toUpperCase();
		try {
			const info = await api.ensure(code);
			state._pendingSelectView = type; // appliquer après init socket
			startSession({ code, type, expiresAt: info.expiresAt });
			// si public demandé à la création, activer immédiatement
			const createPublic = $('#createPublic');
			if (createPublic && createPublic.checked) {
				await fetch(`${basePath}/api/session/${encodeURIComponent(code)}/public`, {
					method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ public: true })
				});
			}
		} catch (e) {
			alert('Création impossible');
		}
	});

	$('#joinBtn').addEventListener('click', async () => {
		const code = ($('#joinCode').value || '').toUpperCase().trim();
		if (!code) return;
		try {
			const info = await api.ensure(code);
			// on ignore le type du sélecteur pour éviter le mauvais module; la vue sera fournie par l'état de session
			startSession({ code, type: 'table', expiresAt: info.expiresAt });
		} catch (e) {
			alert('Session introuvable');
		}
	});

	// Public toggle handler
	if (publicToggle) publicToggle.addEventListener('change', async () => {
		if (!state.code) return;
		try {
			const r = await fetch(`${basePath}/api/session/${encodeURIComponent(state.code)}/public`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ public: !!publicToggle.checked })
			});
			if (!r.ok) {
				const j = await r.json().catch(() => ({}));
				alert(j.error || 'Impossible de modifier la visibilité');
			}
		} catch { alert('Erreur réseau'); }
	});

	// Public sessions list on welcome
	const publicList = $('#publicSessions');
	const publicEmpty = $('#publicSessionsEmpty');
	const refreshBtn = $('#refreshPublic');
	async function loadPublic() {
		if (!publicList) return;
		try {
			const r = await fetch(`${basePath}/api/public-sessions`);
			const j = await r.json();
			publicList.innerHTML = '';
			const sessions = Array.isArray(j.sessions) ? j.sessions : [];
			if (!sessions.length) {
				if (publicEmpty) publicEmpty.style.display = '';
				return;
			}
			if (publicEmpty) publicEmpty.style.display = 'none';
			for (const s of sessions) {
				const li = document.createElement('li');
				const a = document.createElement('a');
				a.href = `${basePath}/join/${encodeURIComponent(s.code)}`;
				a.textContent = `${s.code} — expire le ${new Date(s.expiresAt).toLocaleString()}`;
				li.appendChild(a);
				publicList.appendChild(li);
			}
		} catch {}
	}
	if (refreshBtn) refreshBtn.addEventListener('click', loadPublic);
	// auto-load + rafraîchissement périodique sur la page d'accueil
	if (publicList) { loadPublic(); setInterval(loadPublic, 20000); }

	$('#back').addEventListener('click', () => {
		if (state.socket) try { state.socket.disconnect(); } catch {}
		state.code = null; state.type = null; state.socket = null;
		grid.innerHTML = '';
		clearCanvas();
		showWelcome();
		history.pushState({}, '', `${basePath}/`);
	});

	// Deep link /join/XXXX
	if (joinParams) {
		api.ensure(joinParams).then(info => {
			startSession({ code: joinParams, type: 'table', expiresAt: info.expiresAt });
		}).catch(() => {});
	}
	// Init profile inputs from storage
	const prof = getProfile();
	if (profileNameInput) profileNameInput.value = prof.name || '';
	if (profileColorInput) profileColorInput.value = prof.color || '#2ecc71';

	if (profileSaveBtn) profileSaveBtn.addEventListener('click', () => {
		const name = (profileNameInput?.value || '').trim().slice(0, 50);
		const color = profileColorInput?.value || '';
		setProfile({ name, color });
		if (state.socket && state.socket.connected) {
			state.socket.emit('presence:set', { name, color });
		}
	});
});

// Gestion des onglets partagés
function selectView(view) {
	state.activeView = view;
	// tabs UI
	document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
	// toggle views
	tableView.classList.toggle('hidden', view !== 'table');
	canvasView.classList.toggle('hidden', view !== 'canvas');
	storageView.classList.toggle('hidden', view !== 'storage');
	textView.classList.toggle('hidden', view !== 'text');
	chatView.classList.toggle('hidden', view !== 'chat');
	if (view === 'storage') refreshFiles();
	typeSpan.textContent = viewLabel(view);
}

function initText(textState) {
	if (state._listenersBound.text) {
		if (typeof textState?.content === 'string' && textArea) textArea.value = textState.content;
		return;
	}
	state._listenersBound.text = true;
	if (typeof textState?.content === 'string') textArea.value = textState.content;
	let typingTimer;
	textArea.addEventListener('input', () => {
		clearTimeout(typingTimer);
		const value = textArea.value;
		typingTimer = setTimeout(() => {
			state.socket.emit('text:update', { code: state.code, text: value, origin: state.clientId });
		}, 150);
	});
}

// Tabs click -> local selection only
tabs.addEventListener('click', (e) => {
	const b = e.target.closest('button.tab');
	if (!b) return;
	const view = b.dataset.view;
	if (view === state.activeView) return;
	selectView(view);
});

// Delete session
deleteBtn.addEventListener('click', async () => {
	if (!state.code) return;
	if (!confirm('Supprimer définitivement cette session ?')) return;
	const r = await fetch(`${basePath}/api/session/${encodeURIComponent(state.code)}`, { method: 'DELETE' });
	if (r.ok) {
		alert('Session supprimée');
		location.href = `${basePath}/`;
	} else {
		const j = await r.json().catch(() => ({}));
		alert(j.error || 'Suppression impossible');
	}
});

// Copy link
copyLinkBtn.addEventListener('click', async () => {
	const url = location.origin + `${basePath}/join/${encodeURIComponent(state.code)}`;
	try { await navigator.clipboard.writeText(url); alert('Lien copié'); } catch { prompt('Copiez le lien :', url); }
});

// Clear canvas (effacer dessin)
if (clearCanvasBtn) clearCanvasBtn.addEventListener('click', () => {
	if (!state.code) return;
	if (!confirm('Effacer tout le dessin pour cette session ?')) return;
	state.socket.emit('canvas:clear', { code: state.code });
});

if (undoCanvasBtn) undoCanvasBtn.addEventListener('click', () => {
	if (!state.code) return;
	state.socket.emit('canvas:undo', { code: state.code });
});

function redrawAllStrokes() {
	clearCanvas();
	for (const s of localStrokes) drawStroke(s);
}

// Tools switcher
if (toolPenBtn && toolEraserBtn) {
	toolPenBtn.addEventListener('click', () => { tool = 'pen'; toolPenBtn.classList.add('active'); toolEraserBtn.classList.remove('active'); });
	toolEraserBtn.addEventListener('click', () => { tool = 'eraser'; toolEraserBtn.classList.add('active'); toolPenBtn.classList.remove('active'); });
}

// Text formatting (simple markdown-like insertion around selection)
function wrapSelection(before, after = before) {
	const el = textArea; if (!el) return;
	const start = el.selectionStart, end = el.selectionEnd;
	const value = el.value;
	const selected = value.slice(start, end);
	const newVal = value.slice(0, start) + before + selected + after + value.slice(end);
	el.value = newVal;
	const cursor = start + before.length + selected.length + after.length;
	el.setSelectionRange(cursor, cursor);
	// émettre update
	state.socket.emit('text:update', { code: state.code, text: el.value, origin: state.clientId });
}
if (boldBtn) boldBtn.addEventListener('click', () => wrapSelection('**'));
if (italicBtn) italicBtn.addEventListener('click', () => wrapSelection('*'));
if (underlineBtn) underlineBtn.addEventListener('click', () => wrapSelection('__'));

// Save note button -> send to server to store as file under quota
if (saveNoteBtn) saveNoteBtn.addEventListener('click', async () => {
	if (!state.code) return;
	const text = textArea.value || '';
	const filename = prompt('Nom du fichier (optionnel, .txt par défaut) :', 'note.txt') || 'note.txt';
	try {
		const r = await fetch(`${basePath}/api/session/${encodeURIComponent(state.code)}/save-note`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, filename })
		});
		const j = await r.json();
		if (!r.ok) {
			if (j.error === 'Quota exceeded') {
				alert('Quota dépassé — impossible d’enregistrer la note.');
			} else {
				alert(j.error || 'Échec de l’enregistrement');
			}
			return;
		}
		alert('Note enregistrée dans les fichiers');
		// rafraîchir la liste si ouverte
		if (state.activeView === 'storage') refreshFiles();
	} catch (e) {
		alert('Erreur réseau');
	}
});

// Keyboard shortcuts for text formatting
document.addEventListener('keydown', (e) => {
	if (state.activeView !== 'text') return;
	if (!e.ctrlKey) return;
	const k = e.key.toLowerCase();
	if (k === 'b') { e.preventDefault(); wrapSelection('**'); }
	else if (k === 'i') { e.preventDefault(); wrapSelection('*'); }
	else if (k === 'u') { e.preventDefault(); wrapSelection('__'); }
});


function viewLabel(view) {
	return view === 'table' ? 'Tableau' : view === 'canvas' ? 'Dessin' : view === 'storage' ? 'Stockage' : view === 'chat' ? 'Chat' : 'Texte';
}

// ===== Chat logic =====
function initChat(chatState) {
	if (!chatMessagesEl || !chatForm) return;
	chatMessagesEl.innerHTML = '';
	const msgs = chatState?.messages || [];
	for (const m of msgs) appendChatMessage(m);
	chatForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		if (!state.code) return;
		// If files selected, upload them first, collect their ids, then send message with attachments
		const attachments = [];
		if (chatFile && chatFile.files && chatFile.files.length) {
			for (const file of chatFile.files) {
				const fd = new FormData();
				fd.append('file', file);
				const r = await fetch(`${basePath}/api/session/${encodeURIComponent(state.code)}/upload`, { method: 'POST', body: fd });
				const j = await r.json();
				if (!r.ok) {
					alert(j.error || 'Upload refusé');
					continue;
				}
				attachments.push({ id: j.file.id });
			}
			// clear selection
			chatFile.value = '';
		}
		const text = chatInput.value.trim();
		if (!text && !attachments.length) return;
		const msg = { authorId: state.clientId, text, attachments };
		const prof = getProfile();
		msg.authorName = prof.name || undefined;
		msg.authorColor = prof.color || undefined;
		state.socket.emit('chat:message', { code: state.code, message: msg });
		// local optimistic append (will be reconciled by server broadcast with timestamp/id)
		chatInput.value = '';
	});

	// Enter to send, Shift+Enter for newline
	chatInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			chatForm.requestSubmit();
		}
	});
}

function appendChatMessage(m) {
	if (!chatMessagesEl) return;
	const el = document.createElement('div');
	el.className = 'chat-message' + (m.authorId === state.clientId ? ' me' : '');
	const time = new Date(m.at || Date.now()).toLocaleTimeString();
	const textHtml = escapeHtml(m.text || '').replace(/\n/g, '<br/>');
	const label = (m.authorName && m.authorName.trim()) ? m.authorName.trim() : labelFromId(m.authorId || '');
	const color = m.authorColor || colorFromId(m.authorId || '');
	el.innerHTML = `<div class="bubble">
		<div class="meta"><span class="author" style="--dot:${color}">${escapeHtml(label)}</span><span class="time">${time}</span></div>
		<div class="text">${textHtml}</div>
		${renderAttachments(m.attachments || [])}
	</div>`;
	chatMessagesEl.appendChild(el);
	chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function renderAttachments(atts) {
	if (!atts.length) return '';
	const parts = atts.map(a => {
		const href = `${basePath}/api/session/${encodeURIComponent(state.code)}/file/${encodeURIComponent(a.id)}`;
		const label = `${escapeHtml(a.originalName || a.id)} (${prettyBytes(a.size || 0)})`;
		if ((a.mimetype || '').startsWith('image/')) {
			return `<div class="att"><a href="${href}" target="_blank" rel="noopener">${label}</a><br/><img src="${href}" alt="${escapeHtml(a.originalName || '')}"/></div>`;
		}
		return `<div class="att"><a href="${href}" target="_blank" rel="noopener">${label}</a></div>`;
	});
	return `<div class="atts">${parts.join('')}</div>`;
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== Presence UI =====
function updatePresence(users) {
	if (!presenceBar) return;
	presenceBar.innerHTML = '';
	for (const u of users) {
		const el = document.createElement('span');
		el.className = 'presence-user';
		const color = u.color || colorFromId(u.userId || '');
		el.style.setProperty('--dot', color);
		const label = (u.name && u.name.trim()) ? u.name.trim() : `Invité-${shortId(u.userId).toUpperCase()}`;
		el.title = `${label} (${u.userId})`;
		el.textContent = label;
		presenceBar.appendChild(el);
	}
}
function colorFromId(id) {
	let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
	const hue = h % 360; return `hsl(${hue} 70% 45%)`;
}
function shortId(id) { return String(id).slice(0, 4); }
function labelFromId(id) { return `Invité-${shortId(id).toUpperCase()}`; }

// Profile storage helpers
function getProfile() {
	try {
		const raw = localStorage.getItem('qs_profile');
		if (!raw) return {};
		const j = JSON.parse(raw);
		if (typeof j !== 'object' || !j) return {};
		return { name: typeof j.name === 'string' ? j.name : '', color: typeof j.color === 'string' ? j.color : '' };
	} catch { return {}; }
}
function setProfile(p) {
	try { localStorage.setItem('qs_profile', JSON.stringify({ name: p.name || '', color: p.color || '' })); } catch {}
}