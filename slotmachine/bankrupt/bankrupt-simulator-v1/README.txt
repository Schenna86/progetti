FRAUDULENT BANKRUPTCY - SIMULATORE V1

Il simulatore legge da Supabase:
- slot_games
- slot_symbols
- paylines

Non scrive nulla nel database.

MECCANICHE
- game_id: bankrupt
- 3x3
- linee 1-5
- bet per linea 1
- 3 FREE = 10 Free Spin
- retrigger: 3 FREE = +10
- 3 BONUS = Bonus Game
- una scelta tra:
  x2 x3 x5 x8 x10 x20 x50 x100 x200 x500
- premio bonus = moltiplicatore x puntata totale
- BONUS attivabile anche nei FREE
- rejection sampling per intero rullo

POWERSHELL

$env:SUPABASE_URL="https://xxxxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="LA_TUA_SERVICE_ROLE_KEY"
$env:SIM_SPINS="1000000"
$env:SIM_LINES="all"
$env:SIM_BET="1"

node .\bankrupt-simulator.mjs

TEST VELOCE
$env:SIM_SPINS="200000"
$env:SIM_LINES="all"

TEST FINALE MAX LINEE
$env:SIM_SPINS="10000000"
$env:SIM_LINES="5"

OUTPUT
- RTP base
- RTP FREE
- RTP BONUS
- RTP totale
- target DB e scostamento
- netto medio per spin
- stima spin per guadagnare 5000 fiche
- hit frequency
- trigger FREE
- retrigger FREE
- free spin / paid
- trigger BONUS da paid e FREE
- distribuzione x2...x500
- moltiplicatore bonus medio
- max win base/FREE/feature/BONUS
