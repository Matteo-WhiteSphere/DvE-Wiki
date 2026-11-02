// Dynamic home page: major nations and the country table are built from
// data/countries.json plus the pages published from the web editor.
import { api, loadCountries, el, COLOR_RE, fold, textColorOn, readableOnDark } from './wiki.js';

const $ = (id) => document.getElementById(id);
const pageHref = (slug) => 'page.html?p=' + encodeURIComponent(slug);
const color = (c, fallback) => (COLOR_RE.test(c || '') ? c : fallback);

const EXTRA_TITLES = { guide: 'Guides', other: 'Other Pages' };

async function publishedPages() {
    try {
        return (await api('pages')).pages.filter((p) => p.published);
    } catch {
        return []; // server unavailable: show the base data only
    }
}

/** Base data + editor pages → { majors, countries, extras }. */
function merge(base, pages) {
    const majors = base.majors.map((m) => ({ ...m, paths: m.paths.map((p) => ({ ...p })) }));
    const countries = base.countries.map((c) => ({ ...c }));

    // Country pages update their row (matched by link, then TAG) or add a new one.
    for (const p of pages.filter((x) => x.category === 'country')) {
        const href = pageHref(p.slug);
        let row = countries.find((c) => c.href === href) || (p.tag && countries.find((c) => c.tag === p.tag && !c.major));
        if (!row) {
            row = { tag: p.tag || '', name: '', short: '', ideology: '', ideologyColor: '', subIdeology: '', leader: '', href };
            countries.push(row);
        }
        row.href = row.major ? row.href : href;
        row.short = p.navLabel || row.short || p.title;
        row.name = row.name || p.navLabel || p.title;
        if (p.tag) row.tag = p.tag;
        if (p.ideology) row.ideology = p.ideology;
        if (p.subIdeology) row.subIdeology = p.subIdeology;
        if (p.ideologyColor) { row.ideologyColor = p.ideologyColor; row.ideologyText = textColorOn(p.ideologyColor); }
        if (!row.ideologyColor) row.ideologyColor = p.accent;
    }

    // Path pages join the card of their group, or start a new card.
    const paths = pages.filter((x) => x.category === 'path' && x.group).sort((a, b) => a.navOrder - b.navOrder);
    for (const p of paths) {
        let major = majors.find((m) => m.group === p.group);
        if (!major) {
            const country = pages.find((x) => x.category === 'country' && x.group === p.group);
            major = {
                tag: p.tag || p.group.toUpperCase(), group: p.group,
                name: (country && (country.navLabel || country.title)) || p.title,
                color: p.accent, paths: [], added: true
            };
            majors.push(major);
        }
        if (!major.paths.some((x) => x.href === pageHref(p.slug))) {
            major.paths.push({ label: p.navLabel || p.subtitle || p.title, href: pageHref(p.slug) });
        }
    }

    // Majors first (in their order), then every other country by name.
    const ordered = [
        ...countries.filter((c) => c.major),
        ...countries.filter((c) => !c.major).sort((a, b) => (a.short || a.name).localeCompare(b.short || b.name))
    ];
    const extras = pages.filter((x) => EXTRA_TITLES[x.category]);
    return { majors, countries: ordered, extras };
}

// ----------------------------------------------------------------- render

function renderMajors(majors) {
    $('home-majors').replaceChildren(...majors.map((m) => {
        const c = readableOnDark(color(m.color, '#00f3ff'));
        return el('div', { class: 'card', style: `--accent-color: ${c}` },
            el('h3', { text: `${m.name} (${m.tag})` }),
            el('p', { text: 'Select political path wiki page:' }),
            el('ul', {}, ...m.paths.map((p) => el('li', {}, el('a', { href: p.href, style: `color: ${c}`, text: p.label })))));
    }));
}

function countryRow(c) {
    const bg = color(c.ideologyColor, '#2d3748');
    const short = c.short || c.name;
    return el('tr', { 'data-search': fold([c.tag, c.name, c.short, c.alias, c.ideology, c.subIdeology, c.leader].join(' ')), 'data-ideology': c.ideology || '' },
        el('td', {}, c.major ? el('strong', { text: c.tag }) : c.tag),
        el('td', {}, el('div', { class: 'country-name', text: short }),
            c.name && c.name !== short ? el('div', { class: 'country-official', text: c.name }) : ''),
        el('td', {}, c.ideology
            ? el('span', { class: 'ideology-badge', style: `background-color: ${bg}; color: ${color(c.ideologyText, textColorOn(bg))};`, text: c.ideology })
            : '—'),
        el('td', { text: c.subIdeology || '—' }),
        el('td', { text: c.leader || '—' }),
        el('td', {}, el('a', { href: c.href, text: c.major ? 'View Paths' : 'View Wiki' })));
}

function renderCountries(countries) {
    $('home-countries').replaceChildren(...countries.map(countryRow));
    const ideologies = [...new Set(countries.map((c) => c.ideology).filter(Boolean))].sort();
    const select = $('ideology-filter');
    const current = select.value;
    select.replaceChildren(el('option', { value: '', text: 'All ideologies' }), ...ideologies.map((i) => el('option', { value: i, text: i })));
    if (ideologies.includes(current)) select.value = current;
    applyFilter();
}

function applyFilter() {
    const terms = fold($('country-filter').value).split(/\s+/).filter(Boolean);
    const ideology = $('ideology-filter').value;
    let shown = 0;
    const rows = $('home-countries').children;
    for (const row of rows) {
        const ok = terms.every((t) => row.dataset.search.includes(t)) && (!ideology || row.dataset.ideology === ideology);
        row.hidden = !ok;
        if (ok) shown++;
    }
    $('country-count').textContent = shown === rows.length ? `${rows.length} countries` : `${shown} of ${rows.length} countries`;
}

function renderExtras(extras) {
    const box = $('extra-pages');
    box.replaceChildren();
    const cats = Object.keys(EXTRA_TITLES).filter((c) => extras.some((p) => p.category === c));
    if (!cats.length) return;
    box.append(
        el('h2', { style: 'margin-top: 40px;', text: 'More Wiki Pages' }),
        el('div', { class: 'grid' }, ...cats.map((c) => el('div', { class: 'card' },
            el('h3', { text: EXTRA_TITLES[c] }),
            el('ul', {}, ...extras.filter((p) => p.category === c).sort((a, b) => a.title.localeCompare(b.title))
                .map((p) => el('li', {}, el('a', { href: pageHref(p.slug), style: `color: ${color(p.accent, '#00f3ff')}`, text: p.title }))))))));
}

// ------------------------------------------------------------------- start

$('country-filter').addEventListener('input', applyFilter);
$('ideology-filter').addEventListener('change', applyFilter);

const base = await loadCountries();
if (base.source) {
    $('mod-source').textContent = `Countries, tags, ideologies and leaders at the 2025 start, taken from the mod files` +
        (base.source.generated ? ` (updated ${new Date(base.source.generated).toLocaleDateString()})` : '') + '.';
}
let data = merge(base, []);
renderMajors(data.majors);
renderCountries(data.countries);

const pages = await publishedPages();
if (pages.length) {
    data = merge(base, pages);
    renderMajors(data.majors);
    renderCountries(data.countries);
    renderExtras(data.extras);
}
