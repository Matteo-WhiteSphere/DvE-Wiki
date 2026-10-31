// Page editor for editors / admins / owners.
import {
    api, watchSession, loadSeeds, loadCountries, renderSections, el, applyAccent, isEditorRole, isAdminRole,
    accountActive, SLUG_RE, COLOR_RE, slugify, formatDate, friendlyError
} from './wiki.js';

const $ = (id) => document.getElementById(id);

const SECTION_TEMPLATES = {
    info: '**Starting Name:** \n**Starting Leader:** \n**Capital:** \n**Country Tag:** `XXX`',
    spirits: '| Spirit | Effects |\n|---|---|\n| Spirit name | `Stability +5%`, `Political Power +0.10/day` |',
    focus: '| Focus | Primary Effect |\n|---|---|\n| `XXX_focus_id` | Effect description |',
    leaders: '| Photo | Leader | Party | Ideology | Icon |\n|---|---|---|---|---|\n' +
        '| <img class="leader-avatar" src="images/leaders/NAME.png" alt="NAME"> | Leader name | Party | `ideology-subideology` | <img class="ideology-icon" src="images/ideologies/ICON.png" alt="ICON"> |',
    paths: '| Path | Trigger |\n|---|---|\n| <span class="badge" style="background-color:#ff6868">Progressive</span> | `XXX_event` → `option` |'
};
const MAX_SECTIONS = 60;
const MAX_BODY = 60000;

const state = {
    user: null,
    role: 'none',
    slug: null,          // slug of the loaded page
    isNew: true,         // not yet in the database
    rev: null,           // revision number of the loaded page (conflict detection)
    dirty: false,
    pages: new Map(),    // slug -> page summary
    seeds: {}
};

// ------------------------------------------------------------- notices

/** The session ended (inactivity) or the account changed: back to the login page. */
function handleAuthError(e) {
    if (e && (e.status === 401 || e.code === 'password-change')) {
        state.dirty = false;
        location.replace('login.html?expired=1&next=' + encodeURIComponent('editor.html' + location.search));
        return true;
    }
    return false;
}

