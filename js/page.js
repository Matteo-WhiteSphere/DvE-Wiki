// Public renderer for wiki pages stored in Firestore: page.html?p=<slug>
import {
    db, isConfigured, watchSession, loadSeeds, renderHeader, renderSections, el,
    isEditorRole, SLUG_RE, formatDate
} from './wiki.js';
import {
    doc, getDoc, collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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

async function fetchPage(role) {
    if (!isConfigured) return { page: null, hidden: false };
    try {
        const snap = await getDoc(doc(db, 'pages', slug));
        return { page: snap.exists() ? snap.data() : null, hidden: false };
    } catch (e) {
        // permission-denied = the page exists but is not published.
        if (e.code === 'permission-denied') return { page: null, hidden: true };
        console.error(e);
        return { page: null, hidden: false, error: e };
    }
}

async function fetchSiblings(group, role) {
    const seeds = await loadSeeds();
    const items = new Map();
    for (const [s, p] of Object.entries(seeds)) {
        if (p.group === group) items.set(s, { slug: s, label: p.navLabel || p.title, order: p.navOrder || 0 });
    }
    if (isConfigured) {
        try {
            const filters = [where('group', '==', group)];
            if (!isEditorRole(role)) filters.push(where('published', '==', true));
            const snap = await getDocs(query(collection(db, 'pages'), ...filters));
            snap.forEach((d) => {
                const p = d.data();
                items.set(d.id, { slug: d.id, label: p.navLabel || p.title, order: p.navOrder || 0 });
            });
        } catch (e) { console.warn('Sibling pages unavailable', e); }
    }
    return [...items.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

async function renderNav(page, role) {
    const links = [
        el('a', { href: 'index.html', text: 'Home / Countries' }),
        el('a', { href: 'ideologies.html', text: 'Ideologies List' })
    ];
    if (page && page.group) {
        const siblings = await fetchSiblings(page.group, role);
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
async function render({ role }) {
    const token = ++renderToken;

    if (!SLUG_RE.test(slug)) {
        renderHeader(headerEl, { title: 'Page not found', subtitle: '' });
        contentEl.replaceChildren(el('div', { class: 'card' }, el('p', { text: 'Invalid page address.' })));
        return;
    }

    const [{ page, hidden, error }, seeds] = await Promise.all([fetchPage(role), loadSeeds()]);
    if (token !== renderToken) return;
    const seed = seeds[slug];
    const shown = page || seed;

    notice(null);
    if (!shown) {
        renderHeader(headerEl, { title: 'Page not found', subtitle: slug });
        document.title = 'Page not found - Dragon vs Eagle Wiki';
        contentEl.replaceChildren(el('div', { class: 'card' },
            el('p', { text: hidden ? 'This page has not been published yet.' : 'This page does not exist (yet).' }),
            error ? el('p', { class: 'muted', text: 'Could not reach the database.' }) : ''));
        await renderNav(null, role);
        renderStaffBar(role, false);
        return;
    }

    renderHeader(headerEl, shown);
    document.title = `${shown.title} - Dragon vs Eagle Wiki`;
    renderSections(contentEl, shown.sections);
    await renderNav(shown, role);
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
