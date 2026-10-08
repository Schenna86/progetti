import { COLORS, NUMBERS, COPIES } from "../constants.js";
import {
  analyzeOwnHand,
  cloneKnowledge,
  applyColorHint,
  applyNumberHint,
  totalKnowledgeInformation
} from "../knowledge.js";

function isPlayable(view, card) {
  return card.number === (view.fireworks[card.color] || 0) + 1;
}

function isUseless(view, card) {
  return card.number <= (view.fireworks[card.color] || 0);
}

function copiesNotDiscarded(view, color, number) {
  let remaining = COPIES[number];

  for (const card of view.discarded) {
    if (card.color === color && card.number === number) remaining--;
  }

  const level = view.fireworks[color] || 0;
  if (number <= level) remaining--;

  return Math.max(0, remaining);
}

function isCritical(view, card) {
  if (isUseless(view, card)) return false;
  return copiesNotDiscarded(view, card.color, card.number) <= 1;
}

function simulateHint(opponent, hintType, value) {
  const knowledge = opponent.knowledge.map(cloneKnowledge);

  if (hintType === "color") {
    applyColorHint(opponent.hand, knowledge, value);
  } else {
    applyNumberHint(opponent.hand, knowledge, Number(value));
  }

  return knowledge;
}

function touchedIndexes(opponent, hintType, value) {
  return opponent.hand
    .map((card, index) => ({ card, index }))
    .filter(x =>
      hintType === "color"
        ? x.card.color === value
        : x.card.number === Number(value)
    )
    .map(x => x.index);
}

function focusIndexForHint(opponent, before, after, hintType, value) {
  const touched = touchedIndexes(opponent, hintType, value);
  const changed = touched.filter(index => {
    const b = before[index];
    const a = after[index];

    return (
      b.possibleColors.size !== a.possibleColors.size ||
      b.possibleNumbers.size !== a.possibleNumbers.size
    );
  });

  const source = changed.length ? changed : touched;
  return source.length ? source[source.length - 1] : null;
}

function playableChainLength(view, opponent, touched) {
  const byColor = new Map();

  for (const index of touched) {
    const card = opponent.hand[index];
    if (!byColor.has(card.color)) byColor.set(card.color, []);
    byColor.get(card.color).push(card.number);
  }

  let best = 0;

  for (const [color, numbers] of byColor.entries()) {
    const level = view.fireworks[color] || 0;
    const set = new Set(numbers);

    let expected = level + 1;
    let length = 0;

    while (set.has(expected)) {
      length++;
      expected++;
    }

    if (length > best) best = length;
  }

  return best;
}

function evaluateTouchedCard(view, card, beforeK, afterK) {
  let score = 0;

  const infoBefore =
    Math.log2((COLORS.length * NUMBERS.length) /
      Math.max(1, beforeK.possibleColors.size * beforeK.possibleNumbers.size));

  const infoAfter =
    Math.log2((COLORS.length * NUMBERS.length) /
      Math.max(1, afterK.possibleColors.size * afterK.possibleNumbers.size));

  const infoGain = Math.max(0, infoAfter - infoBefore);

  score += infoGain * 12;

  if (isPlayable(view, card)) score += 90;
  else if (isCritical(view, card)) score += card.number === 5 ? 75 : 55;
  else if (isUseless(view, card)) score += 18;

  if (
    beforeK.possibleColors.size > 1 &&
    afterK.possibleColors.size === 1
  ) score += 14;

  if (
    beforeK.possibleNumbers.size > 1 &&
    afterK.possibleNumbers.size === 1
  ) score += 14;

  return {
    score,
    infoGain,
    playable: isPlayable(view, card),
    critical: isCritical(view, card),
    useless: isUseless(view, card)
  };
}

