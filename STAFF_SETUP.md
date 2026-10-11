# Area Staff — pagine dinamiche, account e sicurezza

Il wiki ha un'**area staff** dove i DEV della mod creano e modificano pagine direttamente dal browser, senza toccare i file HTML. In ogni pagina c'è il pulsante **👤 Login** nella barra di navigazione: quando sei collegato mostra il tuo account (es. `Editor.Rapha`) e porta all'editor.

| Pagina | A cosa serve |
|---|---|
| `login.html` | Accesso con **username staff** (`Ruolo.Nome`), **Google** o **e-mail + password** |
| `editor.html` | Editor delle pagine (editor, admin, owner) |
| `admin.html` | Account, ruoli, inviti e registro attività (admin, owner) |
| `page.html?p=<indirizzo>` | Pagina pubblica generata dal database (es. `page.html?p=afg`) |

Le vecchie ~180 pagine placeholder (`afg.html`, `usa_fascist.html`, …) sono state rimosse: il loro contenuto è in `data/placeholders.json` e viene mostrato come **bozza** finché un editor non scrive la pagina vera. I link della home puntano già a `page.html?p=…`.

Il sito resta statico ed è pubblicato su **Netlify** (configurazione in `netlify.toml` e `_redirects`). Login e database sono forniti da **Firebase** (piano gratuito *Spark*).

---

## 1. Configurazione di Firebase (una volta sola, ~10 minuti)

1. Vai su <https://console.firebase.google.com> → **Aggiungi progetto** (Google Analytics non serve).
2. **Impostazioni progetto → Generali → Le tue app → Web (`</>`)**: registra un'app web e copia i valori di `firebaseConfig` dentro `js/firebase-config.js` (al posto dei valori `YOUR_…`). Questi valori **non sono segreti**: la protezione è data dalle regole del database.
3. **Authentication → Inizia → Sign-in method**: abilita **Email/Password** e **Google**.
4. **Authentication → Impostazioni → Domini autorizzati**: aggiungi i domini Netlify del wiki: `dve-wiki.netlify.app` e, per provare le anteprime, `deploy-preview-1--dve-wiki.netlify.app` (Firebase non accetta asterischi: ogni anteprima va aggiunta a mano; se colleghi un dominio personalizzato aggiungi anche quello).
5. **Authentication → Impostazioni → Criteri password**: attivalo (minimo 10 caratteri, maiuscole, minuscole, numeri). Lascia attiva la **protezione dall'enumerazione delle e-mail**.
6. **Firestore Database → Crea database** in *modalità produzione* (regione consigliata: `europe-west`).
7. **Firestore → Regole**: incolla il contenuto di `firestore.rules` e premi **Pubblica**.
   In alternativa con la CLI: `npx firebase-tools login` e poi `npx firebase-tools deploy --only firestore:rules --project <id-progetto>`.
8. Fai commit + push di `js/firebase-config.js`.

## 2. Creare gli account dello staff (un comando)

Gli account sono già elencati in `tools/staff-accounts.json`:

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

