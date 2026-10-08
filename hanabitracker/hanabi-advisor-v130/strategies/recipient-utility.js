import { COLORS, NUMBERS } from "../constants.js";
import {
  analyzeOwnHand,
  cloneKnowledge,
  applyColorHint,
  applyNumberHint,
  totalKnowledgeInformation
} from "../knowledge.js";

function simulateHint(opponent, hintType, value) {
  const knowledge = opponent.knowledge.map(cloneKnowledge);

  if (hintType === "color") {
    applyColorHint(opponent.hand, knowledge, value);
  } else {
    applyNumberHint(opponent.hand, knowledge, Number(value));
  }

  return knowledge;
}

function makeTargetView(view, opponent, knowledge) {
  return {
    playerIndex: opponent.playerIndex,
    playerCount: view.playerCount,
    clues: view.clues,
    strikes: view.strikes,
    fireworks: { ...view.fireworks },
    discarded: view.discarded.map(card => ({ ...card })),
    deckRemaining: view.deckRemaining,
    ownHandSize: opponent.hand.length,
    knowledge,
    otherHands: opponent.visibleOtherHands.map(x => ({
      playerIndex: x.playerIndex,
      hand: x.hand.map(card => ({ ...card }))
    }))
  };
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

function actionCounts(evaluations) {
  let certainPlay = 0;
  let likelyPlay98 = 0;
  let safeDiscard = 0;
  let lowRiskDiscard95 = 0;
  let criticalKnown = 0;

  for (const e of evaluations) {
    if (e.playableProbability >= 0.999999) certainPlay++;
    if (e.playableProbability >= 0.98) likelyPlay98++;
    if (e.safeDiscardProbability >= 0.999999) safeDiscard++;
    if (e.safeDiscardProbability >= 0.95) lowRiskDiscard95++;
    if (e.criticalProbability >= 0.999999) criticalKnown++;
  }

  return {
    certainPlay,
    likelyPlay98,
    safeDiscard,
    lowRiskDiscard95,
    criticalKnown
  };
}

function deltaCounts(before, after) {
  return {
    certainPlay: Math.max(0, after.certainPlay - before.certainPlay),
    likelyPlay98: Math.max(0, after.likelyPlay98 - before.likelyPlay98),
    safeDiscard: Math.max(0, after.safeDiscard - before.safeDiscard),
    lowRiskDiscard95: Math.max(0, after.lowRiskDiscard95 - before.lowRiskDiscard95),
    criticalKnown: Math.max(0, after.criticalKnown - before.criticalKnown)
  };
}

function buildHintCandidates(view, probabilityMode) {
  const candidates = [];

  for (const opponent of view.otherHands) {
    const targetBeforeView = makeTargetView(
      view,
      opponent,
      opponent.knowledge.map(cloneKnowledge)
    );

    const beforeEval = analyzeOwnHand(
      targetBeforeView,
      { mode: probabilityMode }
    );
    const beforeActions = actionCounts(beforeEval);
    const beforeInfo = totalKnowledgeInformation(opponent.knowledge);

    const rawHints = [];

    for (const color of COLORS) {
      if (opponent.hand.some(card => card.color === color)) {
        rawHints.push({ hintType: "color", value: color });
      }
    }

    for (const number of NUMBERS) {
      if (opponent.hand.some(card => card.number === number)) {
        rawHints.push({ hintType: "number", value: number });
      }
    }

    for (const hint of rawHints) {
      const afterKnowledge = simulateHint(
        opponent,
        hint.hintType,
        hint.value
      );

      const infoGain = Math.max(
        0,
        totalKnowledgeInformation(afterKnowledge) - beforeInfo
      );

      if (infoGain <= 1e-9) continue;

      const targetAfterView = makeTargetView(
        view,
        opponent,
        afterKnowledge
      );

      const afterEval = analyzeOwnHand(
        targetAfterView,
        { mode: probabilityMode }
      );

      const afterActions = actionCounts(afterEval);
      const created = deltaCounts(beforeActions, afterActions);
      const touched = touchedIndexes(
        opponent,
        hint.hintType,
        hint.value
      );

      const actionableCreated =
        created.certainPlay +
        created.safeDiscard +
        created.criticalKnown;

      // Il valore deriva dalle azioni create DAL PUNTO DI VISTA DEL DESTINATARIO.
      let score = 0;
      score += created.certainPlay * 140;
      score += created.likelyPlay98 * 35;
      score += created.safeDiscard * 80;
      score += created.lowRiskDiscard95 * 20;
      score += created.criticalKnown * 70;
      score += infoGain * 8;

      // Bonus piccolo se un singolo token crea più di una nuova azione concreta.
      if (actionableCreated >= 2) {
        score += (actionableCreated - 1) * 45;
      }

      // Toccare più carte non vale nulla da solo.
      // Penalizziamo invece un indizio ampio che non produce azioni.
      if (touched.length > 1 && actionableCreated === 0) {
        score -= (touched.length - 1) * 12;
      }

      // Per la convenzione PLAY/SAVE scegliamo SOLO una carta che il destinatario
      // può ora identificare come azione concreta.
      let convention = null;

      const playIndexes = afterEval
        .map((e, index) => ({ index, p: e.playableProbability }))
        .filter(x =>
          x.p >= 0.999999 &&
          (beforeEval[x.index]?.playableProbability || 0) < 0.999999
        );

      if (playIndexes.length) {
        convention = {
          intent: "PLAY",
          focusIndex: playIndexes[0].index
        };
      } else {
        const saveIndexes = afterEval
          .map((e, index) => ({ index, p: e.criticalProbability }))
          .filter(x =>
            x.p >= 0.999999 &&
            (beforeEval[x.index]?.criticalProbability || 0) < 0.999999
          );

        if (saveIndexes.length) {
          convention = {
            intent: "SAVE",
            focusIndex: saveIndexes[0].index
          };
        }
      }

      candidates.push({
        score,
        targetIndex: opponent.playerIndex,
        hintType: hint.hintType,
        value: hint.value,
        convention,
        meta: {
          infoGain,
          touchedCount: touched.length,
          actionsCreated: actionableCreated,
          certainPlaysCreated: created.certainPlay,
          safeDiscardsCreated: created.safeDiscard,
          criticalCreated: created.criticalKnown
        }
      });
    }
  }

  return candidates.sort((a, b) =>
    (b.score - a.score) ||
    (b.meta.actionsCreated - a.meta.actionsCreated) ||
    (b.meta.infoGain - a.meta.infoGain)
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
        x.criticalProbability * 160 -
        protection
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.index ?? 0;
}

export function createRecipientUtilityStrategy({
  probabilityMode = "hybrid",
  playThreshold = 1,
  riskPlay = false
} = {}) {
  return {
    name: "recipient-utility-v0.6",

    chooseAction(view) {
      const own = analyzeOwnHand(view, { mode: probabilityMode });

      const signaledPlay = view.knowledge
        .map((k, index) => ({
          k,
          index,
          p: own[index]?.playableProbability || 0
        }))
        .filter(x => x.k.playSignal && x.p >= 0.98)
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

      // Se siamo quasi senza token e abbiamo uno scarto certo, recuperiamo prima.
      if (view.clues <= 1) {
        const certainDiscard = own
          .map((x, index) => ({ index, ...x }))
          .filter(x => x.safeDiscardProbability >= 0.999999)
          .sort((a, b) =>
            (b.uselessProbability - a.uselessProbability) ||
            (a.criticalProbability - b.criticalProbability)
          )[0];

        if (certainDiscard) {
          return {
            type: "DISCARD",
            cardIndex: certainDiscard.index
          };
        }
      }

      if (view.clues > 0) {
        const hints = buildHintCandidates(view, probabilityMode);
        const best = hints[0];

        if (best && best.score >= 12) {
          return {
            type: "HINT",
            targetIndex: best.targetIndex,
            hintType: best.hintType,
            value: best.value,
            convention: best.convention,
            meta: best.meta
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
