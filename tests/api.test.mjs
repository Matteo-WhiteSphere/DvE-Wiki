// API and security tests. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';

let server, dir, handler;
const logs = [];

before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dve-test-'));
    server = new BlobsServer({ directory: dir, port: 0, token: 't' });
    const { port } = await server.start();
    const url = `http://127.0.0.1:${port}`;
    setEnvironmentContext({ edgeURL: url, uncachedEdgeURL: url, siteID: 'test', token: 't' });
    process.env.DVE_RECOVERY_CODE = 'recovery-code-for-tests-123';
    const origLog = console.log;
    console.log = (...a) => { logs.push(a.join(' ')); };
    handler = (await import('../netlify/functions/api.mjs')).default;
    await call('GET', 'me'); // triggers the first-start bootstrap
    console.log = origLog;
});
after(async () => { await server.stop(); await rm(dir, { recursive: true, force: true }); });

// --------------------------------------------------------------- helpers

let ipCounter = 0;
async function call(method, path, { body, cookie, headers = {}, ip } = {}) {
    const req = new Request('https://wiki.test/api/' + path, {
        method,
        headers: {
            ...(method !== 'GET' ? { 'X-DvE-Request': '1', 'Content-Type': 'application/json' } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const res = await handler(req, { ip: ip || `10.0.0.${(ipCounter++ % 200) + 1}` });
    const setCookie = res.headers.getSetCookie();
    const data = await res.json();
    return { status: res.status, data, setCookie, cookie: setCookie.length ? setCookie[setCookie.length - 1].split(';')[0] : cookie };
}

const initial = () => Object.fromEntries(logs.join('\n').split('\n')
    .map((l) => l.trim().match(/^(\S+\.\S+)\s+(\S{4}-\S{4}-\S{4}-\S{4})$/)).filter(Boolean).map((m) => [m[1], m[2]]));

/** Logs in with the temporary password, sets a real one and returns the session cookie. */
const sessions = {};
async function session(username) {
    if (sessions[username]) return sessions[username];
    const login = await call('POST', 'login', { body: { username, password: initial()[username] } });
    assert.equal(login.status, 200, `login ${username}: ${JSON.stringify(login.data)}`);
    const pw = await call('POST', 'password', { cookie: login.cookie, body: { newPassword: `Secret-${username}-2026` } });
    assert.equal(pw.status, 200);
    return (sessions[username] = pw.cookie);
}

const page = (extra = {}) => ({
    title: 'Test', subtitle: '', category: 'country', group: 'tst', tag: 'TST', accent: '#112233',
    navLabel: 'Test', navOrder: 0, published: true, sections: [{ title: 'A', layout: 'full', body: 'text' }], ...extra
});

// ------------------------------------------------------------------ tests

test('first start creates the 8 staff accounts with temporary passwords in the log', () => {
    const creds = initial();
    assert.deepEqual(Object.keys(creds).sort(), ['Admin.Kylo', 'Editor.Defort', 'Editor.Pyro', 'Editor.Rapha',
        'Editor.Tazi', 'Editor.iowaderussr', 'Owner.EC', 'Owner.RedMatteo'].sort());
});

test('session cookie is HttpOnly, Secure, SameSite=Strict', async () => {
    const r = await call('POST', 'login', { body: { username: 'Editor.Defort', password: initial()['Editor.Defort'] } });
    assert.equal(r.status, 200);
    assert.match(r.setCookie[0], /^__Host-dve_session=.+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/);
});

test('login: wrong password, wrong role prefix, case-insensitive username', async () => {
    assert.equal((await call('POST', 'login', { body: { username: 'Owner.EC', password: 'nope' } })).status, 401);
    assert.equal((await call('POST', 'login', { body: { username: 'Editor.EC', password: initial()['Owner.EC'] } })).status, 401);
    assert.equal((await call('POST', 'login', { body: { username: 'owner.ec', password: initial()['Owner.EC'] } })).status, 200);
});

test('accounts lock after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) await call('POST', 'login', { body: { username: 'Editor.Tazi', password: 'bad' } });
    const r = await call('POST', 'login', { body: { username: 'Editor.Tazi', password: initial()['Editor.Tazi'] } });
    assert.equal(r.status, 429);
});

test('IP addresses are throttled', async () => {
    let last;
    for (let i = 0; i < 31; i++) last = await call('POST', 'login', { ip: '9.9.9.9', body: { username: `Editor.x${i}`, password: 'bad' } });
    assert.equal(last.status, 429);
});

test('requests without the custom header or from another site are refused', async () => {
    const noHeader = await handler(new Request('https://wiki.test/api/login', { method: 'POST', body: '{}' }), {});
    assert.equal(noHeader.status, 403);
    const cross = await call('POST', 'login', { headers: { Origin: 'https://evil.example' }, body: {} });
    assert.equal(cross.status, 403);
});

test('temporary password must be changed before doing anything', async () => {
    const login = await call('POST', 'login', { body: { username: 'Editor.Pyro', password: initial()['Editor.Pyro'] } });
    assert.equal(login.data.user.mustChangePassword, true);
    const save = await call('PUT', 'pages/x1', { cookie: login.cookie, body: { page: page(), baseRev: null } });
    assert.equal(save.status, 403);
    assert.equal(save.data.code, 'password-change');
    const weak = await call('POST', 'password', { cookie: login.cookie, body: { newPassword: 'alllowercase1' } });
    assert.equal(weak.status, 400);
    const ok = await call('POST', 'password', { cookie: login.cookie, body: { newPassword: 'PyroPassword2026' } });
    assert.equal(ok.status, 200);
    assert.equal((await call('PUT', 'pages/x1', { cookie: ok.cookie, body: { page: page(), baseRev: null } })).status, 200);
    // the old cookie (before the change) no longer works
    assert.equal((await call('GET', 'me', { cookie: login.cookie })).data.user, null);
    // a voluntary change needs the current password
    const again = await call('POST', 'password', { cookie: ok.cookie, body: { newPassword: 'OtherPassword2026' } });
    assert.equal(again.status, 400);
    sessions['Editor.Pyro'] = ok.cookie;
});

test('forged or tampered cookies are rejected', async () => {
    const c = await session('Editor.Rapha');
    const [name, value] = c.split('=');
    const [payload, sig] = value.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ k: 'redmatteo', v: 1, iat: Date.now(), exp: Date.now() + 1e6 })).toString('base64url');
    assert.equal((await call('GET', 'me', { cookie: `${name}=${forgedPayload}.${sig}` })).data.user, null);
    assert.equal((await call('GET', 'me', { cookie: `${name}=${payload}.AAAA` })).data.user, null);
    assert.equal((await call('GET', 'me', { cookie: c })).data.user.username, 'Editor.Rapha');
});

