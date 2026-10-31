# Area Staff — pagine dinamiche, account e sicurezza

Il wiki ha un'**area staff** dove i DEV della mod creano e modificano pagine direttamente dal browser, senza toccare i file HTML. In ogni pagina c'è il pulsante **👤 Login** nella barra in alto: quando sei collegato mostra il tuo account (es. `Editor.Rapha`) e porta all'editor.

Tutto gira **dentro Netlify**, senza servizi esterni:

- il sito resta statico (HTML/CSS/JS);
- un piccolo server (**Netlify Function**, `netlify/functions/api.mjs`) gestisce login, permessi e salvataggi;
- i dati (pagine, account, cronologia, registro) stanno in **Netlify Blobs**, l'archivio dati integrato di Netlify, visibile solo al server.

| Pagina | A cosa serve |
|---|---|
| `login.html` | Accesso con username `Ruolo.Nome` e password |
| `editor.html` | Editor delle pagine (editor, admin, owner) |
| `admin.html` | Account, ruoli, reset password, registro attività (admin, owner) |
| `page.html?p=<indirizzo>` | Pagina pubblica (es. `page.html?p=afg`) |

Le vecchie ~180 pagine placeholder sono in `data/placeholders.json` e vengono mostrate come **bozza** finché un editor non scrive la pagina vera. I vecchi indirizzi (`afg.html`, …) reindirizzano a `page.html?p=…` (`_redirects`).

---

## 1. Account e password temporanee (il "foglio" `data/staff-accounts.json`)

Gli account dello staff sono elencati nel file **`data/staff-accounts.json`**:

| Username | Ruolo |
|---|---|
| `Owner.RedMatteo` | owner |
| `Owner.EC` | owner |
| `Admin.Kylo` | admin |
| `Editor.Rapha` | editor |
| `Editor.Pyro` | editor |
| `Editor.Tazi` | editor |
| `Editor.Defort` | editor |
| `Editor.iowaderussr` | editor |

Per ogni account il file contiene la **password temporanea in forma cifrata** (`"tempPassword": "scrypt$…"`) e un campo `"reset"`. Il repository è **pubblico**, per questo nel file c'è solo la versione cifrata: dalla versione cifrata non si può risalire alla password. La versione leggibile la conosce solo chi l'ha generata.

Ad ogni avvio il sito legge il file:
- un account che non esiste ancora viene **creato** con quella password temporanea;
- un account esistente riceve la password temporanea **una sola volta** per ogni nuovo valore di `"reset"`;
- in entrambi i casi, al primo accesso la persona **deve scegliere la propria password**; prima di farlo l'account non può fare niente.

### Generare nuove password temporanee

