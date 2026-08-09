SLOT MACHINE - HOME V1
======================

FILE
----
index.html
get_weekly_leaderboard.sql

COSA FA
-------
- Login Supabase
- Registrazione Supabase
- Mostra username
- Mostra saldo fiche
- Legge automaticamente tutte le slot attive da public.slot_games
- Mostra una card per ogni slot
- Usa background.webp della slot come immagine card
- Classifica settimanale
- Evidenzia la riga dell'utente
- Mostra anche posizione personale se è fuori dalla Top 20

PRIMA DI USARLA
---------------
1. Eseguire get_weekly_leaderboard.sql su Supabase.
2. Aprire index.html.
3. Impostare:

   SUPABASE_URL
   SUPABASE_ANON_KEY

   Usare ANON/PUBLISHABLE KEY.
   NON usare SERVICE_ROLE nel browser.

STRUTTURA CONSIGLIATA
---------------------
index.html
pirates.html

assets/
└── pirates/
    ├── background.webp
    ├── frame.webp
    ├── logo.webp
    ├── bet.webp
    ├── lines.webp
    ├── total.webp
    ├── winnings.webp
    └── symbols/
        └── ...

NUOVE SLOT
----------
La home legge public.slot_games dove active=true.

Convenzione della pagina:
game.id = pirates -> pirates.html
game.id = jungle  -> jungle.html
game.id = space   -> space.html

Quindi per aggiungere una nuova slot:
1. aggiungere il record a slot_games
2. impostare active=true
3. creare <id>.html
4. creare assets/<asset_folder>/background.webp

Non serve modificare index.html.

CLASSIFICA
----------
Il punteggio settimanale è:

spin_bet + spin_win + bonus_win

spin_bet è negativo.

In pratica:
vincite di gioco - puntate.

Non vengono conteggiati:
- initial
- daily_bonus
- admin

La settimana va da lunedì 00:00 a lunedì successivo,
interpretata nel fuso Europe/Rome.

NOTA SU UTENTI CON SCORE 0
--------------------------
La funzione include anche utenti che nella settimana non hanno giocato,
con score 0. Se preferiamo mostrare solo chi ha effettuato almeno uno spin,
possiamo cambiare facilmente la query.
