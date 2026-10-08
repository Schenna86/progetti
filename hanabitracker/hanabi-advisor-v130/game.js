import { COLORS, COLOR_CLUES, NUMBERS, COPIES, BONUS_TYPES, cardsPerPlayer, configureVariant, getVariantConfig, targetScore, colorHintTouches, isLegalColorClue } from "./constants.js";
import { createDeck } from "./deck.js";
import { newKnowledge, applyColorHint, applyNumberHint } from "./knowledge.js";

export class HanabiGame {
  constructor({ players = 5, rng, bonusMode = "original", variant = "standard" }) {
    if (players < 2 || players > 5) {
      throw new Error("players deve essere compreso tra 2 e 5");
    }

    configureVariant(variant);
    this.variant = getVariantConfig().name;
    this.players = players;
    this.rng = rng;
    this.cardsPerPlayer = cardsPerPlayer(players);

    this.deck = createDeck(rng);
    this.hands = Array.from({ length: players }, () => []);
    this.knowledge = Array.from({ length: players }, () => []);
    this.fireworks = Object.fromEntries(COLORS.map(c => [c, 0]));
    this.discarded = [];
    this.clues = 8;
    this.strikes = 0;
    this.currentPlayer = 0;
    this.turns = 0;

    this.finalTurnsRemaining = null;
    this.finalCountdownArmed = false;
    this.finished = false;
    this.bonusMode = bonusMode;
    this.bonusDeck = bonusMode === "expansion"
      ? this.rng.shuffle([...BONUS_TYPES])
      : [];
    this.bonusHistory = [];

    // v1.7.1 profiler: history per physical card. This does not affect strategy
    // decisions; it only records opportunities and final-state reasons.
    this.cardProfiler = new Map();

    // v1.10 Lost-Card Profiler. These structures are observability only:
    // they are never exposed to strategies through getPlayerView().
    this.lostCardEvents = [];
    this.penultimateCopyEvents = [];
    this.rawRecoveryEvents = [];

    // v1.13.1 Exact Final override profiler.
    // Observability only; never exposed through getPlayerView().
    this.exactFinalOverrideEvents = [];

    this.stats = {
      plays: 0,
      successfulPlays: 0,
      failedPlays: 0,
      discards: 0,
      hints: 0,
      hintActionsCreated: 0,
      hintCertainPlaysCreated: 0,
      hintSafeDiscardsCreated: 0,
      hintCriticalCreated: 0,
      hintInformationGain: 0,
      hintTouchedCards: 0,
      playClues: 0,
      saveClues: 0,
      criticalSaveClues: 0,
      criticalSave5Clues: 0,
      criticalSaveRawValueSum: 0,
      criticalSavePrioritySum: 0,
      criticalSaveWouldDiscardNow: 0,
      criticalSaveAtClue1: 0,
      criticalSaveAtClue2: 0,
      criticalSaveAtClue3Plus: 0,
      criticalCollateralClues: 0,
      criticalCollateralSavedCards: 0,
      criticalCollateralValueSum: 0,
      criticalCollateralFiveCount: 0,
      infoClues: 0,
      signaledPlayAttempts: 0,
      signaledPlaySuccesses: 0,
      becameDeadByLostCard: false,
      becameDeadByLostCardBeforeDeckEnd: false,
      becameDeadByFinalTurns: false,
      firstDeadTurn: null,
      firstDeadScore: null,
      maxAchievableAtFirstDead: null,
      theoreticalMaxSum: 0,
      theoreticalMaxSamples: 0,
      minTheoreticalMax: targetScore(),
      bonusesDrawn: 0,
      bonusClue: 0,
      bonusClueStrike: 0,
      bonusColorHint: 0,
      bonusNumberHint: 0,
      bonusPlayDiscard: 0,
      bonusReturnDeck: 0,
      phaseNormalPlay: 0,
      phaseNormalHint: 0,
      phaseNormalDiscard: 0,
      phaseNearEndPlay: 0,
      phaseNearEndHint: 0,
      phaseNearEndDiscard: 0,
      phaseFinalPlay: 0,
      phaseFinalHint: 0,
      phaseFinalDiscard: 0,
      playCluesDistance1: 0,
      playCluesDistance2: 0,
      playCluesDistance3: 0,
      playCluesDistance4: 0,
      playSignalAttemptsDistance1: 0,
      playSignalAttemptsDistance2: 0,
      playSignalAttemptsDistance3: 0,
      playSignalAttemptsDistance4: 0,
      playSignalSuccessesDistance1: 0,
      playSignalSuccessesDistance2: 0,
      playSignalSuccessesDistance3: 0,
      playSignalSuccessesDistance4: 0,
      tempoPlayClues: 0,
      multiPlayClues: 0,
      multiPlaySignalsCreated: 0,
      deferredPlayClues: 0,
      deferredPlaySuccesses: 0,
      roundPlannerClues: 0,
      roundPlannerGain: 0,
      roundPlannerChainGain: 0,
      roundPlannerBlockedClues: 0,
      roundPlannerProjectedPlays: 0,
      reservationClues: 0,
      coverageClues: 0,
      queueCoverageClues: 0,
      deadlineUnlocks: 0,
      deadlineLateUnlocks: 0,
      futureOpportunityScore: 0,
      twoRoundGain: 0,
      twoRoundFirstGain: 0,
      twoRoundSecondGain: 0,
      twoRoundChainGain: 0,
      twoRoundStrandedReduction: 0,
      twoRoundScaleBonus: 0,
      twoRoundScore: 0,

      // v1.13 Exact Final-Round Scheduler instrumentation.
      exactFinalDecisions: 0,
      exactFinalOverrides: 0,
      exactFinalPreemptedPlays: 0,
      exactFinalHints: 0,
      exactFinalPlays: 0,
      exactFinalDiscards: 0,
      exactFinalRawClues: 0,
      exactFinalProjectedScoreSum: 0,
      exactFinalProjectedStrandedSum: 0,
      exactFinalProjectedRawLossSum: 0,
      exactFinalNodes: 0
    };

    this.dealInitialHands();
  }

  dealInitialHands() {
    for (let r = 0; r < this.cardsPerPlayer; r++) {
      for (let p = 0; p < this.players; p++) {
        this.drawCard(p);
      }
    }
  }

  drawCard(playerIndex) {
    if (!this.deck.length) return null;
    const card = this.deck.pop();
    this.hands[playerIndex].push(card);
    this.knowledge[playerIndex].push(newKnowledge(card.id));
    this.ensureCardProfiler(card, playerIndex);
    this.updateProfilerCardStates();

    if (this.deck.length === 0 && this.finalTurnsRemaining === null) {
      this.finalTurnsRemaining = this.players + 1;
    }

    return card;
  }

  ensureCardProfiler(card, ownerIndex) {
    let meta = this.cardProfiler.get(card.id);
    if (!meta) {
      meta = {
        cardId: card.id,
        ownerIndex,
        drawnTurn: this.turns,
        firstPlayableTurn: null,
        firstGuaranteedPlayableTurn: null,
        everPlaySignaled: false,
        signalCount: 0,
        lastSignalTurn: null,
        ownerTurnsWhilePlayable: 0,
        ownerTurnsWhileGuaranteed: 0,
        ownerTurnsWhileSignaled: 0,
        ownerTurnsSinceLastSignal: 0,
        clueOpportunitiesWhilePlayable: 0,
        zeroClueOpportunitiesWhilePlayable: 0,
        criticalClueOpportunities: 0,
        criticalZeroClueOpportunities: 0,
        everCriticalVisible: false,
        firstCriticalTurn: null,

        // v1.12 endgame conversion diagnostics.
        conversionCandidateOpportunities: 0,
        conversionPreparationOpportunities: 0,
        conversionFinalOpportunities: 0,
        conversionNearOpportunities: 0,
        conversionNormalOpportunities: 0,
        conversionChosenActions: {},
        conversionBestScore: -Infinity,
        conversionMaxProjectedPlays: 0,
        conversionMaxCertainPlays: 0,
        conversionMaxTouchedPlayable: 0,
        conversionMultiPlayPotential: 0,
        lastConversionOpportunity: null,
        conversionOpportunityEvents: [],
        ownerPlayableChosenActions: {},
        lastOwnerPlayableDecision: null,
        lastOwnerPlayableTurn: null
      };
      this.cardProfiler.set(card.id, meta);
    } else {
      meta.ownerIndex = ownerIndex;
    }
    return meta;
  }