Serve [Node.js](https://nodejs.org) 20+ (nella cartella del repository, dopo `npm install`):

```bash
npm run temp-passwords                       # nuove password per tutti gli account del file
npm run temp-passwords -- Editor.Rapha       # solo per alcuni (un nome nuovo viene aggiunto)
```

Il comando aggiorna `data/staff-accounts.json` (solo versioni cifrate) e stampa **una sola volta** le password leggibili: mandale in privato. Poi commit + push: al deploy successivo il sito le applica.

Per le password dimenticate di tutti i giorni non serve: un admin/owner preme **Reset password** nel pannello admin.

### Le password: come funzionano

- **Nessuna password leggibile è scritta nel repository o nel sito.**
- Il server salva solo un'**impronta cifrata** (scrypt) della password: nemmeno chi gestisce il sito può leggerla.
- Ognuno può cambiare la propria password da **👤 Login → Change password**.

---

## 2. Ruoli e account

| Ruolo | Può fare |
|---|---|
| **owner** | Tutto: crea owner, admin ed editor; gestisce admin ed editor |
| **admin** | Crea e gestisce **editor**, resetta le loro password, elimina pagine, legge il registro attività |
| **editor** | Crea e modifica pagine (non può eliminarle, solo toglierle dalla pubblicazione) |
| **disabled** | Account bloccato: non può accedere |

- Gli username hanno sempre la forma `Ruolo.Nome`. Cambiando ruolo dal pannello, il login viene **rinominato** (es. `Editor.Pyro` → `Admin.Pyro`).
- Un **owner esistente non può essere modificato dal sito** (nemmeno da un altro owner).
- Nel pannello admin: **Add a staff account** per una persona, **Create several staff accounts** per più persone (una per riga). La password temporanea viene mostrata **una sola volta**.

### Recupero d'emergenza (pagina `recover.html`)

Se un owner perde la password e non puoi usare `npm run temp-passwords`:

1. Netlify → **Environment variables → Add a variable**: chiave `DVE_RECOVERY_CODE`, valore un codice segreto inventato da te (almeno 16 caratteri). Salva.
2. Rifai il deploy (Netlify → **Deploys → Trigger deploy**, oppure **Retry deploy** sulla deploy preview), così il server legge la variabile.
3. Apri `recover.html` sul sito, scrivi il codice e l'username (es. `Owner.RedMatteo`): ricevi una nuova password temporanea.
4. Entra; per gli altri account usa **Reset password** nel pannello admin (per un altro owner, es. `Owner.EC`, usa di nuovo `recover.html`).
5. **Cancella** la variabile `DVE_RECOVERY_CODE` e rifai il deploy: la pagina smette di funzionare.

Dopo 5 codici sbagliati la pagina si blocca per 15 minuti per quell'indirizzo IP.

---

## 3. Sistema di sicurezza

- **Controlli lato server**: ogni permesso è verificato dal server; manomettere il JavaScript nel browser non serve a niente.
- **Password** cifrate con scrypt (salt casuale), confronti a tempo costante.
- **Password temporanee obbligatoriamente da cambiare** al primo accesso e dopo ogni reset.
- **Sessione** in un cookie firmato (HMAC), `HttpOnly` (il JavaScript non può leggerlo), `Secure`, `SameSite=Strict`; scade dopo **60 minuti di inattività** e comunque dopo 12 ore. Cambio password, reset, cambio ruolo o blocco **chiudono tutte le sessioni** di quell'account.
- **Blocco brute-force**: dopo 5 password sbagliate l'account è bloccato per 15 minuti; massimo 30 tentativi ogni 15 minuti per indirizzo IP.
- **Protezione CSRF**: le modifiche richiedono un'intestazione speciale e la stessa origine.
- **Gerarchia dei ruoli**: nessuno può modificare sé stesso; gli admin non toccano admin né owner; nessuno modifica un owner dal sito.
- **Validazione dei dati** lato server (indirizzi, lunghezze, colori, numero di sezioni).
- **Protezione XSS**: il testo delle pagine (Markdown) è ripulito con DOMPurify; Content Security Policy sulle pagine dinamiche.
- **Header di sicurezza** Netlify (`netlify.toml`): anti-clickjacking, HSTS, nosniff; le pagine staff non vengono mai salvate in cache né indicizzate.
- **Cronologia completa** di ogni pagina (pulsante *History*) e **rilevamento conflitti** se due persone salvano insieme.
- **Registro attività** di ogni modifica di pagine e account, non modificabile dal sito.

---

### Se compare "Server error"

- Il messaggio ha un codice, per esempio `Server error (ref 3fa9c1)`. Su Netlify apri **Cloud compute → Functions → api → Function log** e cerca quel codice: accanto c'è l'errore completo.
- `https://dve-wiki.netlify.app/api/health` dice se il database funziona: `{"ok":true}` va bene; `{"ok":false,"problem":"…"}` indica il tipo di problema (senza dettagli riservati).

---

## 4. Guida rapida per i DEV (editor)

1. Premi **👤 Login** in alto, accedi con il tuo `Editor.Nome` → **Open page editor**.
2. A sinistra: *published* (pubblica), *draft* (bozza, solo staff), *placeholder* (vecchia pagina non ancora creata — aprila e premi **Save**).
3. **+ New page** per una pagina nuova: nazione, percorso politico, guida o altro. L'indirizzo (`slug`) non si può cambiare dopo il primo salvataggio.
4. Pagine con lo stesso **Group** (es. `ita`) sono collegate nella barra di navigazione, in ordine di **Nav order**.
5. Ogni **sezione** è una card (intera, metà o un terzo). Testo in **Markdown** (aiuto in fondo all'editor), con modelli pronti per spiriti nazionali, focus, partiti e leader.
6. Le immagini vanno caricate nel repository (`images/leaders/…`, `images/ideologies/…`) e richiamate con `![nome](images/leaders/file.png)`.
7. Spunta **Published** per renderla visibile a tutti. **Ctrl+S** salva.
8. **Home page automatica**: una pagina *Country* pubblicata compare nella tabella delle nazioni della home (nome = *Label in navigation*, poi TAG, *Starting ideology*, *Sub-ideology* e il colore dell'ideologia, campi che compaiono quando la categoria è *Country*). Se la nazione esiste già nella tabella, la sua riga viene aggiornata. Le pagine *Country path* compaiono nel riquadro della loro nazione (stesso *Group*, es. `ita`), oppure in un riquadro nuovo. Guide e altre pagine finiscono in *More Wiki Pages*.
9. **Ricerca**: `search.html` (🔍 in ogni pagina) cerca tra nazioni, TAG, ideologie, pagine scritte nell'editor, bozze e pagine statiche (ideologie, guida eventi, Italia, Finlandia). Le bozze non pubblicate non compaiono.

---

## 5. Allineamento con la mod

Nazioni, TAG, ideologie, sotto-ideologie, leader, nomi in gioco, icone e illustrazioni del wiki vengono **dalla mod stessa** (repository [ECModder/2025-Dragon-Vs.-Eagle](https://github.com/ECModder/2025-Dragon-Vs.-Eagle)). Quando la mod cambia, si riallinea il wiki così (serve Node.js 20+ e Python 3 con Pillow):

```bash
git clone --depth 1 https://github.com/ECModder/2025-Dragon-Vs.-Eagle ../2025-Dragon-Vs.-Eagle   # la prima volta
git -C ../2025-Dragon-Vs.-Eagle pull                                                              # le volte successive
python3 tools/convert-mod-icons.py ../2025-Dragon-Vs.-Eagle   # icone e illustrazioni nuove
npm run sync-mod -- ../2025-Dragon-Vs.-Eagle                  # dati
```

Poi commit + push. Cosa viene aggiornato:

| File | Contenuto |
|---|---|
| `data/countries.json` | Le nazioni presenti sulla mappa del 2025 (chi possiede almeno uno stato), con TAG HOI4, nome in gioco, ideologia e sotto-ideologia di partenza, leader |
| `data/ideologies.json` | Le 14 ideologie e le sotto-ideologie con colori, descrizioni, icone e illustrazioni → pagina `ideologies.html` |
| `data/placeholders.json` | Le bozze delle nazioni (informazioni, partiti e popolarità del 2025, leader disponibili). Le pagine già scritte nell'editor **non vengono toccate** |
| `data/mod-report.json` | Problemi trovati nei dati della mod (vedi sotto) |
| `images/ideologies/` | Icone mancanti e illustrazioni (`art/`) convertite dai file `.dds` / `.jpg` della mod |

Come vengono letti i dati: per ogni nazione si applica il file `history/countries` come fa il gioco (prima la parte senza data, poi i blocchi datati fino alla data del bookmark 2025); il leader è l'**ultimo** definito per il partito al governo; i nomi vengono dalla localisation inglese della mod.

### Guerra civile italiana

Le 7 pagine sulla guerra civile italiana (`ita_civil_war` e `ita_cw_ita`, `ita_cw_int`, `ita_cw_sri`, `ita_cw_rsi`, `ita_cw_lom`, `ita_cw_tyr`: ITA, INT, SRI, RSI, LOM, TYR) si generano dalla mod con:

```bash
npm run sync-italy -- ../2025-Dragon-Vs.-Eagle
```

Il comando legge lo script della guerra civile (`DVE_ITA_civil_war_effects.txt`: spartizione dei 35 stati, eserciti, guerre dichiarate), la storia, la localisation, gli eventi e gli alberi dei focus di ogni fazione, e riscrive quelle pagine in `data/placeholders.json` (le altre pagine del file non vengono toccate). Le pagine restano "generate dalla mod" finché un editor non ne salva una versione dall'editor web; la versione dell'editor sostituisce allora quella generata. Esegui prima `npm run sync-mod` se sono cambiati nazioni o ideologie.

`data/mod-report.json` elenca le incoerenze della mod utili ai DEV: nazioni senza un leader per il partito al governo (in gioco ne viene generato uno a caso), partito al governo con popolarità 0%, nazioni senza `set_politics`.

## 6. Sviluppo in locale

Serve [Node.js](https://nodejs.org) 20 o più recente. Nessun account Netlify necessario:

```bash
npm install
npm run dev      # sito + server su http://localhost:8888, dati in .dev-data/
npm test         # test automatici del server e della sicurezza
```

In locale valgono le stesse password temporanee del file. Per ricominciare da zero cancella la cartella `.dev-data/`.

## 7. File principali

| File | Contenuto |
|---|---|
| `netlify/functions/api.mjs` | Server: login, pagine, account, registro |
| `netlify/lib/core.mjs` | Archivio dati, password, sessioni, ruoli, validazione |
| `data/staff-accounts.json` | Account dello staff e password temporanee (cifrate) |
| `tools/temp-passwords.mjs` | Genera nuove password temporanee per il file |
| `js/wiki.js` | Modulo comune del browser: chiamate al server, rendering Markdown sicuro |
| `js/page.js`, `js/editor.js`, `js/admin.js`, `js/login.js`, `js/recover.js` | Pagine dinamiche, area staff e recupero |
| `js/home.js`, `data/countries.json` | Home dinamica: nazioni principali e tabella dei paesi (dati della mod + pagine dell'editor) |
| `ideologies.html`, `js/ideologies.js`, `data/ideologies.json` | Pagina delle ideologie (dati della mod) |
| `tools/sync-from-mod.mjs`, `tools/sync-italy.mjs`, `tools/hoi4-parser.mjs`, `tools/convert-mod-icons.py` | Allineamento con la mod (nazioni, ideologie, guerra civile italiana) |
| `search.html`, `js/search.js` | Ricerca nel wiki |
| `js/nav-account.js` | Pulsante Login nelle pagine statiche |
| `netlify.toml`, `_redirects`, `404.html` | Configurazione Netlify, header di sicurezza, redirect, pagina 404 |
| `tools/dev-server.mjs` | Server di sviluppo locale |
| `tests/api.test.mjs` | Test automatici |
| `data/placeholders.json` | Contenuto delle vecchie pagine placeholder |
| `js/vendor/` | `marked` (Markdown) e `DOMPurify` (sanificazione) |
