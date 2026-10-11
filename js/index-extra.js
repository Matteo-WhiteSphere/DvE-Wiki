// Home page: lists the published pages created from the web editor
// (new countries, guides, …) that are not already linked in the tables above.
import { api, loadSeeds, el, COLOR_RE } from './wiki.js';

const CATEGORY_TITLES = {
    country: 'Countries',
    path: 'Country Paths',
    guide: 'Guides',
    other: 'Other Pages'
};

async function run() {
    const box = document.getElementById('extra-pages');
    if (!box) return;
    const [seeds, { pages }] = await Promise.all([loadSeeds(), api('pages')]);
    const groups = {};
    for (const p of pages) {
        if (seeds[p.slug] || !p.published) continue; // already linked from the country tables
        (groups[p.category] = groups[p.category] || []).push(p);
    }
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
