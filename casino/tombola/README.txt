TOMBOLA FRONTEND - vs Bot

1. Apri tombola.html e configura:
   const SUPABASE_URL = "https://xxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "INSERISCI_LA_TUA_ANON_KEY";

   NON usare mai la SERVICE_ROLE_KEY nel frontend.

2. Il file usa queste RPC:
   - start_tombola_bot(p_card_price, p_request_id)
   - finish_tombola_bot(p_round_id)

3. Tabelle lette:
   - tombola_bot_paytable
   - profiles (chips)

4. Funzioni:
   - login Supabase se non esiste sessione
   - cartella 3x9
   - tabellone 1-90
   - animazione estrazioni
   - evidenziazione numeri
   - moltiplicatore corrente
   - paytable dinamica da DB
   - ripristino partita dopo refresh con localStorage
   - verifica SHA-256 seed/hash
   - saldo fiche aggiornato

5. Per test locale è consigliato servirlo via HTTP:
   python -m http.server 8080

   poi:
   http://localhost:8080/tombola.html
