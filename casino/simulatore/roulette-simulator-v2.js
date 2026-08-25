#!/usr/bin/env node
"use strict";

/**
 * Simulatore Roulette Europea
 *
 * Nessuna dipendenza esterna.
 *
 * Esempi:
 *
 *   node roulette-simulator.js --spins 1000000 --seed 12345 --bet RED:100
 *
 *   node roulette-simulator.js --spins 1000000 --seed 12345 \
 *     --bet RED:100,N_17:20,DOZEN_1:50
 *
 *   node roulette-simulator.js --spins 1000000 --seed 12345 \
 *     --bankroll 100000 --mode stop --bet RED:100
 *
 *   node roulette-simulator.js --list-bets
 */

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9,
  12, 14, 16, 18,
  19, 21, 23, 25, 27,
  30, 32, 34, 36
]);

const THEORETICAL_RTP = 36 / 37 * 100;


// ============================================================
// ARGOMENTI CLI
// ============================================================

function parseArgs(argv) {
  const out = {
    spins: 1000000,
    seed: "12345",
    bankroll: 1000000,
    mode: "infinite",
    bet: "RED:100",
    listBets: false,
    quiet: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--spins") {
      out.spins = Number(argv[++i]);
    } else if (arg === "--seed") {
      out.seed = String(argv[++i]);
    } else if (arg === "--bankroll") {
      out.bankroll = Number(argv[++i]);
    } else if (arg === "--mode") {
      out.mode = String(argv[++i]).toLowerCase();
    } else if (arg === "--bet") {
      out.bet = String(argv[++i]);
    } else if (arg === "--list-bets") {
      out.listBets = true;
    } else if (arg === "--quiet") {
      out.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Argomento sconosciuto: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  if (
    !Number.isInteger(out.spins) ||
    out.spins <= 0
  ) {
    throw new Error("--spins deve essere un intero > 0");
  }

  if (
    !Number.isFinite(out.bankroll) ||
    out.bankroll < 0
  ) {
    throw new Error("--bankroll deve essere >= 0");
  }

  if (!["infinite", "stop"].includes(out.mode)) {
    throw new Error("--mode deve essere infinite oppure stop");
  }

  return out;
}


function printHelp() {
  console.log(`
SIMULATORE ROULETTE EUROPEA

Uso:

  node roulette-simulator.js [opzioni]

Opzioni:

  --spins N
      Numero di giri.
      Default: 1000000

  --seed VALORE
      Seed del generatore casuale.
      Default: 12345

  --bet "CODICE:IMPORTO,CODICE:IMPORTO,..."
      Strategia ripetuta a ogni giro.

      Esempi:
        --bet RED:100
        --bet N_17:100
        --bet RED:100,N_17:20,DOZEN_1:50

  --bankroll N
      Bankroll iniziale.
      Default: 1000000

  --mode infinite|stop
      infinite = continua anche se il bankroll teorico scende sotto zero
      stop     = termina quando non ci sono fiche sufficienti
      Default: infinite

  --list-bets
      Mostra tutti i codici puntata disponibili.

  --quiet
      Riduce l'output.

  --help
      Mostra questa guida.
`);
}


// ============================================================
// COSTRUZIONE PUNTATE
// ============================================================

function range(start, end, step = 1) {
  const out = [];

  for (let n = start; n <= end; n += step) {
    out.push(n);
  }

  return out;
}


function makeBet(
  code,
  type,
  label,
  numbers,
  payoutProfit
) {
  return {
    code,
    type,
    label,
    numbers,
    payoutProfit
  };
}


function buildBetOptions() {
  const out = [];


  // ==========================================================
  // STRAIGHT
  // ==========================================================

  for (let n = 0; n <= 36; n++) {
    out.push(
      makeBet(
        `N_${n}`,
        "straight",
        `${n}`,
        [n],
        35
      )
    );
  }


  // ==========================================================
  // SPLIT CON ZERO
  // ==========================================================

  out.push(
    makeBet(
      "SPLIT_0_1",
      "split",
      "0-1",
      [0, 1],
      17
    )
  );

  out.push(
    makeBet(
      "SPLIT_0_2",
      "split",
      "0-2",
      [0, 2],
      17
    )
  );

  out.push(
    makeBet(
      "SPLIT_0_3",
      "split",
      "0-3",
      [0, 3],
      17
    )
  );


  // ==========================================================
  // SPLIT ORIZZONTALI
  // ==========================================================

  for (let start = 1; start <= 34; start += 3) {

    out.push(
      makeBet(
        `SPLIT_${start}_${start + 1}`,
        "split",
        `${start}-${start + 1}`,
        [start, start + 1],
        17
      )
    );

    out.push(
      makeBet(
        `SPLIT_${start + 1}_${start + 2}`,
        "split",
        `${start + 1}-${start + 2}`,
        [start + 1, start + 2],
        17
      )
    );
  }


  // ==========================================================
  // SPLIT VERTICALI
  // ==========================================================

  for (let n = 1; n <= 33; n++) {

    out.push(
      makeBet(
        `SPLIT_${n}_${n + 3}`,
        "split",
        `${n}-${n + 3}`,
        [n, n + 3],
        17
      )
    );
  }


  // ==========================================================
  // STREET
  // ==========================================================

  for (let n = 1; n <= 34; n += 3) {

    out.push(
      makeBet(
        `STREET_${n}`,
        "street",
        `${n}-${n + 1}-${n + 2}`,
        [n, n + 1, n + 2],
        11
      )
    );
  }


  // ==========================================================
  // TRIO ZERO
  // ==========================================================

  out.push(
    makeBet(
      "TRIO_0_1_2",
      "trio",
      "0-1-2",
      [0, 1, 2],
      11
    )
  );

  out.push(
    makeBet(
      "TRIO_0_2_3",
      "trio",
      "0-2-3",
      [0, 2, 3],
      11
    )
  );


  // ==========================================================
  // CORNER
  // ==========================================================

  for (let rowStart = 1; rowStart <= 31; rowStart += 3) {

    for (let offset = 0; offset <= 1; offset++) {

      const n =
        rowStart + offset;

      out.push(
        makeBet(
          `CORNER_${n}`,
          "corner",
          `${n}-${n + 1}-${n + 3}-${n + 4}`,
          [
            n,
            n + 1,
            n + 3,
            n + 4
          ],
          8
        )
      );
    }
  }


  // ==========================================================
  // FIRST FOUR
  // ==========================================================

  out.push(
    makeBet(
      "FIRST_FOUR",
      "corner",
      "0-1-2-3",
      [0, 1, 2, 3],
      8
    )
  );


  // ==========================================================
  // SIX LINE
  // ==========================================================

  for (let n = 1; n <= 31; n += 3) {

    out.push(
      makeBet(
        `SIX_${n}`,
        "six_line",
        `${n}-${n + 5}`,
        [
          n,
          n + 1,
          n + 2,
          n + 3,
          n + 4,
          n + 5
        ],
        5
      )
    );
  }


  // ==========================================================
  // DOZZINE
  // ==========================================================

  out.push(
    makeBet(
      "DOZEN_1",
      "dozen",
      "1ª dozzina",
      range(1, 12),
      2
    )
  );

  out.push(
    makeBet(
      "DOZEN_2",
      "dozen",
      "2ª dozzina",
      range(13, 24),
      2
    )
  );

  out.push(
    makeBet(
      "DOZEN_3",
      "dozen",
      "3ª dozzina",
      range(25, 36),
      2
    )
  );


  // ==========================================================
  // COLONNE
  // ==========================================================

  out.push(
    makeBet(
      "COLUMN_1",
      "column",
      "1ª colonna",
      range(1, 34, 3),
      2
    )
  );

  out.push(
    makeBet(
      "COLUMN_2",
      "column",
      "2ª colonna",
      range(2, 35, 3),
      2
    )
  );

  out.push(
    makeBet(
      "COLUMN_3",
      "column",
      "3ª colonna",
      range(3, 36, 3),
      2
    )
  );


  // ==========================================================
  // CHANCE SEMPLICI
  // ==========================================================

  out.push(
    makeBet(
      "RED",
      "red_black",
      "Rosso",
      [...RED_NUMBERS],
      1
    )
  );

  out.push(
    makeBet(
      "BLACK",
      "red_black",
      "Nero",
      range(1, 36)
        .filter(
          n =>
            !RED_NUMBERS.has(n)
        ),
      1
    )
  );

  out.push(
    makeBet(
      "EVEN",
      "even_odd",
      "Pari",
      range(2, 36, 2),
      1
    )
  );

  out.push(
    makeBet(
      "ODD",
      "even_odd",
      "Dispari",
      range(1, 35, 2),
      1
    )
  );

  out.push(
    makeBet(
      "LOW",
      "low_high",
      "1-18",
      range(1, 18),
      1
    )
  );

  out.push(
    makeBet(
      "HIGH",
      "low_high",
      "19-36",
      range(19, 36),
      1
    )
  );


  if (out.length !== 157) {
    throw new Error(
      `Errore interno: attese 157 opzioni, trovate ${out.length}`
    );
  }

  return out;
}


const BET_OPTIONS =
  buildBetOptions();


const BET_MAP =
  new Map(
    BET_OPTIONS.map(
      bet => [
        bet.code,
        bet
      ]
    )
  );


// ============================================================
// PARSING STRATEGIA
// ============================================================

function parseStrategy(text) {

  if (!text?.trim()) {
    throw new Error(
      "Strategia vuota"
    );
  }


  const aggregated =
    new Map();


  for (
    const part
    of text.split(",")
  ) {

    const trimmed =
      part.trim();


    if (!trimmed) {
      continue;
    }


    const separator =
      trimmed.lastIndexOf(":");


    if (separator <= 0) {

      throw new Error(
        `Puntata non valida: ${trimmed}`
      );
    }


    const code =
      trimmed
        .slice(
          0,
          separator
        )
        .trim()
        .toUpperCase();


    const amount =
      Number(
        trimmed
          .slice(
            separator + 1
          )
      );


    const option =
      BET_MAP.get(code);


    if (!option) {

      throw new Error(
        `Codice puntata sconosciuto: ${code}`
      );
    }


    if (
      !Number.isFinite(amount)
      ||
      amount <= 0
    ) {

      throw new Error(
        `Importo non valido per ${code}`
      );
    }


    aggregated.set(
      code,
      (
        aggregated.get(code)
        || 0
      )
      +
      amount
    );
  }


  return [
    ...aggregated.entries()
  ]
    .map(
      ([code, amount]) => {

        const option =
          BET_MAP.get(code);


        return {
          ...option,
          amount
        };
      }
    );
}


// ============================================================
// PRNG CON SEED
// ============================================================

function xmur3(str) {

  let h =
    1779033703
    ^
    str.length;


  for (
    let i = 0;
    i < str.length;
    i++
  ) {

    h =
      Math.imul(
        h
        ^
        str.charCodeAt(i),
        3432918353
      );


    h =
      h << 13
      |
      h >>> 19;
  }


  return function () {

    h =
      Math.imul(
        h
        ^
        h >>> 16,
        2246822507
      );


    h =
      Math.imul(
        h
        ^
        h >>> 13,
        3266489909
      );


    return (
      h
      ^
      h >>> 16
    )
    >>> 0;
  };
}


function mulberry32(a) {

  return function () {

    let t =
      a +=
      0x6D2B79F5;


    t =
      Math.imul(
        t
        ^
        t >>> 15,
        t
        |
        1
      );


    t ^=
      t
      +
      Math.imul(
        t
        ^
        t >>> 7,
        t
        |
        61
      );


    return (
      (
        t
        ^
        t >>> 14
      )
      >>> 0
    )
    /
    4294967296;
  };
}


// ============================================================
// FORMAT
// ============================================================

function formatNumber(value) {

  return new Intl.NumberFormat(
    "it-IT",
    {
      maximumFractionDigits: 2
    }
  )
    .format(value);
}


function formatPct(value, decimals = 4) {

  return (
    Number(value)
      .toFixed(decimals)
      .replace(".", ",")
    +
    "%"
  );
}


function signed(value) {

  return (
    value > 0
      ? "+"
      : ""
  )
  +
  formatNumber(value);
}


// ============================================================
// SIMULAZIONE
// ============================================================

function simulate(config) {

  const strategy =
    parseStrategy(
      config.bet
    );


  const betPerSpin =
    strategy.reduce(
      (
        total,
        bet
      ) =>
        total
        +
        bet.amount,
      0
    );


  if (
    config.mode === "stop"
    &&
    config.bankroll < betPerSpin
  ) {

    throw new Error(
      "Bankroll insufficiente per il primo giro"
    );
  }


  const seedFactory =
    xmur3(
      config.seed
    );


  const random =
    mulberry32(
      seedFactory()
    );


  const numberCounts =
    new Array(37)
      .fill(0);


  const stats =
    strategy.map(
      bet => ({
        ...bet,
        hits: 0,
        totalReturn: 0
      })
    );


  let spins =
    0;


  let totalWager =
    0;


  let totalReturn =
    0;


  let hitSpins =
    0;


  let bankroll =
    config.bankroll;


  let peakBankroll =
    bankroll;


  let maxDrawdown =
    0;


  let minBankroll =
    bankroll;


  let maxBankroll =
    bankroll;


  const started =
    process.hrtime.bigint();


  for (
    let i = 0;
    i < config.spins;
    i++
  ) {

    if (
      config.mode === "stop"
      &&
      bankroll < betPerSpin
    ) {
      break;
    }


    bankroll -=
      betPerSpin;


    totalWager +=
      betPerSpin;


    const result =
      Math.floor(
        random()
        *
        37
      );


    numberCounts[
      result
    ]++;


    let spinReturn =
      0;


    for (
      const bet
      of stats
    ) {

      if (
        bet.numbers.includes(
          result
        )
      ) {

        const returned =
          bet.amount
          *
          (
            bet.payoutProfit
            +
            1
          );


        bet.hits++;


        bet.totalReturn +=
          returned;


        spinReturn +=
          returned;
      }
    }


    if (
      spinReturn > 0
    ) {

      hitSpins++;
    }


    bankroll +=
      spinReturn;


    totalReturn +=
      spinReturn;


    spins++;


    if (
      bankroll >
      peakBankroll
    ) {

      peakBankroll =
        bankroll;
    }


    if (
      bankroll >
      maxBankroll
    ) {

      maxBankroll =
        bankroll;
    }


    if (
      bankroll <
      minBankroll
    ) {

      minBankroll =
        bankroll;
    }


    const drawdown =
      peakBankroll
      -
      bankroll;


    if (
      drawdown >
      maxDrawdown
    ) {

      maxDrawdown =
        drawdown;
    }
  }


  const ended =
    process.hrtime.bigint();


  const elapsedSeconds =
    Number(
      ended
      -
      started
    )
    /
    1e9;


  const net =
    totalReturn
    -
    totalWager;


  const observedRtp =
    totalWager > 0
      ?
      totalReturn
      /
      totalWager
      *
      100
      :
      0;


  return {

    config,

    strategy,

    betPerSpin,

    spins,

    requestedSpins:
      config.spins,

    stoppedEarly:
      spins
      <
      config.spins,

    totalWager,

    totalReturn,

    net,

    observedRtp,

    theoreticalRtp:
      THEORETICAL_RTP,

    houseEdge:
      100
      -
      THEORETICAL_RTP,

    hitSpins,

    hitRate:
      spins
      ?
      hitSpins
      /
      spins
      *
      100
      :
      0,

    initialBankroll:
      config.bankroll,

    finalBankroll:
      bankroll,

    minBankroll,

    maxBankroll,

    maxDrawdown,

    numberCounts,

    betStats:
      stats,

    elapsedSeconds,

    spinsPerSecond:
      elapsedSeconds > 0
      ?
      spins
      /
      elapsedSeconds
      :
      0
  };
}


// ============================================================
// OUTPUT
// ============================================================

function printResult(result) {

  console.log("");
  console.log(
    "SIMULATORE ROULETTE EUROPEA"
  );
  console.log(
    "=".repeat(72)
  );


  console.log(
    `${formatNumber(result.spins)} giri` +
    ` · seed ${result.config.seed}` +
    ` · mode=${result.config.mode}`
  );


  console.log("");


  console.log(
    "STRATEGIA"
  );
  console.log(
    "-".repeat(72)
  );


  for (
    const bet
    of result.strategy
  ) {

    console.log(
      `${bet.code.padEnd(20)}` +
      `${bet.label.padEnd(18)}` +
      `${formatNumber(bet.amount).padStart(12)} fiche` +
      ` · ${bet.payoutProfit}:1`
    );
  }


  console.log(
    "-".repeat(72)
  );


  console.log(
    `Puntata/giro:        ${formatNumber(result.betPerSpin)}`
  );


  console.log("");
  console.log(
    "RISULTATI"
  );
  console.log(
    "-".repeat(72)
  );


  console.log(
    `Totale giocato:      ${formatNumber(result.totalWager)}`
  );


  console.log(
    `Totale restituito:   ${formatNumber(result.totalReturn)}`
  );


  console.log(
    `Netto:               ${signed(result.net)}`
  );


  console.log(
    `RTP osservato:       ${formatPct(result.observedRtp)}`
  );


  console.log(
    `RTP teorico:         ${formatPct(result.theoreticalRtp)}`
  );


  console.log(
    `Scostamento RTP:     ${(
      result.observedRtp
      -
      result.theoreticalRtp
    ).toFixed(4).replace(".", ",")} pp`
  );


  console.log(
    `Hit rate giro:       ${formatPct(result.hitRate, 3)}`
  );


  console.log("");
  console.log(
    "BANKROLL"
  );
  console.log(
    "-".repeat(72)
  );


  console.log(
    `Iniziale:            ${formatNumber(result.initialBankroll)}`
  );


  console.log(
    `Finale:              ${formatNumber(result.finalBankroll)}`
  );


  console.log(
    `Minimo:              ${formatNumber(result.minBankroll)}`
  );


  console.log(
    `Massimo:             ${formatNumber(result.maxBankroll)}`
  );


  console.log(
    `Max drawdown:        ${formatNumber(result.maxDrawdown)}`
  );


  if (
    result.stoppedEarly
  ) {

    console.log(
      `STOP:                saldo insufficiente dopo ${formatNumber(result.spins)} giri`
    );
  }


  console.log("");
  console.log(
    "DETTAGLIO PUNTATE"
  );
  console.log(
    "-".repeat(72)
  );


  for (
    const bet
    of result.betStats
  ) {

    const wager =
      bet.amount
      *
      result.spins;


    const net =
      bet.totalReturn
      -
      wager;


    const rtp =
      wager > 0
      ?
      bet.totalReturn
      /
      wager
      *
      100
      :
      0;


    const hitRate =
      result.spins > 0
      ?
      bet.hits
      /
      result.spins
      *
      100
      :
      0;


    console.log("");
    console.log(
      `${bet.code} · ${bet.label}`
    );


    console.log(
      `  Hit:      ${formatNumber(bet.hits)} (${formatPct(hitRate, 4)})`
    );


    console.log(
      `  Giocato:  ${formatNumber(wager)}`
    );


    console.log(
      `  Ritorno:  ${formatNumber(bet.totalReturn)}`
    );


    console.log(
      `  RTP:      ${formatPct(rtp)}`
    );


    console.log(
      `  Netto:    ${signed(net)}`
    );
  }


  console.log("");
  console.log(
    "FREQUENZA NUMERI"
  );
  console.log(
    "-".repeat(72)
  );

  const theoreticalNumberPct =
    100 / 37;

  console.log(
    "Numero".padEnd(10) +
    "Uscite".padStart(14) +
    "% osservata".padStart(16) +
    "% teorica".padStart(14) +
    "Scost. pp".padStart(14)
  );

  console.log(
    "-".repeat(72)
  );

  for (
    let number = 0;
    number <= 36;
    number++
  ) {

    const count =
      result.numberCounts[number];

    const observedPct =
      result.spins > 0
      ?
      count
      /
      result.spins
      *
      100
      :
      0;

    const deviation =
      observedPct
      -
      theoreticalNumberPct;

    console.log(
      String(number).padEnd(10) +
      formatNumber(count).padStart(14) +
      formatPct(observedPct, 4).padStart(16) +
      formatPct(theoreticalNumberPct, 4).padStart(14) +
      (
        (deviation > 0 ? "+" : "") +
        deviation
          .toFixed(4)
          .replace(".", ",")
      ).padStart(12) +
      " pp"
    );
  }


  console.log("");
  console.log(
    "PERFORMANCE"
  );
  console.log(
    "-".repeat(72)
  );


  console.log(
    `Tempo:               ${result.elapsedSeconds.toFixed(3)} s`
  );


  console.log(
    `Velocità:            ${formatNumber(Math.round(result.spinsPerSecond))} giri/s`
  );


  console.log("");
}


// ============================================================
// LISTA BET
// ============================================================

function listBets() {

  console.log(
    `Puntate disponibili: ${BET_OPTIONS.length}`
  );


  let currentType =
    null;


  for (
    const bet
    of BET_OPTIONS
  ) {

    if (
      bet.type !==
      currentType
    ) {

      currentType =
        bet.type;


      console.log("");
      console.log(
        `[${currentType}]`
      );
    }


    console.log(
      `${bet.code.padEnd(22)} ${bet.label.padEnd(20)} ${bet.payoutProfit}:1`
    );
  }
}


// ============================================================
// MAIN
// ============================================================

function main() {

  try {

    const config =
      parseArgs(
        process.argv.slice(2)
      );


    if (
      config.listBets
    ) {

      listBets();

      return;
    }


    const result =
      simulate(
        config
      );


    if (
      !config.quiet
    ) {

      printResult(
        result
      );

    } else {

      console.log(
        JSON.stringify(
          {
            spins:
              result.spins,

            totalWager:
              result.totalWager,

            totalReturn:
              result.totalReturn,

            net:
              result.net,

            rtp:
              result.observedRtp,

            hitRate:
              result.hitRate,

            finalBankroll:
              result.finalBankroll,

            maxDrawdown:
              result.maxDrawdown,

            numberFrequencies:
              result.numberCounts.map(
                (count, number) => ({
                  number,
                  count,
                  percentage:
                    result.spins > 0
                    ? count / result.spins * 100
                    : 0
                })
              ),

            elapsedSeconds:
              result.elapsedSeconds
          },
          null,
          2
        )
      );
    }

  } catch (error) {

    console.error(
      `ERRORE: ${error.message}`
    );

    process.exit(1);
  }
}


main();
