# Changelog

## 2026-10-31

* [Ideologies List](https://dve-wiki.netlify.app/ideologies.html#bibism) — 13 new sub-ideologies from the mod, with icon, illustration and description: Communism, Marxism and Scientific Socialism (Vanguard Socialist); Eurocommunism (Reformist Socialist); Neo-Liberalism, Liberal Zionism and Techno-Zionism (Centrist); Zionist Conservatism and National Liberal Zionism (Conservative); Zionist Stratocracy (Autocratic); Monarcho-Zionism (Absolutist); Bibism and Religious Zionism (Fundamentalist). Now 121 sub-ideologies.
* [Ideologies List](https://dve-wiki.netlify.app/ideologies.html#marxism) — fixes: [Workerism](https://dve-wiki.netlify.app/ideologies.html#Workerism), [Deutsche Communism](https://dve-wiki.netlify.app/ideologies.html#Deutsche_Communism), Pol Pot Thought and Kahanism now show their illustration (the file name is lower case in the mod); Marxism now has the standard illustration (its icon on the red background) instead of the full-size portrait of Marx and Engels.
* [Italian Civil War](https://dve-wiki.netlify.app/page.html?p=ita_civil_war) — new: overview of the six-faction civil war (partition of the 35 states, armies at the outbreak, who fights whom, events), from the current mod files.
* [Italy (ITA)](https://dve-wiki.netlify.app/page.html?p=ita_cw_ita) — new: the Armed Forces Joint Command government, its 18 states, parties, leaders and the 55-focus Italian focus tree.
* [The Internationale (INT)](https://dve-wiki.netlify.app/page.html?p=ita_cw_int) — new: the revolutionary left, with its civil war focus tree and the 157-focus post-war tree (economy, politics, foreign policy, military).
* [Socialist Republic of Italy (SRI)](https://dve-wiki.netlify.app/page.html?p=ita_cw_sri) — new: the Stalinist front, with its 100-focus tree.
* [Italian Social Republic (RSI)](https://dve-wiki.netlify.app/page.html?p=ita_cw_rsi) — new: the fascist front and its 22-focus tree.
* [Padania (LOM)](https://dve-wiki.netlify.app/page.html?p=ita_cw_lom) — new: the northern separatists with their 87-focus tree and six ideological paths.
* [South Tyrol (TYR)](https://dve-wiki.netlify.app/page.html?p=ita_cw_tyr) — new: the Tyrolean separatists (no focus tree yet).
* [Home / Countries](https://dve-wiki.netlify.app/index.html) — new "Italian Civil War" card linking the seven pages.
* [Ideologies List](https://dve-wiki.netlify.app/ideologies.html#left_communism) — new icon for Left Communism (the old one was the pre-1991 style).
* [Italy – Democratic](https://dve-wiki.netlify.app/ita_democratic.html), [Italy – Communist](https://dve-wiki.netlify.app/ita_communist.html), [Italy – Fascist](https://dve-wiki.netlify.app/ita_fascist.html) — added a "Civil War" link to the navigation bar.
* [Search](https://dve-wiki.netlify.app/search.html) — the civil war pages are searchable (e.g. "Guardia Padana", "Schützen", "Ilva").
* [Login](https://dve-wiki.netlify.app/login.html) — fix: "Server error" after the first request (the server kept a database connection that Netlify refuses on the next request). Errors now show a reference code, and [/api/health](https://dve-wiki.netlify.app/api/health) reports whether the database works.
* [Mod sync tools](https://github.com/Matteo-WhiteSphere/DvE-Wiki/tree/main/tools) — new `npm run sync-italy` regenerates the civil war pages from the mod.

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
