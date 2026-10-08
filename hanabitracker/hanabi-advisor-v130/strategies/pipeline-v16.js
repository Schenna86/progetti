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
  return !isUseless(view, card) && copiesNotDiscarded(view, card.color, card.number) <= 1;
}
function simulateHint(opponent, hintType, value) {
  const knowledge = opponent.knowledge.map(cloneKnowledge);
  if (hintType === "color") applyColorHint(opponent.hand, knowledge, value);
  else applyNumberHint(opponent.hand, knowledge, Number(value));
  return knowledge;
}
function touchedIndexes(opponent, hintType, value) {
  return opponent.hand.map((card,index)=>({card,index})).filter(x =>
    hintType === "color" ? x.card.color === value : x.card.number === Number(value)
  ).map(x=>x.index);
}
function focusIndexForHint(opponent, before, after, hintType, value) {
  const touched=touchedIndexes(opponent,hintType,value);
  const changed=touched.filter(index => {
    const b=before[index], a=after[index];
    return b.possibleColors.size!==a.possibleColors.size || b.possibleNumbers.size!==a.possibleNumbers.size;
  });
  const source=changed.length?changed:touched;
  return source.length?source[source.length-1]:null;
}
function makeTargetView(view, opponent, knowledge, fireworksOverride=null) {
  return {
    playerIndex: opponent.playerIndex,
    playerCount: view.playerCount,
    clues: view.clues,
    strikes: view.strikes,
    fireworks: fireworksOverride || view.fireworks,
    discarded: view.discarded,
    deckRemaining: view.deckRemaining,
    ownHandSize: opponent.hand.length,
    knowledge,
    otherHands: opponent.visibleOtherHands
  };
}
function actionCounts(evalList) {
  let certainPlay=0, safeDiscard=0, criticalKnown=0;
  for (const e of evalList) {
    if (e.playableProbability>=0.999999) certainPlay++;
    if (e.safeDiscardProbability>=0.999999) safeDiscard++;
    if (e.criticalProbability>=0.999999) criticalKnown++;
  }
  return {certainPlay,safeDiscard,criticalKnown};
}

function fireworksKey(fireworks) {
  return COLORS.map(c=>`${c}:${fireworks[c]||0}`).join("|");
}

// Conservative TEMPO projection.
// We only project an intervening play when exactly one PLAY signal is already
// public in that player's hand. No hidden deck information is used.
function knowledgeGuaranteedPlayable(k,fireworks) {
  let any=false;
  for(const color of k.possibleColors) {
    for(const number of k.possibleNumbers) {
      any=true;
      if(number!==(fireworks[color]||0)+1) return false;
    }
  }
  return any;
}

function projectFireworksToTarget(view,targetIndex,turnCache) {
  const cacheKey=`${view.playerIndex}->${targetIndex}`;
  const cached=turnCache.projectedFireworksByTarget.get(cacheKey);
  if (cached) return cached;

  const projected={...view.fireworks};
  const distance=turnDistance(view.playerIndex,targetIndex,view.playerCount);

  for(let step=1; step<distance; step++) {
    const playerIndex=(view.playerIndex+step)%view.playerCount;
    const opponent=view.otherHands.find(x=>x.playerIndex===playerIndex);
    if(!opponent) continue;

    const signaled=opponent.knowledge
      .map((k,index)=>({k,index}))
      .filter(x=>x.k.playSignal && !x.k.multiPlaySignal);

    let chosenIndex=null;
    if(signaled.length===1 && view.strikes<2) {
      chosenIndex=signaled[0].index;
    } else if(signaled.length===0) {
      // Also project a play that is guaranteed from public knowledge alone.
      // This remains guaranteed even if another player draws before this turn.
      const guaranteed=opponent.knowledge
        .map((k,index)=>({k,index}))
        .filter(x=>knowledgeGuaranteedPlayable(x.k,projected));
      if(guaranteed.length===1) chosenIndex=guaranteed[0].index;
    }

    if(chosenIndex===null) continue;
    const card=opponent.hand[chosenIndex];
    if(!card) continue;
    if(card.number===(projected[card.color]||0)+1) {
      projected[card.color]=card.number;
    }
  }

  turnCache.projectedFireworksByTarget.set(cacheKey,projected);
  return projected;
}

function isPlayableWithFireworks(fireworks,card) {
  return card.number===(fireworks[card.color]||0)+1;
}