function notice(text, kind = '') {
    $('editor-notice').replaceChildren(text ? el('div', { class: 'notice ' + kind, text }) : '');
    if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setDirty(on) {
    state.dirty = on;
    $('dirty-flag').textContent = on ? '● unsaved changes' : '';
}

addEventListener('beforeunload', (ev) => {
    if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
});

// ----------------------------------------------------------- page list

async function refreshList() {
    const { pages } = await api('pages');
    state.pages.clear();
    for (const p of pages) state.pages.set(p.slug, p);
    drawList();
}

function drawList() {
    const q = $('page-search').value.trim().toLowerCase();
    const filter = $('page-filter').value;
    const rows = [];
    for (const [slug, p] of state.pages) {
        rows.push({ slug, title: p.title, kind: p.published ? 'published' : 'draft' });
    }
    for (const [slug, p] of Object.entries(state.seeds)) {
        if (!state.pages.has(slug)) rows.push({ slug, title: p.title, kind: 'seed', generated: !!p.generated });
    }
    rows.sort((a, b) => a.slug.localeCompare(b.slug));
    const list = $('page-list');
    list.replaceChildren();
    for (const r of rows) {
        if (filter !== 'all' && r.kind !== filter) continue;
        if (q && !r.slug.includes(q) && !(r.title || '').toLowerCase().includes(q)) continue;
        const label = { published: 'published', draft: 'draft', seed: r.generated ? 'from the mod' : 'placeholder' }[r.kind];
        list.append(el('li', {
            class: r.slug === state.slug ? 'active' : null,
            title: r.title || '',
            onclick: () => openPage(r.slug)
        }, el('span', { text: r.slug }), el('span', { class: 'state ' + r.kind, text: label })));
    }
    if (!list.children.length) list.append(el('li', { class: 'muted', text: 'No pages.' }));
}

// --------------------------------------------------------------- form

function sectionEditor(section = { title: '', layout: 'full', body: '' }) {
    const box = el('div', { class: 'section-editor' });
    const title = el('input', { type: 'text', class: 's-title', maxlength: '200', placeholder: 'Section title' });
    title.value = section.title || '';
    const layout = el('select', { class: 's-layout', title: 'Width' },
        el('option', { value: 'full', text: 'Full width' }),
        el('option', { value: 'half', text: 'Half width' }),
        el('option', { value: 'third', text: 'One third' }));
    layout.value = ['half', 'third'].includes(section.layout) ? section.layout : 'full';
    const body = el('textarea', { class: 's-body', maxlength: String(MAX_BODY), placeholder: 'Content (Markdown)…', spellcheck: 'false' });
    body.value = section.body || '';
    const tpl = el('select', { class: 'shrink', title: 'Insert a template' },
        el('option', { value: '', text: 'Insert template…' }),
        el('option', { value: 'info', text: 'Info fields' }),
        el('option', { value: 'spirits', text: 'National spirits table' }),
        el('option', { value: 'focus', text: 'Focus table' }),
        el('option', { value: 'leaders', text: 'Parties & leaders table' }),
        el('option', { value: 'paths', text: 'Paths / triggers table' }));
    tpl.addEventListener('change', () => {
        if (!tpl.value) return;
        const text = SECTION_TEMPLATES[tpl.value];
        const pos = body.selectionStart ?? body.value.length;
        const before = body.value.slice(0, pos);
        body.value = before + (before && !before.endsWith('\n') ? '\n\n' : '') + text + body.value.slice(pos);
        tpl.value = '';
        changed();
    });
    const move = (dir) => {
        const sib = dir < 0 ? box.previousElementSibling : box.nextElementSibling;
        if (!sib) return;
        if (dir < 0) sib.before(box); else sib.after(box);
        changed();
    };
    box.append(
        el('div', { class: 'row' },
            title,
            el('div', { class: 'shrink' }, layout),
            tpl,
            el('div', { class: 'shrink toolbar' },
                el('button', { class: 'btn small', type: 'button', title: 'Move up', text: '↑', onclick: () => move(-1) }),
                el('button', { class: 'btn small', type: 'button', title: 'Move down', text: '↓', onclick: () => move(1) }),
                el('button', { class: 'btn small danger', type: 'button', title: 'Remove section', text: '✕', onclick: () => {
                    if (body.value.trim() && !confirm('Remove this section?')) return;
                    box.remove();
                    changed();
                } }))),
        body);
    return box;
}

function fillForm(p) {
    $('f-title').value = p.title || '';
    $('f-subtitle').value = p.subtitle || '';
    $('f-category').value = p.category || 'other';
    $('f-group').value = p.group || '';
    $('f-tag').value = p.tag || '';
    $('f-navlabel').value = p.navLabel || '';
    $('f-navorder').value = Number.isInteger(p.navOrder) ? p.navOrder : 0;
    $('f-ideology').value = p.ideology || '';
    $('f-subideology').value = p.subIdeology || '';
    $('f-ideocolor-text').value = COLOR_RE.test(p.ideologyColor || '') ? p.ideologyColor.toLowerCase() : '';
    if ($('f-ideocolor-text').value) $('f-ideocolor').value = $('f-ideocolor-text').value;
    updateCountryFields();
    const accent = COLOR_RE.test(p.accent || '') ? p.accent.toLowerCase() : '#00f3ff';
    $('f-accent').value = accent;
    $('f-accent-text').value = accent;
    $('f-published').checked = !!p.published;
    const sections = $('sections');
    sections.replaceChildren(...(p.sections || []).map(sectionEditor));
    if (!sections.children.length) sections.append(sectionEditor({ title: 'Overview', layout: 'full', body: '' }));
    updatePreview();
}

/** The home-table fields only matter for country pages. */
function updateCountryFields() {
    $('country-fields').classList.toggle('hidden', $('f-category').value !== 'country');
}

function readForm() {
    const sections = [...document.querySelectorAll('#sections .section-editor')].map((box) => ({
        title: box.querySelector('.s-title').value.trim(),
        layout: box.querySelector('.s-layout').value,
        body: box.querySelector('.s-body').value
    }));
    return {
        title: $('f-title').value.trim(),
        subtitle: $('f-subtitle').value.trim(),
        category: $('f-category').value,
        group: $('f-group').value.trim().toLowerCase(),
        tag: $('f-tag').value.trim().toUpperCase(),
        navLabel: $('f-navlabel').value.trim(),
        navOrder: parseInt($('f-navorder').value, 10) || 0,
        ideology: $('f-ideology').value.trim(),
        subIdeology: $('f-subideology').value.trim(),
        ideologyColor: $('f-ideocolor-text').value.trim().toLowerCase(),
        accent: $('f-accent-text').value.trim().toLowerCase(),
        published: $('f-published').checked,
        sections
    };
}

/** Client-side copy of the checks in netlify/lib/core.mjs (cleanPage), with readable messages. */
function validate(slug, p) {
    if (!SLUG_RE.test(slug)) return 'Page address: lower-case letters, numbers, "_" or "-" only (max 64).';
    if (!p.title || p.title.length > 120) return 'Title is required (max 120 characters).';
    if (p.subtitle.length > 200) return 'Subtitle is too long (max 200).';
    if (!/^[a-z0-9_-]{0,40}$/.test(p.group)) return 'Group: lower-case letters, numbers, "_" or "-" only.';
    if (!/^[A-Z0-9]{0,4}$/.test(p.tag)) return 'TAG: up to 4 letters/numbers.';
    if (!COLOR_RE.test(p.accent)) return 'Accent colour must look like #12ab34.';
    if (p.navLabel.length > 60) return 'Navigation label is too long (max 60).';
    if (p.navOrder < 0 || p.navOrder > 999) return 'Nav order must be between 0 and 999.';
    if (p.ideology.length > 60 || p.subIdeology.length > 60) return 'Ideology names: max 60 characters.';
    if (p.ideologyColor && !COLOR_RE.test(p.ideologyColor)) return 'Ideology colour must look like #12ab34 (or stay empty).';
    if (p.sections.length > MAX_SECTIONS) return `Too many sections (max ${MAX_SECTIONS}).`;
    for (const s of p.sections) {
        if (s.title.length > 200) return 'A section title is too long (max 200).';
        if (s.body.length > MAX_BODY) return 'A section is too long. Split it into more sections.';
    }
    if (new Blob([JSON.stringify(p)]).size > 900000) return 'The page is too big (max ~900 KB).';
    return null;
}

function updatePreview() {
    if ($('preview-panel').classList.contains('hidden')) return;
    const p = readForm();
    const preview = $('preview');
    applyAccent(preview, p.accent);
    const content = el('div', { class: 'container', style: 'margin:20px auto' });
    renderSections(content, p.sections);
    preview.replaceChildren(
        el('header', {}, el('h1', { text: p.title || 'Untitled' }), p.subtitle ? el('p', { text: p.subtitle }) : ''),
        content);
}

let previewTimer = null;
function changed() {
    setDirty(true);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 300);
}

