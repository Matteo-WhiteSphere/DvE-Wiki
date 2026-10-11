// Home page: lists the published pages created from the web editor
// (new countries, guides, …) that are not already linked in the tables above.
import { db, isConfigured, loadSeeds, el, COLOR_RE } from './wiki.js';
import {
    collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CATEGORY_TITLES = {
    country: 'Countries',
    path: 'Country Paths',
    guide: 'Guides',
    other: 'Other Pages'
};

async function run() {
    const box = document.getElementById('extra-pages');
    if (!box || !isConfigured) return;
    const [seeds, snap] = await Promise.all([
        loadSeeds(),
        getDocs(query(collection(db, 'pages'), where('published', '==', true)))
    ]);
    const groups = {};
    snap.forEach((d) => {
        if (seeds[d.id]) return; // already linked from the country tables
        const p = d.data();
        (groups[p.category] = groups[p.category] || []).push({ slug: d.id, ...p });
    });
    const cats = Object.keys(CATEGORY_TITLES).filter((c) => groups[c]);
    if (!cats.length) return;

    const grid = el('div', { class: 'grid' });
    for (const c of cats) {
        const pages = groups[c].sort((a, b) => a.title.localeCompare(b.title));
        grid.append(el('div', { class: 'card' },
            el('h3', { text: CATEGORY_TITLES[c] }),
            el('ul', {}, ...pages.map((p) => el('li', {},
                el('a', {
                    href: 'page.html?p=' + encodeURIComponent(p.slug),
                    style: COLOR_RE.test(p.accent) ? `color: ${p.accent}` : null,
                    text: p.title
                }))))));
    }
    box.append(el('h2', { style: 'margin-top: 40px;', text: 'More Wiki Pages' }), grid);
}

run().catch((e) => console.warn('Extra pages unavailable', e));
