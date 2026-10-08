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
  if (hintType === "color") applyColorHint(opponent.hand, knowledge, value);
  else applyNumberHint(opponent.hand, knowledge, Number(value));
  return knowledge;
}

function touchedIndexes(opponent, hintType, value) {
  return opponent.hand
    .map((card, index) => ({ card, index }))
    .filter(x => hintType === "color" ? x.card.color === value : x.card.number === Number(value))
    .map(x => x.index);
}

function focusIndexForHint(opponent, before, after, hintType, value) {
  const touched = touchedIndexes(opponent, hintType, value);
  const changed = touched.filter(index => {
    const b = before[index], a = after[index];
    return b.possibleColors.size !== a.possibleColors.size || b.possibleNumbers.size !== a.possibleNumbers.size;
  });
  const source = changed.length ? changed : touched;
  return source.length ? source[source.length - 1] : null;
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

function actionCounts(evaluations) {
  let certainPlay = 0, safeDiscard = 0, criticalKnown = 0;
  for (const e of evaluations) {
    if (e.playableProbability >= 0.999999) certainPlay++;
    if (e.safeDiscardProbability >= 0.999999) safeDiscard++;
    if (e.criticalProbability >= 0.999999) criticalKnown++;
  }
  return { certainPlay, safeDiscard, criticalKnown };
}

function buildConventionalCandidates(view) {
  const candidates = [];
  for (const opponent of view.otherHands) {
    const rawHints = [];
    for (const color of COLORS) if (opponent.hand.some(card => card.color === color)) rawHints.push({ hintType: "color", value: color });
    for (const number of NUMBERS) if (opponent.hand.some(card => card.number === number)) rawHints.push({ hintType: "number", value: number });

    const beforeInfo = totalKnowledgeInformation(opponent.knowledge);
    for (const hint of rawHints) {
      const after = simulateHint(opponent, hint.hintType, hint.value);
      const informationGain = Math.max(0, totalKnowledgeInformation(after) - beforeInfo);
      if (informationGain <= 1e-9) continue;

      const touched = touchedIndexes(opponent, hint.hintType, hint.value);
      const focusIndex = focusIndexForHint(opponent, opponent.knowledge, after, hint.hintType, hint.value);
      if (focusIndex === null) continue;

      const focusCard = opponent.hand[focusIndex];
      const focusPlayable = isPlayable(view, focusCard);
      const focusCritical = isCritical(view, focusCard);
      const focusUseless = isUseless(view, focusCard);
      const otherPlayable = touched.filter(index => index !== focusIndex && isPlayable(view, opponent.hand[index])).length;
      const otherNonPlayable = touched.filter(index => index !== focusIndex && !isPlayable(view, opponent.hand[index])).length;

      let intent = "INFO";
      let score = informationGain * 18;
      if (focusPlayable) {
        intent = "PLAY";
        score += 125 + otherPlayable * 20 - otherNonPlayable * 18;
      } else if (focusCritical) {
        intent = "SAVE";
        score += (focusCard.number === 5 ? 115 : 90) - otherNonPlayable * 5;
      } else {
        score += touched.length * 3;
        if (focusUseless) score -= 15;
      }

      candidates.push({
        conventionalScore: score,
        informationGain,
        targetIndex: opponent.playerIndex,
        opponent,
        hintType: hint.hintType,
        value: hint.value,
        focusIndex,
        intent,
        afterKnowledge: after,
        touchedCount: touched.length
      });
    }
  }
  return candidates.sort((a,b) => (b.conventionalScore-a.conventionalScore) || (b.informationGain-a.informationGain));
}

function recipientUtility(view, candidate, probabilityMode) {
  const opponent = candidate.opponent;
  const beforeEval = analyzeOwnHand(makeTargetView(view, opponent, opponent.knowledge.map(cloneKnowledge)), { mode: probabilityMode });
  const afterEval = analyzeOwnHand(makeTargetView(view, opponent, candidate.afterKnowledge), { mode: probabilityMode });
  const before = actionCounts(beforeEval), after = actionCounts(afterEval);
  const newCertainPlays = Math.max(0, after.certainPlay - before.certainPlay);
  const newSafeDiscards = Math.max(0, after.safeDiscard - before.safeDiscard);
  const newCritical = Math.max(0, after.criticalKnown - before.criticalKnown);
  const actionsCreated = newCertainPlays + newSafeDiscards + newCritical;
  let score = newCertainPlays * 120 + newSafeDiscards * 70 + newCritical * 60 + candidate.informationGain * 8;
  if (actionsCreated >= 2) score += (actionsCreated - 1) * 40;
  return { score, actionsCreated, newCertainPlays, newSafeDiscards, newCritical };
}

function chooseHybridHint(view, probabilityMode, topK = 4, recipientWeight = 0.35) {
  const all = buildConventionalCandidates(view);
  if (!all.length) return null;
  const top = all.slice(0, Math.max(1, topK));
  for (const candidate of top) {
    candidate.recipientUtility = recipientUtility(view, candidate, probabilityMode);
    candidate.hybridScore = candidate.conventionalScore + candidate.recipientUtility.score * recipientWeight;
  }
  top.sort((a,b) => (b.hybridScore-a.hybridScore) || (b.conventionalScore-a.conventionalScore));
  return top[0];
}

function selectDiscard(own, knowledge) {
  const ranked = own.map((x,index) => {
    const k = knowledge[index];
    let protection = 0;
    if (k?.saveSignal) protection += 1000;
    if (k?.playSignal) protection += 700;
    return { index, score: x.safeDiscardProbability*100 + x.uselessProbability*40 - x.criticalProbability*150 - protection };
  });
  ranked.sort((a,b) => b.score-a.score);
  return ranked[0]?.index ?? 0;
}

export function createHybridV07Strategy({
  probabilityMode = "hybrid",
  playThreshold = 1,
  riskPlay = false,
  topK = 4,
  recipientWeight = 0.35
} = {}) {
  return {
    name: "hybrid-v0.7",
    chooseAction(view) {
      const own = analyzeOwnHand(view, { mode: probabilityMode });
      const signaledPlay = view.knowledge
        .map((k,index) => ({ k, index, p: own[index]?.playableProbability || 0 }))
        .filter(x => x.k.playSignal)
        .sort((a,b) => (b.p-a.p) || ((a.k.signalAge||0)-(b.k.signalAge||0)))[0];
      if (signaledPlay && view.strikes < 2) return { type: "PLAY", cardIndex: signaledPlay.index };

      const certain = own.map((x,index)=>({index,...x})).filter(x=>x.playableProbability>=0.999999)
        .sort((a,b)=>b.criticalProbability-a.criticalProbability)[0];
      if (certain) return { type: "PLAY", cardIndex: certain.index };

      if (riskPlay && view.strikes < 2) {
        const risky = own.map((x,index)=>({index,p:x.playableProbability})).filter(x=>x.p>=playThreshold).sort((a,b)=>b.p-a.p)[0];
        if (risky) return { type: "PLAY", cardIndex: risky.index };
      }

      if (view.clues <= 1) {
        const safe = own.map((x,index)=>({index,...x})).filter(x=>x.safeDiscardProbability>=0.999999)
          .sort((a,b)=>(b.uselessProbability-a.uselessProbability)||(a.criticalProbability-b.criticalProbability))[0];
        if (safe) return { type: "DISCARD", cardIndex: safe.index };
      }

      if (view.clues > 0) {
        const best = chooseHybridHint(view, probabilityMode, topK, recipientWeight);
        if (best && best.conventionalScore >= 8) {
          return {
            type: "HINT",
            targetIndex: best.targetIndex,
            hintType: best.hintType,
            value: best.value,
            convention: best.intent === "INFO" ? null : { intent: best.intent, focusIndex: best.focusIndex },
            meta: {
              actionsCreated: best.recipientUtility?.actionsCreated || 0,
              certainPlaysCreated: best.recipientUtility?.newCertainPlays || 0,
              safeDiscardsCreated: best.recipientUtility?.newSafeDiscards || 0,
              criticalCreated: best.recipientUtility?.newCritical || 0,
              infoGain: best.informationGain || 0,
              touchedCount: best.touchedCount || 0
            }
          };
        }
      }
      return { type: "DISCARD", cardIndex: selectDiscard(own, view.knowledge) };
    }
  };
}