Per crearli serve [Node.js](https://nodejs.org) (versione 18 o più recente):

1. Firebase console → **Impostazioni progetto → Account di servizio → Genera nuova chiave privata**. Salva il file JSON **fuori dal repository** (es. sul Desktop). È una chiave segreta: non condividerla e non fare mai commit (il `.gitignore` la blocca comunque).
2. Dal terminale, nella cartella del repo:

   ```bash
   cd tools
   npm install
   node accounts.mjs create --key ~/Desktop/<nome-file-chiave>.json
   ```

3. Lo script stampa **una sola volta** la tabella con username e **password temporanea** di ciascuno. Mandala in privato a ogni persona. Al primo accesso il sito obbliga a scegliere una password personale: finché non lo fanno, l'account non può modificare niente.

Rilanciare `create` è sicuro: gli account già esistenti vengono saltati. Per aggiungere qualcuno in futuro basta aggiungerlo al file e rilanciare, oppure crearlo dal pannello admin.

Altri comandi utili:

```bash
node accounts.mjs list  --key <chiave>                    # elenco account e ruoli
node accounts.mjs reset Editor.Rapha --key <chiave>       # password dimenticata → nuova password temporanea
node accounts.mjs role Editor.Pyro admin --key <chiave>   # cambia ruolo; il login diventa Admin.Pyro
node accounts.mjs role Editor.Tazi disabled --key <chiave> # blocca l'account (anche il login)
```

---

### Le password: come funzionano

- **Nessuna password è scritta nel repository o nel sito.** Il repository è pubblico: qualsiasi password messa lì sarebbe visibile a tutti.
- Le password **temporanee** vengono generate a caso dallo script nel momento in cui crei gli account, e stampate **solo nel tuo terminale**, una volta.
- Tu le mandi in privato (es. messaggio su Discord) a ciascuno.
- Al primo accesso ognuno **sceglie la propria password** (minimo 10 caratteri, maiuscole, minuscole e numeri). Da quel momento nemmeno tu la conosci: Firebase salva solo una versione cifrata.
- Password dimenticata: un owner esegue `node accounts.mjs reset Editor.Nome` e manda la nuova password temporanea.
- Ognuno può cambiare la propria password quando vuole da **👤 Login → Change password**.

## 3. Ruoli e account

| Ruolo | Può fare |
|---|---|
| **owner** | Tutto, compreso creare/rimuovere **amministratori** |
| **admin** | Creare e gestire **editor**, eliminare pagine, leggere il registro attività |
| **editor** | Creare e modificare pagine (non può eliminarle, solo toglierle dalla pubblicazione) |
| **user** | Account normale: può accedere ma non modificare |
| **disabled** | Account bloccato |

Il ruolo `owner` si assegna **solo** dalla console Firebase o con `tools/accounts.mjs`, mai dal sito.

### Tipi di account

- **Username staff `Ruolo.Nome`** (es. `Editor.Rapha`): si accede scrivendo l'username e la password. Non hanno un'e-mail; se si dimentica la password, un owner esegue `node accounts.mjs reset Ruolo.Nome`. Nel login l'username non distingue maiuscole/minuscole.
- **Google**: chiunque può accedere con Google e diventa **user** (solo lettura). Un admin può poi dargli il ruolo editor dalla tabella *Users*, oppure invitarne l'indirizzo in anticipo.
- **E-mail + password**: creato da un admin; la persona riceve un'e-mail per scegliere la password.

Dal pannello `admin.html` → **Add a staff account** un admin crea nuovi username staff (la password temporanea viene mostrata una sola volta) o invita indirizzi Google / e-mail. Gli admin possono creare solo **editor**; gli owner anche **admin**. Cambiare ruolo dal pannello non rinomina il login: per avere anche l'username giusto usa `node accounts.mjs role …`.

---

## 4. Sistema di sicurezza

- **Regole Firestore lato server** (`firestore.rules`): ogni scrittura è verificata da Google, non dal browser. Anche manomettendo il JavaScript non si superano i permessi.
- **Gerarchia dei ruoli**: nessuno può cambiare il proprio ruolo; gli admin non possono toccare altri admin né gli owner; gli owner non si creano dal sito.
- **Password temporanee obbligatoriamente da cambiare** al primo accesso; prima di allora l'account non ha permessi.
- **Username staff su un dominio riservato** (`.invalid`, che non può ricevere e-mail): nessuno può farsi mandare il reset della password di un account staff, e gli username staff non possono essere "rubati" tramite inviti.
- **E-mail verificata obbligatoria** per gli account Google / e-mail.
- **Protezione XSS**: il testo delle pagine (Markdown) è ripulito con DOMPurify: script, iframe, form, `javascript:` e CSS pericolosi vengono rimossi.
- **Content Security Policy** sulle pagine dinamiche e dell'area staff.
- **Cronologia completa** di ogni pagina (pulsante *History*), che resta anche dopo l'eliminazione.
- **Registro attività** non modificabile: ogni modifica di pagine, account, ruoli e inviti è registrata con autore e ora.
- **Rilevamento conflitti** se due persone salvano la stessa pagina insieme.
- **Logout automatico** dopo 60 minuti di inattività (modificabile in `js/firebase-config.js`).
- **Protezione brute-force** sul login (gestita da Firebase).

Consigli extra (facoltativi): in Google Cloud Console limita la *API key* ai referrer HTTP del tuo dominio; attiva **Firebase App Check** con reCAPTCHA.

---

## 5. Guida rapida per i DEV (editor)

1. Premi **👤 Login** in alto in qualsiasi pagina, accedi con il tuo `Editor.Nome` e la password → **Open page editor**.
2. A sinistra c'è l'elenco: *published* (pubblica), *draft* (bozza, visibile solo allo staff), *placeholder* (vecchia pagina non ancora creata — aprila e premi **Save** per crearla).
3. **+ New page** per una pagina nuova: nazione, percorso politico, guida o altro. L'indirizzo (`slug`) viene generato dal titolo e non si può cambiare dopo il primo salvataggio.
4. Pagine con lo stesso **Group** (es. `ita`) sono collegate nella barra di navigazione, in ordine di **Nav order**.
5. Ogni **sezione** è una card (larghezza intera, metà o un terzo). Il testo si scrive in **Markdown** (aiuto in fondo all'editor) e ci sono modelli pronti per spiriti nazionali, focus, partiti e leader.
6. Le immagini vanno caricate nel repository (`images/leaders/…`, `images/ideologies/…`) e richiamate con `![nome](images/leaders/file.png)`.
7. Spunta **Published** per renderla visibile a tutti. **Ctrl+S** salva. Da **Account** puoi cambiare la tua password.

---

## 6. Sviluppo locale e test

Serve Node.js e Java (per gli emulatori Firebase).

```bash
# Test automatici delle regole di sicurezza
cd tests && npm install && npm test

# Sito + emulatori in locale (nessun progetto reale necessario)
npx firebase-tools emulators:start --project demo-dve   # Auth :9099, Firestore :8080, UI :4000
python3 -m http.server 8000                             # in un altro terminale, dalla root del repo
cd tools && npm install && node accounts.mjs create --emulator   # crea gli account di prova
# apri http://localhost:8000/login.html?emulator=1
```

## 7. File principali

| File | Contenuto |
|---|---|
| `firestore.rules` | Regole di sicurezza del database |
| `js/firebase-config.js` | Configurazione Firebase, dominio degli username staff, timeout di inattività |
| `js/wiki.js` | Modulo comune: login, ruoli, rendering Markdown sicuro |
| `js/page.js`, `js/editor.js`, `js/admin.js`, `js/login.js` | Logica delle pagine dinamiche e dell'area staff |
| `js/nav-account.js`, `js/index-extra.js` | Pulsante Login nelle pagine statiche, pagine nuove nella home |
| `tools/accounts.mjs`, `tools/staff-accounts.json` | Creazione e gestione degli account staff |
| `netlify.toml`, `_redirects`, `404.html` | Header di sicurezza, redirect dai vecchi indirizzi (`afg.html` → `page.html?p=afg`), pagina 404 |
| `css/wiki.css` | Stile condiviso (stesso tema del wiki) |
| `data/placeholders.json` | Contenuto delle vecchie pagine placeholder |
| `js/vendor/` | `marked` (Markdown) e `DOMPurify` (sanificazione), inclusi nel repo |
| `tests/` | Test automatici delle regole di sicurezza |
