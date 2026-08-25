#!/usr/bin/env node

/**
 * FRAUDULENT BANKRUPTCY - SLOT SIMULATOR V1
 * ============================================================
 *
 * game_id: bankrupt
 *
 * Legge da Supabase:
 *   - slot_games
 *   - slot_symbols
 *   - paylines
 *
 * Poi simula tutto LOCALMENTE.
 *
 * NON scrive nel database.
 * NON modifica saldi.
 * NON crea spin/sessioni.
 *
 * MECCANICHE BANKRUPT
 * ------------------------------------------------------------
 * Griglia: 3x3
 * Linee: 1 / 2 / 3 / 4 / 5
 * Bet per linea: 1
 *
 * FREE:
 *   3 FREE = 10 Free Spin
 *   Durante i FREE:
 *   3 FREE = +10 retrigger
 *
 * BONUS:
 *   3 BONUS = Bonus Game
 *
 *   10 valigette:
 *   x2, x3, x5, x8, x10,
 *   x20, x50, x100, x200, x500
 *
 *   Il giocatore sceglie UNA valigetta.
 *
 *   Vincita bonus =
 *     moltiplicatore valigetta
 *     x puntata totale dello spin
 *
 * Il BONUS può attivarsi anche durante un FREE.
 *
 * RNG:
 *   rejection sampling per intero rullo.
 *
 * Ogni cella viene estratta indipendentemente dalla distribuzione
 * completa dei pesi. Se a fine rullo viene violato max_per_reel,
 * l'intero rullo viene scartato e rigenerato.
 *
 * ============================================================
 *
 * VARIABILI AMBIENTE OBBLIGATORIE:
 *
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * FACOLTATIVE:
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
 *   $env:SIM_LINES="all"
 *   $env:SIM_BET="1"
 *
 *   node .\bankrupt-simulator.mjs
 *
 * Per test finale più preciso:
 *
 *   $env:SIM_SPINS="10000000"
 *   $env:SIM_LINES="5"
 *   node .\bankrupt-simulator.mjs
 *
 * ============================================================
 */


// ============================================================
// CONFIG
// ============================================================

const GAME_ID =
  "bankrupt";


const SUPABASE_URL =
  process.env.SUPABASE_URL;


const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


const PAID_SPINS =
  Number(
    process.env.SIM_SPINS
    || 200000
  );


const BET_PER_LINE =
  Number(
    process.env.SIM_BET
    || 1
  );


const SIM_LINES =
  (
    process.env.SIM_LINES
    || "all"
  )
    .trim()
    .toLowerCase();


const MAX_FREE_SPINS_PER_PAID =
  Number(
    process.env.MAX_FREE_SPINS_PER_PAID
    || 100000
  );


// ============================================================
// BONUS BANKRUPT
// ============================================================

const BONUS_MULTIPLIERS = [
  2,
  3,
  5,
  8,
  10,
  20,
  50,
  100,
  200,
  500
];


// ============================================================
// CONTROLLI INIZIALI
// ============================================================

if (
  !SUPABASE_URL
  ||
  !SERVICE_KEY
) {

  console.error(
    "\nERRORE:\n" +
    "Mancano SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n"
  );

  process.exit(1);
}


if (
  !Number.isInteger(
    PAID_SPINS
  )
  ||
  PAID_SPINS <= 0
) {

  console.error(
    "SIM_SPINS deve essere un intero positivo."
  );

  process.exit(1);
}


