// Public renderer for wiki pages stored by the API: page.html?p=<slug>
import {
    api, watchSession, loadSeeds, renderHeader, renderSections, el,
    isEditorRole, SLUG_RE, formatDate
} from './wiki.js';

const slug = (new URLSearchParams(location.search).get('p') || '').toLowerCase();
const headerEl = document.getElementById('page-header');
const navEl = document.getElementById('page-nav');
const contentEl = document.getElementById('page-content');
const noticeEl = document.getElementById('page-notice');
const metaEl = document.getElementById('page-meta');
const staffBar = document.getElementById('staff-bar');

function notice(html, kind = '') {
    noticeEl.replaceChildren();
    if (!html) return;
    const box = el('div', { class: 'notice ' + kind });
    box.append(...html);
    noticeEl.append(box);
}

async function fetchPage() {
    try {
        return { page: (await api('pages/' + encodeURIComponent(slug))).page };
    } catch (e) {
        if (e.status === 404 && e.code !== 'unavailable') return { page: null };
        console.warn('Wiki server unavailable', e);
        return { page: null, error: e };
    }
}

async function fetchSiblings(group) {
    const seeds = await loadSeeds();
    const items = new Map();
    for (const [s, p] of Object.entries(seeds)) {
        if (p.group === group) items.set(s, { slug: s, label: p.navLabel || p.title, order: p.navOrder || 0 });
    }
    try {
        const { pages } = await api('pages?group=' + encodeURIComponent(group));
        for (const p of pages) items.set(p.slug, { slug: p.slug, label: p.navLabel || p.title, order: p.navOrder || 0 });
    } catch (e) { console.warn('Sibling pages unavailable', e); }
    return [...items.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function loginLink(session) {
    const signedIn = session && session.user;
    const label = signedIn ? session.user.username : 'Login';
    return el('a', {
        href: signedIn && isEditorRole(session.role) ? 'editor.html' : 'login.html',
        class: 'nav-login',
        title: signedIn ? `Signed in as ${label} (${session.role})` : 'Staff sign in',
        text: '\u{1F464} ' + label
    });
}

async function renderNav(page, role, session) {
    const links = [
        el('a', { href: 'index.html', text: 'Home / Countries' }),
        el('a', { href: 'ideologies.html', text: 'Ideologies List' })
    ];
    if (page && page.group) {
        const siblings = await fetchSiblings(page.group);
        if (siblings.length > 1) {
            for (const s of siblings) {
                links.push(el('a', {
                    href: 'page.html?p=' + encodeURIComponent(s.slug),
                    class: s.slug === slug ? 'attivo' : null,
                    text: s.label
                }));
            }
        }
    }
    links.push(loginLink(session));
    navEl.replaceChildren(...links);
}

function renderStaffBar(role, exists) {
    staffBar.replaceChildren();
    if (!isEditorRole(role)) { staffBar.classList.add('hidden'); return; }
    staffBar.classList.remove('hidden');
    staffBar.append(
        el('a', { class: 'btn primary', href: 'editor.html?p=' + encodeURIComponent(slug), text: exists ? '✎ Edit page' : '+ Create this page' }),
        el('a', { class: 'btn', href: 'editor.html', text: 'Staff area' })
    );
}

let renderToken = 0;
async function render(session) {
    const { role } = session;
    const token = ++renderToken;

    if (!SLUG_RE.test(slug)) {
        renderHeader(headerEl, { title: 'Page not found', subtitle: '' });
        contentEl.replaceChildren(el('div', { class: 'card' }, el('p', { text: 'Invalid page address.' })));
        return;
    }

    const [{ page, error }, seeds] = await Promise.all([fetchPage(), loadSeeds()]);
    if (token !== renderToken) return;
    const seed = seeds[slug];
    const shown = page || seed;

    notice(null);
    if (!shown) {
        renderHeader(headerEl, { title: 'Page not found', subtitle: slug });
        document.title = 'Page not found - Dragon vs Eagle Wiki';
        contentEl.replaceChildren(el('div', { class: 'card' },
            el('p', { text: 'This page does not exist (yet), or it has not been published.' }),
            error ? el('p', { class: 'muted', text: 'Could not reach the wiki server.' }) : ''));
        await renderNav(null, role, session);
        renderStaffBar(role, false);
        return;
    }

    renderHeader(headerEl, shown);
    document.title = `${shown.title} - Dragon vs Eagle Wiki`;
    renderSections(contentEl, shown.sections);
    await renderNav(shown, role, session);
    if (token !== renderToken) return;

    if (page && !page.published) {
        notice([el('strong', { text: 'Draft — ' }), 'only staff can see this version. Publish it from the editor.']);
    } else if (!page) {
        notice([el('strong', { text: 'Placeholder page — ' }), 'detailed content for this page has not been written yet.']);
    }

    metaEl.textContent = page && page.updatedAt ? 'Last updated: ' + formatDate(page.updatedAt) : '';
    renderStaffBar(role, !!page);
}

watchSession(render);
