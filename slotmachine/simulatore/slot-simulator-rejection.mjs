#!/usr/bin/env node

/**
 * SLOT SIMULATOR
 * ============================================================
 * Legge la configurazione della slot da Supabase e simula gli
 * spin LOCALMENTE sul PC.
 *
 * NON scrive nulla nel database.
 * NON modifica saldi utenti.
 * NON inserisce slot_spins.
 * NON inserisce wallet_transactions.
 *
 * Legge solamente:
 *   - slot_games
 *   - slot_symbols
 *   - paylines
 *
 * Supporta:
 *   - 5/10/15/20/25 linee
 *   - pesi simboli
 *   - WILD
 *   - FREE scatter
 *   - BONUS scatter
 *   - retrigger FREE
 *   - bonus a 9 forzieri
 *   - RTP base
 *   - RTP free spins
 *   - RTP bonus
 *   - RTP totale
 *
 * BONUS PIRATES
 * ------------------------------------------------------------
 * 9 forzieri:
 *   x5, x10, x20, x25, x30, x35, x40, x50, x100
 *
 * Se ne scelgono 3 casualmente.
 *
 * 3 BONUS -> moltiplicatore trigger x1
 * 4 BONUS -> moltiplicatore trigger x3
 * 5 BONUS -> moltiplicatore trigger x10
 *
 * Vincita bonus =
 *   somma dei 3 forzieri
 *   x moltiplicatore trigger
 *   x puntata totale
 *
 * Puntata totale =
 *   bet_per_line x active_lines
 *
 * ============================================================
 *
 * VARIABILI AMBIENTE OBBLIGATORIE:
 *
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * VARIABILI FACOLTATIVE:
 *
 *   SIM_SPINS=200000
 *   SIM_BET=1
 *   SIM_LINES=all
 *   MAX_FREE_SPINS_PER_PAID=100000
 *
 * ESEMPIO POWERSHELL:
 *
 *   $env:SUPABASE_URL="https://xxxxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="..."
 *   $env:SIM_SPINS="1000000"
 *   $env:SIM_LINES="25"
 *   $env:SIM_BET="1"
 *
 *   node .\slot-simulator.mjs pirates
 *
 * ============================================================
 */


// ============================================================
// CONFIG
// ============================================================

const gameId = process.argv[2] || "pirates";

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAID_SPINS =
  Number(process.env.SIM_SPINS || 200000);

const BET_PER_LINE =
  Number(process.env.SIM_BET || 1);

const SIM_LINES =
  (process.env.SIM_LINES || "all")
    .trim()
    .toLowerCase();

const MAX_FREE_SPINS_PER_PAID =
  Number(
    process.env.MAX_FREE_SPINS_PER_PAID
    || 100000
  );


// ============================================================
// BONUS
// ============================================================

const BONUS_CHESTS = [
  5,
  10,
  20,
  25,
  30,
  35,
  40,
  50,
  100
];


// ============================================================
// CONTROLLI INIZIALI
// ============================================================

if (!SUPABASE_URL || !SERVICE_KEY) {

  console.error(
    "\nERRORE:\n" +
    "Mancano SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n"
  );

  process.exit(1);
}


if (
  !Number.isInteger(PAID_SPINS)
  || PAID_SPINS <= 0
) {

  console.error(
    "SIM_SPINS deve essere un intero positivo."
  );

  process.exit(1);
}


if (
  !Number.isInteger(BET_PER_LINE)
  || BET_PER_LINE <= 0
) {

  console.error(
    "SIM_BET deve essere un intero positivo."
  );

  process.exit(1);
}


// ============================================================
// SUPABASE REST
// ============================================================

const headers = {

  apikey:
    SERVICE_KEY,

  Authorization:
    `Bearer ${SERVICE_KEY}`,

  Accept:
    "application/json"
};


