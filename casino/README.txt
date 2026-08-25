PASSO 4 - STATISTICHE GLOBALI PER SLOT

1. Esegui global-slot-stats.sql nel SQL Editor di Supabase.
2. Metti nella root:
   - index.html
   - stats.html

La home aggiunge solo il pulsante:
📊 Statistiche

Per ogni slot vengono mostrati:
- spin totali
- spin pagati
- free spin
- giocatori unici
- bonus completati
- totale giocato
- vincite spin
- vincite bonus
- totale vinto
- miglior vincita
- netto giocatori
- RTP osservato
- confronto con target RTP
- primo/ultimo spin

RTP osservato:
(vincite spin + vincite bonus) / totale puntate paid * 100

Le vincite dei free spin entrano nel numeratore.
I free spin non aggiungono puntata al denominatore.
Daily Bonus e accrediti esterni non entrano.
