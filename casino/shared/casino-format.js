/*
 * ============================================================
 * CASINO - FORMATTAZIONE VALORI IN FICHE
 * ============================================================
 *
 * Solo presentazione: i valori reali restano numerici nel gioco,
 * nelle RPC e nel database.
 *
 * Esempi:
 *   1_250        -> 1.25K
 *   12_500_000   -> 12.5M
 *   1_284_572_930-> 1.28B
 *   1_000_000_000_000 -> 1T
 *
 * ============================================================
 */

(() => {
  "use strict";

  const UNITS = [
    { value: 1e15, suffix: "Qa" },
    { value: 1e12, suffix: "T" },
    { value: 1e9,  suffix: "B" },
    { value: 1e6,  suffix: "M" },
    { value: 1e3,  suffix: "K" }
  ];

  function formatChips(value) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      return "0";
    }

    const abs = Math.abs(n);

    for (let i = 0; i < UNITS.length; i++) {
      const unit = UNITS[i];

      if (abs < unit.value) {
        continue;
      }

      let v = n / unit.value;
      let absV = Math.abs(v);
      let decimals;

      if (absV >= 100) decimals = 0;
      else if (absV >= 10) decimals = 1;
      else decimals = 2;

      let text = v.toFixed(decimals);

      if (decimals > 0) {
        text = text.replace(/\.?0+$/, "");
      }

      /*
       * Evita casi come 999.999 -> 1000K.
       * Se l'arrotondamento raggiunge 1000 e c'è un'unità
       * superiore disponibile, promuoviamo il valore.
       */
      if (Math.abs(Number(text)) >= 1000 && i > 0) {
        const higher = UNITS[i - 1];
        v = n / higher.value;
        absV = Math.abs(v);

        if (absV >= 100) decimals = 0;
        else if (absV >= 10) decimals = 1;
        else decimals = 2;

        text = v.toFixed(decimals);

        if (decimals > 0) {
          text = text.replace(/\.?0+$/, "");
        }

        return text + higher.suffix;
      }

      return text + unit.suffix;
    }

    return Math.trunc(n).toString();
  }

  window.CasinoFormat = Object.freeze({
    formatChips
  });
})();