if (
  !Number.isFinite(
    BET_PER_LINE
  )
  ||
  BET_PER_LINE <= 0
) {

  console.error(
    "SIM_BET deve essere un numero positivo."
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


async function rest(
  path
) {

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/${path}`,
      {
        headers
      }
    );


  if (
    !response.ok
  ) {

    const text =
      await response.text();


    throw new Error(
      `Supabase REST ${response.status}: ${text}`
    );
  }


  return await response.json();
}


// ============================================================
// FORMAT
// ============================================================

function fmtInt(
  value
) {

  return Math.round(
    Number(value || 0)
  )
    .toLocaleString(
      "it-IT"
    );
}


function fmtNumber(
  value,
  digits = 2
) {

  return Number(
    value || 0
  )
    .toFixed(
      digits
    )
    .replace(
      ".",
      ","
    );
}


function fmtPct(
  value,
  digits = 3
) {

  return (
    (
      Number(value || 0)
      * 100
    )
      .toFixed(
        digits
      )
      .replace(
        ".",
        ","
      )
    +
    "%"
  );
}


function oneIn(
  probability
) {

  if (
    !(probability > 0)
  ) {

    return "mai osservato";
  }


  return (
    "1 ogni "
    +
    (
      1
      /
      probability
    )
      .toFixed(1)
      .replace(
        ".",
        ","
      )
    +
    " spin"
  );
}


// ============================================================
// BONUS
// ============================================================

function playBonus(
  totalBet
) {

  const index =
    Math.floor(
      Math.random()
      *
      BONUS_MULTIPLIERS.length
    );


  const multiplier =
    BONUS_MULTIPLIERS[
      index
    ];


  const win =
    multiplier
    *
    totalBet;


  return {

    multiplier,

    win
  };
}


// ============================================================
// ESTRAZIONE PESATA
// ============================================================

function weightedPick(
  symbols
) {

  let totalWeight =
    0;


  for (
    const symbol
    of symbols
  ) {

    totalWeight +=
      Number(
        symbol.weight
      );
  }


  if (
    !(totalWeight > 0)
  ) {

    throw new Error(
      "Peso totale simboli non valido."
    );
  }


  let rnd =
    Math.random()
    *
    totalWeight;


  for (
    const symbol
    of symbols
  ) {

    rnd -=
      Number(
        symbol.weight
      );


    if (
      rnd < 0
    ) {

      return symbol;
    }
  }


  return symbols[
    symbols.length - 1
  ];
}


// ============================================================
// REJECTION SAMPLING PER INTERO RULLO
// ============================================================

function generateReel(
  symbols,
  rows
) {

  const MAX_RETRIES =
    10000;


  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {

    const reel =
      [];


    const counts =
      new Map();


    /*
     * Estrazioni indipendenti dalla distribuzione completa.
     */
    for (
      let row = 0;
      row < rows;
      row++
    ) {

      const symbol =
        weightedPick(
          symbols
        );


      reel.push(
        symbol.code
      );


      counts.set(
        symbol.code,
        (
          counts.get(
            symbol.code
          )
          || 0
        )
        + 1
      );
    }


    /*
     * I vincoli vengono controllati soltanto
     * DOPO aver generato tutto il rullo.
     */
    let valid =
      true;


    for (
      const symbol
      of symbols
    ) {

      if (
        symbol.max_per_reel
        == null
      ) {

        continue;
      }


      if (
        (
          counts.get(
            symbol.code
          )
          || 0
        )
        >
        Number(
          symbol.max_per_reel
        )
      ) {

        valid =
          false;

        break;
      }
    }


    if (
      valid
    ) {

      return reel;
    }
  }


  throw new Error(
    "Impossibile generare una colonna valida dopo " +
    `${MAX_RETRIES} tentativi. ` +
    "Controllare weight/max_per_reel."
  );
}


// ============================================================
// GENERA + VALUTA UNO SPIN
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
  } =
    config;


  const reels =
    Number(
      game.reels
    );


  const rows =
    Number(
      game.rows
    );


  const grid =
    Array.from(
      {
        length:
          reels
      },
      () =>
        Array(
          rows
        ).fill(
          null
        )
    );


  let freeCount =
    0;


  let bonusCount =
    0;


  // ==========================================================
  // GRIGLIA
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
        generatedReel[
          row
        ];


      grid[
        reel
      ][
        row
      ] =
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
  // PAYLINES
  // ==========================================================

  let totalWin =
    0;


  let winningLineCount =
    0;


  for (
    const line
    of paylines
  ) {

    if (
      Number(
        line.line_no
      )
      >
      activeLines
    ) {

      break;
    }


    const pattern =
      line.pattern
        .map(
          Number
        );


    const lineSymbols =
      [];


    for (
      let reel = 0;
      reel < reels;
      reel++
    ) {

      lineSymbols.push(
        grid[
          reel
        ][
          pattern[
            reel
          ]
        ]
      );
    }


    /*
     * WILD sostituisce NORMAL.
     * FREE/BONUS interrompono la sequenza.
     * Una linea composta solo da WILD non paga.
     */
    let target =
      null;


    for (
      const code
      of lineSymbols
    ) {

      if (
        code === "WILD"
      ) {

        continue;
      }


      const symbol =
        symbolByCode.get(
          code
        );


      if (
        symbol?.symbol_type
        === "normal"
      ) {

        target =
          code;

        break;
      }


      break;
    }


    if (
      !target
    ) {

      continue;
    }


    let count =
      0;


    for (
      const code
      of lineSymbols
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


    if (
      count < 3
    ) {

      continue;
    }


    const symbol =
      symbolByCode.get(
        target
      );


    const multiplier =
      Number(
        symbol[
          `payout_${count}`
        ]
      );


    if (
      !(multiplier > 0)
    ) {

      continue;
    }


    const lineWin =
      Math.floor(
        betPerLine
        *
        multiplier
      );


    totalWin +=
      lineWin;


    winningLineCount++;
  }


  // ==========================================================
  // FREE
  // ==========================================================
  //
  // Bankrupt è 3x3:
  // max 1 FREE per rullo.
  // Quindi il trigger possibile è solo 3 FREE.
  // ==========================================================

  const freeAwarded =
    freeCount === 3
      ? 10
      : 0;


  // ==========================================================
  // BONUS
  // ==========================================================
  //
  // Anche BONUS max 1/rullo:
  // trigger soltanto con 3 BONUS.
  // ==========================================================

  const bonusTriggered =
    bonusCount === 3;


  return {

    grid,

    totalWin,

    winningLineCount,

    freeCount,

    freeAwarded,

    bonusCount,

    bonusTriggered
  };
}


// ============================================================
// CONFIG DA SUPABASE
// ============================================================

async function loadConfig() {

  const games =
    await rest(
      `slot_games` +
      `?id=eq.${encodeURIComponent(GAME_ID)}` +
      `&select=*`
    );


  if (
    games.length !== 1
  ) {

    throw new Error(
      `Slot "${GAME_ID}" non trovata.`
    );
  }


  const game =
    games[
      0
    ];


  const symbols =
    await rest(
      `slot_symbols` +
      `?game_id=eq.${encodeURIComponent(GAME_ID)}` +
      `&select=*` +
      `&order=sort_order.asc`
    );


  if (
    !symbols.length
  ) {

    throw new Error(
      `Nessun simbolo configurato per "${GAME_ID}".`
    );
  }


  const paylines =
    await rest(
      `paylines` +
      `?set_id=eq.${encodeURIComponent(game.payline_set_id)}` +
      `&select=line_no,pattern` +
      `&order=line_no.asc`
    );


  if (
    !paylines.length
  ) {

    throw new Error(
      `Nessuna payline configurata per "${game.payline_set_id}".`
    );
  }


  const symbolByCode =
    new Map(
      symbols.map(
        symbol =>
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
// VALIDAZIONE
// ============================================================

function validateConfig(
  config
) {

  const {
    game,
    symbols,
    paylines,
    symbolByCode
  } =
    config;


  if (
    Number(
      game.reels
    ) !== 3
    ||
    Number(
      game.rows
    ) !== 3
  ) {

    throw new Error(
      `Bankrupt deve essere 3x3. ` +
      `DB: ${game.reels}x${game.rows}`
    );
  }


  for (
    const code
    of [
      "WILD",
      "FREE",
      "BONUS"
    ]
  ) {

    if (
      !symbolByCode.has(
        code
      )
    ) {

      throw new Error(
        `Simbolo obbligatorio mancante: ${code}`
      );
    }
  }


  const normals =
    symbols.filter(
      symbol =>
        symbol.symbol_type
        === "normal"
    );


  if (
    normals.length !== 10
  ) {

    console.warn(
      `ATTENZIONE: attesi 10 NORMAL, trovati ${normals.length}.`
    );
  }


  const free =
    symbolByCode.get(
      "FREE"
    );


  const bonus =
    symbolByCode.get(
      "BONUS"
    );


  if (
    Number(
      free.max_per_reel
    ) !== 1
  ) {

    console.warn(
      "ATTENZIONE: FREE dovrebbe avere max_per_reel = 1."
    );
  }


  if (
    Number(
      bonus.max_per_reel
    ) !== 1
  ) {

    console.warn(
      "ATTENZIONE: BONUS dovrebbe avere max_per_reel = 1."
    );
  }


  for (
    const line
    of paylines
  ) {

    if (
      !Array.isArray(
        line.pattern
      )
      ||
      line.pattern.length
      !== 3
    ) {

      throw new Error(
        `Payline ${line.line_no} non valida per una 3x3.`
      );
    }


    for (
      const row
      of line.pattern
    ) {

      if (
        Number(row) < 0
        ||
        Number(row) >= 3
      ) {

        throw new Error(
          `Payline ${line.line_no}: riga ${row} fuori griglia.`
        );
      }
    }
  }


  const allowedLines =
    (
      game.allowed_lines
      || []
    )
      .map(
        Number
      );


  if (
    allowedLines.length
    &&
    allowedLines.some(
      lines =>
        ![
          1,
          2,
          3,
          4,
          5
        ].includes(
          lines
        )
    )
  ) {

    console.warn(
      `ATTENZIONE allowed_lines: ${allowedLines.join(", ")}`
    );
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
    *
    betPerLine;


  const totalPaidBet =
    paidSpins
    *
    totalBetPerSpin;


  // VINCITE
  let baseWins =
    0;


  let freeLineWins =
    0;


  let bonusWins =
    0;


  // HIT
  let paidWinningSpins =
    0;


  let freeWinningSpins =
    0;


  // FREE
  let paidFreeTriggers =
    0;


  let freeRetriggers =
    0;


  let freeSpinsPlayed =
    0;


  // BONUS
  let paidBonusTriggers =
    0;


  let freeBonusTriggers =
    0;


  let bonusGamesPlayed =
    0;


  const bonusDistribution =
    new Map(
      BONUS_MULTIPLIERS.map(
        value =>
          [
            value,
            0
          ]
      )
    );


  let bonusMultiplierSum =
    0;


  // MAX
  let maxBaseSpinWin =
    0;


  let maxFreeSpinWin =
    0;


  let maxFreeFeatureWin =
    0;


  let maxBonusWin =
    0;


  let maxBonusMultiplier =
    0;


  // ==========================================================
  // SPIN PAGATI
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


    baseWins +=
      base.totalWin;


    if (
      base.totalWin > 0
    ) {

      paidWinningSpins++;
    }


    if (
      base.totalWin
      >
      maxBaseSpinWin
    ) {

      maxBaseSpinWin =
        base.totalWin;
    }


    if (
      base.freeAwarded > 0
    ) {

      paidFreeTriggers++;
    }


    // --------------------------------------------------------
    // BONUS DA PAID
    // --------------------------------------------------------

    if (
      base.bonusTriggered
    ) {

      paidBonusTriggers++;


      const bonus =
        playBonus(
          totalBetPerSpin
        );


      bonusWins +=
        bonus.win;


      bonusGamesPlayed++;


      bonusMultiplierSum +=
        bonus.multiplier;


      bonusDistribution.set(
        bonus.multiplier,
        (
          bonusDistribution.get(
            bonus.multiplier
          )
          || 0
        )
        + 1
      );


      if (
        bonus.win
        >
        maxBonusWin
      ) {

        maxBonusWin =
          bonus.win;
      }


      if (
        bonus.multiplier
        >
        maxBonusMultiplier
      ) {

        maxBonusMultiplier =
          bonus.multiplier;
      }
    }


    // ========================================================
    // FREE FEATURE
    // ========================================================

    let queue =
      base.freeAwarded;


    let featureWin =
      0;


    let freeSpinsForThisPaidSpin =
      0;


    while (
      queue > 0
    ) {

      queue--;


      freeSpinsPlayed++;


      freeSpinsForThisPaidSpin++;


      if (
        freeSpinsForThisPaidSpin
        >
        MAX_FREE_SPINS_PER_PAID
      ) {

        throw new Error(
          "Catena FREE troppo lunga. " +
          "Controllare peso/retrigger FREE."
        );
      }


      const fs =
        makeSpin(
          config,
          activeLines,
          betPerLine
        );


      freeLineWins +=
        fs.totalWin;


      featureWin +=
        fs.totalWin;


      if (
        fs.totalWin > 0
      ) {

        freeWinningSpins++;
      }


      if (
        fs.totalWin
        >
        maxFreeSpinWin
      ) {

        maxFreeSpinWin =
          fs.totalWin;
      }


      // RETRIGGER
      if (
        fs.freeAwarded > 0
      ) {

        freeRetriggers++;


        queue +=
          fs.freeAwarded;
      }


      // BONUS DURANTE FREE
      if (
        fs.bonusTriggered
      ) {

        freeBonusTriggers++;


        const bonus =
          playBonus(
            totalBetPerSpin
          );


        bonusWins +=
          bonus.win;


        /*
         * Per il massimo della feature FREE includiamo anche
         * i bonus attivati all'interno della sessione.
         */
        featureWin +=
          bonus.win;


        bonusGamesPlayed++;


        bonusMultiplierSum +=
          bonus.multiplier;


        bonusDistribution.set(
          bonus.multiplier,
          (
            bonusDistribution.get(
              bonus.multiplier
            )
            || 0
          )
          + 1
        );


        if (
          bonus.win
          >
          maxBonusWin
        ) {

          maxBonusWin =
            bonus.win;
        }


        if (
          bonus.multiplier
          >
          maxBonusMultiplier
        ) {

          maxBonusMultiplier =
            bonus.multiplier;
        }
      }
    }


    if (
      featureWin
      >
      maxFreeFeatureWin
    ) {

      maxFreeFeatureWin =
        featureWin;
    }
  }


  // ==========================================================
  // RTP
  // ==========================================================

  const baseRtp =
    baseWins
    /
    totalPaidBet;


  const freeRtp =
    freeLineWins
    /
    totalPaidBet;


  const bonusRtp =
    bonusWins
    /
    totalPaidBet;


  const totalRtp =
    (
      baseWins
      +
      freeLineWins
      +
      bonusWins
    )
    /
    totalPaidBet;


  const totalSpinsPlayed =
    paidSpins
    +
    freeSpinsPlayed;


  const allBonusTriggers =
    paidBonusTriggers
    +
    freeBonusTriggers;


  const averageBonusMultiplier =
    bonusGamesPlayed > 0
      ? bonusMultiplierSum
        /
        bonusGamesPlayed
      : 0;


  const expectedNetPerPaidSpin =
    (
      totalRtp
      -
      1
    )
    *
    totalBetPerSpin;


  return {

    activeLines,

    betPerLine,

    totalBetPerSpin,

    paidSpins,

    totalPaidBet,


    baseWins,

    freeLineWins,

    bonusWins,


    baseRtp,

    freeRtp,

    bonusRtp,

    totalRtp,


    paidHitFrequency:
      paidWinningSpins
      /
      paidSpins,


    freeHitFrequency:
      freeSpinsPlayed > 0
        ? freeWinningSpins
          /
          freeSpinsPlayed
        : 0,


    paidFreeTriggers,

    paidFreeTriggerFrequency:
      paidFreeTriggers
      /
      paidSpins,


    freeRetriggers,

    freeRetriggerFrequency:
      freeSpinsPlayed > 0
        ? freeRetriggers
          /
          freeSpinsPlayed
        : 0,


    freeSpinsPlayed,

    freeSpinsPerPaidSpin:
      freeSpinsPlayed
      /
      paidSpins,


    paidBonusTriggers,

    freeBonusTriggers,

    bonusGamesPlayed,


    paidBonusTriggerFrequency:
      paidBonusTriggers
      /
      paidSpins,


    allBonusTriggerFrequency:
      totalSpinsPlayed > 0
        ? allBonusTriggers
          /
          totalSpinsPlayed
        : 0,


    bonusDistribution,

    averageBonusMultiplier,

    maxBonusMultiplier,


    maxBaseSpinWin,

    maxFreeSpinWin,

    maxFreeFeatureWin,

    maxBonusWin,


    expectedNetPerPaidSpin
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
    `Griglia:              ${game.reels}x${game.rows}`
  );


  console.log(
    `Linee attive:         ${result.activeLines}`
  );


  console.log(
    `Bet/linea:            ${fmtNumber(result.betPerLine, 2)}`
  );


  console.log(
    `Bet/spin:             ${fmtNumber(result.totalBetPerSpin, 2)}`
  );


  console.log(
    `Spin pagati:          ${fmtInt(result.paidSpins)}`
  );


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `RTP base:             ${fmtPct(result.baseRtp)}`
  );


  console.log(
    `RTP FREE:             ${fmtPct(result.freeRtp)}`
  );


  console.log(
    `RTP BONUS:            ${fmtPct(result.bonusRtp)}`
  );


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `RTP TOTALE:           ${fmtPct(result.totalRtp)}`
  );


  if (
    game.target_rtp
    != null
  ) {

    const target =
      Number(
        game.target_rtp
      )
      /
      100;


    const difference =
      result.totalRtp
      -
      target;


    console.log(
      `RTP target DB:        ${fmtPct(target)}`
    );


    console.log(
      `Scostamento target:   ${
        difference >= 0
          ? "+"
          : ""
      }${fmtPct(difference)}`
    );
  }


  console.log(
    `Netto medio/spin:     ${
      result.expectedNetPerPaidSpin >= 0
        ? "+"
        : ""
    }${fmtNumber(result.expectedNetPerPaidSpin, 3)} fiche`
  );


  if (
    result.expectedNetPerPaidSpin > 0
  ) {

    console.log(
      `Spin medi per +5000:  ${fmtInt(
        5000
        /
        result.expectedNetPerPaidSpin
      )}`
    );
  }


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `Hit frequency paid:   ${fmtPct(result.paidHitFrequency)}`
  );


  console.log(
    `Hit frequency FREE:   ${fmtPct(result.freeHitFrequency)}`
  );


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `Trigger FREE paid:    ${fmtPct(result.paidFreeTriggerFrequency)} ` +
    `(${oneIn(result.paidFreeTriggerFrequency)})`
  );


  console.log(
    `Retrigger FREE:       ${fmtPct(result.freeRetriggerFrequency)} ` +
    `(${oneIn(result.freeRetriggerFrequency)})`
  );


  console.log(
    `Free spin giocati:    ${fmtInt(result.freeSpinsPlayed)}`
  );


  console.log(
    `Free spin / paid:     ${fmtNumber(result.freeSpinsPerPaidSpin, 5)}`
  );


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `BONUS da paid:        ${fmtInt(result.paidBonusTriggers)}`
  );


  console.log(
    `BONUS da FREE:        ${fmtInt(result.freeBonusTriggers)}`
  );


  console.log(
    `BONUS totali:         ${fmtInt(result.bonusGamesPlayed)}`
  );


  console.log(
    `Trigger BONUS paid:   ${fmtPct(result.paidBonusTriggerFrequency)} ` +
    `(${oneIn(result.paidBonusTriggerFrequency)})`
  );


  console.log(
    `Trigger BONUS all:    ${fmtPct(result.allBonusTriggerFrequency)} ` +
    `(${oneIn(result.allBonusTriggerFrequency)})`
  );


  console.log(
    `Moltiplicatore medio: x${fmtNumber(result.averageBonusMultiplier, 2)}`
  );


  console.log(
    `Max moltiplicatore:   x${fmtInt(result.maxBonusMultiplier)}`
  );


  console.log(
    "Distribuzione BONUS:"
  );


  for (
    const multiplier
    of BONUS_MULTIPLIERS
  ) {

    const count =
      result.bonusDistribution.get(
        multiplier
      )
      || 0;


    const frequency =
      result.bonusGamesPlayed > 0
        ? count
          /
          result.bonusGamesPlayed
        : 0;


    console.log(
      `  x${String(multiplier).padEnd(3, " ")} ` +
      `${fmtInt(count).padStart(10, " ")}  ` +
      `${fmtPct(frequency, 2)}`
    );
  }


  console.log(
    "------------------------------------------------------------"
  );


  console.log(
    `Max win base:         ${fmtInt(result.maxBaseSpinWin)} ` +
    `(${fmtNumber(
      result.maxBaseSpinWin
      /
      result.totalBetPerSpin,
      2
    )}x bet totale)`
  );


  console.log(
    `Max win FREE spin:    ${fmtInt(result.maxFreeSpinWin)} ` +
    `(${fmtNumber(
      result.maxFreeSpinWin
      /
      result.totalBetPerSpin,
      2
    )}x bet totale)`
  );


  console.log(
    `Max feature FREE:     ${fmtInt(result.maxFreeFeatureWin)} ` +
    `(${fmtNumber(
      result.maxFreeFeatureWin
      /
      result.totalBetPerSpin,
      2
    )}x bet totale)`
  );


  console.log(
    `Max BONUS:            ${fmtInt(result.maxBonusWin)} ` +
    `(${fmtNumber(
      result.maxBonusWin
      /
      result.totalBetPerSpin,
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
    `\nCarico "${GAME_ID}" da Supabase...`
  );


  const config =
    await loadConfig();


  validateConfig(
    config
  );


  const allowedLines =
    (
      config.game.allowed_lines
      || []
    )
      .map(
        Number
      )
      .sort(
        (
          a,
          b
        ) =>
          a - b
      );


  let lineTests;


  if (
    SIM_LINES
    === "all"
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
      Number(
        SIM_LINES
      );


    if (
      !Number.isInteger(
        lines
      )
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
      !allowedLines.includes(
        lines
      )
    ) {

      throw new Error(
        `SIM_LINES=${lines} non consentito. ` +
        `Valori ammessi: ${allowedLines.join(", ")}`
      );
    }


    lineTests =
      [
        lines
      ];
  }


  console.log(
    `Spin per configurazione: ${fmtInt(PAID_SPINS)}`
  );


  console.log(
    `Linee testate: ${lineTests.join(", ")}`
  );


  console.log(
    `Bet per linea: ${fmtNumber(BET_PER_LINE, 2)}`
  );


  console.log(
    `BONUS: ${BONUS_MULTIPLIERS.map(v => `x${v}`).join(", ")}`
  );


  console.log(
    "FREE: 3 scatter = 10 spin; retrigger = +10."
  );


  console.log(
    "RNG: rejection sampling per intero rullo."
  );


  console.log(
    "Il database viene solamente letto all'avvio; " +
    "la simulazione è locale."
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
        -
        started
      )
      /
      1000;


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
    error => {

      console.error(
        "\nERRORE SIMULATORE\n"
      );


      console.error(
        error
      );


      process.exit(
        1
      );
    }
  );