function recipientUtility(view,candidate,probabilityMode,turnCache) {
  const opponent=candidate.opponent;
  const evaluationFireworks=candidate.evaluationFireworks || view.fireworks;
  const fwKey=fireworksKey(evaluationFireworks);
  const beforeKey=`${opponent.playerIndex}|${fwKey}`;

  let beforeEval=turnCache.beforeByPlayer.get(beforeKey);
  if (!beforeEval) {
    beforeEval=analyzeOwnHand(
      makeTargetView(view,opponent,opponent.knowledge,evaluationFireworks),
      {mode:candidate.forceFastUtility?"fast":probabilityMode}
    );
    turnCache.beforeByPlayer.set(beforeKey,beforeEval);
  }

  const afterKey=`${opponent.playerIndex}|${candidate.hintType}|${candidate.value}|${fwKey}`;
  let afterEval=turnCache.afterByHint.get(afterKey);
  if (!afterEval) {
    afterEval=analyzeOwnHand(
      makeTargetView(view,opponent,candidate.afterKnowledge,evaluationFireworks),
      {mode:candidate.forceFastUtility?"fast":probabilityMode}
    );
    turnCache.afterByHint.set(afterKey,afterEval);
  }

  const before=actionCounts(beforeEval), after=actionCounts(afterEval);
  const newCertainPlays=Math.max(0,after.certainPlay-before.certainPlay);
  const newSafeDiscards=Math.max(0,after.safeDiscard-before.safeDiscard);
  const newCritical=Math.max(0,after.criticalKnown-before.criticalKnown);
  const actionsCreated=newCertainPlays+newSafeDiscards+newCritical;
  const newCertainPlayIndexes=[];
  for(let i=0;i<afterEval.length;i++) {
    if(afterEval[i].playableProbability>=0.999999 && beforeEval[i].playableProbability<0.999999) {
      newCertainPlayIndexes.push(i);
    }
  }

  return {
    score:newCertainPlays*120+newSafeDiscards*70+newCritical*60+candidate.infoGain*8+(actionsCreated>=2?(actionsCreated-1)*40:0),
    actionsCreated,newCertainPlays,newSafeDiscards,newCritical,newCertainPlayIndexes
  };
}
function prerequisitePubliclyProgrammed(view,targetPlayerIndex,color,number) {
  for(const opponent of view.otherHands) {
    if(opponent.playerIndex===targetPlayerIndex) continue;
    for(let i=0;i<opponent.hand.length;i++) {
      const card=opponent.hand[i];
      if(card.color!==color || card.number!==number) continue;
      const k=opponent.knowledge[i];
      if(k?.playSignal || knowledgeGuaranteedPlayable(k,view.fireworks)) return true;
    }
  }
  return false;
}

