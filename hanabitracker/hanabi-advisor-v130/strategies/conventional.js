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

// Convenzione di focus semplice e riproducibile:
// tra le carte toccate scegliamo quella più a destra che beneficia
// realmente dell'indizio; in assenza, la più a destra.
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

function buildHintCandidates(view, touchedPriorityWeight = 0) {
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
      const infoGain = Math.max(
        0,
        totalKnowledgeInformation(after) - beforeInfo
      );

      const focusIndex = focusIndexForHint(
        opponent,
        opponent.knowledge,
        after,
        hint.hintType,
        hint.value
      );

      if (focusIndex === null) continue;

      const focusCard = opponent.hand[focusIndex];
      const touched = touchedIndexes(opponent, hint.hintType, hint.value);
      const focusPlayable = isPlayable(view, focusCard);
      const focusCritical = isCritical(view, focusCard);
      const focusUseless = isUseless(view, focusCard);

      const otherPlayable = touched.filter(index =>
        index !== focusIndex && isPlayable(view, opponent.hand[index])
      ).length;

      const otherNonPlayable = touched.filter(index =>
        index !== focusIndex && !isPlayable(view, opponent.hand[index])
      ).length;

      let intent = "INFO";
      let score = infoGain * 12;

      // Esperimento multi-touch:
      // premia esplicitamente gli indizi che toccano più carte.
      // touchedPriorityWeight=0 mantiene il comportamento v0.4 originale.
      score += Math.max(0, touched.length - 1) * touchedPriorityWeight;

      if (focusPlayable) {
        intent = "PLAY";
        score += 125;
        score += otherPlayable * 20;
        score -= otherNonPlayable * 18;
      } else if (focusCritical) {
        intent = "SAVE";
        score += focusCard.number === 5 ? 115 : 90;
        score -= otherNonPlayable * 5;
      } else {
        score += touched.length * 3;
        if (focusUseless) score -= 15;
      }

      // Non spendiamo un token per una pura ripetizione.
      if (infoGain <= 1e-9 && intent === "INFO") continue;

      candidates.push({
        score,
        infoGain,
        targetIndex: opponent.playerIndex,
        hintType: hint.hintType,
        value: hint.value,
        focusIndex,
        intent
      });
    }
  }

  return candidates.sort((a, b) =>
    (b.score - a.score) ||
    (b.infoGain - a.infoGain)
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

export function createConventionalStrategy({
  probabilityMode = "hybrid",
  playThreshold = 1,
  riskPlay = false,
  touchedPriorityWeight = 0
} = {}) {
  return {
    name: "conventional-v0.4",

    chooseAction(view) {
      const own = analyzeOwnHand(view, { mode: probabilityMode });

      // 1) Convenzione PLAY: un indizio esplicitamente interpretato come giocata
      // viene eseguito anche se l'identità non è ancora certa.
      const signaledPlay = view.knowledge
        .map((k, index) => ({ k, index, p: own[index]?.playableProbability || 0 }))
        .filter(x => x.k.playSignal)
        .sort((a, b) =>
          (b.p - a.p) ||
          ((a.k.signalAge || 0) - (b.k.signalAge || 0))
        )[0];

      if (signaledPlay && view.strikes < 2) {
        return { type: "PLAY", cardIndex: signaledPlay.index };
      }

      // 2) Giocata logicamente certa.
      const certain = own
        .map((x, index) => ({ index, ...x }))
        .filter(x => x.playableProbability >= 0.999999)
        .sort((a, b) => b.criticalProbability - a.criticalProbability)[0];

      if (certain) {
        return { type: "PLAY", cardIndex: certain.index };
      }

      // 3) Eventuale rischio probabilistico configurabile.
      if (riskPlay && view.strikes < 2) {
        const risky = own
          .map((x, index) => ({ index, p: x.playableProbability }))
          .filter(x => x.p >= playThreshold)
          .sort((a, b) => b.p - a.p)[0];

        if (risky) {
          return { type: "PLAY", cardIndex: risky.index };
        }
      }

      // 4) Genera PLAY clue o SAVE clue prima degli indizi puramente informativi.
      if (view.clues > 0) {
        const hints = buildHintCandidates(view, touchedPriorityWeight);
        const best = hints[0];

        if (best && (best.intent !== "INFO" || best.score >= 16)) {
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

      // 5) Scarto. SAVE e PLAY signal proteggono fortemente la carta.
      return {
        type: "DISCARD",
        cardIndex: selectDiscard(own, view.knowledge)
      };
    }
  };
}
