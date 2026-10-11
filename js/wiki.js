// Core module shared by the dynamic wiki pages and the staff area:
// talks to the wiki API (/api, a Netlify Function), session/role helpers,
// safe Markdown rendering.
import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.js';

// -------------------------------------------------------------------- API

export class ApiError extends Error {
    constructor(status, data) {
        super((data && data.error) || `Request failed (${status}).`);
        this.status = status;
        this.code = data && data.code;
        this.data = data || {};
    }
}

/** Calls the wiki API. Throws ApiError on HTTP errors. */
export async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
        res = await fetch('/api/' + path, {
            method,
            credentials: 'same-origin',
            headers: {
                'X-DvE-Request': '1',
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
    } catch (e) {
        throw new ApiError(0, { error: 'Network error: the server cannot be reached.', code: 'network' });
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON (e.g. API not deployed) */ }
    if (!res.ok || !data) throw new ApiError(res.status, data || { error: 'The wiki server is not available.', code: 'unavailable' });
    return data;
}

// ------------------------------------------------------------------ roles

export const ROLES = ['owner', 'admin', 'editor', 'disabled'];
export const isEditorRole = (r) => r === 'editor' || r === 'admin' || r === 'owner';
export const isAdminRole = (r) => r === 'admin' || r === 'owner';

// Mirrors CAN_CREATE / CAN_MANAGE in netlify/lib/core.mjs (the server decides).
export const creatableRoles = (actor) => ({ owner: ['owner', 'admin', 'editor'], admin: ['editor'] }[actor] || []);
export const assignableRoles = (actor) => ({ owner: ['admin', 'editor', 'disabled'], admin: ['editor', 'disabled'] }[actor] || []);

export const ROLE_PREFIX = { owner: 'Owner', admin: 'Admin', editor: 'Editor' };
export const STAFF_NAME_RE = /^[A-Za-z0-9_-]{2,32}$/;
export const USERNAME_RE = /^(owner|admin|editor)\.([A-Za-z0-9_-]{2,32})$/i;

export function staffUsername(role, name) {
    return `${ROLE_PREFIX[role]}.${name}`;
}

// ---------------------------------------------------------------- session

let sessionPromise = null;

/** The signed-in user ({ username, role, mustChangePassword }) or null. Cached per page load. */
export function currentUser({ refresh = false } = {}) {
    if (!sessionPromise || refresh) {
        sessionPromise = api('me').then((d) => d.user).catch(() => null);
    }
    return sessionPromise;
}

/** Calls cb({ user, role }) once the session is known. role is 'none' when signed out. */
export async function watchSession(cb) {
    const user = await currentUser();
    cb({ user, role: user ? user.role : 'none' });
}

/** Signed in, editing allowed and no temporary password left to change. */
export const accountActive = (user) => !!user && !user.mustChangePassword && user.role !== 'disabled';

export async function login(username, password) {
    const { user } = await api('login', { method: 'POST', body: { username, password } });
    sessionPromise = Promise.resolve(user);
    return user;
}

export async function logout() {
    try { await api('logout', { method: 'POST' }); } catch { /* ignore */ }
    sessionPromise = Promise.resolve(null);
}

// ---------------------------------------------------------- placeholders

let seedCache = null;
/** The old static placeholder pages, kept as starting drafts (data/placeholders.json). */
export async function loadSeeds() {
    if (!seedCache) {
        try {
            const res = await fetch('data/placeholders.json', { cache: 'no-cache' });
            seedCache = res.ok ? await res.json() : {};
        } catch { seedCache = {}; }
    }
    return seedCache;
}

let countriesCache = null;
/** Base data of the home page (data/countries.json): major nations and country table. */
export async function loadCountries() {
    if (!countriesCache) {
        try {
            const res = await fetch('data/countries.json', { cache: 'no-cache' });
            countriesCache = res.ok ? await res.json() : { majors: [], countries: [] };
        } catch { countriesCache = { majors: [], countries: [] }; }
    }
    return countriesCache;
}

/** Normalizes text for searching: lower case, no accents. */
export function fold(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Readable text colour (black or white) on a given background. */
export function textColorOn(hex) {
    if (!COLOR_RE.test(hex || '')) return '#ffffff';
    const n = parseInt(hex.slice(1), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.62 ? '#000000' : '#ffffff';
}

// --------------------------------------------------------------- helpers

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function slugify(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 64);
}

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
        if (c === null || c === undefined || c === false) continue;
        node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
}

export function hexToRgba(hex, alpha) {
    if (!COLOR_RE.test(hex)) return `rgba(0, 243, 255, ${alpha})`;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function applyAccent(target, hex) {
    const color = COLOR_RE.test(hex || '') ? hex : '#00f3ff';
    target.style.setProperty('--accent-color', color);
    target.style.setProperty('--accent-glow', hexToRgba(color, 0.35));
}

export function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
}

export function friendlyError(e) {
    return (e && e.message) || String(e);
}

// ------------------------------------------------------------- markdown

const ALLOWED_STYLE_PROPS = new Set([
    'color', 'background-color', 'border-color', 'font-weight', 'font-style',
    'text-align', 'text-decoration', 'text-transform'
]);
const SAFE_STYLE_VALUE = /^[#a-z0-9 ,.%()-]+$/i;

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'style') return;
    const kept = [];
    for (const decl of data.attrValue.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const value = decl.slice(i + 1).trim();
        if (ALLOWED_STYLE_PROPS.has(prop) && SAFE_STYLE_VALUE.test(value) && !/url|expression|var/i.test(value)) {
            kept.push(`${prop}: ${value}`);
        }
    }
    if (kept.length) data.attrValue = kept.join('; ');
    else data.keepAttr = false;
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
        const href = node.getAttribute('href');
        if (/^https?:\/\//i.test(href) && !href.startsWith(location.origin)) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer nofollow');
        }
    }
    if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy');
});

