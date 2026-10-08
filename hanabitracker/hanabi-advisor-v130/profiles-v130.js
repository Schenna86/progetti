import { createEndgameConversionV112Strategy } from "./strategies/endgame-conversion-v112.js";
import { createExactFinalV1132Strategy } from "./strategies/exact-final-v1132.js";

const COMMON = {
  probabilityMode: "hybrid",
  playThreshold: 1,
  riskPlay: false,
  topK: 2,
  recipientWeight: 0.12,
  criticalDiscardPenalty: 0,
  finalLookaheadTurns: 3,
  twoPlayerPreEndTrigger: 36,
  distanceWeight5p: 25,
  distanceProfile5p: { 1: 4, 2: 3.3, 3: 0.8, 4: 0.8 },
  enableTempo: true,
  enableMultiPlay: false,
  multiVisibleBonus: 45,
  multiUtilityBonus: 70,
  signalPlayMinProbability: 1e-9,
  enableDeferred: false,
  deferredBaseScore: 100,
  enableRoundPlanner: true,
  roundPlannerWeight: 200,
  roundPlannerChainBonus: 110,
  roundPlannerBlockedPenalty: 70,
  enableCoverage: true,
  coverageWeight: 0,
  enableReservation: true,
  reservationBaseScore: 92,
  enableDeadline: false,
  enableCriticalSavePlanner: false,
  enableCriticalCollateral: true,
  criticalCollateralWeight: 60,
  criticalCollateralFiveBonus: 0,
  criticalCollateralExtraPenalty: 8
};

export function profileConfigForPlayers(players) {
  const n = Number(players);
  if (n === 2) return {
    id: "2p-trigger36",
    players: 2,
    queueCoverageBonus: 40,
    reservationWeight: 80,
    criticalCollateralWeight: 60,
    twoPlayerPreEndTrigger: 36,
    exactFinal: false
  };
  if (n === 3) return {
    id: "3p-q100-r80-c60",
    players: 3,
    queueCoverageBonus: 100,
    reservationWeight: 80,
    criticalCollateralWeight: 60,
    twoPlayerPreEndTrigger: 36,
    exactFinal: false
  };
  if (n === 4) return {
    id: "4p-q80-r40-c60",
    players: 4,
    queueCoverageBonus: 80,
    reservationWeight: 40,
    criticalCollateralWeight: 60,
    twoPlayerPreEndTrigger: 36,
    exactFinal: false
  };
  if (n === 5) return {
    id: "5p-q40-r80-c60-exact-hint-T5",
    players: 5,
    queueCoverageBonus: 40,
    reservationWeight: 80,
    criticalCollateralWeight: 60,
    twoPlayerPreEndTrigger: 36,
    exactFinal: true,
    exactPolicy: "hint-T5"
  };
  throw new Error(`Numero giocatori non supportato: ${players}`);
}

export function createFrozenProfileStrategy(players) {
  const cfg = profileConfigForPlayers(players);
  const base = {
    ...COMMON,
    queueCoverageBonus: cfg.queueCoverageBonus,
    reservationWeight: cfg.reservationWeight,
    criticalCollateralWeight: cfg.criticalCollateralWeight,
    twoPlayerPreEndTrigger: cfg.twoPlayerPreEndTrigger
  };

  if (!cfg.exactFinal) return createEndgameConversionV112Strategy(base);

  return createExactFinalV1132Strategy({
    ...base,
    enableExactFinalScheduler: true,
    finalExactAllowPreemptPlay: false,
    finalExactUseRawClues: false,
    finalExactAllowFutureChain: false,
    finalExactTieBreak: "score",
    finalExactMaxHints: 8,
    finalExactOverridePolicy: "hint-T5"
  });
}
