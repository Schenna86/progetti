import { COLORS, NUMBERS, COPIES } from "../constants.js";
import {
  analyzeOwnHand,
  cloneKnowledge,
  applyColorHint,
  applyNumberHint,
  totalKnowledgeInformation
} from "../knowledge.js";

function cardVisibleRemaining(view, color, number) {
  let remaining = COPIES[number];

  for (const card of view.discarded) {
    if (card.color === color && card.number === number) remaining--;
  }

  const level = view.fireworks[color] || 0;
  if (number <= level) remaining--;

  for (const opponent of view.otherHands) {
    for (const card of opponent.hand) {
      if (card.color === color && card.number === number) remaining--;
    }
  }

  return Math.max(0, remaining);
}

function isPlayable(view, card) {
  return card.number === (view.fireworks[card.color] || 0) + 1;
}

function isUseless(view, card) {
  return card.number <= (view.fireworks[card.color] || 0);
}

function isCriticalVisible(view, card) {
  if (isUseless(view, card)) return false;
  return cardVisibleRemaining(view, card.color, card.number) <= 1;
}

function simulateHintKnowledge(opponent, hintType, value) {
  const cloned = opponent.knowledge.map(cloneKnowledge);

  if (hintType === "color") {
    applyColorHint(opponent.hand, cloned, value);
  } else {
    applyNumberHint(opponent.hand, cloned, Number(value));
  }

  return cloned;
}

function analyzeTargetAfterHint(view, opponent, newKnowledge) {
  const pseudoView = {
    ...view,
    knowledge: newKnowledge,
    ownHandSize: opponent.hand.length,
    otherHands: view.otherHands
      .filter(x => x.playerIndex !== opponent.playerIndex)
      .map(x => ({ playerIndex: x.playerIndex, hand: x.hand }))
      .concat([{
        playerIndex: view.playerIndex,
        hand: null
      }])
      .filter(x => x.hand)
  };

  // Per il giocatore bersaglio, la mano del giocatore corrente è visibile.
  // La ricostruiamo dalle carte che il current player vede attraverso targetVisibleHands.
  pseudoView.otherHands = opponent.visibleOtherHands;

  return analyzeOwnHand(pseudoView);
}

function hintCandidates(view) {
  const out = [];

  for (const opponent of view.otherHands) {
    const candidateHints = [];

    for (const color of COLORS) {
      if (opponent.hand.some(c => c.color === color)) {
        candidateHints.push({ hintType: "color", value: color });
      }
    }

    for (const number of NUMBERS) {
      if (opponent.hand.some(c => c.number === number)) {
        candidateHints.push({ hintType: "number", value: number });
      }
    }

    const beforeInfo = totalKnowledgeInformation(opponent.knowledge);

    for (const hint of candidateHints) {
      const newKnowledge = simulateHintKnowledge(
        opponent,
        hint.hintType,
        hint.value
      );

      const afterInfo = totalKnowledgeInformation(newKnowledge);
      const informationGain = Math.max(0, afterInfo - beforeInfo);

      if (informationGain <= 1e-9) continue;

      const touched = opponent.hand
        .map((card, index) => ({ card, index }))
        .filter(x =>
          hint.hintType === "color"
            ? x.card.color === hint.value
            : x.card.number === hint.value
        );

      const playableTouched = touched.filter(x => isPlayable(view, x.card));
      const criticalTouched = touched.filter(x => isCriticalVisible(view, x.card));
      const uselessTouched = touched.filter(x => isUseless(view, x.card));

      // Bonus più forte se il suggerimento rende una carta esattamente nota
      // almeno su uno degli assi (colore o numero).
      let certaintyGain = 0;
      for (let i = 0; i < newKnowledge.length; i++) {
        const before = opponent.knowledge[i];
        const after = newKnowledge[i];

        if (before.possibleColors.size > 1 && after.possibleColors.size === 1) certaintyGain += 1;
        if (before.possibleNumbers.size > 1 && after.possibleNumbers.size === 1) certaintyGain += 1;
      }

      const score =
        informationGain * 18 +
        certaintyGain * 14 +
        playableTouched.length * 32 +
        criticalTouched.length * 18 +
        uselessTouched.length * 3 -
        Math.max(0, touched.length - playableTouched.length) * 4;

      out.push({
        score,
        informationGain,
        certaintyGain,
        targetIndex: opponent.playerIndex,
        hintType: hint.hintType,
        value: hint.value
      });
    }
  }

  return out.sort((a, b) =>
    (b.score - a.score) ||
    (b.informationGain - a.informationGain)
  );
}

export function createBaselineStrategy({
  playThreshold = 1,
  riskPlay = false,
  probabilityMode = "hybrid"
} = {}) {
  return {
    name: "baseline-v0.3",

    chooseAction(view) {
      const own = analyzeOwnHand(view, { mode: probabilityMode });

      const certainPlays = own
        .map((x, index) => ({ index, ...x }))
        .filter(x => x.playableProbability >= 0.999999)
        .sort((a, b) =>
          (b.criticalProbability - a.criticalProbability) ||
          (b.uselessProbability - a.uselessProbability)
        );

      if (certainPlays.length) {
        return { type: "PLAY", cardIndex: certainPlays[0].index };
      }

      if (riskPlay && view.strikes < 2) {
        const bestRiskPlay = own
          .map((x, index) => ({ index, p: x.playableProbability }))
          .filter(x => x.p >= playThreshold)
          .sort((a, b) => b.p - a.p)[0];

        if (bestRiskPlay) {
          return { type: "PLAY", cardIndex: bestRiskPlay.index };
        }
      }

      // Con pochi indizi, privilegia uno scarto certamente sicuro prima di spendere l'ultimo token.
      if (view.clues <= 1) {
        const safe = own
          .map((x, index) => ({ index, ...x }))
          .filter(x => x.safeDiscardProbability >= 0.999999)
          .sort((a, b) =>
            (b.uselessProbability - a.uselessProbability) ||
            (a.criticalProbability - b.criticalProbability)
          )[0];

        if (safe) return { type: "DISCARD", cardIndex: safe.index };
      }

      if (view.clues > 0) {
        const hints = hintCandidates(view);
        if (hints.length && hints[0].score > 8) {
          const h = hints[0];
          return {
            type: "HINT",
            targetIndex: h.targetIndex,
            hintType: h.hintType,
            value: h.value
          };
        }
      }

      const safeDiscard = own
        .map((x, index) => ({ index, ...x }))
        .filter(x => x.safeDiscardProbability >= 0.999999)
        .sort((a, b) =>
          (b.uselessProbability - a.uselessProbability) ||
          (a.criticalProbability - b.criticalProbability)
        )[0];

      if (safeDiscard) {
        return { type: "DISCARD", cardIndex: safeDiscard.index };
      }

      const safest = own
        .map((x, index) => ({ index, ...x }))
        .sort((a, b) =>
          (b.safeDiscardProbability - a.safeDiscardProbability) ||
          (a.criticalProbability - b.criticalProbability) ||
          (b.uselessProbability - a.uselessProbability)
        )[0];

      return { type: "DISCARD", cardIndex: safest?.index ?? 0 };
    }
  };
}
