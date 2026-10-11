// Wiki search: countries, pages written in the editor, placeholder pages and the
// static pages (ideologies, events guide, Italy, Finland…). Runs in the browser.
import { api, loadSeeds, loadCountries, el, fold } from './wiki.js';

const $ = (id) => document.getElementById(id);

// Static pages of the site that are not managed by the editor.
const STATIC_PAGES = ['ideologies.html', 'events_guide.html', 'fin.html', 'ita_democratic.html', 'ita_communist.html', 'ita_fascist.html'];

const KIND_LABEL = {
    country: 'Country', path: 'Country path', guide: 'Guide', other: 'Page',
    ideology: 'Ideology', section: 'Section', draft: 'Placeholder'
};

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// --------------------------------------------------------------- sources

async function databasePages() {
    try { return (await api('search')).pages; } catch { return []; }
}

/** Splits a static page into searchable blocks (cards/sections, ideology rows). */
async function staticDocs(url) {
    try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) return [];
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const pageTitle = clean(doc.querySelector('header h1')?.textContent) || url;
        const subtitle = clean(doc.querySelector('header p')?.textContent);
        const docs = [];

        // Ideologies: one result per sub-ideology row.
        doc.querySelectorAll('table.wiki-table').forEach((table) => {
            const group = clean(table.querySelector('thead th')?.textContent);
            table.querySelectorAll('tbody tr').forEach((tr) => {
                const name = clean(tr.querySelector('.col-name')?.textContent);
                if (!name || !tr.querySelector('.col-name')) return;
                docs.push({
                    title: name, url, kind: 'ideology', context: `${group} · ${pageTitle}`,
                    text: clean(`${name} ${group} ${tr.textContent}`)
                });
            });
        });

        // Cards and sections with a heading.
        doc.querySelectorAll('.container > .card, .container > .section, .container > .page-intro, .container .grid > .card').forEach((block) => {
            const heading = clean(block.querySelector('h2, h3')?.textContent);
            if (!heading) return;
            docs.push({
                title: heading, url: block.id ? `${url}#${block.id}` : url, kind: 'section',
                context: pageTitle, text: clean(block.textContent)
            });
        });

        // The page itself.
        docs.push({
            title: pageTitle, url, kind: 'other', context: subtitle,
            text: clean(doc.querySelector('.container')?.textContent || doc.body.textContent).slice(0, 30000)
        });
        return docs;
    } catch { return []; }
}