const PURIFY_OPTS = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'textarea', 'select', 'option',
                  'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'svg', 'math'],
    FORBID_ATTR: ['id', 'srcset', 'formaction', 'autofocus'],
    ALLOW_DATA_ATTR: false
};

/** Markdown (GitHub flavour, tables included) → sanitized HTML string. */
export function renderMarkdown(md) {
    const raw = marked.parse(String(md || ''), { gfm: true, breaks: false, async: false });
    const clean = DOMPurify.sanitize(raw, PURIFY_OPTS);
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    tpl.content.querySelectorAll('table').forEach((t) => {
        t.classList.add('wiki-table');
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        t.replaceWith(wrap);
        wrap.append(t);
    });
    tpl.content.querySelectorAll('img').forEach((img) => {
        if (img.closest('a')) return;
        const a = document.createElement('a');
        a.href = img.getAttribute('src') || '#';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        img.replaceWith(a);
        a.append(img);
    });
    return tpl.innerHTML;
}

/** Renders the sections of a page into `container`. */
export function renderSections(container, sections) {
    container.replaceChildren();
    let grid = null;
    for (const s of sections || []) {
        const layout = ['half', 'third'].includes(s.layout) ? s.layout : 'full';
        const card = el('div', { class: 'card layout-' + layout });
        if (s.title) card.append(el('h3', { text: s.title }));
        const body = el('div', { class: 'card-body' });
        body.innerHTML = renderMarkdown(s.body);
        card.append(body);
        if (layout === 'full') {
            grid = null;
            container.append(card);
        } else {
            if (!grid) { grid = el('div', { class: 'grid' }); container.append(grid); }
            grid.append(card);
        }
    }
}

/** Fills the standard header (h1 + subtitle) and applies the accent colour. */
export function renderHeader(headerEl, page) {
    headerEl.replaceChildren(
        el('h1', { text: page.title || 'Untitled' }),
        page.subtitle ? el('p', { text: page.subtitle }) : ''
    );
    applyAccent(document.documentElement, page.accent);
}
