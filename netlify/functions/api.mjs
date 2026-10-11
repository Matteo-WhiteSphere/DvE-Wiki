// DvE wiki API (Netlify Function). Every request to /api/* lands here.
import { timingSafeEqual, randomBytes } from 'node:crypto';
import {
    store, HttpError, ensureBootstrap, parseUsername, renameForRole, verifyPassword, hashPassword,
    passwordProblem, tempPassword, signSession, readSession, sessionCookie, SESSION_COOKIE,
    getUser, listUsers, saveUser, createUser, publicUser, checkLock, recordFailure, clearFailures,
    audit, cleanPage, pageSummary, SLUG_RE, isEditorRole, isAdminRole, canCreate, canManage,
    canAssign, MAX_FAILED_LOGINS, MAX_IP_ATTEMPTS
} from '../lib/core.mjs';

export const config = { path: '/api/*' };

// ------------------------------------------------------------------ helpers

function json(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
    });
}

function readCookie(req, name) {
    const raw = req.headers.get('cookie') || '';
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return null;
}

async function body(req) {
    const text = await req.text();
    if (text.length > 1_000_000) throw new HttpError(413, 'Request too large.');
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}

function clientIp(req, context) {
    return (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unknown';
}

/** Blocks cross-site requests: same-origin header + custom header that forms cannot send. */
function checkCsrf(req) {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    if (req.headers.get('x-dve-request') !== '1') throw new HttpError(403, 'Missing request header.');
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== new URL(req.url).host) throw new HttpError(403, 'Cross-site request refused.');
}

function requireUser(session) {
    if (!session) throw new HttpError(401, 'Please sign in.');
    if (session.user.mustChangePassword) throw new HttpError(403, 'Choose your own password first.', { code: 'password-change' });
    return session.user;
}
function requireEditor(session) {
    const u = requireUser(session);
    if (!isEditorRole(u.role)) throw new HttpError(403, 'Your account cannot edit pages.');
    return u;
}
function requireAdmin(session) {
    const u = requireUser(session);
    if (!isAdminRole(u.role)) throw new HttpError(403, 'Only administrators can do this.');
    return u;
}

// ------------------------------------------------------------------ routes

async function login(req, context) {
    const { username, password } = await body(req);
    const ip = clientIp(req, context);
    await checkLock('ip', ip);
    const parsed = parseUsername(username);
    if (parsed) await checkLock('user', parsed.key);
    const user = parsed ? await getUser(parsed.key) : null;
    const ok = await verifyPassword(password, user && user.username.toLowerCase() === parsed.username.toLowerCase() ? user.passwordHash : null);
    if (!ok) {
        await recordFailure('ip', ip, MAX_IP_ATTEMPTS);
        if (user) await recordFailure('user', user.key, MAX_FAILED_LOGINS);
        throw new HttpError(401, 'Wrong username or password.');
    }
    if (user.role === 'disabled') throw new HttpError(403, 'This account has been disabled.');
    await clearFailures('user', user.key);
    user.lastLogin = new Date().toISOString();
    await saveUser(user);
    return json({ user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(await signSession(user)) });
}