function buildCandidates(view,turnCache,{enableTempo=false,enableMultiPlay=false,enableDeferred=false,multiVisibleBonus=45,deferredBaseScore=100}={}) {
  const out=[];
  for (const opponent of view.otherHands) {
    const raw=[];
    for (const color of COLORS) if (opponent.hand.some(c=>c.color===color)) raw.push({hintType:"color",value:color});
    for (const number of NUMBERS) if (opponent.hand.some(c=>c.number===number)) raw.push({hintType:"number",value:number});
    const beforeInfo=totalKnowledgeInformation(opponent.knowledge);
    const projectedFireworks=enableTempo
      ? projectFireworksToTarget(view,opponent.playerIndex,turnCache)
      : view.fireworks;

    for (const hint of raw) {
      const after=simulateHint(opponent,hint.hintType,hint.value);
      const infoGain=Math.max(0,totalKnowledgeInformation(after)-beforeInfo);
      const focusIndex=focusIndexForHint(opponent,opponent.knowledge,after,hint.hintType,hint.value);
      if (focusIndex===null) continue;
      const touched=touchedIndexes(opponent,hint.hintType,hint.value);
      const focusCard=opponent.hand[focusIndex];
      const focusPlayable=isPlayable(view,focusCard);
      const focusTempoPlayable=enableTempo && !focusPlayable && isPlayableWithFireworks(projectedFireworks,focusCard);
      const level=view.fireworks[focusCard.color]||0;
      const focusDeferredPlayable=
        enableDeferred && !focusPlayable && !focusTempoPlayable &&
        focusCard.number===level+2 &&
        prerequisitePubliclyProgrammed(view,opponent.playerIndex,focusCard.color,level+1);
      const deferredFireworks=focusDeferredPlayable
        ? {...view.fireworks,[focusCard.color]:level+1}
        : null;
      const focusCritical=isCritical(view,focusCard);
      const focusUseless=isUseless(view,focusCard);

      const projectedPlayableTouched=touched.filter(i=>
        isPlayableWithFireworks(projectedFireworks,opponent.hand[i])
      ).length;
      const otherPlayable=touched.filter(i=>i!==focusIndex && isPlayable(view,opponent.hand[i])).length;
      const otherNonPlayable=touched.filter(i=>i!==focusIndex && !isPlayableWithFireworks(projectedFireworks,opponent.hand[i])).length;

      let intent="INFO", conventionalScore=infoGain*12;
      let tempo=false, deferred=false;
      if (focusPlayable || focusTempoPlayable || focusDeferredPlayable) {
        intent="PLAY";
        tempo=Boolean(focusTempoPlayable);
        deferred=Boolean(focusDeferredPlayable);
        conventionalScore+=(deferred?deferredBaseScore:(tempo?118:125))+otherPlayable*20-otherNonPlayable*18;
        if(enableMultiPlay && projectedPlayableTouched>=2) {
          conventionalScore+=(projectedPlayableTouched-1)*multiVisibleBonus;
        }
      } else if (focusCritical) {
        intent="SAVE"; conventionalScore+=(focusCard.number===5?115:90)-otherNonPlayable*5;
      } else {
        conventionalScore+=touched.length*3;
        if (focusUseless) conventionalScore-=15;
      }
      if (infoGain<=1e-9 && intent==="INFO") continue;
      out.push({
        intent,conventionalScore,infoGain,targetIndex:opponent.playerIndex,opponent,
        hintType:hint.hintType,value:hint.value,focusIndex,afterKnowledge:after,
        touchedCount:touched.length,projectedPlayableTouched,tempo,deferred,
        evaluationFireworks:deferred?deferredFireworks:(enableMultiPlay?projectedFireworks:view.fireworks),
        forceFastUtility:Boolean(deferred)
      });
    }
  }
  return out;
}
function distanceBonus(view,candidate,distanceWeight5p,distanceProfile5p) {
  if (candidate.intent!=="PLAY" || view.playerCount!==5 || distanceWeight5p<=0) return 0;
  const distance=turnDistance(view.playerIndex,candidate.targetIndex,view.playerCount);
  if (distance<=0) return 0;
  const coefficient=Number(distanceProfile5p?.[distance] ?? 0);
  return coefficient*distanceWeight5p*(candidate.deferred?0.25:1);
}

