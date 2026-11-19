// Ideologies page, built from data/ideologies.json (generated from the mod by tools/sync-from-mod.mjs).
import { el, COLOR_RE, readableOnDark } from './wiki.js';

const $ = (id) => document.getElementById(id);
const img = (src, cls, alt) => (src ? el('img', { src, class: cls, alt, loading: 'lazy' }) : '');

function countryLinks(list) {
    if (!list.length) return el('span', { class: 'muted', text: '—' });
    return el('div', { class: 'sub-countries' }, ...list.map((c) => el('a', { href: c.href, title: c.tag, text: c.name })));
}

function section(i) {
    const color = COLOR_RE.test(i.color) ? i.color : '#00f3ff';
    const rows = i.types.map((t) => el('tr', { id: t.key, class: 'sub-row' },
        el('td', { class: 'col-icon' }, img(t.icon, 'sub-icon', t.name)),
        el('td', {}, el('span', { class: 'sub-name', text: t.name }), el('code', { class: 'sub-key', text: t.key })),
        el('td', { class: 'td-art' }, img(t.art, 'sub-art', '')),
        el('td', { class: 'sub-desc', text: t.description || '—' }),
        el('td', {}, countryLinks(t.countries))));
    return el('section', { class: 'ideo-section', id: i.key, style: `--ideo: ${color}; --ideo-text: ${readableOnDark(color)}` },
        el('div', { class: 'ideo-head' },
            img(i.icon, '', i.name),
            el('div', {},
                el('h2', { text: i.name }),
                el('div', { class: 'meta', text: `${i.types.length} sub-ideologies · ${i.countries.length} countries at the 2025 start` }),
                i.description ? el('p', { class: 'sub-desc', text: i.description }) : '')),
        el('div', { class: 'table-wrap' }, el('table', { class: 'wiki-table' },
            el('thead', {}, el('tr', {},
                el('th', { class: 'col-icon', text: 'Icon' }),
                el('th', { class: 'col-name', text: 'Sub-ideology' }),
                el('th', { class: 'col-art td-art', text: 'Illustration' }),
                el('th', { text: 'Description' }),
                el('th', { class: 'col-countries', text: 'Starts as (2025)' }))),
            el('tbody', {}, ...rows))));
}

const res = await fetch('data/ideologies.json', { cache: 'no-cache' });
const { ideologies } = await res.json();
$('ideo-summary').textContent = `${ideologies.length} ideologies and ${ideologies.reduce((n, i) => n + i.types.length, 0)} sub-ideologies, taken from the mod files.`;
$('ideo-index').replaceChildren(...ideologies.map((i) => el('a', { href: '#' + i.key, style: `--ideo: ${COLOR_RE.test(i.color) ? i.color : '#00f3ff'}` },
    img(i.icon, '', ''), i.name)));
$('ideologies').replaceChildren(...ideologies.map(section));
// Jump to the anchor once the content exists (links from the search, e.g. ideologies.html#maoism).
if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
