# Area Staff — pagine dinamiche, account e sicurezza

Il wiki ora ha un'**area staff** dove i DEV della mod possono creare e modificare pagine direttamente dal browser, senza toccare i file HTML.

| Pagina | A cosa serve |
|---|---|
| `login.html` | Accesso con **Google** o **e-mail + password** |
| `editor.html` | Editor delle pagine (moderatori, admin, owner) |
| `admin.html` | Gestione account, ruoli, inviti e registro attività (admin, owner) |
| `page.html?p=<indirizzo>` | Pagina pubblica generata dal database (es. `page.html?p=afg`) |

Le vecchie ~180 pagine placeholder (`afg.html`, `usa_fascist.html`, …) sono state rimosse: il loro contenuto è in `data/placeholders.json` e viene mostrato come **bozza** finché un moderatore non scrive la pagina vera dall'editor. I link della home puntano già a `page.html?p=…`.

Il sito resta statico (GitHub Pages va benissimo). Login e database sono forniti da **Firebase** (piano gratuito *Spark*).

---

## 1. Configurazione iniziale (una volta sola)

1. Vai su <https://console.firebase.google.com> → **Aggiungi progetto** (Google Analytics non serve).
2. **Impostazioni progetto → Generali → Le tue app → Web (`</>`)**: registra un'app web e copia l'oggetto `firebaseConfig` dentro `js/firebase-config.js` (sostituendo i valori `YOUR_…`). Questi valori **non sono segreti**: la protezione è data dalle regole del database.
3. **Authentication → Sign-in method**: abilita **Email/Password** e **Google**.
4. **Authentication → Impostazioni → Domini autorizzati**: aggiungi il dominio dove è pubblicato il wiki (es. `matteo-whitesphere.github.io`).
5. **Authentication → Impostazioni → Criteri password**: attiva il criterio (consigliato: minimo 10 caratteri, maiuscole, minuscole e numeri). Lascia attiva la **protezione dall'enumerazione delle e-mail**.
6. **Firestore Database → Crea database** in *modalità produzione* (regione consigliata: `europe-west`).
7. **Firestore → Regole**: incolla il contenuto di `firestore.rules` e premi **Pubblica**.
   In alternativa, con la CLI: `npm i -g firebase-tools && firebase login && firebase deploy --only firestore:rules --project <id-progetto>`.
8. Pubblica il sito (commit + push).

### Diventare owner (il tuo account)

1. Apri `login.html` sul sito e accedi con il tuo account Google. Vedrai il ruolo **pending**.
2. Nella console Firebase → **Firestore → users → (il documento con la tua e-mail)** cambia il campo `role` da `pending` a `owner`.
3. Ricarica `login.html`: ora vedi i pulsanti **Open page editor** e **Admin panel**.

Il ruolo `owner` si può assegnare **solo dalla console Firebase**, mai dal sito: nessuno può prendersi il controllo totale dal web.

---

## 2. Ruoli

| Ruolo | Può fare |
|---|---|
| **owner** | Tutto, compreso creare/rimuovere **amministratori** |
| **admin** | Invitare e gestire **moderatori**, eliminare pagine, leggere il registro attività |
| **moderator** | Creare e modificare pagine (non può eliminarle, può solo togliere la pubblicazione) |
| **pending** | Ha fatto l'accesso ma non è stato approvato: nessun permesso |
| **disabled** | Account bloccato: nessun permesso |

### Aggiungere un DEV / moderatore (o un admin)

Da `admin.html` → **Add a staff account**:

- **Google**: inserisci la sua e-mail Google e il ruolo. Al suo primo accesso con "Sign in with Google" riceve il ruolo in automatico.
- **E-mail + password**: viene creato l'account e il DEV riceve un'e-mail per **scegliere la propria password** (tu non la vedi mai).

Se qualcuno ha già fatto l'accesso da solo (ruolo *pending*), lo trovi nella tabella **Users** e puoi approvarlo da lì.
Solo l'**owner** vede l'opzione *admin* nei ruoli.

---

## 3. Sistema di sicurezza