function bestWithinClass(
  view,candidates,intent,probabilityMode,topK,recipientWeight,turnCache,
  distanceWeight5p=0,distanceProfile5p={1:4,2:3,3:2,4:1},
  {enableMultiPlay=false,multiUtilityBonus=70}={}
) {
  const cls=candidates
    .filter(c=>c.intent===intent)
    .map(c=>({
      c,
      preliminary:c.conventionalScore+distanceBonus(view,c,distanceWeight5p,distanceProfile5p)
    }))
    .sort((a,b)=>b.preliminary-a.preliminary || b.c.infoGain-a.c.infoGain);
  if (!cls.length) return null;
  const effectiveTopK=enableMultiPlay?Math.max(topK,3):Math.max(1,topK);
  const top=cls.slice(0,effectiveTopK).map(x=>x.c);
  for (const c of top) {
    const u=recipientUtility(view,c,probabilityMode,turnCache); c.utility=u;
    const multiBonus=enableMultiPlay?Math.max(0,u.newCertainPlays-1)*multiUtilityBonus:0;
    c.multiPlayCount=enableMultiPlay?u.newCertainPlayIndexes.length:0;
    c.hybridScore=c.conventionalScore+u.score*recipientWeight+
      distanceBonus(view,c,distanceWeight5p,distanceProfile5p)+multiBonus;
  }
  top.sort((a,b)=>b.hybridScore-a.hybridScore || b.conventionalScore-a.conventionalScore);
  return top[0];
}
function selectSafeDiscard(
  own,
  knowledge,
  onlyCertain=false,
  criticalDiscardPenalty=150
) {
  const ranked=own
    .map((x,index)=>({index,...x,k:knowledge[index]}))
    .filter(x=>!onlyCertain || x.safeDiscardProbability>=0.999999)
    .map(x=>{
      let protection=0;
      if(x.k?.saveSignal) protection+=1000;
      if(x.k?.playSignal && !x.k?.multiPlaySignal) protection+=700;
      if(x.k?.multiPlaySignal && x.playableProbability>=0.999999) protection+=700;
      if(x.k?.deferredPlaySignal && x.uselessProbability<0.999999) protection+=550;
      return {
        ...x,
        rank:
          x.safeDiscardProbability*100 +
          x.uselessProbability*40 -
          x.criticalProbability*criticalDiscardPenalty -
          protection
      };
    })
    .sort((a,b)=>b.rank-a.rank);
  return ranked[0]?.index ?? null;
}
function actionFromHint(best, clueClass, view=null, {enableMultiPlay=false}={}) {
  const playDistance =
    clueClass==="PLAY" && view
      ? turnDistance(view.playerIndex,best.targetIndex,view.playerCount)
      : 0;

  const multiPlayCount =
    enableMultiPlay && clueClass==="PLAY"
      ? Number(best.utility?.newCertainPlays || 0)
      : 0;

  return {
    type:"HINT",
    targetIndex:best.targetIndex,
    hintType:best.hintType,
    value:best.value,
    convention:best.intent==="INFO"
      ? null
      : {
          intent:best.intent,
          focusIndex:best.focusIndex,
          playSignalDistance:playDistance,
          multiPlayIndexes:null,
          deferred:Boolean(best.deferred)
        },
    clueClass,
    meta:{
      actionsCreated:best.utility?.actionsCreated||0,
      certainPlaysCreated:best.utility?.newCertainPlays||0,
      safeDiscardsCreated:best.utility?.newSafeDiscards||0,
      criticalCreated:best.utility?.newCritical||0,
      infoGain:best.infoGain||0,
      touchedCount:best.touchedCount||0,
      playDistance,
      tempo:Boolean(best.tempo),
      deferred:Boolean(best.deferred),
      multiPlayCount
    }
  };
}
function turnDistance(currentPlayer, targetPlayer, playerCount) {
  return (targetPlayer - currentPlayer + playerCount) % playerCount;
}

function playClueCanConvertInTime(view, candidate, lookaheadTurns) {
  if (view.finalTurnsRemaining === null || view.finalTurnsRemaining === undefined) {
    return true;
  }

  const distance = turnDistance(
    view.playerIndex,
    candidate.targetIndex,
    view.playerCount
  );

  if (distance <= 0) return false;

  // Il turno corrente consuma uno dei turni finali.
  // Il destinatario deve quindi arrivare PRIMA dell'esaurimento del countdown.
  const reachableBeforeEnd = distance < view.finalTurnsRemaining;

  // Look-ahead corto: in finale accettiamo clue soltanto se il destinatario
  // agirà entro N turni dal clue.
  const withinLookahead = distance <= lookaheadTurns;

  return reachableBeforeEnd && withinLookahead;
}

function bestFinalPlayClue(
  view,
  candidates,
  probabilityMode,
  topK,
  recipientWeight,
  lookaheadTurns,
  turnCache,
  distanceWeight5p,
  distanceProfile5p,
  multiOptions={}
) {
  const eligible = candidates.filter(
    c =>
      c.intent === "PLAY" &&
      !c.deferred &&
      playClueCanConvertInTime(view, c, lookaheadTurns)
  );

  if (!eligible.length) return null;

  return bestWithinClass(
    view,
    eligible,
    "PLAY",
    probabilityMode,
    topK,
    recipientWeight,
    turnCache,
    distanceWeight5p,
    distanceProfile5p,
    multiOptions
  );
}