test('pages: create, conflict detection, drafts hidden from the public, revisions', async () => {
    const ed = await session('Editor.Rapha');
    const anon = {};
    assert.equal((await call('PUT', 'pages/p1', { ...anon, body: { page: page(), baseRev: null } })).status, 401);
    const created = await call('PUT', 'pages/p1', { cookie: ed, body: { page: page({ published: false }), baseRev: null } });
    assert.equal(created.status, 200);
    assert.equal(created.data.page.rev, 1);
    assert.equal((await call('PUT', 'pages/p1', { cookie: ed, body: { page: page(), baseRev: null } })).data.code, 'exists');
    assert.equal((await call('GET', 'pages/p1')).status, 404); // draft
    assert.equal((await call('GET', 'pages')).data.pages.some((p) => p.slug === 'p1'), false);
    assert.equal((await call('GET', 'pages/p1', { cookie: ed })).status, 200);

    const v2 = await call('PUT', 'pages/p1', { cookie: ed, body: { page: page({ title: 'V2' }), baseRev: 1 } });
    assert.equal(v2.data.page.rev, 2);
    const stale = await call('PUT', 'pages/p1', { cookie: ed, body: { page: page({ title: 'stale' }), baseRev: 1 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, 'conflict');
    const forced = await call('PUT', 'pages/p1', { cookie: ed, body: { page: page({ title: 'forced' }), baseRev: 1, force: true } });
    assert.equal(forced.data.page.rev, 3);
    assert.equal((await call('GET', 'pages/p1')).data.page.title, 'forced');

    const revs = await call('GET', 'pages/p1/revisions', { cookie: ed });
    assert.equal(revs.data.revisions.length, 3);
    const one = await call('GET', `pages/p1/revisions/${encodeURIComponent(revs.data.revisions[2].id)}`, { cookie: ed });
    assert.equal(one.data.revision.published, false);
    assert.equal((await call('GET', 'pages/p1/revisions')).status, 401);
});

test('page validation', async () => {
    const ed = await session('Editor.Rapha');
    const bad = async (slug, p) => (await call('PUT', `pages/${slug}`, { cookie: ed, body: { page: p, baseRev: null } })).status;
    assert.equal(await bad('Bad%20Slug', page()), 400);
    assert.equal(await bad('v1', page({ accent: 'red;x' })), 400);
    assert.equal(await bad('v2', page({ title: '' })), 400);
    assert.equal(await bad('v3', page({ category: 'evil' })), 400);
    assert.equal(await bad('v4', page({ sections: Array(61).fill({ title: '', body: '' }) })), 400);
    const extra = await call('PUT', 'pages/v5', { cookie: ed, body: { page: page({ evil: 1, rev: 99, updatedBy: 'Owner.EC' }), baseRev: null } });
    assert.equal(extra.data.page.evil, undefined);
    assert.equal(extra.data.page.updatedBy, 'Editor.Rapha');
});

test('only admins delete pages; editors cannot manage accounts', async () => {
    const ed = await session('Editor.Rapha');
    await call('PUT', 'pages/d1', { cookie: ed, body: { page: page(), baseRev: null } });
    assert.equal((await call('DELETE', 'pages/d1', { cookie: ed })).status, 403);
    assert.equal((await call('GET', 'users', { cookie: ed })).status, 403);
    assert.equal((await call('POST', 'users', { cookie: ed, body: { username: 'Editor.Hacker' } })).status, 403);
    assert.equal((await call('GET', 'audit', { cookie: ed })).status, 403);
    const admin = await session('Admin.Kylo');
    assert.equal((await call('DELETE', 'pages/d1', { cookie: admin })).status, 200);
});

test('role hierarchy', async () => {
    const admin = await session('Admin.Kylo');
    const owner = await session('Owner.RedMatteo');
    // admins create editors only
    assert.equal((await call('POST', 'users', { cookie: admin, body: { username: 'Editor.Nuovo' } })).status, 200);
    assert.equal((await call('POST', 'users', { cookie: admin, body: { username: 'Admin.Nuovo2' } })).status, 403);
    // names are unique whatever the role
    assert.equal((await call('POST', 'users', { cookie: owner, body: { username: 'Admin.Nuovo' } })).status, 409);
    // owners create owners and admins
    assert.equal((await call('POST', 'users', { cookie: owner, body: { username: 'Owner.Second' } })).status, 200);
    // admins cannot touch admins or owners; nobody can change an owner or themselves
    assert.equal((await call('PATCH', 'users/Owner.EC', { cookie: admin, body: { role: 'disabled' } })).status, 403);
    assert.equal((await call('PATCH', 'users/Owner.EC', { cookie: owner, body: { role: 'disabled' } })).status, 403);
    assert.equal((await call('PATCH', 'users/Owner.RedMatteo', { cookie: owner, body: { role: 'admin' } })).status, 403);
    assert.equal((await call('PATCH', 'users/Editor.Nuovo', { cookie: admin, body: { role: 'admin' } })).status, 403);
    assert.equal((await call('PATCH', 'users/Editor.Nuovo', { cookie: owner, body: { role: 'owner' } })).status, 403);
    // owner promotes: the login is renamed
    const promoted = await call('PATCH', 'users/Editor.Nuovo', { cookie: owner, body: { role: 'admin' } });
    assert.equal(promoted.data.user.username, 'Admin.Nuovo');
    assert.equal((await call('PATCH', 'users/Admin.Nuovo', { cookie: admin, body: { role: 'disabled' } })).status, 403);
});

test('disabling and password reset end existing sessions', async () => {
    const owner = await session('Owner.RedMatteo');
    const pyro = sessions['Editor.Pyro'];
    const reset = await call('POST', 'users/Editor.Pyro/reset', { cookie: owner });
    assert.equal(reset.status, 200);
    assert.match(reset.data.password, /^\S{4}-\S{4}-\S{4}-\S{4}$/);
    assert.equal((await call('GET', 'me', { cookie: pyro })).data.user, null);
    const relog = await call('POST', 'login', { body: { username: 'Editor.Pyro', password: reset.data.password } });
    assert.equal(relog.data.user.mustChangePassword, true);

    await call('PATCH', 'users/Editor.Pyro', { cookie: owner, body: { role: 'disabled' } });
    assert.equal((await call('GET', 'me', { cookie: relog.cookie })).data.user, null);
    const blocked = await call('POST', 'login', { body: { username: 'Editor.Pyro', password: reset.data.password } });
    assert.equal(blocked.status, 403);
});

test('recovery code resets any account, wrong code is refused', async () => {
    assert.equal((await call('POST', 'recover', { body: { code: 'wrong', username: 'Owner.EC' } })).status, 403);
    const r = await call('POST', 'recover', { body: { code: process.env.DVE_RECOVERY_CODE, username: 'Owner.EC' } });
    assert.equal(r.status, 200);
    const login = await call('POST', 'login', { body: { username: 'Owner.EC', password: r.data.password } });
    assert.equal(login.data.user.role, 'owner');
});

test('audit log records actions and is admin-only', async () => {
    const admin = await session('Admin.Kylo');
    const { data } = await call('GET', 'audit', { cookie: admin });
    const actions = data.entries.map((e) => e.action);
    for (const a of ['account.create', 'page.create', 'page.update', 'page.delete', 'user.role', 'account.reset']) {
        assert.ok(actions.includes(a), `missing ${a}`);
    }
    assert.equal((await call('GET', 'audit')).status, 401);
});
