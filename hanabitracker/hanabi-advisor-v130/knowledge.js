import { COLORS, NUMBERS, COPIES, colorHintTouches, colorsConsistentWithPositiveColorClue, colorsExcludedByNegativeColorClue } from "./constants.js";

export function newKnowledge(cardId) {
  return {
    cardId,
    possibleColors: new Set(COLORS),
    possibleNumbers: new Set(NUMBERS),
    playSignal: false,
    saveSignal: false,
    signalAge: 0,
    playSignalDistance: 0,
    multiPlaySignal: false,
    deferredPlaySignal: false
  };
}

export function cloneKnowledge(k) {
  return {
    cardId: k.cardId,
    possibleColors: new Set(k.possibleColors),
    possibleNumbers: new Set(k.possibleNumbers),
    playSignal: Boolean(k.playSignal),
    saveSignal: Boolean(k.saveSignal),
    signalAge: Number(k.signalAge || 0),
    playSignalDistance: Number(k.playSignalDistance || 0),
    multiPlaySignal: Boolean(k.multiPlaySignal),
    deferredPlaySignal: Boolean(k.deferredPlaySignal)
  };
}

export function applyColorHint(hand, knowledge, color) {
  const positive = new Set(colorsConsistentWithPositiveColorClue(color));
  const excluded = colorsExcludedByNegativeColorClue(color);
  for (let i = 0; i < hand.length; i++) {
    const touched = colorHintTouches(hand[i].color, color);
    if (touched) {
      knowledge[i].possibleColors = new Set(
        [...knowledge[i].possibleColors].filter(c => positive.has(c))
      );
    } else {
      for (const c of excluded) knowledge[i].possibleColors.delete(c);
    }
  }
}

export function applyNumberHint(hand, knowledge, number) {
  for (let i = 0; i < hand.length; i++) {
    const touched = hand[i].number === number;
    if (touched) {
      knowledge[i].possibleNumbers = new Set([number]);
    } else {
      knowledge[i].possibleNumbers.delete(number);
    }
  }
}

export function knowledgeSize(k) {
  return k.possibleColors.size * k.possibleNumbers.size;
}

export function knowledgeInformationScore(k) {
  const size = Math.max(1, knowledgeSize(k));
  return Math.log2((COLORS.length * NUMBERS.length) / size);
}

export function totalKnowledgeInformation(knowledge) {
  return knowledge.reduce((sum, k) => sum + knowledgeInformationScore(k), 0);
}

function identityKey(color, number) {
  return `${color}|${number}`;
}

function splitIdentity(key) {
  const [color, number] = key.split("|");
  return { color, number: Number(number) };
}

function allIdentityKeys() {
  const keys = [];
  for (const color of COLORS) {
    for (const number of NUMBERS) {
      keys.push(identityKey(color, number));
    }
  }
  return keys;
}

function visibleCounts(view) {
  const counts = Object.fromEntries(
    allIdentityKeys().map(key => {
      const { number } = splitIdentity(key);
      return [key, COPIES[number]];
    })
  );

  // Scarti visibili
  for (const card of view.discarded) {
    counts[identityKey(card.color, card.number)]--;
  }

  // Carte già giocate: una copia per ogni numero 1..livello
  for (const color of COLORS) {
    const level = view.fireworks[color] || 0;
    for (let number = 1; number <= level; number++) {
      counts[identityKey(color, number)]--;
    }
  }

  // Tutte le mani visibili al giocatore corrente
  for (const opponent of view.otherHands) {
    for (const card of opponent.hand) {
      counts[identityKey(card.color, card.number)]--;
    }
  }

  for (const key of Object.keys(counts)) {
    counts[key] = Math.max(0, counts[key]);
  }

  return counts;
}

function candidatesForKnowledge(k, counts) {
  const out = [];
  for (const color of k.possibleColors) {
    for (const number of k.possibleNumbers) {
      const key = identityKey(color, number);
      if ((counts[key] || 0) > 0) out.push(key);
    }
  }
  return out;
}

/**
 * Calcolo congiunto esatto ispirato al calculateProbabilities()
 * del Tracker HTML: per ogni carta bersaglio enumera le assegnazioni
 * compatibili delle altre carte, pesandole per il numero di copie fisiche.
 */

