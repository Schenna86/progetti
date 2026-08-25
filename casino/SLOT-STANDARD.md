# SLOT MACHINE HTML — STANDARD SLOT V1

Questo documento definisce lo standard comune da usare per OGNI nuova slot.
Non richiede modifiche alle slot già funzionanti.

---

## 1. STRUTTURA CARTELLE

La root del sito contiene:

/index.html
/daily-bonus.html
/stats.html
/reset-password.html

Le payline table grafiche comuni stanno nella root:

/5x3_25.webp
/5x4_25.webp
/5x5_25.webp
...

Ogni slot ha una cartella con lo stesso nome del proprio game_id:

/{game_id}/{game_id}.html

Esempio:

/pirates/pirates.html
/jungle/jungle.html
/egypt/egypt.html

---

## 2. ASSET DELLA SLOT

Dentro:

/{game_id}/assets/

Asset standard:

background.webp
frame.webp
logo.webp
bet.webp
lines.webp
total.webp
winnings.webp
spin.webp
payouttable.webp

Simboli:

/{game_id}/assets/symbols/

common1.webp
common2.webp
common3.webp
common4.webp
medium1.webp
medium2.webp
medium3.webp
premium1.webp
premium2.webp
premium3.webp
wild.webp
free.webp
bonus.webp

Asset opzionali delle feature possono avere nomi propri.

Esempio Pirates:

bonus1.webp
bonus2.webp

---

## 3. PAYLINE TABLE

La tabella grafica delle linee NON è specifica della skin.

Nome obbligatorio:

{reels}x{rows}_{max_lines}.webp

Esempi:

5x3_25.webp
5x4_25.webp
5x5_25.webp

La slot deve ricavare automaticamente il nome da:

game.reels
game.rows
game.max_lines

Percorso dalla slot:

../{reels}x{rows}_{max_lines}.webp

La home usa:

./{reels}x{rows}_{max_lines}.webp

---

## 4. PAYOUT TABLE

Ogni slot deve avere:

/{game_id}/assets/payouttable.webp

È specifica della slot perché payout e simboli possono cambiare.

Deve essere accessibile dalla topbar.

---

## 5. TOPBAR OBBLIGATORIA

Ogni slot deve avere almeno:

SALDO
LINEE
PAYOUT
FULLSCREEN
HOME

LINEE:
apre la payline table globale.

PAYOUT:
apre assets/payouttable.webp.

HOME:
torna a ../index.html SENZA logout.

FULLSCREEN:
prova ad attivare fullscreen + landscape lock.

---

## 6. ASSET VERSIONING

Tutti gli asset devono passare dalla funzione assetUrl().

Formato:

./assets/file.webp?v={asset_version}

asset_version arriva da slot_games.

Questo permette di forzare il refresh della cache senza rinominare gli asset.

---

## 7. CONFIGURAZIONE SLOT

La slot deve leggere la configurazione con:

get_slot_config(p_game_id)

Il client NON deve ricevere:

weight
payout reali server-side
max_per_reel
dati RNG sensibili

Il client riceve solo ciò che serve per visualizzare il gioco.

---

## 8. SPIN

Ogni slot deve chiamare:

spin_slot_safe()

NON:

spin_slot()

Parametri standard:

p_game_id
p_bet_per_line
p_active_lines
p_free_spin_session_id

La RPC server-side deve essere l'unico punto che:

controlla il saldo
scala la puntata
genera la griglia
valuta paylines
gestisce FREE
gestisce BONUS
accredita vincite
scrive storico/wallet

Il browser NON decide mai il risultato.

---

## 9. PROTEZIONE SPIN CONCORRENTI

spin_slot_safe() usa un lock per utente.

Due tab/dispositivi dello stesso account non devono poter processare due spin contemporaneamente.

In caso di:

SPIN_ALREADY_IN_PROGRESS

il frontend:

1. non mostra errore fatale;
2. interrompe l'animazione;
3. aspetta brevemente;
4. rilegge get_slot_config();
5. si risincronizza col server.

---

## 10. RNG

La generazione della griglia deve restare server-side.

Per i vincoli max_per_reel:

1. genera tutte le celle del rullo dai pesi completi;
2. controlla i limiti;
3. se il rullo viola un limite, rigetta TUTTO il rullo;
4. rigenera il rullo.

Non correggere singole celle dopo l'estrazione.

Questo mantiene la simmetria delle righe.

---

## 11. PUNTATA

allowed_bets arriva da slot_games.

allowed_lines arriva da slot_games.

Puntata totale:

bet_per_line × active_lines

Il frontend deve sempre mostrare:

PUNTATA
LINEE
TOTALE GIOCATA
VINCITA TOTALE

---

## 12. FREE SPIN

Regole comuni:

- sessione server-side;
- FREE non scala il saldo;
- mantiene bet_per_line dello spin che l'ha attivata;
- mantiene active_lines dello spin che l'ha attivata;
- eventuali retrigger aggiungono spin;
- la sessione deve poter essere ripresa dopo refresh/chiusura pagina.

Durante una sessione FREE:

puntata e linee sono bloccate.

---