let indexPromise = null;
function buildIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = (async () => {
        const [pages, seeds, base, ...statics] = await Promise.all([
            databasePages(), loadSeeds(), loadCountries(), ...STATIC_PAGES.map(staticDocs)
        ]);
        const docs = [];
        const written = new Set(pages.map((p) => p.slug));

        // Country table rows (so a TAG or an ideology finds the country).
        for (const c of base.countries) {
            docs.push({
                title: c.name, url: c.href, kind: 'country', tag: c.tag,
                context: [c.tag, c.ideology, c.subIdeology].filter(Boolean).join(' · '),
                text: clean([c.tag, c.name, c.ideology, c.subIdeology].join(' '))
            });
        }
        // Pages written in the editor.
        for (const p of pages) {
            docs.push({
                title: p.navLabel && p.category === 'country' ? p.navLabel : p.title,
                url: 'page.html?p=' + encodeURIComponent(p.slug), kind: p.category, tag: p.tag,
                context: clean([p.title, p.subtitle].filter(Boolean).join(' · ')),
                text: clean([p.title, p.subtitle, p.tag, p.ideology, p.subIdeology, p.text].join(' '))
            });
        }
        // Placeholders not written yet.
        for (const [slug, p] of Object.entries(seeds)) {
            if (written.has(slug)) continue;
            docs.push({
                title: p.category === 'country' ? p.navLabel || p.title : p.title,
                url: 'page.html?p=' + encodeURIComponent(slug), kind: 'draft', tag: p.tag,
                context: clean([p.title, p.subtitle].join(' · ')),
                text: clean([p.title, p.subtitle, p.tag, ...p.sections.map((s) => `${s.title} ${s.body}`)].join(' ').replace(/[*#>|`-]/g, ' '))
            });
        }
        docs.push(...statics.flat());

        // One result per URL+title: the country row and its page are merged.
        const byKey = new Map();
        for (const d of docs) {
            const key = d.url + '|' + d.title;
            const prev = byKey.get(key);
            if (prev) {
                prev.text = clean(`${prev.text} ${d.text}`);
                prev.tag = prev.tag || d.tag;
                prev.context = prev.context || d.context;
            } else {
                byKey.set(key, d);
            }
        }
        const unique = [...byKey.values()];
        for (const d of unique) { d.foldTitle = fold(d.title); d.foldText = fold(d.text); }
        return unique;
    })();
    return indexPromise;
}

// ---------------------------------------------------------------- search

function score(d, terms) {
    let s = 0;
    for (const t of terms) {
        const inTitle = d.foldTitle.includes(t);
        const inText = d.foldText.includes(t);
        if (!inTitle && !inText) return 0;
        if (d.tag && fold(d.tag) === t) s += 40;
        if (d.foldTitle === t) s += 30;
        else if (d.foldTitle.startsWith(t)) s += 15;
        else if (inTitle) s += 10;
        if (inText) s += Math.min(5, d.foldText.split(t).length - 1);
    }
    // Real pages before placeholders and generic page entries.
    if (d.kind === 'country' || d.kind === 'ideology') s += 3;
    if (d.kind === 'draft') s -= 2;
    return s;
}

/** Text with the search terms wrapped in <mark>, built from text nodes only (no HTML injection). */
function highlighted(text, terms) {
    const out = [];
    const folded = fold(text);
    let i = 0;
    while (i < text.length) {
        let best = -1, len = 0;
        for (const t of terms) {
            const at = folded.indexOf(t, i);
            if (at !== -1 && (best === -1 || at < best)) { best = at; len = t.length; }
        }
        if (best === -1) { out.push(text.slice(i)); break; }
        if (best > i) out.push(text.slice(i, best));
        out.push(el('mark', { text: text.slice(best, best + len) }));
        i = best + len;
    }
    return out;
}

function snippet(d, terms) {
    const at = Math.max(0, d.foldText.indexOf(terms[0]));
    const start = Math.max(0, at - 70);
    const end = Math.min(d.text.length, at + 150);
    return (start > 0 ? '…' : '') + d.text.slice(start, end) + (end < d.text.length ? '…' : '');
}

let lastQuery = null;
async function run() {
    const q = $('q').value.trim().slice(0, 100);
    if (q === lastQuery) return;
    lastQuery = q;
    const url = q ? `search.html?q=${encodeURIComponent(q)}` : 'search.html';
    history.replaceState(null, '', url);
    document.title = q ? `${q} - Search - Dragon vs Eagle Wiki` : 'Search - Dragon vs Eagle Wiki';

    const terms = [...new Set(fold(q).split(/\s+/).filter((t) => t.length >= 2))];
    const list = $('results');
    if (!terms.length) {
        $('status').textContent = 'Type at least 2 letters: a country, a TAG, an ideology, a focus id, a leader…';
        list.replaceChildren();
        return;
    }
    const docs = await buildIndex();
    if (q !== lastQuery) return; // a newer search started meanwhile
    const results = docs.map((d) => ({ d, s: score(d, terms) })).filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s || a.d.title.localeCompare(b.d.title)).slice(0, 60);

    $('status').textContent = results.length ? `${results.length}${results.length === 60 ? '+' : ''} results for “${q}”` : `No results for “${q}”.`;
    list.replaceChildren(...results.map(({ d }) => el('li', { class: 'result' },
        el('a', { href: d.url, class: 'result-title' }, ...highlighted(d.title, terms)),
        el('span', { class: 'result-kind kind-' + d.kind, text: KIND_LABEL[d.kind] || 'Page' }),
        d.context ? el('div', { class: 'result-context' }, ...highlighted(d.context, terms)) : '',
        el('div', { class: 'result-snippet' }, ...highlighted(snippet(d, terms), terms)))));
}

let timer = null;
$('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
$('search-form').addEventListener('submit', (ev) => { ev.preventDefault(); run(); });
$('q').value = new URLSearchParams(location.search).get('q') || '';
$('q').focus();
buildIndex();
run();