function setMode() {
    const slugInput = $('f-slug');
    slugInput.readOnly = !state.isNew;
    slugInput.title = state.isNew ? '' : 'The address of an existing page cannot be changed.';
    $('edit-title').textContent = state.isNew ? `New page${state.slug ? ': ' + state.slug : ''}` : `Editing: ${state.slug}`;
    $('delete-btn').classList.toggle('hidden', state.isNew || !isAdminRole(state.role));
    $('history-btn').disabled = state.isNew;
    const viewSlug = state.slug || $('f-slug').value;
    $('view-btn').href = 'page.html?p=' + encodeURIComponent(viewSlug);
    $('history-panel').classList.add('hidden');
    drawList();
}

async function openPage(slug, { force = false } = {}) {
    if (!force && state.dirty && !confirm('You have unsaved changes. Discard them?')) return;
    notice(null);
    let data = null;
    try {
        data = (await api('pages/' + encodeURIComponent(slug))).page;
    } catch (e) {
        if (handleAuthError(e)) return;
        if (e.status !== 404) { notice(friendlyError(e), 'error'); return; }
    }

    if (data) {
        state.isNew = false;
        state.rev = data.rev;
        fillForm(data);
    } else {
        state.isNew = true;
        state.rev = null;
        const seed = state.seeds[slug];
        let base = {};
        if (seed && seed.category === 'country') {
            // Prefill the home-table fields from data/countries.json.
            const row = (await loadCountries()).countries.find((c) => c.href === 'page.html?p=' + slug);
            if (row) base = { ideology: row.ideology, subIdeology: row.subIdeology, ideologyColor: row.ideologyColor, navLabel: row.short || row.name };
        }
        fillForm(seed ? { ...seed, ...base, published: false } : { title: '', category: 'other', accent: '#00f3ff' });
        if (seed) notice(seed.generated
            ? 'This page is generated from the mod files. Its content has been loaded: edit it and press Save to create the page (the generated version is then replaced by yours).'
            : 'This page is still a placeholder. Its old content has been loaded: edit it and press Save to create the page.');
    }
    state.slug = slug;
    $('f-slug').value = slug;
    delete $('f-slug').dataset.touched;
    history.replaceState(null, '', 'editor.html?p=' + encodeURIComponent(slug));
    setMode();
    setDirty(false);
}

