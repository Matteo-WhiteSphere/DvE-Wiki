# Changelog

## 2026-10-11

* [Home / Countries](https://dve-wiki.netlify.app/index.html) — the country table is now built from the mod: 220 countries on the 2025 map with HOI4 tags, in-game names, starting ideology, sub-ideology and the new **Leader** column; filter by name/TAG/leader and by ideology; search box; pages created in the editor appear automatically (new countries, new paths in the major nation cards, guides under "More Wiki Pages").
* [Ideologies List](https://dve-wiki.netlify.app/ideologies.html) — rebuilt from the mod: 14 ideologies (new **Liberal**) and 108 sub-ideologies with the mod's colours, descriptions, icons and illustrations, plus the countries that start with each one.
* [Search](https://dve-wiki.netlify.app/search.html) — new: searches countries, TAGs, leaders, ideologies, wiki pages and guides; available from 🔍 in every page.
* [Country pages](https://dve-wiki.netlify.app/page.html?p=afg) — the ~180 placeholder pages are now dynamic pages (`page.html?p=…`) with the mod's data: country information, parties and popularity in 2025, available leaders. Old addresses such as [afg.html](https://dve-wiki.netlify.app/afg.html) still work (redirect).
* [Major nation paths](https://dve-wiki.netlify.app/page.html?p=usa_democratic) — path pages of USA, China, Russia, UK, France, Germany and Italy are dynamic pages, linked together in the navigation bar.
* [Login](https://dve-wiki.netlify.app/login.html) — new staff login with `Role.Name` usernames (e.g. `Editor.Rapha`), mandatory password change at the first login, 👤 Login button in the navigation of every page.
* [Page Editor](https://dve-wiki.netlify.app/editor.html) — new: create and edit wiki pages from the browser (Markdown sections, live preview, table templates, drafts/published, revision history, conflict warning between editors).
* [Admin Panel](https://dve-wiki.netlify.app/admin.html) — new: create staff accounts (single or several at once), change roles (owner / admin / editor / disabled), reset passwords, activity log.
* [Account Recovery](https://dve-wiki.netlify.app/recover.html) — new: emergency password reset for owners, enabled only with a secret code set in Netlify.
* [Page not found](https://dve-wiki.netlify.app/404.html) — new 404 page in the wiki style.
* [Events Guide](https://dve-wiki.netlify.app/events_guide.html), [Finland](https://dve-wiki.netlify.app/fin.html), [Italy – Democratic](https://dve-wiki.netlify.app/ita_democratic.html), [Italy – Communist](https://dve-wiki.netlify.app/ita_communist.html), [Italy – Fascist](https://dve-wiki.netlify.app/ita_fascist.html) — added 🔍 Search and 👤 Login to the navigation bar.
* [Wiki server](https://github.com/Matteo-WhiteSphere/DvE-Wiki/tree/main/netlify) — new server on Netlify (pages, accounts, history, activity log), with security: encrypted passwords, signed session cookie with 60-minute idle logout, lockout after 5 wrong passwords, role hierarchy, sanitized page content, security headers.
* [Mod sync tools](https://github.com/Matteo-WhiteSphere/DvE-Wiki/tree/main/tools) — `npm run sync-mod` and `tools/convert-mod-icons.py` re-align countries, ideologies, icons and illustrations with the [mod repository](https://github.com/ECModder/2025-Dragon-Vs.-Eagle); data problems found in the mod are listed in [mod-report.json](https://github.com/Matteo-WhiteSphere/DvE-Wiki/blob/main/data/mod-report.json).
* [Staff guide](https://github.com/Matteo-WhiteSphere/DvE-Wiki/blob/main/STAFF_SETUP.md) — new guide (Italian) for accounts, editor, security and mod sync.