export function calculateJointProbabilities(view) {
  const keys = allIdentityKeys();
  const keyIndex = Object.fromEntries(keys.map((key, index) => [key, index]));
  const countObject = visibleCounts(view);
  const baseCounts = keys.map(key => countObject[key] || 0);

  const rawCandidates = view.knowledge.map(k => candidatesForKnowledge(k, countObject));
  const order = view.knowledge
    .map((_, index) => index)
    .sort((a, b) => rawCandidates[a].length - rawCandidates[b].length);

  const orderedCandidates = order.map(originalIndex =>
    rawCandidates[originalIndex].map(key => keyIndex[key])
  );

  const cardCount = view.knowledge.length;
  const identityCount = keys.length;
  const memo = new Map();

  function emptyMarginals() {
    return Array.from({ length: cardCount }, () =>
      Array(identityCount).fill(0)
    );
  }

  function solve(position, counts) {
    if (position >= cardCount) {
      return {
        ways: 1,
        marginals: emptyMarginals()
      };
    }

    const memoKey = `${position}:${counts.join(",")}`;
    const cached = memo.get(memoKey);
    if (cached) return cached;

    const originalCardIndex = order[position];
    let ways = 0;
    const marginals = emptyMarginals();

    for (const identityId of orderedCandidates[position]) {
      const remaining = counts[identityId];
      if (remaining <= 0) continue;

      counts[identityId]--;
      const child = solve(position + 1, counts);
      counts[identityId]++;

      if (!child.ways) continue;

      const branchWays = remaining * child.ways;
      ways += branchWays;

      // La carta corrente assume questa identità in tutte le assegnazioni del ramo.
      marginals[originalCardIndex][identityId] += branchWays;

      // Le marginali delle carte successive vanno pesate per il numero
      // di copie disponibili della scelta corrente.
      for (let cardIndex = 0; cardIndex < cardCount; cardIndex++) {
        if (cardIndex === originalCardIndex) continue;
        const childRow = child.marginals[cardIndex];
        const outRow = marginals[cardIndex];

        for (let id = 0; id < identityCount; id++) {
          const value = childRow[id];
          if (value) outRow[id] += remaining * value;
        }
      }
    }

    const result = { ways, marginals };
    memo.set(memoKey, result);
    return result;
  }

  const solved = solve(0, baseCounts.slice());

  return view.knowledge.map((_, cardIndex) => {
    const byIdentity = {};
    const byColor = Object.fromEntries(COLORS.map(c => [c, 0]));
    const byNumber = Object.fromEntries(NUMBERS.map(n => [n, 0]));

    if (solved.ways > 0) {
      for (let identityId = 0; identityId < identityCount; identityId++) {
        const numerator = solved.marginals[cardIndex][identityId];
        if (!numerator) continue;

        const probability = numerator / solved.ways;
        const key = keys[identityId];
        const { color, number } = splitIdentity(key);

        byIdentity[key] = probability;
        byColor[color] += probability;
        byNumber[number] += probability;
      }
    }

    return {
      total: solved.ways,
      byIdentity,
      byColor,
      byNumber
    };
  });
}


function analyzeOwnHandFast(view) {
  const counts = visibleCounts(view);

  return view.knowledge.map(k => {
    let totalWeight = 0;
    let playableWeight = 0;
    let safeDiscardWeight = 0;
    let criticalWeight = 0;
    let uselessWeight = 0;
    const byIdentity = {};

    for (const color of k.possibleColors) {
      for (const number of k.possibleNumbers) {
        const key = identityKey(color, number);
        const copies = Math.max(0, counts[key] || 0);
        if (!copies) continue;

        totalWeight += copies;
        byIdentity[key] = copies;

        const level = view.fireworks[color] || 0;
        if (number === level + 1) playableWeight += copies;

        if (number <= level) {
          safeDiscardWeight += copies;
          uselessWeight += copies;
        } else {
          if (copies > 1) safeDiscardWeight += copies;
          if (copies === 1) criticalWeight += copies;
        }
      }
    }

    if (!totalWeight) {
      return {
        playableProbability: 0,
        safeDiscardProbability: 0,
        criticalProbability: 0,
        uselessProbability: 0,
        byIdentity: {}
      };
    }

    for (const key of Object.keys(byIdentity)) {
      byIdentity[key] /= totalWeight;
    }

    return {
      playableProbability: playableWeight / totalWeight,
      safeDiscardProbability: safeDiscardWeight / totalWeight,
      criticalProbability: criticalWeight / totalWeight,
      uselessProbability: uselessWeight / totalWeight,
      byIdentity
    };
  });
}

function estimatedJointComplexity(view) {
  const counts = visibleCounts(view);
  let product = 1;

  for (const k of view.knowledge) {
    const size = Math.max(1, candidatesForKnowledge(k, counts).length);
    product *= size;
    if (product > 250000) break;
  }

  return product;
}

export function analyzeOwnHand(view, { mode = "hybrid", exactLimit = 500 } = {}) {
  const shouldUseExact =
    mode === "exact" ||
    (mode === "hybrid" && estimatedJointComplexity(view) <= exactLimit);

  if (!shouldUseExact) {
    return analyzeOwnHandFast(view);
  }

  const joint = calculateJointProbabilities(view);

  return joint.map(result => {
    if (!result.total) {
      return {
        playableProbability: 0,
        safeDiscardProbability: 0,
        criticalProbability: 0,
        uselessProbability: 0,
        byIdentity: {}
      };
    }

    let playableProbability = 0;
    let safeDiscardProbability = 0;
    let criticalProbability = 0;
    let uselessProbability = 0;

    const counts = visibleCounts(view);

    for (const [key, probability] of Object.entries(result.byIdentity)) {
      const { color, number } = splitIdentity(key);
      const level = view.fireworks[color] || 0;

      if (number === level + 1) playableProbability += probability;

      if (number <= level) {
        safeDiscardProbability += probability;
        uselessProbability += probability;
      } else {
        const remaining = counts[key] || 0;
        if (remaining > 1) safeDiscardProbability += probability;
        if (remaining === 1) criticalProbability += probability;
      }
    }

    return {
      playableProbability,
      safeDiscardProbability,
      criticalProbability,
      uselessProbability,
      byIdentity: result.byIdentity
    };
  });
}