function newPage() {
    if (state.dirty && !confirm('You have unsaved changes. Discard them?')) return;
    notice(null);
    state.slug = null;
    state.isNew = true;
    state.rev = null;
    fillForm({ title: '', subtitle: '', category: 'other', accent: '#00f3ff', published: false });
    $('f-slug').value = '';
    delete $('f-slug').dataset.touched;
    history.replaceState(null, '', 'editor.html');
    setMode();
    setDirty(false);
    $('f-title').focus();
}

// --------------------------------------------------------------- save

async function save({ force = false } = {}) {
    const slug = (state.isNew ? $('f-slug').value.trim().toLowerCase() : state.slug) || '';
    const p = readForm();
    const err = validate(slug, p);
    if (err) { notice(err, 'error'); return; }

    $('save-btn').disabled = true;
    try {
        const { page } = await api('pages/' + encodeURIComponent(slug), {
            method: 'PUT', body: { page: p, baseRev: state.isNew ? null : state.rev, force }
        });
        const created = state.isNew;
        state.pages.set(slug, page);
        state.slug = slug;
        state.isNew = false;
        state.rev = page.rev;
        history.replaceState(null, '', 'editor.html?p=' + encodeURIComponent(slug));
        setDirty(false);
        setMode();
        notice(created ? `Page "${slug}" created.` : 'Saved.', 'ok');
    } catch (e) {
        if (handleAuthError(e)) return;
        if (e.code === 'conflict') {
            if (confirm(`${e.data.updatedBy || 'Someone else'} saved this page after you opened it.\n\nOK = overwrite their changes with yours\nCancel = keep their version (you can reload the page to see it)`)) {
                $('save-btn').disabled = false;
                return save({ force: true });
            }
            notice('Not saved: the page was changed by someone else. Copy your text somewhere, then reload the page.', 'error');
        } else if (e.code === 'exists') {
            notice(`A page with the address "${slug}" already exists. Open it from the list or choose another address.`, 'error');
        } else {
            notice('Save failed: ' + friendlyError(e), 'error');
        }
    } finally {
        $('save-btn').disabled = false;
    }
}

async function removePage() {
    if (state.isNew || !isAdminRole(state.role)) return;
    const typed = prompt(`Delete the page "${state.slug}"?\nIts history is kept, so it can be restored by re-creating the same address.\n\nType the address to confirm:`);
    if (typed !== state.slug) return;
    try {
        await api('pages/' + encodeURIComponent(state.slug), { method: 'DELETE' });
        state.pages.delete(state.slug);
        const slug = state.slug;
        setDirty(false);
        await openPage(slug, { force: true });
        notice(`Page "${slug}" deleted.`, 'ok');
    } catch (e) {
        if (!handleAuthError(e)) notice('Delete failed: ' + friendlyError(e), 'error');
    }
}