## 13. RIEPILOGO FREE SPIN

Alla fine di una sessione FREE deve comparire un riepilogo.

RPC standard:

get_free_spin_summary(p_session_id)

Il totale deve comprendere:

vincite paylines dei FREE
+
eventuali BONUS completati attivati durante quei FREE

Se l'ultimo FREE attiva un BONUS:

1. si completa prima il BONUS;
2. poi si mostra il riepilogo FREE.

---

## 14. BONUS

Il BONUS deve essere sempre server-side.

Il browser può:

mostrare grafica
inviare una scelta
animare il risultato

Il browser NON può:

decidere valori
decidere moltiplicatori
decidere vincite
leggere anticipatamente dati nascosti

Ogni feature bonus può avere RPC specifiche.

Esempio Pirates:

get_bonus_state
pick_bonus_chest

---

## 15. SALDO

Il saldo visualizzato deve essere quello ritornato dal server.

Dopo una modifica del saldo la pagina deve notificare:

BroadcastChannel:
slot-machine-sync

messaggio:

{
  type: "balance-changed"
}

Fallback:

localStorage key:
slot-machine-balance-sync

La home rilegge comunque profiles.chips al ritorno in primo piano.

---

## 16. BLOCCO REFRESH ACCIDENTALE

beforeunload deve attivarsi almeno quando:

state.spinning
state.bonusOpen
state.freeRemaining > 0

Se esistono altre feature persistenti, aggiungerle.

Non deve bloccare inutilmente l'utente quando il gioco è fermo.

---

## 17. OVERLAY INFORMATIVI

LINEE e PAYOUT devono essere overlay e NON nuove pagine.

Devono chiudersi con:

X
click sullo sfondo
ESC

Durante:

spin
FREE automatici
BONUS
riepiloghi critici

i pulsanti informativi possono essere disabilitati.

---

## 18. AUTENTICAZIONE

La sessione Supabase è condivisa con la home.

Entrare nella slot non richiede un nuovo login se la sessione esiste.

HOME non esegue signOut().

Solo il pulsante logout della home esegue:

supabase.auth.signOut()

---

## 19. CLASSIFICA

La classifica resta gestita centralmente dalla home/backend.

Una nuova slot deve scrivere gli spin nello stesso sistema comune.

Punteggio settimanale:

spin paid:
total_win - (bet_per_line × active_lines)

spin free:
total_win

bonus:
+ bonus_win associato allo spin

Daily Bonus escluso.

---

## 20. STATISTICHE

Ogni nuova slot deve usare:

slot_spins.game_id = slot_games.id

In questo modo entra automaticamente in:

storico personale
statistiche globali
RTP osservato
classifica

senza creare codice specifico nella home.

---

## 21. RTP OSSERVATO

Formula comune:

(vincite spin + vincite bonus)
/ puntate degli spin paid
× 100

Le vincite FREE entrano nel numeratore.

I FREE non aumentano il denominatore.

---

## 22. MOBILE

La slot è landscape-first.

Deve includere:

viewport-fit=cover
user-scalable=no
screen-orientation=landscape

In portrait deve comparire il blocker di rotazione.

Controlli principali abbastanza grandi per touch.

---

## 23. STAGE GRAFICO

Stage standard:

2560 × 1440
16:9

Posizionamento grafico tramite variabili CSS percentuali.

Esempio:

--frame-left
--frame-top
--frame-width
--reels-left
--reels-top
--reels-width
--reels-height
--spin-left
--spin-top
--spin-size

Ogni skin può avere valori diversi senza cambiare la logica.

---

## 24. REGOLE PER NUOVE SLOT

Quando viene creata una nuova slot:

1. creare game_id;
2. configurare slot_games;
3. configurare slot_symbols;
4. assegnare payline_set;
5. creare cartella /{game_id};
6. creare /{game_id}/{game_id}.html;
7. aggiungere assets standard;
8. aggiungere payouttable.webp;
9. assicurarsi che esista la payline table corretta nella root;
10. testare get_slot_config;
11. testare spin_slot_safe;
12. simulare RTP;
13. testare FREE;
14. testare BONUS;
15. testare refresh/ripresa sessione;
16. testare due tab contemporanee;
17. testare ritorno home/saldo;
18. verificare storico personale;
19. verificare statistiche globali;
20. attivare slot_games.active = true.

---

## 25. COSA NON FARE

Non mettere RNG nel browser.

Non mettere pesi o payout server-side nel frontend.

Non chiamare direttamente spin_slot().

Non creare un saldo separato per ogni slot.

Non duplicare autenticazione.

Non fare logout tornando alla home.

Non hardcodare la payline table della skin.

Non perdere bet/linee durante FREE.

Non accreditare BONUS dal browser.

Non rifare la struttura comune per ogni nuova slot.

---

## 26. PRINCIPIO GENERALE

La skin cambia.

Gli asset cambiano.

Le feature possono cambiare.

Ma:

account
saldo
spin sicuro
storico
classifica
statistiche
payline table
payout overlay
sincronizzazione
sessioni FREE

devono comportarsi allo stesso modo in ogni slot.
