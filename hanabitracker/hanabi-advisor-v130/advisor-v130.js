import {
  COLORS,
  COLOR_CLUES,
  NUMBERS,
  COPIES,
  colorHintTouches,
  configureVariant
} from "./constants.js";
import {
  analyzeOwnHand,
  cloneKnowledge,
  applyColorHint,
  applyNumberHint,
  totalKnowledgeInformation
} from "./knowledge.js";
import { createFrozenProfileStrategy, profileConfigForPlayers } from "./profiles-v130.js";

function toSet(v, fallback = []) {
  if (v instanceof Set) return new Set(v);
  if (Array.isArray(v)) return new Set(v);
  return new Set(fallback);
}

function normalizeKnowledge(k = {}) {
  return {
    cardId: k.cardId ?? null,
    possibleColors: toSet(k.possibleColors, COLORS),
    possibleNumbers: toSet(k.possibleNumbers, NUMBERS),
    playSignal: Boolean(k.playSignal),
    saveSignal: Boolean(k.saveSignal),
    signalAge: Number(k.signalAge || 0),
    playSignalDistance: Number(k.playSignalDistance || 0),
    multiPlaySignal: Boolean(k.multiPlaySignal),
    deferredPlaySignal: Boolean(k.deferredPlaySignal)
  };
}

export function normalizeTrackerView(input) {
  const variant = input?.variant || input?.variantConfig?.name || "standard";
  configureVariant(variant);
  const view = {
    ...input,
    variant,
    playerIndex: Number(input.playerIndex || 0),
    playerCount: Number(input.playerCount || 5),
    clues: Number(input.clues || 0),
    strikes: Number(input.strikes || 0),
    deckRemaining: Number(input.deckRemaining || 0),
    finalTurnsRemaining:
      input.finalTurnsRemaining === null || input.finalTurnsRemaining === undefined
        ? null
        : Number(input.finalTurnsRemaining),
    fireworks: { ...(input.fireworks || {}) },
    discarded: (input.discarded || []).map(c => ({ ...c, number: Number(c.number) })),
    knowledge: (input.knowledge || []).map(normalizeKnowledge),
    otherHands: (input.otherHands || []).map(op => ({
      ...op,
      playerIndex: Number(op.playerIndex),
      hand: (op.hand || []).map(c => ({ ...c, number: Number(c.number) })),
      knowledge: (op.knowledge || []).map(normalizeKnowledge),
      visibleOtherHands: (op.visibleOtherHands || []).map(x => ({
        ...x,
        playerIndex: Number(x.playerIndex),
        hand: (x.hand || []).map(c => ({ ...c, number: Number(c.number) }))
      }))
    }))
  };
  view.ownHandSize = Number(input.ownHandSize ?? view.knowledge.length);
  return view;
}

function actionKey(a) {
  if (!a) return "NULL";
  if (a.type === "PLAY" || a.type === "DISCARD") return `${a.type}:${a.cardIndex}`;
  if (a.type === "HINT") return `HINT:${a.targetIndex}:${a.hintType}:${a.value}`;
  return String(a.type);
}

function visibleRemainingCopies(view, color, number) {
  let n = Number(COPIES[number] || 0);
  for (const card of view.discarded || []) {
    if (card.color === color && Number(card.number) === Number(number)) n--;
  }
  const level = Number(view.fireworks?.[color] || 0);
  if (number <= level) n--;
  return Math.max(0, n);
}

function isVisibleCritical(view, card) {
  if (!card) return false;
  if (Number(card.number) <= Number(view.fireworks?.[card.color] || 0)) return false;
  return visibleRemainingCopies(view, card.color, Number(card.number)) <= 1;
}

function isPlayable(view, card) {
  return Number(card.number) === Number(view.fireworks?.[card.color] || 0) + 1;
}

function touchedIndexes(hand, hintType, value) {
  return hand.map((card, index) => ({ card, index })).filter(x =>
    hintType === "color"
      ? colorHintTouches(x.card.color, value)
      : Number(x.card.number) === Number(value)
  ).map(x => x.index);
}

function simulateHint(opponent, hintType, value) {
  const after = (opponent.knowledge || []).map(cloneKnowledge);
  if (hintType === "color") applyColorHint(opponent.hand, after, value);
  else applyNumberHint(opponent.hand, after, Number(value));
  return after;
}

