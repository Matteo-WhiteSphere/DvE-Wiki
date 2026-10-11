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

## 1. Primo avvio (nessuna configurazione richiesta)

1. Fai il merge della PR (o apri la deploy preview): Netlify pubblica sito e funzione da solo.
2. Apri una pagina qualsiasi del sito. Alla **prima richiesta** il server crea gli account elencati in `data/staff-accounts.json`:

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

3. Le **password temporanee** vengono scritte **una sola volta** nel log del server: Netlify → il sito *dve-wiki* → **Logs → Functions → api**. Solo chi ha accesso al pannello Netlify del sito può leggerle.
4. Mandale in privato a ognuno (es. Discord). Al primo accesso ognuno **deve scegliere la propria password**; prima di farlo l'account non può fare niente.

> I dati sono condivisi tra sito principale e deploy preview: gli account creati una volta valgono ovunque.

**Se ti perdi il log** (o un owner dimentica la password): vedi *Recupero d'emergenza* più sotto.

### Le password: come funzionano

- **Nessuna password è scritta nel repository o nel sito.**
- Il server salva solo un'**impronta cifrata** (scrypt) della password: nemmeno chi gestisce il sito può leggerla.
- Password dimenticata: un admin/owner preme **Reset password** nel pannello admin e manda la nuova password temporanea.
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

### Recupero d'emergenza

Se un owner perde la password (o non hai copiato il log del primo avvio):

1. Netlify → *Site configuration → Environment variables* → aggiungi `DVE_RECOVERY_CODE` con un codice lungo e casuale (almeno 16 caratteri) e rifai il deploy.
2. Da terminale:

   ```bash
   curl -X POST https://dve-wiki.netlify.app/api/recover \
     -H "X-DvE-Request: 1" -H "Content-Type: application/json" \
     -d '{"code":"IL-TUO-CODICE","username":"Owner.RedMatteo"}'
   ```

   La risposta contiene una nuova password temporanea.
3. **Togli** la variabile `DVE_RECOVERY_CODE` subito dopo.

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

## 4. Guida rapida per i DEV (editor)

1. Premi **👤 Login** in alto, accedi con il tuo `Editor.Nome` → **Open page editor**.
2. A sinistra: *published* (pubblica), *draft* (bozza, solo staff), *placeholder* (vecchia pagina non ancora creata — aprila e premi **Save**).
3. **+ New page** per una pagina nuova: nazione, percorso politico, guida o altro. L'indirizzo (`slug`) non si può cambiare dopo il primo salvataggio.
4. Pagine con lo stesso **Group** (es. `ita`) sono collegate nella barra di navigazione, in ordine di **Nav order**.
5. Ogni **sezione** è una card (intera, metà o un terzo). Testo in **Markdown** (aiuto in fondo all'editor), con modelli pronti per spiriti nazionali, focus, partiti e leader.
6. Le immagini vanno caricate nel repository (`images/leaders/…`, `images/ideologies/…`) e richiamate con `![nome](images/leaders/file.png)`.
7. Spunta **Published** per renderla visibile a tutti. **Ctrl+S** salva.

---

## 5. Sviluppo in locale

Serve [Node.js](https://nodejs.org) 20 o più recente. Nessun account Netlify necessario:

```bash
npm install
npm run dev      # sito + server su http://localhost:8888, dati in .dev-data/
npm test         # test automatici del server e della sicurezza
```

Al primo avvio locale le password temporanee compaiono nel terminale. Per ricominciare da zero cancella la cartella `.dev-data/`.

## 6. File principali

| File | Contenuto |
|---|---|
| `netlify/functions/api.mjs` | Server: login, pagine, account, registro |
| `netlify/lib/core.mjs` | Archivio dati, password, sessioni, ruoli, validazione |
| `data/staff-accounts.json` | Account creati al primo avvio |
| `js/wiki.js` | Modulo comune del browser: chiamate al server, rendering Markdown sicuro |
| `js/page.js`, `js/editor.js`, `js/admin.js`, `js/login.js` | Pagine dinamiche e area staff |
| `js/nav-account.js`, `js/index-extra.js` | Pulsante Login nelle pagine statiche, pagine nuove nella home |
| `netlify.toml`, `_redirects`, `404.html` | Configurazione Netlify, header di sicurezza, redirect, pagina 404 |
| `tools/dev-server.mjs` | Server di sviluppo locale |
| `tests/api.test.mjs` | Test automatici |
| `data/placeholders.json` | Contenuto delle vecchie pagine placeholder |
| `js/vendor/` | `marked` (Markdown) e `DOMPurify` (sanificazione) |
