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
function makeTargetView(view, opponent, knowledge) {
  return {
    playerIndex: opponent.playerIndex,
    playerCount: view.playerCount,
    clues: view.clues,
    strikes: view.strikes,
    fireworks: {...view.fireworks},
    discarded: view.discarded.map(c=>({...c})),
    deckRemaining: view.deckRemaining,
    ownHandSize: opponent.hand.length,
    knowledge,
    otherHands: opponent.visibleOtherHands.map(x=>({playerIndex:x.playerIndex,hand:x.hand.map(c=>({...c}))}))
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
function recipientUtility(view,candidate,probabilityMode) {
  const opponent=candidate.opponent;
  const beforeEval=analyzeOwnHand(makeTargetView(view,opponent,opponent.knowledge.map(cloneKnowledge)),{mode:probabilityMode});
  const afterEval=analyzeOwnHand(makeTargetView(view,opponent,candidate.afterKnowledge),{mode:probabilityMode});
  const before=actionCounts(beforeEval), after=actionCounts(afterEval);
  const newCertainPlays=Math.max(0,after.certainPlay-before.certainPlay);
  const newSafeDiscards=Math.max(0,after.safeDiscard-before.safeDiscard);
  const newCritical=Math.max(0,after.criticalKnown-before.criticalKnown);
  const actionsCreated=newCertainPlays+newSafeDiscards+newCritical;
  return {
    score:newCertainPlays*120+newSafeDiscards*70+newCritical*60+candidate.infoGain*8+(actionsCreated>=2?(actionsCreated-1)*40:0),
    actionsCreated,newCertainPlays,newSafeDiscards,newCritical
  };
}
function buildCandidates(view) {
  const out=[];
  for (const opponent of view.otherHands) {
    const raw=[];
    for (const color of COLORS) if (opponent.hand.some(c=>c.color===color)) raw.push({hintType:"color",value:color});
    for (const number of NUMBERS) if (opponent.hand.some(c=>c.number===number)) raw.push({hintType:"number",value:number});
    const beforeInfo=totalKnowledgeInformation(opponent.knowledge);
    for (const hint of raw) {
      const after=simulateHint(opponent,hint.hintType,hint.value);
      const infoGain=Math.max(0,totalKnowledgeInformation(after)-beforeInfo);
      const focusIndex=focusIndexForHint(opponent,opponent.knowledge,after,hint.hintType,hint.value);
      if (focusIndex===null) continue;
      const touched=touchedIndexes(opponent,hint.hintType,hint.value);
      const focusCard=opponent.hand[focusIndex];
      const focusPlayable=isPlayable(view,focusCard);
      const focusCritical=isCritical(view,focusCard);
      const focusUseless=isUseless(view,focusCard);
      const otherPlayable=touched.filter(i=>i!==focusIndex && isPlayable(view,opponent.hand[i])).length;
      const otherNonPlayable=touched.filter(i=>i!==focusIndex && !isPlayable(view,opponent.hand[i])).length;
      let intent="INFO", conventionalScore=infoGain*12;
      if (focusPlayable) {
        intent="PLAY"; conventionalScore+=125+otherPlayable*20-otherNonPlayable*18;
      } else if (focusCritical) {
        intent="SAVE"; conventionalScore+=(focusCard.number===5?115:90)-otherNonPlayable*5;
      } else {
        conventionalScore+=touched.length*3;
        if (focusUseless) conventionalScore-=15;
      }
      if (infoGain<=1e-9 && intent==="INFO") continue;
      out.push({intent,conventionalScore,infoGain,targetIndex:opponent.playerIndex,opponent,hintType:hint.hintType,value:hint.value,focusIndex,afterKnowledge:after,touchedCount:touched.length});
    }
  }
  return out;
}
function bestWithinClass(view,candidates,intent,probabilityMode,topK,recipientWeight) {
  const cls=candidates.filter(c=>c.intent===intent).sort((a,b)=>b.conventionalScore-a.conventionalScore || b.infoGain-a.infoGain);
  if (!cls.length) return null;
  const top=cls.slice(0,Math.max(1,topK));
  for (const c of top) {
    const u=recipientUtility(view,c,probabilityMode); c.utility=u;
    c.hybridScore=c.conventionalScore+u.score*recipientWeight;
  }
  top.sort((a,b)=>b.hybridScore-a.hybridScore || b.conventionalScore-a.conventionalScore);
  return top[0];
}
function selectSafeDiscard(own,knowledge,onlyCertain=false) {
  const ranked=own.map((x,index)=>({index,...x,k:knowledge[index]})).filter(x=>!onlyCertain || x.safeDiscardProbability>=0.999999).map(x=>{
    let protection=0; if(x.k?.saveSignal) protection+=1000; if(x.k?.playSignal) protection+=700;
    return {...x,rank:x.safeDiscardProbability*100+x.uselessProbability*40-x.criticalProbability*150-protection};
  }).sort((a,b)=>b.rank-a.rank);
  return ranked[0]?.index ?? null;
}
function actionFromHint(best, clueClass) {
  return {
    type:"HINT", targetIndex:best.targetIndex, hintType:best.hintType, value:best.value,
    convention:best.intent==="INFO"?null:{intent:best.intent,focusIndex:best.focusIndex},
    clueClass,
    meta:{
      actionsCreated:best.utility?.actionsCreated||0,
      certainPlaysCreated:best.utility?.newCertainPlays||0,
      safeDiscardsCreated:best.utility?.newSafeDiscards||0,
      criticalCreated:best.utility?.newCritical||0,
      infoGain:best.infoGain||0,
      touchedCount:best.touchedCount||0
    }
  };
}
export function createPriorityV08Strategy({probabilityMode="hybrid",playThreshold=1,riskPlay=false,topK=3,recipientWeight=0.10}={}) {
  return {
    name:"priority-v0.8",
    chooseAction(view) {
      const own=analyzeOwnHand(view,{mode:probabilityMode});
      const signaled=view.knowledge.map((k,index)=>({k,index,p:own[index]?.playableProbability||0})).filter(x=>x.k.playSignal).sort((a,b)=>b.p-a.p || (a.k.signalAge||0)-(b.k.signalAge||0))[0];
      if(signaled && view.strikes<2) return {type:"PLAY",cardIndex:signaled.index,playWasSignaled:true};
      const certain=own.map((x,index)=>({index,...x})).filter(x=>x.playableProbability>=0.999999).sort((a,b)=>b.criticalProbability-a.criticalProbability)[0];
      if(certain) return {type:"PLAY",cardIndex:certain.index};
      if(riskPlay && view.strikes<2) {
        const risky=own.map((x,index)=>({index,p:x.playableProbability})).filter(x=>x.p>=playThreshold).sort((a,b)=>b.p-a.p)[0];
        if(risky) return {type:"PLAY",cardIndex:risky.index};
      }
      const candidates=view.clues>0?buildCandidates(view):[];
      // Gerarchia rigida: PLAY > SAVE > SAFE DISCARD > INFO
      if(view.clues>0) {
        const play=bestWithinClass(view,candidates,"PLAY",probabilityMode,topK,recipientWeight);
        if(play) return actionFromHint(play,"PLAY");
        const save=bestWithinClass(view,candidates,"SAVE",probabilityMode,topK,recipientWeight);
        if(save) return actionFromHint(save,"SAVE");
      }
      const safeDiscard=selectSafeDiscard(own,view.knowledge,true);
      if(safeDiscard!==null) return {type:"DISCARD",cardIndex:safeDiscard};
      if(view.clues>0) {
        const info=bestWithinClass(view,candidates,"INFO",probabilityMode,topK,recipientWeight);
        if(info && info.conventionalScore>=16) return actionFromHint(info,"INFO");
      }
      return {type:"DISCARD",cardIndex:selectSafeDiscard(own,view.knowledge,false)??0};
    }
  };
}