async function changePassword(req, session) {
    if (!session) throw new HttpError(401, 'Please sign in.');
    const { currentPassword, newPassword } = await body(req);
    const user = session.user;
    // A temporary password was just used to sign in: no need to type it again.
    if (!user.mustChangePassword && !(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new HttpError(400, 'The current password is wrong.');
    }
    const problem = passwordProblem(newPassword);
    if (problem) throw new HttpError(400, problem);
    if (await verifyPassword(newPassword, user.passwordHash)) throw new HttpError(400, 'Choose a password different from the current one.');
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    user.sessionVersion += 1; // signs out every other device
    await saveUser(user);
    await audit(user.username, 'account.password', user.username, 'password changed');
    return json({ user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(await signSession(user)) });
}

async function listPages(url, session) {
    const editor = session && !session.user.mustChangePassword && isEditorRole(session.user.role);
    const group = url.searchParams.get('group');
    const pages = store('pages');
    const { blobs } = await pages.list();
    const all = await Promise.all(blobs.map(async (b) => {
        const p = await pages.get(b.key, { type: 'json' });
        return p ? pageSummary(b.key, p) : null;
    }));
    const result = all.filter((p) => p && (editor || p.published) && (!group || p.group === group));
    return json({ pages: result });
}

async function getPage(slug, session) {
    const page = await store('pages').get(slug, { type: 'json' });
    const editor = session && !session.user.mustChangePassword && isEditorRole(session.user.role);
    if (!page || (!page.published && !editor)) return json({ error: 'Page not found.' }, 404);
    return json({ page: { slug, ...page } });
}

async function savePage(req, slug, session) {
    const user = requireEditor(session);
    if (!SLUG_RE.test(slug)) throw new HttpError(400, 'Page address: lower-case letters, numbers, "_" or "-" only (max 64).');
    const { page: input, baseRev = null, force = false } = await body(req);
    const page = cleanPage(input);
    const pages = store('pages');
    const current = await pages.getWithMetadata(slug, { type: 'json' });
    const existing = current && current.data;

    if (existing && baseRev === null && !force) {
        throw new HttpError(409, `A page with the address "${slug}" already exists.`, { code: 'exists' });
    }
    if (existing && baseRev !== null && existing.rev !== baseRev && !force) {
        throw new HttpError(409, 'Changed by someone else.', { code: 'conflict', updatedBy: existing.updatedBy });
    }
    if (!existing && baseRev !== null && !force) {
        throw new HttpError(409, 'This page has been deleted by someone else.', { code: 'gone' });
    }

    const now = new Date().toISOString();
    const record = {
        ...page,
        rev: existing ? existing.rev + 1 : 1,
        createdAt: existing ? existing.createdAt : now,
        createdBy: existing ? existing.createdBy : user.username,
        updatedAt: now,
        updatedBy: user.username
    };
    const res = existing
        ? await pages.setJSON(slug, record, { onlyIfMatch: current.etag })
        : await pages.setJSON(slug, record, { onlyIfNew: true });
    if (res && res.modified === false) {
        throw new HttpError(409, 'Changed by someone else.', { code: 'conflict', updatedBy: 'another user' });
    }
    await store('revisions').setJSON(`${slug}/${now}-${randomBytes(3).toString('hex')}`, {
        ...page, rev: record.rev, savedAt: now, savedBy: user.username
    });
    await audit(user.username, existing ? 'page.update' : 'page.create', slug,
        `${page.published ? 'published' : 'draft'} · ${page.sections.length} sections`);
    return json({ page: { slug, ...record } });
}

async function deletePage(slug, session) {
    const user = requireAdmin(session);
    const page = await store('pages').get(slug, { type: 'json' });
    if (!page) throw new HttpError(404, 'Page not found.');
    await store('pages').delete(slug);
    await audit(user.username, 'page.delete', slug, page.title);
    return json({ ok: true });
}

async function listRevisions(slug, session) {
    requireEditor(session);
    const revs = store('revisions');
    const { blobs } = await revs.list({ prefix: `${slug}/` });
    const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 50);
    const items = await Promise.all(keys.map(async (key) => {
        const r = await revs.get(key, { type: 'json' });
        return r && { id: key.slice(slug.length + 1), savedAt: r.savedAt, savedBy: r.savedBy, published: r.published };
    }));
    return json({ revisions: items.filter(Boolean) });
}

async function getRevision(slug, id, session) {
    requireEditor(session);
    const r = await store('revisions').get(`${slug}/${id}`, { type: 'json' });
    if (!r) throw new HttpError(404, 'Version not found.');
    return json({ revision: r });
}

async function users(session) {
    requireAdmin(session);
    const list = (await listUsers()).map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
    return json({ users: list });
}

async function addUser(req, session) {
    const actor = requireAdmin(session);
    const { username } = await body(req);
    const parsed = parseUsername(username);
    if (!parsed) throw new HttpError(400, 'Write the username as Role.Name (Owner / Admin / Editor), name 2-32 letters or numbers.');
    if (!canCreate(actor.role, parsed.role)) throw new HttpError(403, `You cannot create ${parsed.role} accounts.`);
    const result = await createUser(parsed.username, actor.username);
    if (!result) throw new HttpError(409, `The name "${parsed.name}" is already used by another account.`, { code: 'exists' });
    await audit(actor.username, 'account.create', result.user.username, result.user.role);
    return json({ user: publicUser(result.user), password: result.password });
}

async function managedTarget(name, actor) {
    const target = await getUser(String(name || '').split('.').pop());
    if (!target || target.username.toLowerCase() !== String(name).toLowerCase()) throw new HttpError(404, 'Account not found.');
    if (target.key === actor.key) throw new HttpError(403, 'You cannot change your own account here.');
    if (!canManage(actor.role, target)) throw new HttpError(403, 'You cannot manage this account.');
    return target;
}