function buildHintCandidates(view) {
  const candidates = [];

  for (const opponent of view.otherHands) {
    const rawHints = [];

    for (const color of COLORS) {
      if (opponent.hand.some(c => c.color === color)) {
        rawHints.push({ hintType: "color", value: color });
      }
    }

    for (const number of NUMBERS) {
      if (opponent.hand.some(c => c.number === number)) {
        rawHints.push({ hintType: "number", value: number });
      }
    }

    const beforeInfo = totalKnowledgeInformation(opponent.knowledge);

    for (const hint of rawHints) {
      const after = simulateHint(opponent, hint.hintType, hint.value);
      const totalInfoGain = Math.max(
        0,
        totalKnowledgeInformation(after) - beforeInfo
      );

      const touched = touchedIndexes(
        opponent,
        hint.hintType,
        hint.value
      );

      if (!touched.length) continue;

      const perCard = touched.map(index =>
        evaluateTouchedCard(
          view,
          opponent.hand[index],
          opponent.knowledge[index],
          after[index]
        )
      );

      const usefulCards = perCard.filter(x =>
        x.playable || x.critical || x.useless || x.infoGain > 0
      ).length;

      const playableCards = perCard.filter(x => x.playable).length;
      const criticalCards = perCard.filter(x => x.critical).length;

      // Somma dell'utilità reale sulle singole carte.
      let score = perCard.reduce((sum, x) => sum + x.score, 0);

      // Piccolo bonus di efficienza, ma solo per carte effettivamente utili.
      if (usefulCards > 1) {
        score += (usefulCards - 1) * 18;
      }

      // Bonus catena: 2->3->4 ecc. dello stesso colore a partire
      // dalla prossima carta necessaria sul fuoco.
      const chainLength = playableChainLength(view, opponent, touched);
      if (chainLength >= 2) {
        score += 70 + (chainLength - 2) * 55;
      }

      // Penalizza l'ambiguità: molte carte toccate ma poche realmente utili.
      const ambiguousTouched = touched.length - usefulCards;
      score -= ambiguousTouched * 20;

      const focusIndex = focusIndexForHint(
        opponent,
        opponent.knowledge,
        after,
        hint.hintType,
        hint.value
      );

      if (focusIndex === null) continue;

      const focusCard = opponent.hand[focusIndex];

      let intent = "INFO";
      if (isPlayable(view, focusCard)) {
        intent = "PLAY";
      } else if (isCritical(view, focusCard)) {
        intent = "SAVE";
      }

      // Ripetizioni puramente informative non valgono un token.
      if (
        totalInfoGain <= 1e-9 &&
        playableCards === 0 &&
        criticalCards === 0 &&
        chainLength < 2
      ) {
        continue;
      }

      candidates.push({
        score,
        totalInfoGain,
        targetIndex: opponent.playerIndex,
        hintType: hint.hintType,
        value: hint.value,
        focusIndex,
        intent,
        touchedCount: touched.length,
        usefulCards,
        chainLength
      });
    }
  }

  return candidates.sort((a, b) =>
    (b.score - a.score) ||
    (b.chainLength - a.chainLength) ||
    (b.usefulCards - a.usefulCards) ||
    (b.totalInfoGain - a.totalInfoGain)
  );
}

function selectDiscard(own, knowledge) {
  const ranked = own.map((x, index) => {
    const k = knowledge[index];

    let protection = 0;
    if (k?.saveSignal) protection += 1000;
    if (k?.playSignal) protection += 700;

    return {
      index,
      score:
        x.safeDiscardProbability * 100 +
        x.uselessProbability * 40 -
        x.criticalProbability * 150 -
        protection
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.index ?? 0;
}

export function createMultiUseStrategy({
  probabilityMode = "hybrid",
  playThreshold = 1,
  riskPlay = false
} = {}) {
  return {
    name: "multiuse-v0.5",

    chooseAction(view) {
      const own = analyzeOwnHand(view, { mode: probabilityMode });

      const signaledPlay = view.knowledge
        .map((k, index) => ({
          k,
          index,
          p: own[index]?.playableProbability || 0
        }))
        .filter(x => x.k.playSignal)
        .sort((a, b) =>
          (b.p - a.p) ||
          ((a.k.signalAge || 0) - (b.k.signalAge || 0))
        )[0];

      if (signaledPlay && view.strikes < 2) {
        return { type: "PLAY", cardIndex: signaledPlay.index };
      }

      const certain = own
        .map((x, index) => ({ index, ...x }))
        .filter(x => x.playableProbability >= 0.999999)
        .sort((a, b) =>
          b.criticalProbability - a.criticalProbability
        )[0];

      if (certain) {
        return { type: "PLAY", cardIndex: certain.index };
      }

      if (riskPlay && view.strikes < 2) {
        const risky = own
          .map((x, index) => ({
            index,
            p: x.playableProbability
          }))
          .filter(x => x.p >= playThreshold)
          .sort((a, b) => b.p - a.p)[0];

        if (risky) {
          return { type: "PLAY", cardIndex: risky.index };
        }
      }

      if (view.clues > 0) {
        const hints = buildHintCandidates(view);
        const best = hints[0];

        if (best && best.score >= 16) {
          return {
            type: "HINT",
            targetIndex: best.targetIndex,
            hintType: best.hintType,
            value: best.value,
            convention: best.intent === "INFO"
              ? null
              : {
                  intent: best.intent,
                  focusIndex: best.focusIndex
                }
          };
        }
      }

      return {
        type: "DISCARD",
        cardIndex: selectDiscard(own, view.knowledge)
      };
    }
  };
}