async function showHistory() {
    const panel = $('history-panel');
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const list = $('history-list');
    list.replaceChildren(el('p', { class: 'muted', text: 'Loading…' }));
    const base = 'pages/' + encodeURIComponent(state.slug) + '/revisions';
    try {
        const { revisions } = await api(base);
        const table = el('table', { class: 'wiki-table' },
            el('tr', {}, el('th', { text: 'Saved' }), el('th', { text: 'By' }), el('th', { text: 'State' }), el('th', { text: '' })));
        for (const r of revisions) {
            table.append(el('tr', {},
                el('td', { text: formatDate(r.savedAt) }),
                el('td', { text: r.savedBy }),
                el('td', { text: r.published ? 'published' : 'draft' }),
                el('td', {}, el('button', { class: 'btn small', type: 'button', text: 'Load', onclick: async () => {
                    if (state.dirty && !confirm('Replace the current text with this version?')) return;
                    try {
                        const { revision } = await api(base + '/' + encodeURIComponent(r.id));
                        fillForm(revision);
                        setDirty(true);
                        notice(`Version from ${formatDate(r.savedAt)} loaded. Press Save to restore it.`);
                    } catch (e) { if (!handleAuthError(e)) notice(friendlyError(e), 'error'); }
                } }))));
        }
        list.replaceChildren(revisions.length ? table : el('p', { class: 'muted', text: 'No saved versions.' }));
    } catch (e) {
        if (!handleAuthError(e)) list.replaceChildren(el('p', { class: 'muted', text: friendlyError(e) }));
    }
}

// -------------------------------------------------------------- wiring

function wire() {
    $('new-page-btn').addEventListener('click', newPage);
    $('save-btn').addEventListener('click', () => save());
    $('delete-btn').addEventListener('click', removePage);
    $('history-btn').addEventListener('click', showHistory);
    $('preview-btn').addEventListener('click', () => {
        const panel = $('preview-panel');
        panel.classList.toggle('hidden');
        updatePreview();
        if (!panel.classList.contains('hidden')) panel.scrollIntoView({ behavior: 'smooth' });
    });
    $('add-section-btn').addEventListener('click', () => {
        if ($('sections').children.length >= MAX_SECTIONS) return;
        const box = sectionEditor();
        $('sections').append(box);
        box.querySelector('.s-title').focus();
        changed();
    });
    $('page-search').addEventListener('input', drawList);
    $('page-filter').addEventListener('change', drawList);
    $('sections').addEventListener('input', changed);
    $('sections').addEventListener('change', changed);
    $('f-category').addEventListener('change', updateCountryFields);
    $('f-ideocolor').addEventListener('input', () => { $('f-ideocolor-text').value = $('f-ideocolor').value; changed(); });
    $('f-ideocolor-text').addEventListener('input', () => {
        if (COLOR_RE.test($('f-ideocolor-text').value)) $('f-ideocolor').value = $('f-ideocolor-text').value.toLowerCase();
    });
    for (const id of ['f-title', 'f-subtitle', 'f-category', 'f-group', 'f-tag', 'f-navlabel', 'f-navorder', 'f-published',
        'f-ideology', 'f-subideology', 'f-ideocolor-text']) {
        $(id).addEventListener('input', changed);
        $(id).addEventListener('change', changed);
    }
    $('f-title').addEventListener('input', () => {
        if (state.isNew && !$('f-slug').dataset.touched) $('f-slug').value = slugify($('f-title').value);
    });
    $('f-slug').addEventListener('input', () => { $('f-slug').dataset.touched = '1'; changed(); });
    $('f-accent').addEventListener('input', () => { $('f-accent-text').value = $('f-accent').value; changed(); });
    $('f-accent-text').addEventListener('input', () => {
        if (COLOR_RE.test($('f-accent-text').value)) $('f-accent').value = $('f-accent-text').value.toLowerCase();
        changed();
    });
    // Ctrl/Cmd + S saves.
    addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); }
    });
}

// --------------------------------------------------------------- start

watchSession(async ({ user, role }) => {
    if (!user) {
        location.replace('login.html?next=' + encodeURIComponent('editor.html' + location.search));
        return;
    }
    if (user.mustChangePassword) { location.replace('login.html'); return; }
    state.user = user;
    state.role = role;
    $('whoami').textContent = `Signed in as ${user.username} (${role})`;
    $('nav-admin').classList.toggle('hidden', !isAdminRole(role));
    if (!isEditorRole(role) || !accountActive(user)) {
        notice('Your account cannot edit pages (role: ' + role + ').', 'error');
        return;
    }
    wire();
    $('editor-root').classList.remove('hidden');
    state.seeds = await loadSeeds();
    try { await refreshList(); } catch (e) { if (!handleAuthError(e)) notice(friendlyError(e), 'error'); }
    const wanted = (new URLSearchParams(location.search).get('p') || '').toLowerCase();
    if (SLUG_RE.test(wanted)) await openPage(wanted, { force: true });
    else newPage();
});