- **Regole Firestore lato server** (`firestore.rules`): ogni scrittura è verificata da Google, non dal browser. Anche manomettendo il JavaScript non si possono superare i permessi.
- **Gerarchia dei ruoli**: nessuno può cambiare il proprio ruolo; gli admin non possono toccare altri admin né l'owner; l'owner si assegna solo da console.
- **E-mail verificata obbligatoria** per qualsiasi modifica.
- **Account creati solo su invito**: chi accede senza invito resta *pending*.
- **Protezione XSS**: il testo delle pagine (Markdown) è ripulito con DOMPurify — script, iframe, form, `javascript:` e CSS pericolosi vengono rimossi. Sono ammessi solo colori/stili di testo innocui.
- **Content Security Policy** sulle pagine dinamiche e dell'area staff: il browser carica script solo dal sito e da Google.
- **Cronologia completa**: ogni salvataggio crea una revisione immutabile; si può ripristinare qualsiasi versione dal pulsante *History*. Anche dopo l'eliminazione di una pagina la cronologia resta.
- **Registro attività (audit log)**: ogni creazione/modifica/eliminazione di pagine e ogni cambio di ruolo/invito viene registrato con autore e ora. Non è modificabile né cancellabile dal sito.
- **Rilevamento conflitti**: se due DEV modificano la stessa pagina insieme, il secondo viene avvisato prima di sovrascrivere.
- **Logout automatico** dopo 60 minuti di inattività (modificabile in `js/firebase-config.js`).
- **Protezione brute-force** sul login e nessuna rivelazione di quali e-mail esistono (gestito da Firebase).
- **Validazione dei dati** lato server: formato dell'indirizzo, lunghezza dei testi, colori, numero di sezioni, autore e data non falsificabili.

Consigli extra (facoltativi):

- **Google Cloud Console → API e servizi → Credenziali**: limita la *API key* del progetto ai referrer HTTP del tuo dominio.
- **Firebase → App Check** con reCAPTCHA: blocca le richieste che non arrivano dal tuo sito.

---

## 4. Guida rapida per i DEV (editor)

1. Accedi da **Staff area** (link in fondo alla home) → **Open page editor**.
2. A sinistra c'è l'elenco: *published* (pubblica), *draft* (bozza, visibile solo allo staff), *placeholder* (vecchia pagina non ancora creata — aprila e premi **Save** per crearla).
3. **+ New page** per una pagina nuova: nazione, percorso politico, guida o altro. L'indirizzo (`slug`) viene generato dal titolo e non si può cambiare dopo il primo salvataggio.
4. Pagine con lo stesso **Group** (es. `ita`) vengono collegate tra loro nella barra di navigazione, in ordine di **Nav order**.
5. Ogni **sezione** è una card; può essere larga quanto la pagina, metà o un terzo. Il testo si scrive in **Markdown** (aiuto in fondo all'editor) e ci sono modelli pronti per tabelle di spiriti nazionali, focus, partiti e leader.
6. Le immagini vanno caricate nel repository (`images/leaders/…`, `images/ideologies/…`) e richiamate con `![nome](images/leaders/file.png)`.
7. Spunta **Published** per renderla visibile a tutti. **Ctrl+S** salva.

---

## 5. Sviluppo locale e test

Serve Node.js e Java (per gli emulatori Firebase).

```bash
# Test automatici delle regole di sicurezza
cd tests && npm install && npm test

# Sito + emulatori in locale (nessun progetto reale necessario)
npx firebase-tools emulators:start --project demo-dve   # Auth :9099, Firestore :8080, UI :4000
python3 -m http.server 8000                             # in un altro terminale, dalla root del repo
# apri http://localhost:8000/login.html?emulator=1
# per diventare owner in locale: http://127.0.0.1:4000/firestore → users → role = "owner"
```

## 6. File principali

| File | Contenuto |
|---|---|
| `firestore.rules` | Regole di sicurezza del database |
| `js/firebase-config.js` | Configurazione Firebase e timeout di inattività |
| `js/wiki.js` | Modulo comune: login, ruoli, rendering Markdown sicuro |
| `js/page.js`, `js/editor.js`, `js/admin.js`, `js/login.js`, `js/index-extra.js` | Logica delle singole pagine |
| `css/wiki.css` | Stile condiviso (stesso tema del wiki) |
| `data/placeholders.json` | Contenuto delle vecchie pagine placeholder |
| `js/vendor/` | `marked` (Markdown) e `DOMPurify` (sanificazione), inclusi nel repo |
| `tests/` | Test automatici delle regole di sicurezza |