async function updateUser(req, name, session) {
    const actor = requireAdmin(session);
    const target = await managedTarget(name, actor);
    const { role } = await body(req);
    if (!canAssign(actor.role, role)) throw new HttpError(403, `You cannot give the role "${role}".`);
    const before = `${target.username} (${target.role})`;
    target.role = role;
    target.username = renameForRole(target.username, role);
    target.sessionVersion += 1;
    await saveUser(target);
    await audit(actor.username, 'user.role', before, `→ ${target.username} (${role})`);
    return json({ user: publicUser(target) });
}

async function resetUser(name, session) {
    const actor = requireAdmin(session);
    const target = await managedTarget(name, actor);
    const password = tempPassword();
    target.passwordHash = await hashPassword(password);
    target.mustChangePassword = true;
    target.sessionVersion += 1;
    await saveUser(target);
    await audit(actor.username, 'account.reset', target.username, 'temporary password');
    return json({ user: publicUser(target), password });
}

async function auditLog(url, session) {
    requireAdmin(session);
    const before = url.searchParams.get('before');
    const { blobs } = await store('audit').list();
    let keys = blobs.map((b) => b.key).sort().reverse();
    if (before) keys = keys.filter((k) => k < before);
    const page = keys.slice(0, 50);
    const entries = await Promise.all(page.map((k) => store('audit').get(k, { type: 'json' })));
    return json({ entries: entries.filter(Boolean), next: keys.length > 50 ? page[page.length - 1] : null });
}

/** Emergency reset (e.g. an owner lost the password). Needs DVE_RECOVERY_CODE set in Netlify. */
async function recover(req, context) {
    const code = process.env.DVE_RECOVERY_CODE || '';
    const ip = clientIp(req, context);
    await checkLock('ip', ip);
    const { code: given, username } = await body(req);
    const a = Buffer.from(String(given || '')), b = Buffer.from(code);
    if (code.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) {
        await recordFailure('ip', ip, 5);
        throw new HttpError(403, 'Recovery is not enabled or the code is wrong.');
    }
    const parsed = parseUsername(username);
    const user = parsed && await getUser(parsed.key);
    if (!user || user.username.toLowerCase() !== parsed.username.toLowerCase()) throw new HttpError(404, 'Account not found.');
    const password = tempPassword();
    user.passwordHash = await hashPassword(password);
    user.mustChangePassword = true;
    user.sessionVersion += 1;
    if (user.role === 'disabled') user.role = parsed.role;
    await saveUser(user);
    await clearFailures('user', user.key);
    await audit('recovery code', 'account.reset', user.username, 'recovery');
    return json({ username: user.username, password });
}

// ------------------------------------------------------------------- main

export default async function handler(req, context) {
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const route = `${req.method} /${parts.map((p, i) => (i === 0 ? p : ':')).join('/')}`;
    try {
        checkCsrf(req);
        await ensureBootstrap();
        const session = await readSession(readCookie(req, SESSION_COOKIE));
        let res;
        switch (route) {
            case 'GET /me': res = json({ user: session ? publicUser(session.user) : null }); break;
            case 'POST /login': return await login(req, context);
            case 'POST /logout':
                return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
            case 'POST /password': return await changePassword(req, session);
            case 'GET /pages': res = await listPages(url, session); break;
            case 'GET /pages/:': res = await getPage(parts[1], session); break;
            case 'PUT /pages/:': res = await savePage(req, parts[1], session); break;
            case 'DELETE /pages/:': res = await deletePage(parts[1], session); break;
            case 'GET /pages/:/:':
                if (parts[2] !== 'revisions') throw new HttpError(404, 'Not found.');
                res = await listRevisions(parts[1], session); break;
            case 'GET /pages/:/:/:':
                if (parts[2] !== 'revisions') throw new HttpError(404, 'Not found.');
                res = await getRevision(parts[1], parts[3], session); break;
            case 'GET /users': res = await users(session); break;
            case 'POST /users': res = await addUser(req, session); break;
            case 'PATCH /users/:': res = await updateUser(req, parts[1], session); break;
            case 'POST /users/:/:':
                if (parts[2] !== 'reset') throw new HttpError(404, 'Not found.');
                res = await resetUser(parts[1], session); break;
            case 'GET /audit': res = await auditLog(url, session); break;
            case 'POST /recover': return await recover(req, context);
            default: throw new HttpError(404, 'Not found.');
        }
        // Sliding session: every authenticated request extends it.
        if (session && res.status < 400) {
            const fresh = await getUser(session.user.key);
            if (fresh && fresh.sessionVersion === session.user.sessionVersion) {
                res.headers.append('Set-Cookie', sessionCookie(await signSession(fresh, session.issuedAt)));
            }
        }
        return res;
    } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
        console.error(e);
        return json({ error: 'Server error.' }, 500);
    }
}