function hintCandidates(view, strategy) {
  if (view.clues <= 0) return [];
  const diagnostics = typeof strategy.diagnosePlayClues === "function"
    ? strategy.diagnosePlayClues(view)
    : [];
  const diagByKey = new Map();
  for (const d of diagnostics) {
    const key = `HINT:${d.targetIndex}:${d.hintType}:${d.value}`;
    const prev = diagByKey.get(key);
    if (!prev || Number(d.score || 0) > Number(prev.score || 0)) diagByKey.set(key, d);
  }

  const out = [];
  for (const op of view.otherHands || []) {
    const raw = [];
    for (const color of COLOR_CLUES) {
      if (op.hand.some(c => colorHintTouches(c.color, color))) raw.push({ hintType: "color", value: color });
    }
    for (const number of NUMBERS) {
      if (op.hand.some(c => Number(c.number) === number)) raw.push({ hintType: "number", value: number });
    }

    const beforeInfo = totalKnowledgeInformation(op.knowledge || []);
    for (const h of raw) {
      const touched = touchedIndexes(op.hand, h.hintType, h.value);
      if (!touched.length) continue;
      const after = simulateHint(op, h.hintType, h.value);
      const infoGain = Math.max(0, totalKnowledgeInformation(after) - beforeInfo);
      const playableTouched = touched.filter(i => isPlayable(view, op.hand[i]));
      const criticalTouched = touched.filter(i => isVisibleCritical(view, op.hand[i]));
      const nonPlayableTouched = touched.length - playableTouched.length;
      const key = `HINT:${op.playerIndex}:${h.hintType}:${h.value}`;
      const diag = diagByKey.get(key);

      let clueClass = "INFO";
      if (diag) clueClass = "PLAY";
      else if (playableTouched.length > 0) clueClass = "PLAY";
      else if (criticalTouched.length > 0) clueClass = "SAVE";

      let policyScore;
      if (clueClass === "PLAY") {
        policyScore = 700 + playableTouched.length * 35 - nonPlayableTouched * 8 + infoGain * 5;
        if (diag) policyScore += Math.min(120, Math.max(0, Number(diag.score || 0)) / 4);
      } else if (clueClass === "SAVE") {
        policyScore = 585 + criticalTouched.length * 50 + infoGain * 8;
      } else {
        policyScore = 390 + infoGain * 22 + touched.length * 2;
      }

      const focusIndex = diag?.focusIndex ?? (playableTouched.at(-1) ?? criticalTouched.at(-1) ?? touched.at(-1));
      const focus = Number.isInteger(focusIndex) ? op.hand[focusIndex] : null;
      out.push({
        action: {
          type: "HINT",
          targetIndex: op.playerIndex,
          hintType: h.hintType,
          value: h.value,
          clueClass,
          convention: clueClass === "PLAY" && Number.isInteger(focusIndex)
            ? { intent: "PLAY", focusIndex, playSignalDistance: ((op.playerIndex - view.playerIndex + view.playerCount) % view.playerCount), multiPlayIndexes: null, saveIndexes: null, deferred: false }
            : clueClass === "SAVE" && Number.isInteger(focusIndex)
              ? { intent: "SAVE", focusIndex }
              : null
        },
        policyScore,
        category: `HINT_${clueClass}`,
        metrics: {
          infoGain,
          touchedCount: touched.length,
          playableTouched: playableTouched.length,
          criticalTouched: criticalTouched.length,
          focusIndex,
          focusColor: focus?.color ?? null,
          focusNumber: focus?.number ?? null,
          strategyDiagnosticScore: Number(diag?.score || 0),
          roundPlannerGain: Number(diag?.roundPlannerGain || 0),
          queueCoverage: Boolean(diag?.queueCoverage),
          reservation: Boolean(diag?.reservation),
          criticalCollateral: Boolean(diag?.criticalCollateral)
        }
      });
    }
  }
  return out;
}

function ownCandidates(view) {
  const own = analyzeOwnHand(view, { mode: "hybrid" });
  const out = [];
  for (let i = 0; i < own.length; i++) {
    const e = own[i];
    const k = view.knowledge[i] || {};
    const signaled = Boolean(k.playSignal || k.deferredPlaySignal);
    const pPlay = Number(e.playableProbability || 0);
    const pSafe = Number(e.safeDiscardProbability || 0);
    const pCritical = Number(e.criticalProbability || 0);
    const pUseless = Number(e.uselessProbability || 0);

    const playScore = signaled
      ? 940 + pPlay * 40
      : pPlay >= 0.999999
        ? 910 + pPlay * 30
        : 220 + pPlay * 420 - (1 - pPlay) * 180;
    out.push({
      action: { type: "PLAY", cardIndex: i },
      policyScore: playScore,
      category: signaled ? "PLAY_SIGNAL" : pPlay >= 0.999999 ? "PLAY_CERTAIN" : "PLAY_RISK",
      metrics: { playableProbability: pPlay, safeDiscardProbability: pSafe, criticalProbability: pCritical, uselessProbability: pUseless, signaled }
    });

    let protection = 0;
    if (k.saveSignal) protection += 240;
    if (k.playSignal) protection += 220;
    if (k.deferredPlaySignal) protection += 180;
    const cluePressureBonus = view.clues <= 1 ? 70 : view.clues <= 3 ? 35 : 0;
    const discardScore = 470 + pSafe * 120 + pUseless * 35 - pCritical * 260 + cluePressureBonus - protection;
    out.push({
      action: { type: "DISCARD", cardIndex: i },
      policyScore: discardScore,
      category: pSafe >= 0.999999 ? "DISCARD_SAFE" : "DISCARD_RISK",
      metrics: { playableProbability: pPlay, safeDiscardProbability: pSafe, criticalProbability: pCritical, uselessProbability: pUseless, protected: protection > 0 }
    });
  }
  return out;
}