async function rest(path) {

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/${path}`,
      {
        headers
      }
    );


  if (!response.ok) {

    const text =
      await response.text();

    throw new Error(
      `Supabase REST ${response.status}: ${text}`
    );
  }


  return await response.json();
}


// ============================================================
// FORMATTAZIONE OUTPUT
// ============================================================

function fmtInt(value) {

  return Math.round(value)
    .toLocaleString("it-IT");
}


function fmtNumber(
  value,
  digits = 2
) {

  return Number(value)
    .toFixed(digits)
    .replace(".", ",");
}


function fmtPct(
  value,
  digits = 3
) {

  return (
    (value * 100)
      .toFixed(digits)
      .replace(".", ",")
    + "%"
  );
}


function oneIn(probability) {

  if (!probability) {
    return "mai osservato";
  }

  return (
    "1 ogni "
    + (1 / probability)
        .toFixed(1)
        .replace(".", ",")
    + " spin"
  );
}


// ============================================================
// SHUFFLE
// ============================================================

function shuffle(array) {

  const result = [...array];

  for (
    let i = result.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random()
        * (i + 1)
      );

    [
      result[i],
      result[j]
    ] = [
      result[j],
      result[i]
    ];
  }

  return result;
}


// ============================================================
// BONUS GAME
// ============================================================

function playBonus(
  totalBet,
  triggerMultiplier
) {

  const chests =
    shuffle(BONUS_CHESTS);


  // Simula la scelta casuale di 3 dei 9 forzieri
  const picked =
    chests.slice(0, 3);


  const sumMultiplier =
    picked.reduce(
      (sum, value) =>
        sum + value,
      0
    );


  const win =
    sumMultiplier
    * triggerMultiplier
    * totalBet;


  return {

    picked,

    sumMultiplier,

    triggerMultiplier,

    win
  };
}


// ============================================================
// ESTRAZIONE PESATA SIMBOLO
// ============================================================
//
// Ogni cella viene estratta usando SEMPRE l'intera distribuzione
// dei simboli. max_per_reel NON modifica il peso delle celle
// successive.
//
// Se una colonna completa viola max_per_reel, l'intera colonna
// viene scartata e rigenerata. In questo modo riga alta, centrale
// e bassa hanno la stessa probabilita' marginale.
//

function weightedPick(symbols) {

  let totalWeight = 0;


  for (
    const symbol of symbols
  ) {

    totalWeight +=
      Number(symbol.weight);
  }


  if (!(totalWeight > 0)) {

    throw new Error(
      "Peso totale simboli non valido."
    );
  }


  let rnd =
    Math.random()
    * totalWeight;


  for (
    const symbol of symbols
  ) {

    rnd -=
      Number(symbol.weight);


    if (rnd < 0) {

      return symbol;
    }
  }


  return symbols[
    symbols.length - 1
  ];
}


// ============================================================
// GENERA UNA COLONNA CON REJECTION SAMPLING
// ============================================================

function generateReel(
  symbols,
  rows
) {

  const MAX_RETRIES = 10000;


  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {

    const reel =
      [];


    const counts =
      new Map();


    // Estrazioni indipendenti:
    // nessun simbolo viene escluso mentre componiamo la colonna.
    for (
      let row = 0;
      row < rows;
      row++
    ) {

      const symbol =
        weightedPick(symbols);


      reel.push(
        symbol.code
      );


      counts.set(
        symbol.code,
        (
          counts.get(symbol.code)
          || 0
        ) + 1
      );
    }


    // Controlla i vincoli SOLO dopo aver generato
    // l'intera colonna.
    let valid = true;


    for (
      const symbol of symbols
    ) {

      if (
        symbol.max_per_reel == null
      ) {

        continue;
      }


      if (
        (counts.get(symbol.code) || 0)
        >
        Number(symbol.max_per_reel)
      ) {

        valid = false;

        break;
      }
    }


    if (valid) {

      return reel;
    }
  }


  throw new Error(
    "Impossibile generare una colonna valida dopo " +
    `${MAX_RETRIES} tentativi. Controllare weight/max_per_reel.`
  );
}


// ============================================================
// GENERA E VALUTA UN SINGOLO SPIN
// ============================================================

function makeSpin(
  config,
  activeLines,
  betPerLine
) {

  const {
    game,
    symbols,
    paylines,
    symbolByCode
  } = config;


  const reels =
    Number(game.reels);

  const rows =
    Number(game.rows);


  // grid[reel][row]
  const grid =
    Array.from(
      {
        length: reels
      },
      () =>
        Array(rows).fill(null)
    );


  let freeCount = 0;

  let bonusCount = 0;


  // ==========================================================
  // GENERAZIONE GRIGLIA
  // ==========================================================

  for (
    let reel = 0;
    reel < reels;
    reel++
  ) {

    const generatedReel =
      generateReel(
        symbols,
        rows
      );


    for (
      let row = 0;
      row < rows;
      row++
    ) {

      const code =
        generatedReel[row];


      grid[reel][row] =
        code;


      if (
        code === "FREE"
      ) {

        freeCount++;
      }


      if (
        code === "BONUS"
      ) {

        bonusCount++;
      }
    }
  }


  // ==========================================================
  // VALUTAZIONE PAYLINES
  // ==========================================================

  let totalWin = 0;

  let winningLineCount = 0;


  for (
    const line of paylines
  ) {

    if (
      Number(line.line_no)
      > activeLines
    ) {

      break;
    }


    const pattern =
      line.pattern.map(Number);


    const lineSymbols = [];


    for (
      let reel = 0;
      reel < reels;
      reel++
    ) {

      lineSymbols.push(
        grid[reel][
          pattern[reel]
        ]
      );
    }


    // ========================================================
    // TROVA IL SIMBOLO TARGET
    //
    // WILD sostituisce NORMAL.
    // FREE e BONUS interrompono la linea.
    // WILD-only non paga.
    // ========================================================

    let target = null;


    for (
      const code of lineSymbols
    ) {

      if (
        code === "WILD"
      ) {

        continue;
      }


      const symbol =
        symbolByCode.get(code);


      if (
        symbol?.symbol_type
        === "normal"
      ) {

        target = code;

        break;
      }


      // FREE o BONUS prima di un NORMAL:
      // linea non valida
      break;
    }


    if (!target) {

      continue;
    }


    // ========================================================
    // CONTA CONSECUTIVI DA SINISTRA
    // ========================================================

    let count = 0;


    for (
      const code of lineSymbols
    ) {

      if (
        code === target
        ||
        code === "WILD"
      ) {

        count++;

      } else {

        break;
      }
    }


    if (count < 3) {

      continue;
    }


    const symbol =
      symbolByCode.get(target);


    const multiplier =
      Number(
        symbol[
          `payout_${count}`
        ]
      );


    if (!(multiplier > 0)) {

      continue;
    }


    const lineWin =
      Math.floor(
        betPerLine
        * multiplier
      );


    totalWin +=
      lineWin;


    winningLineCount++;
  }


  // ==========================================================
  // FREE
  // ==========================================================

  const freeAwarded =

    freeCount === 3
      ? 10

    : freeCount === 4
      ? 20

    : freeCount === 5
      ? 40

    : 0;


  // ==========================================================
  // BONUS
  // ==========================================================

  const bonusMultiplier =

    bonusCount === 3
      ? 1

    : bonusCount === 4
      ? 3

    : bonusCount === 5
      ? 10

    : null;


  return {

    grid,

    totalWin,

    winningLineCount,

    freeCount,

    freeAwarded,

    bonusCount,

    bonusMultiplier
  };
}


// ============================================================
// CARICA CONFIGURAZIONE DA SUPABASE
// ============================================================

async function loadConfig(
  gameId
) {

  const games =
    await rest(
      `slot_games` +
      `?id=eq.${encodeURIComponent(gameId)}` +
      `&select=*`
    );


  if (
    games.length !== 1
  ) {

    throw new Error(
      `Slot "${gameId}" non trovata.`
    );
  }


  const game =
    games[0];


  const symbols =
    await rest(
      `slot_symbols` +
      `?game_id=eq.${encodeURIComponent(gameId)}` +
      `&select=*` +
      `&order=sort_order.asc`
    );


  if (!symbols.length) {

    throw new Error(
      `Nessun simbolo configurato per "${gameId}".`
    );
  }


  const paylines =
    await rest(
      `paylines` +
      `?set_id=eq.${encodeURIComponent(game.payline_set_id)}` +
      `&select=line_no,pattern` +
      `&order=line_no.asc`
    );


  if (!paylines.length) {

    throw new Error(
      `Nessuna payline configurata per ` +
      `"${game.payline_set_id}".`
    );
  }


  const symbolByCode =
    new Map(
      symbols.map(
        (symbol) =>
          [
            symbol.code,
            symbol
          ]
      )
    );


  return {

    game,

    symbols,

    paylines,

    symbolByCode
  };
}


// ============================================================
// VALIDAZIONE CONFIGURAZIONE
// ============================================================

function validateConfig(
  config
) {

  const {
    game,
    symbols,
    paylines,
    symbolByCode
  } = config;


  for (
    const code
    of [
      "WILD",
      "FREE",
      "BONUS"
    ]
  ) {

    if (
      !symbolByCode.has(code)
    ) {

      throw new Error(
        `Simbolo obbligatorio mancante: ${code}`
      );
    }
  }


  const normalCount =
    symbols.filter(
      (symbol) =>
        symbol.symbol_type
        === "normal"
    ).length;


  if (
    normalCount !== 10
  ) {

    console.warn(
      `ATTENZIONE: attesi 10 simboli NORMAL, trovati ${normalCount}.`
    );
  }


  for (
    const line of paylines
  ) {

    if (
      !Array.isArray(line.pattern)
      ||
      line.pattern.length
      !== Number(game.reels)
    ) {

      throw new Error(
        `Payline ${line.line_no} non valida.`
      );
    }


    for (
      const row of line.pattern
    ) {

      if (
        row < 0
        ||
        row >= Number(game.rows)
      ) {

        throw new Error(
          `Payline ${line.line_no}: ` +
          `riga ${row} fuori dalla griglia.`
        );
      }
    }
  }
}


// ============================================================
// SIMULAZIONE
// ============================================================

function simulate(
  config,
  activeLines,
  paidSpins,
  betPerLine
) {

  const totalBetPerSpin =
    activeLines
    * betPerLine;


  const totalPaidBet =
    paidSpins
    * totalBetPerSpin;


  // ==========================================================
  // VINCITE
  // ==========================================================

  let baseWins = 0;

  let freeWins = 0;

  let bonusWins = 0;


  // ==========================================================
  // HIT FREQUENCY
  // ==========================================================

  let paidWinningSpins = 0;

  let freeWinningSpins = 0;


  // ==========================================================
  // FREE
  // ==========================================================

  let paidFreeTriggers = 0;

  let freeRetriggers = 0;

  let freeSpinsPlayed = 0;


  // ==========================================================
  // BONUS
  // ==========================================================

  let paidBonusTriggers = 0;

  let freeBonusTriggers = 0;


  const bonusMultipliers =
    new Map(
      [
        [1, 0],
        [3, 0],
        [10, 0]
      ]
    );


  // Per analisi bonus
  let bonusSumMultipliers = 0;

  let bonusGamesPlayed = 0;

  let maxBonusWin = 0;

  let maxBonusSumMultiplier = 0;


  // ==========================================================
  // MAX WIN
  // ==========================================================

  let maxBaseSpinWin = 0;

  let maxFreeSpinWin = 0;

  let maxFeatureFreeWin = 0;


  // ==========================================================
  // CICLO SPIN PAGATI
  // ==========================================================

  for (
    let i = 0;
    i < paidSpins;
    i++
  ) {

    const base =
      makeSpin(
        config,
        activeLines,
        betPerLine
      );


    // --------------------------------------------------------
    // BASE GAME
    // --------------------------------------------------------

    baseWins +=
      base.totalWin;


    if (
      base.totalWin > 0
    ) {

      paidWinningSpins++;
    }


    if (
      base.totalWin
      > maxBaseSpinWin
    ) {

      maxBaseSpinWin =
        base.totalWin;
    }


    // --------------------------------------------------------
    // FREE TRIGGER DA SPIN PAGATO
    // --------------------------------------------------------

    if (
      base.freeAwarded > 0
    ) {

      paidFreeTriggers++;
    }


    // --------------------------------------------------------
    // BONUS DA SPIN PAGATO
    // --------------------------------------------------------

    if (
      base.bonusMultiplier
      != null
    ) {

      paidBonusTriggers++;


      bonusMultipliers.set(
        base.bonusMultiplier,
        (
          bonusMultipliers.get(
            base.bonusMultiplier
          )
          || 0
        ) + 1
      );


      const bonus =
        playBonus(
          totalBetPerSpin,
          base.bonusMultiplier
        );


      bonusWins +=
        bonus.win;


      bonusSumMultipliers +=
        bonus.sumMultiplier;


      bonusGamesPlayed++;


      if (
        bonus.win
        > maxBonusWin
      ) {

        maxBonusWin =
          bonus.win;
      }


      if (
        bonus.sumMultiplier
        > maxBonusSumMultiplier
      ) {

        maxBonusSumMultiplier =
          bonus.sumMultiplier;
      }
    }


    // ========================================================
    // FREE SPINS
    // ========================================================

    let queue =
      base.freeAwarded;


    let freeFeatureWin = 0;


    let freeSpinsForThisPaidSpin = 0;


    while (
      queue > 0
    ) {

      queue--;


      freeSpinsPlayed++;


      freeSpinsForThisPaidSpin++;


      if (
        freeSpinsForThisPaidSpin
        > MAX_FREE_SPINS_PER_PAID
      ) {

        throw new Error(
          `Catena free spin superiore a ` +
          `${MAX_FREE_SPINS_PER_PAID}. ` +
          `Controllare peso FREE e retrigger.`
        );
      }


      const fs =
        makeSpin(
          config,
          activeLines,
          betPerLine
        );


      // ------------------------------------------------------
      // VINCITE FREE SPIN
      // ------------------------------------------------------

      freeWins +=
        fs.totalWin;


      freeFeatureWin +=
        fs.totalWin;


      if (
        fs.totalWin > 0
      ) {

        freeWinningSpins++;
      }


      if (
        fs.totalWin
        > maxFreeSpinWin
      ) {

        maxFreeSpinWin =
          fs.totalWin;
      }


      // ------------------------------------------------------
      // RETRIGGER FREE
      // ------------------------------------------------------

      if (
        fs.freeAwarded > 0
      ) {

        freeRetriggers++;


        queue +=
          fs.freeAwarded;
      }


      // ------------------------------------------------------
      // BONUS DURANTE FREE SPIN
      //
      // Il bonus usa la puntata totale originale.
      // ------------------------------------------------------

      if (
        fs.bonusMultiplier
        != null
      ) {

        freeBonusTriggers++;


        bonusMultipliers.set(
          fs.bonusMultiplier,
          (
            bonusMultipliers.get(
              fs.bonusMultiplier
            )
            || 0
          ) + 1
        );


        const bonus =
          playBonus(
            totalBetPerSpin,
            fs.bonusMultiplier
          );


        bonusWins +=
          bonus.win;


        bonusSumMultipliers +=
          bonus.sumMultiplier;


        bonusGamesPlayed++;


        if (
          bonus.win
          > maxBonusWin
        ) {

          maxBonusWin =
            bonus.win;
        }


        if (
          bonus.sumMultiplier
          > maxBonusSumMultiplier
        ) {

          maxBonusSumMultiplier =
            bonus.sumMultiplier;
        }
      }
    }


    if (
      freeFeatureWin
      > maxFeatureFreeWin
    ) {

      maxFeatureFreeWin =
        freeFeatureWin;
    }
  }


  // ==========================================================
  // RTP
  // ==========================================================

  const baseRtp =
    baseWins
    / totalPaidBet;


  const freeRtp =
    freeWins
    / totalPaidBet;


  const bonusRtp =
    bonusWins
    / totalPaidBet;


  const totalRtp =
    (
      baseWins
      +
      freeWins
      +
      bonusWins
    )
    /
    totalPaidBet;


  // ==========================================================
  // ALTRE STATISTICHE
  // ==========================================================

  const totalSpinsPlayed =
    paidSpins
    +
    freeSpinsPlayed;


  const allBonusTriggers =
    paidBonusTriggers
    +
    freeBonusTriggers;


  const averageBonusSumMultiplier =
    bonusGamesPlayed > 0
      ? bonusSumMultipliers
        / bonusGamesPlayed
      : 0;


  return {

    activeLines,

    paidSpins,

    betPerLine,

    totalBetPerSpin,

    totalPaidBet,


    baseWins,

    freeWins,

    bonusWins,


    baseRtp,

    freeRtp,

    bonusRtp,

    totalRtp,


    paidHitFrequency:
      paidWinningSpins
      / paidSpins,


    freeHitFrequency:
      freeSpinsPlayed > 0
        ? freeWinningSpins
          / freeSpinsPlayed
        : 0,


    paidFreeTriggerFrequency:
      paidFreeTriggers
      / paidSpins,


    freeRetriggerFrequency:
      freeSpinsPlayed > 0
        ? freeRetriggers
          / freeSpinsPlayed
        : 0,


    freeSpinsPlayed,


    freeSpinsPerPaidSpin:
      freeSpinsPlayed
      / paidSpins,


    paidBonusTriggerFrequency:
      paidBonusTriggers
      / paidSpins,


    allBonusTriggerFrequency:
      totalSpinsPlayed > 0
        ? allBonusTriggers
          / totalSpinsPlayed
        : 0,


    paidBonusTriggers,

    freeBonusTriggers,

    bonusGamesPlayed,

    bonusMultipliers,

    averageBonusSumMultiplier,

    maxBonusSumMultiplier,


    maxBaseSpinWin,

    maxFreeSpinWin,

    maxFeatureFreeWin,

    maxBonusWin
  };
}


// ============================================================
// REPORT
// ============================================================

function printReport(
  game,
  result
) {

  console.log(
    "\n============================================================"
  );

  console.log(
    `${game.name} (${game.id})`
  );

  console.log(
    `Linee attive:        ${result.activeLines}`
  );

  console.log(
    `Bet/linea:           ${fmtInt(result.betPerLine)}`
  );

  console.log(
    `Bet/spin:            ${fmtInt(result.totalBetPerSpin)}`
  );

  console.log(
    `Spin pagati:         ${fmtInt(result.paidSpins)}`
  );


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `RTP base:            ${fmtPct(result.baseRtp)}`
  );

  console.log(
    `RTP free spins:      ${fmtPct(result.freeRtp)}`
  );

  console.log(
    `RTP bonus:           ${fmtPct(result.bonusRtp)}`
  );


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `RTP TOTALE:          ${fmtPct(result.totalRtp)}`
  );


  if (
    game.target_rtp != null
  ) {

    const target =
      Number(game.target_rtp)
      / 100;


    const diff =
      result.totalRtp
      - target;


    console.log(
      `RTP target DB:       ${fmtPct(target)}`
    );

    console.log(
      `Scostamento target:  ${
        diff >= 0 ? "+" : ""
      }${fmtPct(diff)}`
    );
  }


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `Hit frequency base:  ${fmtPct(result.paidHitFrequency)}`
  );

  console.log(
    `Hit frequency FREE:  ${fmtPct(result.freeHitFrequency)}`
  );


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `Trigger FREE:        ${fmtPct(result.paidFreeTriggerFrequency)} ` +
    `(${oneIn(result.paidFreeTriggerFrequency)})`
  );

  console.log(
    `Retrigger FREE:      ${fmtPct(result.freeRetriggerFrequency)}`
  );

  console.log(
    `Free spin giocati:   ${fmtInt(result.freeSpinsPlayed)}`
  );

  console.log(
    `Free spin / paid:    ${fmtNumber(result.freeSpinsPerPaidSpin, 5)}`
  );


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `BONUS da paid spin:  ${fmtInt(result.paidBonusTriggers)}`
  );

  console.log(
    `BONUS da free spin:  ${fmtInt(result.freeBonusTriggers)}`
  );

  console.log(
    `BONUS totali:        ${fmtInt(result.bonusGamesPlayed)}`
  );

  console.log(
    `Trigger BONUS paid:  ${fmtPct(result.paidBonusTriggerFrequency)} ` +
    `(${oneIn(result.paidBonusTriggerFrequency)})`
  );

  console.log(
    `Trigger BONUS all:   ${fmtPct(result.allBonusTriggerFrequency)}`
  );


  console.log(
    `BONUS x1/x3/x10:     ` +
    `${fmtInt(result.bonusMultipliers.get(1) || 0)} / ` +
    `${fmtInt(result.bonusMultipliers.get(3) || 0)} / ` +
    `${fmtInt(result.bonusMultipliers.get(10) || 0)}`
  );


  console.log(
    `Media 3 forzieri:    x${fmtNumber(result.averageBonusSumMultiplier, 2)}`
  );

  console.log(
    `Max somma forzieri:  x${fmtInt(result.maxBonusSumMultiplier)}`
  );


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `Max win base:        ${fmtInt(result.maxBaseSpinWin)} ` +
    `(${fmtNumber(
      result.maxBaseSpinWin
      / result.totalBetPerSpin,
      2
    )}x bet totale)`
  );


  console.log(
    `Max win free spin:   ${fmtInt(result.maxFreeSpinWin)} ` +
    `(${fmtNumber(
      result.maxFreeSpinWin
      / result.totalBetPerSpin,
      2
    )}x bet totale)`
  );


  console.log(
    `Max feature FREE:    ${fmtInt(result.maxFeatureFreeWin)} ` +
    `(${fmtNumber(
      result.maxFeatureFreeWin
      / result.totalBetPerSpin,
      2
    )}x bet totale)`
  );


  console.log(
    `Max BONUS:           ${fmtInt(result.maxBonusWin)} ` +
    `(${fmtNumber(
      result.maxBonusWin
      / result.totalBetPerSpin,
      2
    )}x bet totale)`
  );


  console.log(
    "============================================================"
  );
}


// ============================================================
// MAIN
// ============================================================

async function main() {

  console.log(
    `\nCarico "${gameId}" da Supabase...`
  );


  const config =
    await loadConfig(gameId);


  validateConfig(config);


  const allowedLines =
    (
      config.game.allowed_lines
      || []
    )
      .map(Number)
      .sort(
        (a, b) =>
          a - b
      );


  let lineTests;


  if (
    SIM_LINES === "all"
  ) {

    lineTests =
      allowedLines.length
        ? allowedLines
        : [
            Number(
              config.game.max_lines
            )
          ];

  } else {

    const lines =
      Number(SIM_LINES);


    if (
      !Number.isInteger(lines)
      ||
      lines <= 0
    ) {

      throw new Error(
        'SIM_LINES deve essere "all" oppure un intero positivo.'
      );
    }


    if (
      allowedLines.length
      &&
      !allowedLines.includes(lines)
    ) {

      throw new Error(
        `SIM_LINES=${lines} non consentito. ` +
        `Valori ammessi: ${allowedLines.join(", ")}`
      );
    }


    lineTests =
      [lines];
  }


  console.log(
    `Spin per configurazione: ${fmtInt(PAID_SPINS)}`
  );

  console.log(
    `Linee da testare: ${lineTests.join(", ")}`
  );

  console.log(
    `Bet per linea: ${fmtInt(BET_PER_LINE)}`
  );

  console.log(
    `Bonus forzieri: ${BONUS_CHESTS.join(", ")}`
  );

  console.log(
    "Il simulatore effettua solo letture iniziali da Supabase; " +
    "gli spin vengono poi simulati localmente."
  );


  for (
    const activeLines
    of lineTests
  ) {

    const started =
      Date.now();


    const result =
      simulate(
        config,
        activeLines,
        PAID_SPINS,
        BET_PER_LINE
      );


    printReport(
      config.game,
      result
    );


    const seconds =
      (
        Date.now()
        - started
      )
      / 1000;


    console.log(
      `Tempo simulazione: ${fmtNumber(seconds, 1)} s\n`
    );
  }
}


// ============================================================
// START
// ============================================================

main()
  .catch(
    (error) => {

      console.error(
        "\nERRORE SIMULATORE\n"
      );

      console.error(error);

      process.exit(1);
    }
  );