  knowledgeGuaranteesPlayable(k) {
    if (!k) return false;
    let any = false;
    for (const color of k.possibleColors) {
      for (const number of k.possibleNumbers) {
        any = true;
        if (number !== (this.fireworks[color] || 0) + 1) return false;
      }
    }
    return any;
  }

  updateProfilerCardStates() {
    for (let p = 0; p < this.players; p++) {
      const hand = this.hands[p];
      const knowledge = this.knowledge[p];
      for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        const k = knowledge[i];
        const meta = this.ensureCardProfiler(card, p);
        if (this.isPlayable(card) && meta.firstPlayableTurn === null) {
          meta.firstPlayableTurn = this.turns;
        }
        if (this.knowledgeGuaranteesPlayable(k) && meta.firstGuaranteedPlayableTurn === null) {
          meta.firstGuaranteedPlayableTurn = this.turns;
        }
      }
    }
  }

  phaseName() {
    if (this.finalTurnsRemaining !== null) return "FINAL";
    if (this.deck.length <= 5) return "NEAR";
    return "NORMAL";
  }

  remainingUnlostCopies(color, number) {
    return Math.max(
      0,
      Number(COPIES[number] || 0) - this.discardedCount(color, number)
    );
  }

  cardStillNeeded(card) {
    return card.number > Number(this.fireworks[card.color] || 0);
  }

  knowledgeState(k) {
    const colorKnown = Boolean(k && k.possibleColors && k.possibleColors.size === 1);
    const numberKnown = Boolean(k && k.possibleNumbers && k.possibleNumbers.size === 1);
    if (colorKnown && numberKnown) return "BOTH";
    if (colorKnown) return "COLOR";
    if (numberKnown) return "NUMBER";
    return "NONE";
  }

  captureActionCardContext(playerIndex, cardIndex, actionMeta = {}) {
    const card = this.hands[playerIndex]?.[cardIndex];
    const k = this.knowledge[playerIndex]?.[cardIndex];
    if (!card) return null;

    const profiler = this.ensureCardProfiler(card, playerIndex);
    const remainingBefore = this.remainingUnlostCopies(card.color, card.number);

    return {
      card: { ...card },
      playerIndex,
      cardIndex,
      turn: this.turns,
      phase: this.phaseName(),
      clues: this.clues,
      strikes: this.strikes,
      deckRemaining: this.deck.length,
      fireworksBefore: { ...this.fireworks },
      rawMaxBefore: this.maxAchievableScoreByCardAvailability(),
      remainingCopiesBefore: remainingBefore,
      neededBefore: this.cardStillNeeded(card),
      knowledgeState: this.knowledgeState(k),
      colorKnown: Boolean(k?.possibleColors?.size === 1),
      numberKnown: Boolean(k?.possibleNumbers?.size === 1),
      playSignal: Boolean(k?.playSignal),
      deferredPlaySignal: Boolean(k?.deferredPlaySignal),
      saveSignal: Boolean(k?.saveSignal),
      signalAge: Number(k?.signalAge || 0),
      criticalClueOpportunities: Number(profiler.criticalClueOpportunities || 0),
      criticalZeroClueOpportunities: Number(profiler.criticalZeroClueOpportunities || 0),
      everCriticalVisible: Boolean(profiler.everCriticalVisible),
      firstCriticalTurn: profiler.firstCriticalTurn,
      actionMeta: { ...(actionMeta || {}) }
    };
  }

  recordLostCardOutcome(context, cause) {
    if (!context?.card) return;
    const card = context.card;
    const rawMaxAfter = this.maxAchievableScoreByCardAvailability();
    const rawPointsLost = Math.max(0, context.rawMaxBefore - rawMaxAfter);
    const remainingAfter = this.remainingUnlostCopies(card.color, card.number);

    // Penultimate-copy pressure event: this action leaves exactly one unlost copy
    // of an identity that is still needed. It may or may not become fatal later.
    if (
      context.neededBefore &&
      context.remainingCopiesBefore === 2 &&
      remainingAfter === 1
    ) {
      this.penultimateCopyEvents.push({
        color: card.color,
        number: card.number,
        turn: context.turn,
        phase: context.phase,
        cause,
        playerIndex: context.playerIndex,
        clues: context.clues,
        knowledgeState: context.knowledgeState,
        saveSignal: context.saveSignal,
        criticalProbability: Number(context.actionMeta?.criticalProbability || 0),
        safeDiscardProbability: Number(context.actionMeta?.safeDiscardProbability || 0)
      });
    }

    if (rawPointsLost <= 0) return;

    this.lostCardEvents.push({
      color: card.color,
      number: card.number,
      cardId: card.id,
      turn: context.turn,
      phase: context.phase,
      cause,
      rawPointsLost,
      rawMaxBefore: context.rawMaxBefore,
      rawMaxAfter,
      scoreAtLoss: this.score(),
      playerIndex: context.playerIndex,
      clues: context.clues,
      strikes: context.strikes,
      deckRemaining: context.deckRemaining,
      remainingCopiesBefore: context.remainingCopiesBefore,
      remainingCopiesAfter: remainingAfter,
      wasLastCopy: context.remainingCopiesBefore === 1,
      knowledgeState: context.knowledgeState,
      colorKnown: context.colorKnown,
      numberKnown: context.numberKnown,
      playSignal: context.playSignal,
      deferredPlaySignal: context.deferredPlaySignal,
      saveSignal: context.saveSignal,
      signalAge: context.signalAge,
      everCriticalVisible: context.everCriticalVisible,
      criticalClueOpportunities: context.criticalClueOpportunities,
      criticalZeroClueOpportunities: context.criticalZeroClueOpportunities,
      savableWithPriorClue: context.criticalClueOpportunities > 0,
      safeDiscardProbability: Number(context.actionMeta?.safeDiscardProbability || 0),
      uselessProbability: Number(context.actionMeta?.uselessProbability || 0),
      criticalProbability: Number(context.actionMeta?.criticalProbability || 0),
      playCause: context.actionMeta?.playCause || null,
      playableProbability: Number(context.actionMeta?.playableProbability || 0)
    });
  }

  v112ActionLabel(playerIndex, action, ownerIndex=null, cardIndex=null) {
    if(!action?.type) return "UNKNOWN";
    if(action.type==="HINT") {
      if(action.clueClass==="PLAY") {
        if(ownerIndex!==null && action.targetIndex===ownerIndex) {
          if(
            cardIndex!==null &&
            Number(action.convention?.focusIndex)===Number(cardIndex)
          ) return "PLAY_CLUE_THIS_CARD";
          return "PLAY_CLUE_OTHER_CARD_SAME_OWNER";
        }
        return "PLAY_CLUE_OTHER_OWNER";
      }
      if(action.clueClass==="SAVE") return "SAVE_CLUE";
      if(action.clueClass==="INFO") return "INFO_CLUE";
      return "OTHER_HINT";
    }
    if(action.type==="PLAY") {
      if(ownerIndex!==null && playerIndex===ownerIndex) {
        return Number(action.cardIndex)===Number(cardIndex)
          ? "OWNER_PLAY_THIS_CARD"
          : "OWNER_PLAY_OTHER_CARD";
      }
      return "ACTOR_PLAY";
    }
    if(action.type==="DISCARD") {
      if(ownerIndex!==null && playerIndex===ownerIndex) {
        return Number(action.cardIndex)===Number(cardIndex)
          ? "OWNER_DISCARD_THIS_CARD"
          : "OWNER_DISCARD_OTHER_CARD";
      }
      const cause=String(action.meta?.discardCause||"");
      if(cause==="SAFE_CERTAIN") return "ACTOR_SAFE_DISCARD";
      if(cause==="FORCED_NO_CLUE") return "ACTOR_FORCED_NO_CLUE_DISCARD";
      if(cause==="FORCED_BY_PHASE") return "ACTOR_FORCED_PHASE_DISCARD";
      return "ACTOR_DISCARD";
    }
    return String(action.type);
  }

  recordV112DecisionDiagnostics(playerIndex, action, diagnostics=[]) {
    // 1. What did the owner do on a turn where a card in their own hand
    // was already truly playable?
    for(let i=0;i<this.hands[playerIndex].length;i++) {
      const card=this.hands[playerIndex][i];
      if(!this.isPlayable(card)) continue;
      const meta=this.ensureCardProfiler(card,playerIndex);
      const label=this.v112ActionLabel(playerIndex,action,playerIndex,i);
      meta.ownerPlayableChosenActions[label]=(meta.ownerPlayableChosenActions[label]||0)+1;
      const k=this.knowledge[playerIndex]?.[i];
      const otherPlayableSignals=this.hands[playerIndex]
        .map((c,j)=>({c,j,k:this.knowledge[playerIndex]?.[j]}))
        .filter(x=>x.j!==i && x.k?.playSignal && this.isPlayable(x.c)).length;
      meta.lastOwnerPlayableTurn=this.turns;
      meta.lastOwnerPlayableDecision={
        turn:this.turns,
        phase:this.phaseName(),
        clues:this.clues,
        finalTurnsRemaining:this.finalTurnsRemaining,
        action:label,
        playSignal:Boolean(k?.playSignal),
        deferredPlaySignal:Boolean(k?.deferredPlaySignal),
        guaranteedPlayable:this.knowledgeGuaranteesPlayable(k),
        otherPlayableSignals
      };
    }

    // 2. For every visible card for which the strategy's own convention
    // produced a legal PLAY-clue candidate this turn, record what was
    // actually chosen instead. Deduplicate color/number alternatives by card.
    const bestByCard=new Map();
    for(const d of diagnostics||[]) {
      if(!d?.focusCardId) continue;
      const prev=bestByCard.get(d.focusCardId);
      if(!prev || Number(d.score||-Infinity)>Number(prev.score||-Infinity)) {
        bestByCard.set(d.focusCardId,d);
      }
    }

    for(const [cardId,d] of bestByCard) {
      let ownerIndex=null,cardIndex=null,card=null,k=null;
      for(let p=0;p<this.players;p++) {
        const idx=this.hands[p].findIndex(c=>c.id===cardId);
        if(idx>=0) {
          ownerIndex=p; cardIndex=idx; card=this.hands[p][idx];
          k=this.knowledge[p]?.[idx];
          break;
        }
      }
      if(ownerIndex===null || ownerIndex===playerIndex || !card) continue;

      const meta=this.ensureCardProfiler(card,ownerIndex);
      const trulyPlayable=this.isPlayable(card);
      const isPreparation=!trulyPlayable && (d.tempo || d.reservation);
      if(!trulyPlayable && !isPreparation) continue;

      const selectedLabel=this.v112ActionLabel(playerIndex,action,ownerIndex,cardIndex);
      if(trulyPlayable) {
        meta.conversionCandidateOpportunities++;
        if(this.finalTurnsRemaining!==null) meta.conversionFinalOpportunities++;
        else if(this.deck.length<=5) meta.conversionNearOpportunities++;
        else meta.conversionNormalOpportunities++;
        meta.conversionChosenActions[selectedLabel]=(meta.conversionChosenActions[selectedLabel]||0)+1;
      } else {
        meta.conversionPreparationOpportunities++;
      }

      meta.conversionBestScore=Math.max(
        Number.isFinite(meta.conversionBestScore)?meta.conversionBestScore:-Infinity,
        Number(d.score||0)
      );
      meta.conversionMaxProjectedPlays=Math.max(meta.conversionMaxProjectedPlays,Number(d.roundPlannerProjectedPlays||0));
      meta.conversionMaxCertainPlays=Math.max(meta.conversionMaxCertainPlays,Number(d.certainPlaysCreated||0));
      meta.conversionMaxTouchedPlayable=Math.max(meta.conversionMaxTouchedPlayable,Number(d.projectedPlayableTouched||0));
      if(
        Number(d.roundPlannerGain||0)>=2 ||
        Number(d.certainPlaysCreated||0)>=2 ||
        Number(d.projectedPlayableTouched||0)>=2
      ) {
        meta.conversionMultiPlayPotential++;
      }

      if(trulyPlayable) {
        meta.conversionOpportunityEvents.push({
          turn:this.turns,
          phase:this.phaseName(),
          selectedAction:selectedLabel,
          clues:this.clues,
          finalTurnsRemaining:this.finalTurnsRemaining,
          candidateScore:Number(d.score||0),
          distance:Number(d.distance||0),
          projectedPlays:Number(d.roundPlannerProjectedPlays||0),
          certainPlaysCreated:Number(d.certainPlaysCreated||0),
          touchedPlayable:Number(d.projectedPlayableTouched||0)
        });
        meta.lastConversionOpportunity={
          turn:this.turns,
          phase:this.phaseName(),
          actingPlayer:playerIndex,
          ownerIndex,
          clues:this.clues,
          finalTurnsRemaining:this.finalTurnsRemaining,
          selectedAction:selectedLabel,
          candidateScore:Number(d.score||0),
          hintType:d.hintType,
          hintValue:d.value,
          distance:Number(d.distance||0),
          roundPlannerGain:Number(d.roundPlannerGain||0),
          projectedPlays:Number(d.roundPlannerProjectedPlays||0),
          certainPlaysCreated:Number(d.certainPlaysCreated||0),
          touchedPlayable:Number(d.projectedPlayableTouched||0),
          eligibleFinal:Boolean(d.eligibleFinal),
          ownerHadPlaySignal:Boolean(k?.playSignal),
          ownerHadDeferredSignal:Boolean(k?.deferredPlaySignal)
        };
      }
    }
  }

  v112PrimaryStrandedReason(meta,k) {
    const activeSignal=Boolean(k?.playSignal||k?.deferredPlaySignal);
    if(meta.ownerTurnsWhilePlayable===0) return "BECAME_PLAYABLE_TOO_LATE";
    if(activeSignal && meta.ownerTurnsSinceLastSignal===0) return "SIGNALLED_NO_OWNER_TURN";
    if(activeSignal && meta.ownerTurnsSinceLastSignal>0) return "SIGNALLED_NOT_CONVERTED";

    if(meta.conversionCandidateOpportunities>0) {
      const last=meta.lastConversionOpportunity?.selectedAction||"UNKNOWN";
      if(last==="PLAY_CLUE_OTHER_CARD_SAME_OWNER") return "LOST_TO_PLAY_CLUE_SAME_OWNER";
      if(last==="PLAY_CLUE_OTHER_OWNER") return "LOST_TO_PLAY_CLUE_OTHER_OWNER";
      if(last==="ACTOR_PLAY") return "ACTOR_PLAYED_INSTEAD_OF_CLUE";
      if(last==="ACTOR_SAFE_DISCARD" || last==="ACTOR_DISCARD") return "ACTOR_DISCARDED_INSTEAD_OF_CLUE";
      if(last==="SAVE_CLUE") return "LOST_TO_SAVE_CLUE";
      if(last==="INFO_CLUE" || last==="OTHER_HINT") return "LOST_TO_INFO_CLUE";
      if(last==="PLAY_CLUE_THIS_CARD") return "CLUE_GIVEN_BUT_NOT_CONVERTED";
      return `CANDIDATE_EXISTED_${last}`;
    }

    if(meta.clueOpportunitiesWhilePlayable>0) return "CLUE_AVAILABLE_NO_PLAY_CANDIDATE";
    if(meta.zeroClueOpportunitiesWhilePlayable>0) return "NO_CLUES_WHILE_PLAYABLE";
    if(meta.conversionPreparationOpportunities>0) return "PREP_OPPORTUNITY_ONLY";
    return "OTHER";
  }

  finalEndgameConversionProfile() {
    const events=[];
    const reasons={};

    for(let p=0;p<this.players;p++) {
      for(let i=0;i<this.hands[p].length;i++) {
        const card=this.hands[p][i];
        if(!this.isPlayable(card)) continue;
        const k=this.knowledge[p]?.[i];
        const meta=this.ensureCardProfiler(card,p);
        const reason=this.v112PrimaryStrandedReason(meta,k);
        reasons[reason]=(reasons[reason]||0)+1;

        const dominantAlternative=Object.entries(meta.conversionChosenActions||{})
          .sort((a,b)=>b[1]-a[1])[0]?.[0] || null;
        const activePlayableSignals=this.hands[p]
          .map((c,j)=>({c,j,k:this.knowledge[p]?.[j]}))
          .filter(x=>x.k?.playSignal && this.isPlayable(x.c)).length;

        const lastOwnerTurn=meta.lastOwnerPlayableTurn;
        const candidateBeforeLastOwnerTurn=(meta.conversionOpportunityEvents||[])
          .filter(e=>lastOwnerTurn!==null && e.turn<lastOwnerTurn).length;
        const candidateAfterLastOwnerTurn=(meta.conversionOpportunityEvents||[])
          .filter(e=>lastOwnerTurn===null || e.turn>lastOwnerTurn).length;

        events.push({
          cardId:card.id,
          color:card.color,
          number:card.number,
          ownerIndex:p,
          reason,
          firstPlayableTurn:meta.firstPlayableTurn,
          firstGuaranteedPlayableTurn:meta.firstGuaranteedPlayableTurn,
          playableForTurns:
            meta.firstPlayableTurn===null ? 0 : Math.max(0,this.turns-meta.firstPlayableTurn),
          ownerTurnsWhilePlayable:meta.ownerTurnsWhilePlayable,
          lastOwnerPlayableTurn:lastOwnerTurn,
          candidateBeforeLastOwnerTurn,
          candidateAfterLastOwnerTurn,
          ownerTurnsWhileGuaranteed:meta.ownerTurnsWhileGuaranteed,
          ownerTurnsWhileSignaled:meta.ownerTurnsWhileSignaled,
          clueOpportunitiesWhilePlayable:meta.clueOpportunitiesWhilePlayable,
          zeroClueOpportunitiesWhilePlayable:meta.zeroClueOpportunitiesWhilePlayable,
          playClueCandidateOpportunities:meta.conversionCandidateOpportunities,
          preparationCandidateOpportunities:meta.conversionPreparationOpportunities,
          finalCandidateOpportunities:meta.conversionFinalOpportunities,
          nearCandidateOpportunities:meta.conversionNearOpportunities,
          normalCandidateOpportunities:meta.conversionNormalOpportunities,
          candidateChosenActions:{...(meta.conversionChosenActions||{})},
          dominantAlternative,
          bestCandidateScore:Number.isFinite(meta.conversionBestScore)?meta.conversionBestScore:0,
          maxProjectedPlays:meta.conversionMaxProjectedPlays,
          maxCertainPlays:meta.conversionMaxCertainPlays,
          maxTouchedPlayable:meta.conversionMaxTouchedPlayable,
          multiPlayPotential:meta.conversionMultiPlayPotential,
          lastConversionOpportunity:meta.lastConversionOpportunity?{...meta.lastConversionOpportunity}:null,
          ownerPlayableChosenActions:{...(meta.ownerPlayableChosenActions||{})},
          lastOwnerPlayableDecision:meta.lastOwnerPlayableDecision?{...meta.lastOwnerPlayableDecision}:null,
          activePlaySignal:Boolean(k?.playSignal),
          activeDeferredSignal:Boolean(k?.deferredPlaySignal),
          guaranteedPlayable:this.knowledgeGuaranteesPlayable(k),
          activePlayableSignalsInOwnerHand:activePlayableSignals,
          knowledgeState:this.knowledgeState(k)
        });
      }
    }

    return {total:events.length,reasons,events};
  }

  recordProfilerTurnOpportunities(playerIndex) {
    // Owner opportunities: could the owner have played this card on this turn?
    for (let i = 0; i < this.hands[playerIndex].length; i++) {
      const card = this.hands[playerIndex][i];
      const k = this.knowledge[playerIndex][i];
      const meta = this.ensureCardProfiler(card, playerIndex);
      if (this.isPlayable(card)) meta.ownerTurnsWhilePlayable++;
      if (this.knowledgeGuaranteesPlayable(k)) meta.ownerTurnsWhileGuaranteed++;
      if (k?.playSignal) {
        meta.ownerTurnsWhileSignaled++;
        meta.ownerTurnsSinceLastSignal++;
      }
    }

    // Clue opportunities: another player has a turn while the card is playable,
    // and v1.10 also tracks opportunities to SAVE a globally critical last copy.
    for (let owner = 0; owner < this.players; owner++) {
      if (owner === playerIndex) continue;
      for (const card of this.hands[owner]) {
        const meta = this.ensureCardProfiler(card, owner);

        if (this.isPlayable(card)) {
          if (this.clues > 0) meta.clueOpportunitiesWhilePlayable++;
          else meta.zeroClueOpportunitiesWhilePlayable++;
        }

        const isCriticalLastCopy =
          this.cardStillNeeded(card) &&
          this.remainingUnlostCopies(card.color, card.number) === 1;

        if (isCriticalLastCopy) {
          meta.everCriticalVisible = true;
          if (meta.firstCriticalTurn === null) meta.firstCriticalTurn = this.turns;
          if (this.clues > 0) meta.criticalClueOpportunities++;
          else meta.criticalZeroClueOpportunities++;
        }
      }
    }
  }

  markProfilerPlaySignal(targetIndex, cardIndex) {
    const card = this.hands[targetIndex]?.[cardIndex];
    if (!card) return;
    const meta = this.ensureCardProfiler(card, targetIndex);
    meta.everPlaySignaled = true;
    meta.signalCount++;
    meta.lastSignalTurn = this.turns;
    meta.ownerTurnsSinceLastSignal = 0;
  }

  discardedCount(color, number) {
    return this.discarded.filter(card =>
      card.color === color && card.number === number
    ).length;
  }

  maxAchievableScoreByCardAvailability() {
    let total = 0;

    for (const color of COLORS) {
      let reachable = Number(this.fireworks[color] || 0);

      for (let number = reachable + 1; number <= 5; number++) {
        const lost = this.discardedCount(color, number);
        const remainingCopies = Math.max(0, Number(COPIES[number] || 0) - lost);

        if (remainingCopies <= 0) break;
        reachable = number;
      }

      total += reachable;
    }

    return total;
  }

  maxAchievableScoreWithRecoveryPotential() {
    const raw = this.maxAchievableScoreByCardAvailability();
    if (this.bonusMode !== "expansion") return raw;

    // Optimistic upper bound: each still-undrawn recovery bonus may restore one
    // completely lost identity. It deliberately ignores whether another 5 can
    // actually be completed to draw that bonus, so it is an upper bound.
    const recoveryBudget = this.bonusDeck.filter(
      x => x === "PLAY_DISCARD" || x === "RETURN_DISCARD_TO_DECK"
    ).length;
    if (recoveryBudget <= 0) return raw;

    // For every color, compute the number of missing identities that must be
    // recovered to reach each possible level from the current firework.
    const optionsByColor = [];
    for (const color of COLORS) {
      const reached = Number(this.fireworks[color] || 0);
      const opts = [{ level: reached, cost: 0 }];
      let cost = 0;
      for (let number = reached + 1; number <= 5; number++) {
        const lost = this.discardedCount(color, number);
        const remainingCopies = Math.max(0, Number(COPIES[number] || 0) - lost);
        if (remainingCopies <= 0) cost++;
        opts.push({ level: number, cost });
      }
      optionsByColor.push(opts);
    }

    // Small knapsack over 5 colors and at most two recovery bonuses.
    let dp = Array(recoveryBudget + 1).fill(-Infinity);
    dp[0] = 0;
    for (const opts of optionsByColor) {
      const next = Array(recoveryBudget + 1).fill(-Infinity);
      for (let used = 0; used <= recoveryBudget; used++) {
        if (!Number.isFinite(dp[used])) continue;
        for (const opt of opts) {
          const totalCost = used + opt.cost;
          if (totalCost > recoveryBudget) continue;
          next[totalCost] = Math.max(next[totalCost], dp[used] + opt.level);
        }
      }
      dp = next;
    }
    return Math.max(raw, ...dp.filter(Number.isFinite));
  }

  remainingFinalActionTurns() {
    if (this.deck.length > 0 || this.finalTurnsRemaining === null) return null;
    return Math.max(0, Number(this.finalTurnsRemaining || 0));
  }

  updateDeadState() {
    const maxByCards = this.maxAchievableScoreByCardAvailability();

    if (maxByCards < targetScore() && !this.stats.becameDeadByLostCard) {
      this.stats.becameDeadByLostCard = true;
      if (this.deck.length > 0) {
        this.stats.becameDeadByLostCardBeforeDeckEnd = true;
      }
      if (this.stats.firstDeadTurn === null) {
        this.stats.firstDeadTurn = this.turns;
        this.stats.firstDeadScore = this.score();
        this.stats.maxAchievableAtFirstDead = maxByCards;
      }
    }

    const finalTurns = this.remainingFinalActionTurns();
    if (finalTurns !== null) {
      const playsNeeded = Math.max(0, targetScore() - this.score());
      if (finalTurns < playsNeeded && !this.stats.becameDeadByFinalTurns) {
        this.stats.becameDeadByFinalTurns = true;
        if (this.stats.firstDeadTurn === null) {
          this.stats.firstDeadTurn = this.turns;
          this.stats.firstDeadScore = this.score();
          this.stats.maxAchievableAtFirstDead = Math.min(
            maxByCards,
            this.score() + finalTurns
          );
        }
      }
    }
  }

  score() {
    return Object.values(this.fireworks).reduce((a, b) => a + b, 0);
  }

  isPlayable(card) {
    return card.number === this.fireworks[card.color] + 1;
  }

  removeHandCard(playerIndex, cardIndex) {
    const [card] = this.hands[playerIndex].splice(cardIndex, 1);
    this.knowledge[playerIndex].splice(cardIndex, 1);
    return card;
  }

  play(playerIndex, cardIndex, actionMeta = {}) {
    const lossContext = this.captureActionCardContext(playerIndex, cardIndex, actionMeta);
    const signalKnowledge = this.knowledge[playerIndex]?.[cardIndex];
    const wasSignaled = Boolean(signalKnowledge?.playSignal);
    const wasDeferred = Boolean(signalKnowledge?.deferredPlaySignal);
    const playSignalDistance = Number(signalKnowledge?.playSignalDistance || 0);
    const card = this.removeHandCard(playerIndex, cardIndex);
    this.stats.plays++;

    if (wasSignaled) {
      this.stats.signaledPlayAttempts++;
      const key = `playSignalAttemptsDistance${playSignalDistance}`;
      if (playSignalDistance >= 1 && playSignalDistance <= 4 && key in this.stats) {
        this.stats[key]++;
      }
    }

    if (this.isPlayable(card)) {
      this.fireworks[card.color] = card.number;
      this.stats.successfulPlays++;
      if (wasDeferred) this.stats.deferredPlaySuccesses++;
      if (wasSignaled) {
        this.stats.signaledPlaySuccesses++;
        const key = `playSignalSuccessesDistance${playSignalDistance}`;
        if (playSignalDistance >= 1 && playSignalDistance <= 4 && key in this.stats) {
          this.stats[key]++;
        }
      }
      if (card.number === 5) {
        this.resolveCompletedFireworkBonus(playerIndex);
      }
    } else {
      this.discarded.push(card);
      this.strikes++;
      this.stats.failedPlays++;
      const playCause = actionMeta?.playCause || (wasSignaled ? "SIGNAL" : "OTHER");
      this.recordLostCardOutcome(lossContext, `FAILED_PLAY_${playCause}`);
    }

    this.drawCard(playerIndex);
  }

  discard(playerIndex, cardIndex, actionMeta = {}) {
    const lossContext = this.captureActionCardContext(playerIndex, cardIndex, actionMeta);
    const card = this.removeHandCard(playerIndex, cardIndex);
    this.discarded.push(card);
    const cause = `DISCARD_${actionMeta?.discardCause || "UNKNOWN"}`;
    this.recordLostCardOutcome(lossContext, cause);
    this.clues = Math.min(8, this.clues + 1);
    this.stats.discards++;
    this.drawCard(playerIndex);
  }

  hint(playerIndex, targetIndex, hintType, value, convention = null) {
    if (this.clues <= 0) throw new Error("Nessun indizio disponibile");
    if (targetIndex === playerIndex) throw new Error("Non puoi dare un indizio a te stesso");

    const targetHand = this.hands[targetIndex];
    const targetKnowledge = this.knowledge[targetIndex];

    const touchedIndexes = targetHand
      .map((card, index) => ({ card, index }))
      .filter(x =>
        hintType === "color"
          ? colorHintTouches(x.card.color, value)
          : x.card.number === Number(value)
      )
      .map(x => x.index);

    if (hintType === "color" && !isLegalColorClue(value)) {
      throw new Error(`Indizio colore non valido per la variante ${this.variant}: ${value}`);
    }
    if (!touchedIndexes.length) {
      throw new Error("Indizio non valido: deve toccare almeno una carta");
    }

    this.clues--;
    this.stats.hints++;

    if (hintType === "color") {
      applyColorHint(targetHand, targetKnowledge, value);
    } else {
      applyNumberHint(targetHand, targetKnowledge, Number(value));
    }

    // Protocollo convenzionale v0.4:
    // il focus è una carta toccata determinata dal suggeritore.
    // Non modifica l'identità logica della carta: memorizza solo
    // l'interpretazione condivisa dell'indizio.
    if (
      convention &&
      Number.isInteger(convention.focusIndex) &&
      touchedIndexes.includes(convention.focusIndex)
    ) {
      const signalPlayIndex = (index,isMulti=false) => {
        if (!Number.isInteger(index) || !touchedIndexes.includes(index)) return;
        const k = targetKnowledge[index];
        k.playSignal = true;
        k.saveSignal = false;
        k.signalAge = 0;
        k.playSignalDistance = Number(convention.playSignalDistance || 0);
        k.multiPlaySignal = Boolean(isMulti);
        k.deferredPlaySignal = false;
        this.markProfilerPlaySignal(targetIndex, index);
      };

      const focused = targetKnowledge[convention.focusIndex];

      if (convention.intent === "PLAY") {
        if (convention.deferred) {
          const k=targetKnowledge[convention.focusIndex];
          k.deferredPlaySignal=true;
          k.playSignal=false;
          k.saveSignal=false;
          k.multiPlaySignal=false;
          k.signalAge=0;
          this.markProfilerPlaySignal(targetIndex, convention.focusIndex);
        } else {
          signalPlayIndex(convention.focusIndex,false);
          const extra = Array.isArray(convention.multiPlayIndexes)
            ? convention.multiPlayIndexes.filter(i => i !== convention.focusIndex)
            : [];
          for (const index of extra) signalPlayIndex(index,true);
        }
        const saveIndexes = Array.isArray(convention.saveIndexes) ? convention.saveIndexes : [];
        for(const index of saveIndexes) {
          if(index===convention.focusIndex || !touchedIndexes.includes(index)) continue;
          const k=targetKnowledge[index];
          if(!k || k.playSignal || k.deferredPlaySignal) continue;
          k.saveSignal=true;
          k.signalAge=0;
        }
      } else if (convention.intent === "SAVE") {
        focused.saveSignal = true;
        focused.playSignal = false;
        focused.signalAge = 0;
        focused.playSignalDistance = 0;
        focused.multiPlaySignal = false;
        focused.deferredPlaySignal = false;
      }
    }
  }


  chooseBestDiscardCardForBonus() {
    const playable = this.discarded
      .filter(card => this.isPlayable(card))
      .sort((a, b) => {
        const aLost = this.discarded.filter(
          x => x.color === a.color && x.number === a.number
        ).length >= COPIES[a.number];
        const bLost = this.discarded.filter(
          x => x.color === b.color && x.number === b.number
        ).length >= COPIES[b.number];

        return Number(bLost) - Number(aLost) || b.number - a.number;
      });

    return playable[0] || null;
  }

  chooseBestDiscardCardToReturn() {
    const candidates = this.discarded
      .filter(card => card.number > (this.fireworks[card.color] || 0))
      .map(card => {
        const level = this.fireworks[card.color] || 0;
        const immediatelyPlayable = card.number === level + 1 ? 100 : 0;
        const allLost = this.discarded.filter(
          x => x.color === card.color && x.number === card.number
        ).length >= COPIES[card.number];

        return {
          card,
          score:
            immediatelyPlayable +
            (allLost ? 80 : 0) +
            (6 - card.number)
        };
      })
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.card || null;
  }

  applyFreeHint(playerIndex, hintType) {
    const targets = this.hands
      .map((hand, index) => ({ hand, index }))
      .filter(x => x.index !== playerIndex);

    let best = null;

    for (const target of targets) {
      if (hintType === "color") {
        for (const color of COLOR_CLUES) {
          const touched = target.hand.filter(card => colorHintTouches(card.color, color));
          if (!touched.length) continue;

          const playable = touched.filter(card => this.isPlayable(card)).length;
          const score = playable * 100 + touched.length * 5;

          if (!best || score > best.score) {
            best = {
              score,
              targetIndex: target.index,
              value: color
            };
          }
        }
      } else {
        for (const number of NUMBERS) {
          const touched = target.hand.filter(card => card.number === number);
          if (!touched.length) continue;

          const playable = touched.filter(card => this.isPlayable(card)).length;
          const score = playable * 100 + touched.length * 5;

          if (!best || score > best.score) {
            best = {
              score,
              targetIndex: target.index,
              value: number
            };
          }
        }
      }
    }

    if (!best) return false;

    const targetHand = this.hands[best.targetIndex];
    const targetKnowledge = this.knowledge[best.targetIndex];

    if (hintType === "color") {
      applyColorHint(targetHand, targetKnowledge, best.value);
    } else {
      applyNumberHint(targetHand, targetKnowledge, Number(best.value));
    }

    return true;
  }

  resolveCompletedFireworkBonus(playerIndex) {
    const rawMaxBeforeBonus = this.maxAchievableScoreByCardAvailability();
    if (this.bonusMode !== "expansion") {
      this.clues = Math.min(8, this.clues + 1);
      return;
    }

    if (!this.bonusDeck.length) return;

    const bonus = this.bonusDeck.pop();
    this.bonusHistory.push(bonus);
    this.stats.bonusesDrawn++;

    if (bonus === "CLUE") {
      this.clues = Math.min(8, this.clues + 1);
      this.stats.bonusClue++;
      return;
    }

    if (bonus === "CLUE_AND_STRIKE_RECOVERY") {
      this.clues = Math.min(8, this.clues + 1);
      this.strikes = Math.max(0, this.strikes - 1);
      this.stats.bonusClueStrike++;
      return;
    }

    if (bonus === "FREE_COLOR_HINT") {
      this.applyFreeHint(playerIndex, "color");
      this.stats.bonusColorHint++;
      return;
    }

    if (bonus === "FREE_NUMBER_HINT") {
      this.applyFreeHint(playerIndex, "number");
      this.stats.bonusNumberHint++;
      return;
    }

    if (bonus === "PLAY_FROM_DISCARD") {
      const card = this.chooseBestDiscardCardForBonus();

      if (card) {
        const index = this.discarded.findIndex(x => x.id === card.id);
        if (index >= 0) this.discarded.splice(index, 1);
        this.fireworks[card.color] = card.number;
      }

      this.stats.bonusPlayDiscard++;
      const rawMaxAfterBonus = this.maxAchievableScoreByCardAvailability();
      if (rawMaxAfterBonus > rawMaxBeforeBonus) {
        this.rawRecoveryEvents.push({
          turn:this.turns,
          bonus:"PLAY_DISCARD",
          rawPointsRecovered:rawMaxAfterBonus-rawMaxBeforeBonus
        });
      }
      return;
    }

    if (bonus === "RETURN_DISCARD_TO_DECK") {
      const card = this.chooseBestDiscardCardToReturn();

      if (card) {
        const index = this.discarded.findIndex(x => x.id === card.id);
        if (index >= 0) this.discarded.splice(index, 1);

        if (this.deck.length === 0 && this.isPlayable(card)) {
          this.fireworks[card.color] = card.number;
        } else {
          this.deck.push(card);

          if (this.finalTurnsRemaining !== null) {
            this.finalTurnsRemaining = null;
            this.finalCountdownArmed = false;
          }
        }
      }

      this.stats.bonusReturnDeck++;
      const rawMaxAfterBonus = this.maxAchievableScoreByCardAvailability();
      if (rawMaxAfterBonus > rawMaxBeforeBonus) {
        this.rawRecoveryEvents.push({
          turn:this.turns,
          bonus:"RETURN_DISCARD_TO_DECK",
          rawPointsRecovered:rawMaxAfterBonus-rawMaxBeforeBonus
        });
      }
    }
  }

  getPlayerView(playerIndex) {
    return {
      playerIndex,
      playerCount: this.players,
      clues: this.clues,
      strikes: this.strikes,
      fireworks: { ...this.fireworks },
      discarded: this.discarded.map(c => ({ ...c })),
      deckRemaining: this.deck.length,
      finalTurnsRemaining: this.finalTurnsRemaining,
      finalCountdownArmed: this.finalCountdownArmed,
      bonusMode: this.bonusMode,
      variant: this.variant,
      variantConfig: getVariantConfig(),
      targetScore: targetScore(),
      bonusRemaining: [...this.bonusDeck],
      bonusHistory: [...this.bonusHistory],
      ownHandSize: this.hands[playerIndex].length,
      knowledge: this.knowledge[playerIndex].map(k => ({
        cardId: k.cardId,
        possibleColors: new Set(k.possibleColors),
        possibleNumbers: new Set(k.possibleNumbers),
        playSignal: Boolean(k.playSignal),
        saveSignal: Boolean(k.saveSignal),
        signalAge: Number(k.signalAge || 0),
        playSignalDistance: Number(k.playSignalDistance || 0),
        multiPlaySignal: Boolean(k.multiPlaySignal),
        deferredPlaySignal: Boolean(k.deferredPlaySignal)
      })),
      otherHands: this.hands
        .map((hand, index) => {
          if (index === playerIndex) return null;

          return {
            playerIndex: index,
            hand: hand.map(c => ({ ...c })),
            knowledge: this.knowledge[index].map(k => ({
              cardId: k.cardId,
              possibleColors: new Set(k.possibleColors),
              possibleNumbers: new Set(k.possibleNumbers),
              playSignal: Boolean(k.playSignal),
              saveSignal: Boolean(k.saveSignal),
              signalAge: Number(k.signalAge || 0)
            })),
            visibleOtherHands: this.hands
              .map((otherHand, otherIndex) => ({
                playerIndex: otherIndex,
                hand: otherIndex === index ? null : otherHand.map(c => ({ ...c }))
              }))
              .filter(x => x.playerIndex !== index && x.hand)
          };
        })
        .filter(Boolean)
    };
  }


  getPerfectInformationView(playerIndex, { includeDeck = false } = {}) {
    const base = this.getPlayerView(playerIndex);
    return {
      ...base,
      perfectInformation: true,
      ownHand: this.hands[playerIndex].map(card => ({ ...card })),
      allHands: this.hands.map((hand, index) => ({
        playerIndex: index,
        hand: hand.map(card => ({ ...card }))
      })),
      ...(includeDeck
        ? { deckOrder: this.deck.map(card => ({ ...card })) }
        : {})
    };
  }

  advanceTurn() {
    this.turns++;

    for (const playerKnowledge of this.knowledge) {
      for (const k of playerKnowledge) {
        if (k.playSignal || k.saveSignal) {
          k.signalAge = Number(k.signalAge || 0) + 1;
        }
      }
    }

    if (this.strikes >= 3 || this.score() >= targetScore()) {
      this.finished = true;
      return;
    }

    if (this.finalTurnsRemaining !== null) {
      if (this.finalCountdownArmed) {
        this.finalCountdownArmed = false;
      } else {
        this.finalTurnsRemaining--;
        if (this.finalTurnsRemaining <= 0) {
          this.finished = true;
          return;
        }
      }
    }

    this.currentPlayer = (this.currentPlayer + 1) % this.players;
  }

  step(strategy) {
    if (this.finished) return;

    const player = this.currentPlayer;
    this.updateProfilerCardStates();
    this.recordProfilerTurnOpportunities(player);
    const view =
      strategy?.perfectInformation
        ? this.getPerfectInformationView(player, {
            includeDeck: Boolean(strategy?.omniscientDeck)
          })
        : this.getPlayerView(player);
    const action = strategy.chooseAction(view);

    if (!action || !action.type) {
      throw new Error("Strategia ha restituito un'azione non valida");
    }

    const v112Diagnostics =
      typeof strategy.diagnosePlayClues === "function"
        ? strategy.diagnosePlayClues(view)
        : [];
    this.recordV112DecisionDiagnostics(player, action, v112Diagnostics);

    if (action.meta?.exactFinal) {
      this.stats.exactFinalDecisions++;
      if (action.meta.exactFinalOverride) this.stats.exactFinalOverrides++;
      if (action.meta.exactFinalPreemptedPlay) this.stats.exactFinalPreemptedPlays++;
      if (action.type === "HINT") this.stats.exactFinalHints++;
      else if (action.type === "PLAY") this.stats.exactFinalPlays++;
      else if (action.type === "DISCARD") this.stats.exactFinalDiscards++;
      if (action.meta.exactFinalRawClue) this.stats.exactFinalRawClues++;
      this.stats.exactFinalProjectedScoreSum += Number(action.meta.exactFinalProjectedScore || 0);
      this.stats.exactFinalProjectedStrandedSum += Number(action.meta.exactFinalProjectedStranded || 0);
      this.stats.exactFinalProjectedRawLossSum += Number(action.meta.exactFinalProjectedRawLoss || 0);
      this.stats.exactFinalNodes += Number(action.meta.exactFinalNodes || 0);

      if (action.meta.exactFinalOverride) {
        const selectedTarget =
          Number.isInteger(action.meta.exactFinalSelectedTargetIndex)
            ? action.meta.exactFinalSelectedTargetIndex
            : null;
        const baselineTarget =
          Number.isInteger(action.meta.exactFinalBaselineTargetIndex)
            ? action.meta.exactFinalBaselineTargetIndex
            : null;

        this.exactFinalOverrideEvents.push({
          turn:this.turns,
          currentPlayer:player,
          scoreBefore:this.score(),
          cluesBefore:this.clues,
          strikesBefore:this.strikes,
          finalTurnsRemaining:this.finalTurnsRemaining,
          maxRawBefore:this.maxAchievableScoreByCardAvailability(),
          playableInHandsBefore:this.finalCardLocationProfile().playableInHands,

          baselineType:action.meta.exactFinalBaselineType || null,
          baselineLabel:action.meta.exactFinalBaselineLabel || null,
          baselineClueClass:action.meta.exactFinalBaselineClueClass || null,
          baselineTargetIndex:baselineTarget,
          baselineDistance:Number(action.meta.exactFinalBaselineDistance || 0),

          selectedType:action.meta.exactFinalSelectedType || action.type || null,
          selectedLabel:action.meta.exactFinalSelectedLabel || action.type || null,
          selectedClueClass:action.meta.exactFinalSelectedClueClass || action.clueClass || null,
          selectedTargetIndex:selectedTarget,
          selectedDistance:Number(action.meta.exactFinalSelectedDistance || action.meta.playDistance || 0),

          projectedScore:Number(action.meta.exactFinalProjectedScore || 0),
          projectedStranded:Number(action.meta.exactFinalProjectedStranded || 0),
          projectedRawLoss:Number(action.meta.exactFinalProjectedRawLoss || 0),
          searchNodes:Number(action.meta.exactFinalNodes || 0),
          rawClue:Boolean(action.meta.exactFinalRawClue),
          preemptedPlay:Boolean(action.meta.exactFinalPreemptedPlay)
        });
      }
    }

    const phase =
      this.finalTurnsRemaining !== null
        ? "Final"
        : this.deck.length <= 5
          ? "NearEnd"
          : "Normal";

    const suffix =
      action.type === "PLAY"
        ? "Play"
        : action.type === "HINT"
          ? "Hint"
          : "Discard";

    const phaseStat = `phase${phase}${suffix}`;
    if (phaseStat in this.stats) this.stats[phaseStat]++;

    if (action.type === "PLAY") {
      this.play(player, action.cardIndex, action.meta || {});
    } else if (action.type === "DISCARD") {
      this.discard(player, action.cardIndex, action.meta || {});
    } else if (action.type === "HINT") {
      this.hint(
        player,
        action.targetIndex,
        action.hintType,
        action.value,
        action.convention || null
      );

      if (action.clueClass === "PLAY") {
        this.stats.playClues++;
        const distance = Number(action.meta?.playDistance || 0);
        const key = `playCluesDistance${distance}`;
        if (distance >= 1 && distance <= 4 && key in this.stats) {
          this.stats[key]++;
        }
      } else if (action.clueClass === "SAVE") {
        this.stats.saveClues++;
        if(action.meta?.criticalSave) {
          this.stats.criticalSaveClues++;
          if(action.meta?.criticalSaveFive) this.stats.criticalSave5Clues++;
          this.stats.criticalSaveRawValueSum += Number(action.meta?.criticalSaveRawValue || 0);
          this.stats.criticalSavePrioritySum += Number(action.meta?.criticalSavePriority || 0);
          if(action.meta?.criticalSaveWouldDiscardNow) this.stats.criticalSaveWouldDiscardNow++;
          // hint() has already consumed one clue, so reconstruct the pre-hint clue count.
          const preHintClues=this.clues+1;
          if(preHintClues<=1) this.stats.criticalSaveAtClue1++;
          else if(preHintClues===2) this.stats.criticalSaveAtClue2++;
          else this.stats.criticalSaveAtClue3Plus++;
        }
      } else if (action.clueClass === "INFO") this.stats.infoClues++;

      if (action.meta) {
        this.stats.hintActionsCreated += Number(action.meta.actionsCreated || 0);
        this.stats.hintCertainPlaysCreated += Number(action.meta.certainPlaysCreated || 0);
        this.stats.hintSafeDiscardsCreated += Number(action.meta.safeDiscardsCreated || 0);
        this.stats.hintCriticalCreated += Number(action.meta.criticalCreated || 0);
        this.stats.hintInformationGain += Number(action.meta.infoGain || 0);
        this.stats.hintTouchedCards += Number(action.meta.touchedCount || 0);
        if (action.meta.tempo) this.stats.tempoPlayClues++;
        if (action.meta.deferred) this.stats.deferredPlayClues++;
        if (Number(action.meta.roundPlannerProjectedPlays || 0) > 0 || Number(action.meta.roundPlannerGain || 0) !== 0 || action.meta.roundPlannerBlocked) {
          this.stats.roundPlannerClues++;
          this.stats.roundPlannerGain += Number(action.meta.roundPlannerGain || 0);
          this.stats.roundPlannerChainGain += Number(action.meta.roundPlannerChainGain || 0);
          this.stats.roundPlannerProjectedPlays += Number(action.meta.roundPlannerProjectedPlays || 0);
          if (action.meta.roundPlannerBlocked) this.stats.roundPlannerBlockedClues++;
        }
        if (action.meta.criticalCollateral) {
          this.stats.criticalCollateralClues++;
          this.stats.criticalCollateralSavedCards += Number(action.meta.criticalCollateralSavedCount || 0);
          this.stats.criticalCollateralValueSum += Number(action.meta.criticalCollateralValue || 0);
          this.stats.criticalCollateralFiveCount += Number(action.meta.criticalCollateralFiveCount || 0);
        }
        if (action.meta.reservation) this.stats.reservationClues++;
        if (action.meta.coverage) this.stats.coverageClues++;
        if (action.meta.queueCoverage) this.stats.queueCoverageClues++;
        this.stats.deadlineUnlocks += Number(action.meta.deadlineUnlocks || 0);
        this.stats.deadlineLateUnlocks += Number(action.meta.deadlineLateUnlocks || 0);
        this.stats.futureOpportunityScore += Number(action.meta.futureOpportunityScore || 0);
        this.stats.twoRoundGain += Number(action.meta.twoRoundGain || 0);
        this.stats.twoRoundFirstGain += Number(action.meta.twoRoundFirstGain || 0);
        this.stats.twoRoundSecondGain += Number(action.meta.twoRoundSecondGain || 0);
        this.stats.twoRoundChainGain += Number(action.meta.twoRoundChainGain || 0);
        this.stats.twoRoundStrandedReduction += Number(action.meta.twoRoundStrandedReduction || 0);
        this.stats.twoRoundScaleBonus += Number(action.meta.twoRoundScaleBonus || 0);
        this.stats.twoRoundScore += Number(action.meta.twoRoundScore || 0);
        if (Number(action.meta.multiPlayCount || 0) >= 2) {
          this.stats.multiPlayClues++;
          this.stats.multiPlaySignalsCreated += Number(action.meta.multiPlayCount || 0);
        }
      }
    } else {
      throw new Error(`Tipo azione sconosciuto: ${action.type}`);
    }

    this.updateProfilerCardStates();
    this.updateDeadState();

    const theoreticalMaxNow = this.maxAchievableScoreByCardAvailability();
    this.stats.theoreticalMaxSum += theoreticalMaxNow;
    this.stats.theoreticalMaxSamples++;
    this.stats.minTheoreticalMax = Math.min(
      this.stats.minTheoreticalMax,
      theoreticalMaxNow
    );

    this.advanceTurn();
    this.updateDeadState();
  }


  finalColorProfile() {
    const profile = {};

    for (const color of COLORS) {
      const reached = this.fireworks[color] || 0;
      let maxTheoretical = reached;

      for (let number = reached + 1; number <= 5; number++) {
        const totalCopies = COPIES[number];
        const lostCopies = this.discarded.filter(
          card => card.color === color && card.number === number
        ).length;

        if (totalCopies - lostCopies <= 0) break;
        maxTheoretical = number;
      }

      profile[color] = {
        reached,
        maxTheoretical,
        impossiblePoints: 5 - maxTheoretical,
        unrealizedAvailablePoints: maxTheoretical - reached
      };
    }

    return profile;
  }

  finalPlayableReasonProfile() {
    const reasons = {
      queuedBehindAnotherPlayableSignal: 0,
      signaledNoOwnerTurn: 0,
      signaledNotConverted: 0,
      becamePlayableTooLate: 0,
      knownPlayableNoOwnerTurn: 0,
      knownPlayableNotPlayed: 0,
      signalLostOrInvalidated: 0,
      noCluesAvailable: 0,
      neverSignaledDespiteClueOpportunity: 0,
      other: 0
    };

    let totalPlayable = 0;
    let totalFutureNeeded = 0;
    let blockedByPrerequisite = 0;
    let activeSignalsOnPlayable = 0;

    for (let p = 0; p < this.players; p++) {
      const hand = this.hands[p];
      const knowledge = this.knowledge[p];
      const activePlayableSignalIndexes = hand
        .map((card, index) => ({ card, index, k: knowledge[index] }))
        .filter(x => x.k?.playSignal && this.isPlayable(x.card))
        .map(x => x.index);

      for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        const k = knowledge[i];
        const level = Number(this.fireworks[card.color] || 0);
        if (card.number > level) totalFutureNeeded++;
        if (card.number > level + 1) blockedByPrerequisite++;
        if (!this.isPlayable(card)) continue;

        totalPlayable++;
        const meta = this.ensureCardProfiler(card, p);
        const activeSignal = Boolean(k?.playSignal || k?.deferredPlaySignal);
        if (activeSignal) activeSignalsOnPlayable++;

        if (
          k?.playSignal &&
          activePlayableSignalIndexes.some(other => other !== i)
        ) {
          reasons.queuedBehindAnotherPlayableSignal++;
        } else if (activeSignal && meta.ownerTurnsSinceLastSignal === 0) {
          reasons.signaledNoOwnerTurn++;
        } else if (activeSignal && meta.ownerTurnsSinceLastSignal > 0) {
          reasons.signaledNotConverted++;
        } else if (meta.ownerTurnsWhilePlayable === 0) {
          reasons.becamePlayableTooLate++;
        } else if (this.knowledgeGuaranteesPlayable(k)) {
          if (meta.ownerTurnsWhileGuaranteed === 0) reasons.knownPlayableNoOwnerTurn++;
          else reasons.knownPlayableNotPlayed++;
        } else if (meta.everPlaySignaled) {
          reasons.signalLostOrInvalidated++;
        } else if (
          meta.clueOpportunitiesWhilePlayable === 0 &&
          meta.zeroClueOpportunitiesWhilePlayable > 0
        ) {
          reasons.noCluesAvailable++;
        } else if (meta.clueOpportunitiesWhilePlayable > 0) {
          reasons.neverSignaledDespiteClueOpportunity++;
        } else {
          reasons.other++;
        }
      }
    }

    return {
      totalPlayable,
      totalFutureNeeded,
      blockedByPrerequisite,
      activeSignalsOnPlayable,
      reasons
    };
  }

  finalCardLocationProfile() {
    const playableNow = card =>
      card.number === (this.fireworks[card.color] || 0) + 1;

    let playableInHands = 0;
    let futureNeededInHands = 0;

    for (const hand of this.hands) {
      for (const card of hand) {
        if (playableNow(card)) playableInHands++;
        if (card.number > (this.fireworks[card.color] || 0)) {
          futureNeededInHands++;
        }
      }
    }

    let playableInDeck = 0;
    let futureNeededInDeck = 0;

    for (const card of this.deck) {
      if (playableNow(card)) playableInDeck++;
      if (card.number > (this.fireworks[card.color] || 0)) {
        futureNeededInDeck++;
      }
    }

    return {
      playableInHands,
      futureNeededInHands,
      playableInDeck,
      futureNeededInDeck
    };
  }

  run(strategy, maxTurns = 1000) {
    while (!this.finished && this.turns < maxTurns) {
      this.step(strategy);
    }

    if (this.turns >= maxTurns) {
      throw new Error("Partita oltre il limite massimo di turni");
    }

    const finalRawLostIdentities = new Set();
    for (const color of COLORS) {
      const level = Number(this.fireworks[color] || 0);
      for (let number = level + 1; number <= 5; number++) {
        if (this.remainingUnlostCopies(color, number) <= 0) {
          finalRawLostIdentities.add(`${color}|${number}`);
        }
      }
    }
    const penultimateCopyEvents = this.penultimateCopyEvents.map(e => ({
      ...e,
      eventuallyFatal: finalRawLostIdentities.has(`${e.color}|${e.number}`)
    }));

    return {
      score: this.score(),
      strikes: this.strikes,
      turns: this.turns,
      clues: this.clues,
      deckRemaining: this.deck.length,
      bonusMode: this.bonusMode,
      variant: this.variant,
      variantConfig: getVariantConfig(),
      targetScore: targetScore(),
      bonusRemaining: [...this.bonusDeck],
      bonusHistory: [...this.bonusHistory],
      maxAchievableScore: this.maxAchievableScoreByCardAvailability(),
      maxAchievableScoreRecoveryAware: this.maxAchievableScoreWithRecoveryPotential(),
      colorProfile: this.finalColorProfile(),
      cardLocationProfile: this.finalCardLocationProfile(),
      finalPlayableReasonProfile: this.finalPlayableReasonProfile(),
      endgameConversionProfile: this.finalEndgameConversionProfile(),
      lostCardEvents: this.lostCardEvents.map(e => ({ ...e })),
      penultimateCopyEvents,
      rawRecoveryEvents: this.rawRecoveryEvents.map(e => ({ ...e })),
      exactFinalOverrideEvents: this.exactFinalOverrideEvents.map(e => ({ ...e })),
      meanTheoreticalMax:
        this.stats.theoreticalMaxSamples > 0
          ? this.stats.theoreticalMaxSum / this.stats.theoreticalMaxSamples
          : targetScore(),
      theoreticalGap:
        this.maxAchievableScoreByCardAvailability() - this.score(),
      mathematicallyDead: Boolean(this.stats.becameDeadByLostCard),
      finalWindowInsufficient: Boolean(this.stats.becameDeadByFinalTurns),
      ...this.stats
    };
  }
}