export function createPipelineV16Strategy({probabilityMode="hybrid",playThreshold=1,riskPlay=false,topK=2,recipientWeight=0.12,criticalDiscardPenalty=0,finalLookaheadTurns=3,twoPlayerPreEndTrigger=8,distanceWeight5p=25,distanceProfile5p={1:4,2:3.3,3:0.8,4:0.8},enableTempo=false,enableMultiPlay=false,multiVisibleBonus=45,multiUtilityBonus=70,signalPlayMinProbability=0,enableDeferred=false,deferredBaseScore=100}={}) {
  return {
    name:`pipeline-v1.6-${enableTempo?"tempo":"plain"}-${enableMultiPlay?"multi":"single"}`,
    chooseAction(view) {
      const turnCache={
        beforeByPlayer:new Map(),
        afterByHint:new Map(),
        projectedFireworksByTarget:new Map()
      };
      const own=analyzeOwnHand(view,{mode:probabilityMode});
      const twoPlayerPreEnd=
        view.playerCount===2 &&
        view.finalTurnsRemaining===null &&
        view.deckRemaining<=twoPlayerPreEndTrigger;
      const signaled=view.knowledge.map((k,index)=>({k,index,p:own[index]?.playableProbability||0})).filter(x=>x.k.playSignal && x.p>=signalPlayMinProbability && (!x.k.multiPlaySignal || x.p>=0.999999)).sort((a,b)=>b.p-a.p || (a.k.signalAge||0)-(b.k.signalAge||0))[0];
      if(signaled && view.strikes<2) return {type:"PLAY",cardIndex:signaled.index,playWasSignaled:true};
      const deferredReady=view.knowledge
        .map((k,index)=>({k,index,p:own[index]?.playableProbability||0}))
        .filter(x=>x.k.deferredPlaySignal && x.p>=0.999999)
        .sort((a,b)=>(a.k.signalAge||0)-(b.k.signalAge||0))[0];
      if(deferredReady) return {type:"PLAY",cardIndex:deferredReady.index,deferredPlay:true};
      const certain=own.map((x,index)=>({index,...x})).filter(x=>x.playableProbability>=0.999999).sort((a,b)=>b.criticalProbability-a.criticalProbability)[0];
      if(certain) return {type:"PLAY",cardIndex:certain.index};
      if(riskPlay && view.strikes<2) {
        const risky=own.map((x,index)=>({index,p:x.playableProbability})).filter(x=>x.p>=playThreshold).sort((a,b)=>b.p-a.p)[0];
        if(risky) return {type:"PLAY",cardIndex:risky.index};
      }
      const candidates=view.clues>0
        ? buildCandidates(view,turnCache,{enableTempo,enableMultiPlay,enableDeferred,multiVisibleBonus,deferredBaseScore})
        : [];
      // Gerarchia rigida: PLAY > SAVE > SAFE DISCARD > INFO
      if(view.clues>0) {
        const inFinalRound =
          view.finalTurnsRemaining !== null &&
          view.finalTurnsRemaining !== undefined;

        const play = inFinalRound
          ? bestFinalPlayClue(
              view,
              candidates,
              probabilityMode,
              topK,
              recipientWeight,
              finalLookaheadTurns,
              turnCache,
              distanceWeight5p,
              distanceProfile5p,
              {enableMultiPlay,multiUtilityBonus}
            )
          : bestWithinClass(
              view,
              candidates,
              "PLAY",
              probabilityMode,
              topK,
              recipientWeight,
              turnCache,
              distanceWeight5p,
              distanceProfile5p,
              {enableMultiPlay,multiUtilityBonus}
            );

        if(play) return actionFromHint(play,"PLAY",view,{enableMultiPlay});

        // Nel giro finale niente SAVE clue: se non possiamo generare
        // una PLAY a breve, usiamo il turno per una mossa immediata.
        if (!inFinalRound && !twoPlayerPreEnd) {
          const save=bestWithinClass(
            view,
            candidates,
            "SAVE",
            probabilityMode,
            topK,
            recipientWeight,
            turnCache,
            0
          );
          if(save) return actionFromHint(save,"SAVE");
        }
      }
      const safeDiscard=selectSafeDiscard(own,view.knowledge,true,criticalDiscardPenalty);
      if(safeDiscard!==null) return {type:"DISCARD",cardIndex:safeDiscard};
      if(
        view.clues>0 &&
        (view.finalTurnsRemaining === null || view.finalTurnsRemaining === undefined) &&
        !twoPlayerPreEnd
      ) {
        const info=bestWithinClass(
          view,
          candidates,
          "INFO",
          probabilityMode,
          topK,
          recipientWeight,
          turnCache,
          0
        );
        if(info && info.conventionalScore>=16) return actionFromHint(info,"INFO");
      }
      return {type:"DISCARD",cardIndex:selectSafeDiscard(own,view.knowledge,false,criticalDiscardPenalty)??0};
    }
  };
}