function actionReason(row, selected) {
  const a = row.action;
  const m = row.metrics || {};
  if (selected) {
    if (a.type === "PLAY") return `Mossa scelta dal profilo: gioca la carta ${Number(a.cardIndex) + 1}.`;
    if (a.type === "DISCARD") return `Mossa scelta dal profilo: scarta la carta ${Number(a.cardIndex) + 1} per sicurezza/gestione indizi.`;
    if (a.type === "HINT") return `Mossa scelta dal profilo: indizio ${a.hintType === "color" ? a.value : a.value} a P${Number(a.targetIndex) + 1} (${a.clueClass || "INFO"}).`;
  }
  if (a.type === "PLAY") {
    const p = (100 * Number(m.playableProbability || 0)).toFixed(1);
    return m.signaled ? `Carta ${a.cardIndex + 1}: segnale PLAY attivo, giocabilità stimata ${p}%.` : `Carta ${a.cardIndex + 1}: giocabilità stimata ${p}%.`;
  }
  if (a.type === "DISCARD") {
    return `Carta ${a.cardIndex + 1}: scarto sicuro ${(100 * Number(m.safeDiscardProbability || 0)).toFixed(1)}%, rischio critica ${(100 * Number(m.criticalProbability || 0)).toFixed(1)}%.`;
  }
  if (a.type === "HINT") {
    const base = `Indizio ${a.hintType === "color" ? a.value : a.value} a P${a.targetIndex + 1}`;
    if (a.clueClass === "PLAY") return `${base}: prepara una PLAY; ${m.playableTouched || 0} carta/e già giocabili toccate, info +${Number(m.infoGain || 0).toFixed(2)}.`;
    if (a.clueClass === "SAVE") return `${base}: protegge ${m.criticalTouched || 0} carta/e critica/e, info +${Number(m.infoGain || 0).toFixed(2)}.`;
    return `${base}: indizio informativo, info +${Number(m.infoGain || 0).toFixed(2)}.`;
  }
  return "Azione alternativa.";
}

export function evaluateActions(inputView, { limit = 5 } = {}) {
  const view = normalizeTrackerView(inputView);
  const profile = profileConfigForPlayers(view.playerCount);
  const strategy = createFrozenProfileStrategy(view.playerCount);
  const selectedAction = strategy.chooseAction(view);
  const selectedKey = actionKey(selectedAction);

  const merged = new Map();
  const add = row => {
    const key = actionKey(row.action);
    const prev = merged.get(key);
    if (!prev || row.policyScore > prev.policyScore) merged.set(key, row);
  };

  for (const row of ownCandidates(view)) add(row);
  for (const row of hintCandidates(view, strategy)) add(row);

  const existing = merged.get(selectedKey);
  add({
    ...(existing || {}),
    action: selectedAction,
    policyScore: 10000,
    category: `SELECTED_${selectedAction.type}`,
    metrics: { ...(existing?.metrics || {}), selectedByProfile: true }
  });

  const rows = [...merged.values()].sort((a, b) => b.policyScore - a.policyScore);
  const alternatives = rows.filter(r => actionKey(r.action) !== selectedKey);
  const altScores = alternatives.map(r => r.policyScore);
  const maxAlt = altScores.length ? Math.max(...altScores) : 1;
  const minAlt = altScores.length ? Math.min(...altScores) : 0;
  const span = Math.max(1e-9, maxAlt - minAlt);

  const recommendations = rows.slice(0, Math.max(1, Number(limit || 5))).map((row, index) => {
    const selected = actionKey(row.action) === selectedKey;
    const utility = selected
      ? 100
      : Math.round((55 + 40 * ((row.policyScore - minAlt) / span)) * 10) / 10;
    return {
      rank: index + 1,
      utility,
      selected,
      category: row.category,
      action: row.action,
      reason: actionReason(row, selected),
      metrics: row.metrics || {}
    };
  });

  return {
    advisorVersion: "1.30",
    profile,
    variant: view.variant,
    recommendations
  };
}
