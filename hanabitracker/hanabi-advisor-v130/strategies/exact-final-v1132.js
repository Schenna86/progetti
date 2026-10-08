import { COLORS, COLOR_CLUES, NUMBERS, COPIES, colorHintTouches, targetScore } from "../constants.js";
import {
  analyzeOwnHand,
  cloneKnowledge,
  applyColorHint,
  applyNumberHint,
  totalKnowledgeInformation
} from "../knowledge.js";
import { createEndgameConversionV112Strategy } from "./endgame-conversion-v112.js";

function turnDistance(current,target,n){
  return (target-current+n)%n;
}
function scoreFireworks(fw){
  return Object.values(fw).reduce((a,b)=>a+Number(b||0),0);
}
function isPlayableCard(fw,card){
  return Boolean(card) && card.number===Number(fw[card.color]||0)+1;
}
function knowledgeGuaranteesPlayable(k,fw){
  if(!k) return false;
  let any=false;
  for(const color of k.possibleColors||[]){
    for(const number of k.possibleNumbers||[]){
      any=true;
      if(Number(number)!==Number(fw[color]||0)+1) return false;
    }
  }
  return any;
}
function knowledgeGuaranteesUseless(k,fw){
  if(!k) return false;
  let any=false;
  for(const color of k.possibleColors||[]){
    for(const number of k.possibleNumbers||[]){
      any=true;
      if(Number(number)>Number(fw[color]||0)) return false;
    }
  }
  return any;
}
function cloneKList(list){
  return (list||[]).map(cloneKnowledge);
}
function cloneState(st){
  return {
    ...st,
    fireworks:{...st.fireworks},
    discarded:(st.discarded||[]).map(c=>({...c})),
    hands:st.hands.map(h=>h ? h.map(c=>({...c})) : null),
    knowledge:st.knowledge.map(cloneKList)
  };
}
function stateFromView(view){
  const hands=Array(view.playerCount).fill(null);
  const knowledge=Array(view.playerCount).fill(null).map(()=>[]);
  knowledge[view.playerIndex]=cloneKList(view.knowledge);
  for(const op of view.otherHands){
    hands[op.playerIndex]=(op.hand||[]).map(c=>({...c}));
    knowledge[op.playerIndex]=cloneKList(op.knowledge||[]);
  }
  return {
    rootIndex:view.playerIndex,
    actor:view.playerIndex,
    turnsLeft:Number(view.finalTurnsRemaining||0),
    clues:Number(view.clues||0),
    strikes:Number(view.strikes||0),
    fireworks:{...view.fireworks},
    discarded:(view.discarded||[]).map(c=>({...c})),
    hands,
    knowledge,
    playerCount:view.playerCount,
    bonusMode:view.bonusMode||"original",
    rootView:view,
    rawLoss:0
  };
}
function syntheticView(st,actor){
  const otherHands=[];
  for(let p=0;p<st.playerCount;p++){
    if(p===actor || !st.hands[p]) continue;
    const visibleOtherHands=[];
    for(let q=0;q<st.playerCount;q++){
      if(q===p || !st.hands[q]) continue;
      visibleOtherHands.push({playerIndex:q,hand:st.hands[q].map(c=>({...c}))});
    }
    otherHands.push({
      playerIndex:p,
      hand:st.hands[p].map(c=>({...c})),
      knowledge:cloneKList(st.knowledge[p]),
      visibleOtherHands
    });
  }
  return {
    playerIndex:actor,
    playerCount:st.playerCount,
    clues:st.clues,
    strikes:st.strikes,
    fireworks:{...st.fireworks},
    discarded:st.discarded.map(c=>({...c})),
    deckRemaining:0,
    finalTurnsRemaining:st.turnsLeft,
    finalCountdownArmed:false,
    bonusMode:st.bonusMode,
    bonusRemaining:[],
    bonusHistory:[],
    ownHandSize:st.knowledge[actor]?.length||0,
    knowledge:cloneKList(st.knowledge[actor]),
    otherHands
  };
}
function touchedIndexes(hand,hintType,value){
  return hand.map((card,index)=>({card,index})).filter(x=>
    hintType==="color" ? colorHintTouches(x.card.color,value) : x.card.number===Number(value)
  ).map(x=>x.index);
}
function simulateHintKnowledge(hand,before,hintType,value){
  const after=cloneKList(before);
  if(hintType==="color") applyColorHint(hand,after,value);
  else applyNumberHint(hand,after,Number(value));
  return after;
}
function focusIndexForHint(hand,before,after,hintType,value){
  const touched=touchedIndexes(hand,hintType,value);
  const changed=touched.filter(i=>{
    const b=before[i],a=after[i];
    return b.possibleColors.size!==a.possibleColors.size ||
           b.possibleNumbers.size!==a.possibleNumbers.size;
  });
  const src=changed.length?changed:touched;
  return src.length?src[src.length-1]:null;
}
function rawFinalPlayClues(st,actor,{maxHints=10,allowFutureChain=true}={}){
  if(st.clues<=0) return [];
  const out=[];
  for(let target=0;target<st.playerCount;target++){
    if(target===actor || !st.hands[target]) continue;
    const distance=turnDistance(actor,target,st.playerCount);
    if(distance<=0 || distance>=st.turnsLeft) continue;

    const hand=st.hands[target],before=st.knowledge[target];
    const raw=[];
    for(const color of COLOR_CLUES){
      if(hand.some(c=>colorHintTouches(c.color,color))) raw.push({hintType:"color",value:color});
    }
    for(const number of NUMBERS){
      if(hand.some(c=>c.number===number)) raw.push({hintType:"number",value:number});
    }

    for(const h of raw){
      const after=simulateHintKnowledge(hand,before,h.hintType,h.value);
      const focusIndex=focusIndexForHint(hand,before,after,h.hintType,h.value);
      if(focusIndex===null) continue;
      const card=hand[focusIndex];
      const k=before[focusIndex];
      if(!card || k?.playSignal) continue;

      const level=Number(st.fireworks[card.color]||0);
      if(card.number<=level) continue;

      // At most one level of this color can be advanced per action before
      // the recipient's slot. This is only an optimistic feasibility filter;
      // the DFS still has to produce the actual prerequisite sequence.
      const maxReachableByTarget=level+distance;
      if(card.number>maxReachableByTarget) continue;
      if(!allowFutureChain && !isPlayableCard(st.fireworks,card)) continue;

      const touched=touchedIndexes(hand,h.hintType,h.value);
      const beforeInfo=totalKnowledgeInformation(before);
      const afterInfo=totalKnowledgeInformation(after);
      const infoGain=Math.max(0,afterInfo-beforeInfo);
      const rank=
        (isPlayableCard(st.fireworks,card)?200:100) +
        (maxReachableByTarget-card.number+1)*8 +
        (st.turnsLeft-distance)*10 +
        infoGain*2 -
        Math.max(0,touched.length-1)*4;

      out.push({
        type:"HINT",
        targetIndex:target,
        hintType:h.hintType,
        value:h.value,
        clueClass:"PLAY",
        convention:{
          intent:"PLAY",
          focusIndex,
          playSignalDistance:distance,
          multiPlayIndexes:null,
          saveIndexes:null,
          deferred:false
        },
        meta:{
          exactFinalRawClue:true,
          playDistance:distance,
          exactFocusColor:card.color,
          exactFocusNumber:card.number
        },
        focusIndex,
        focusCardId:card.id,
        rank,
        touchedCount:touched.length,
        infoGain
      });
    }
  }

  // Keep the better physical hint when color and number focus the same card.
  const dedup=new Map();
  for(const c of out){
    const key=`${c.targetIndex}|${c.focusCardId}`;
    const prev=dedup.get(key);
    if(!prev || c.rank>prev.rank) dedup.set(key,c);
  }
  return [...dedup.values()].sort((a,b)=>b.rank-a.rank).slice(0,maxHints);
}
function diagnosePlayClues(base,view,st,actor,maxHints=10){
  if(st.clues<=0 || typeof base.diagnosePlayClues!=="function") return [];
  const rows=base.diagnosePlayClues(view)
    .filter(d=>{
      const distance=turnDistance(actor,d.targetIndex,st.playerCount);
      return distance>0 && distance<st.turnsLeft;
    })
    .sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  const out=[];
  const seen=new Set();
  for(const d of rows){
    const key=`${d.targetIndex}|${d.focusCardId}`;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push({
      type:"HINT",
      targetIndex:d.targetIndex,
      hintType:d.hintType,
      value:d.value,
      clueClass:"PLAY",
      convention:{
        intent:"PLAY",
        focusIndex:d.focusIndex,
        playSignalDistance:turnDistance(actor,d.targetIndex,st.playerCount),
        multiPlayIndexes:null,
        saveIndexes:null,
        deferred:false
      },
      meta:{
        exactFinalDiagnosticClue:true,
        playDistance:turnDistance(actor,d.targetIndex,st.playerCount),
        exactFocusColor:d.focusColor,
        exactFocusNumber:d.focusNumber
      },
      focusIndex:d.focusIndex,
      focusCardId:d.focusCardId,
      rank:Number(d.score||0)
    });
    if(out.length>=maxHints) break;
  }
  return out;
}
function applyHintToState(st,action){
  const ns=cloneState(st);
  if(ns.clues<=0) return null;
  const target=action.targetIndex;
  const hand=ns.hands[target];
  const knowledge=ns.knowledge[target];
  if(!hand || !knowledge) return null;

  const touched=touchedIndexes(hand,action.hintType,action.value);
  if(!touched.length) return null;
  ns.clues--;

  if(action.hintType==="color") applyColorHint(hand,knowledge,action.value);
  else applyNumberHint(hand,knowledge,Number(action.value));

  const conv=action.convention;
  if(conv && Number.isInteger(conv.focusIndex) && touched.includes(conv.focusIndex)){
    const focus=knowledge[conv.focusIndex];
    if(conv.intent==="PLAY"){
      focus.playSignal=true;
      focus.saveSignal=false;
      focus.signalAge=0;
      focus.playSignalDistance=Number(conv.playSignalDistance||0);
      focus.multiPlaySignal=false;
      focus.deferredPlaySignal=Boolean(conv.deferred);
      const saves=Array.isArray(conv.saveIndexes)?conv.saveIndexes:[];
      for(const i of saves){
        if(i===conv.focusIndex || !touched.includes(i)) continue;
        const k=knowledge[i];
        if(!k || k.playSignal || k.deferredPlaySignal) continue;
        k.saveSignal=true;
        k.signalAge=0;
      }
    }else if(conv.intent==="SAVE"){
      focus.saveSignal=true;
      focus.playSignal=false;
      focus.deferredPlaySignal=false;
      focus.signalAge=0;
    }
  }
  return ns;
}
function maxReachableColor(st,color,extraDiscardCard=null){
  let level=Number(st.fireworks[color]||0);
  for(let n=level+1;n<=5;n++){
    let remaining=Number(COPIES[n]||0);
    for(const c of st.discarded){
      if(c.color===color && c.number===n) remaining--;
    }
    if(extraDiscardCard && extraDiscardCard.color===color && extraDiscardCard.number===n) remaining--;
    if(remaining<=0) break;
    level=n;
  }
  return level;
}
function discardRawValue(st,card){
  if(!card) return 0;
  const before=maxReachableColor(st,card.color,null);
  const after=maxReachableColor(st,card.color,card);
  return Math.max(0,before-after);
}
function advanceState(ns){
  ns.actor=(ns.actor+1)%ns.playerCount;
  ns.turnsLeft=Math.max(0,ns.turnsLeft-1);
  for(const list of ns.knowledge){
    for(const k of list){
      if(k.playSignal||k.saveSignal) k.signalAge=Number(k.signalAge||0)+1;
    }
  }
  return ns;
}
function knownOwnPlayAction(st,actor){
  const ks=st.knowledge[actor]||[];
  const signals=ks.map((k,index)=>({k,index}))
    .filter(x=>x.k?.playSignal)
    .sort((a,b)=>Number(a.k.signalAge||0)-Number(b.k.signalAge||0));
  if(signals.length) return {type:"PLAY",cardIndex:signals[0].index,source:"SIGNAL"};

  const deferred=ks.map((k,index)=>({k,index}))
    .filter(x=>x.k?.deferredPlaySignal && knowledgeGuaranteesPlayable(x.k,st.fireworks))
    .sort((a,b)=>Number(a.k.signalAge||0)-Number(b.k.signalAge||0));
  if(deferred.length) return {type:"PLAY",cardIndex:deferred[0].index,source:"DEFERRED"};

  const guaranteed=ks.map((k,index)=>({k,index}))
    .filter(x=>knowledgeGuaranteesPlayable(x.k,st.fireworks));
  if(guaranteed.length) return {type:"PLAY",cardIndex:guaranteed[0].index,source:"CERTAIN"};
  return null;
}
function publicDiscardIndex(st,actor){
  const ks=st.knowledge[actor]||[];
  let candidates=ks.map((k,index)=>({k,index}))
    .filter(x=>!x.k?.playSignal && !x.k?.deferredPlaySignal && !x.k?.saveSignal);
  if(!candidates.length) candidates=ks.map((k,index)=>({k,index}));
  const useless=candidates.filter(x=>knowledgeGuaranteesUseless(x.k,st.fireworks));
  if(useless.length) return useless[0].index;
  // Final round: no future turn for this actor. Prefer an unprotected,
  // least-informative slot; this rule does not inspect the physical card.
  candidates.sort((a,b)=>{
    const sa=(a.k.possibleColors?.size||0)*(a.k.possibleNumbers?.size||0);
    const sb=(b.k.possibleColors?.size||0)*(b.k.possibleNumbers?.size||0);
    return sb-sa || a.index-b.index;
  });
  return candidates[0]?.index??0;
}
function rootDiscardAction(view){
  const own=analyzeOwnHand(view,{mode:"hybrid"});
  const ranked=own.map((x,index)=>({index,...x,k:view.knowledge[index]}))
    .map(x=>{
      let protection=0;
      if(x.k?.saveSignal) protection+=1000;
      if(x.k?.playSignal&&!x.k?.multiPlaySignal) protection+=700;
      if(x.k?.deferredPlaySignal&&x.uselessProbability<0.999999) protection+=550;
      return {
        ...x,
        rank:x.safeDiscardProbability*100+x.uselessProbability*40-protection
      };
    })
    .sort((a,b)=>b.rank-a.rank);
  return {
    type:"DISCARD",
    cardIndex:ranked[0]?.index??0,
    meta:{discardCause:view.clues<=0?"FORCED_NO_CLUE":"EXACT_FINAL_DISCARD"}
  };
}
function applyKnownPlay(st,action){
  const ns=cloneState(st);
  const actor=st.actor;
  const hand=ns.hands[actor];
  if(!hand) return null;
  const card=hand[action.cardIndex];
  if(!card) return null;
  hand.splice(action.cardIndex,1);
  ns.knowledge[actor].splice(action.cardIndex,1);
  if(isPlayableCard(ns.fireworks,card)){
    ns.fireworks[card.color]=card.number;
    if(card.number===5 && ns.bonusMode==="original") ns.clues=Math.min(8,ns.clues+1);
  }else{
    ns.discarded.push(card);
    ns.strikes++;
  }
  return ns;
}
function applyKnownDiscard(st,action){
  const ns=cloneState(st);
  const actor=st.actor;
  const hand=ns.hands[actor];
  if(hand && hand[action.cardIndex]){
    const card=hand[action.cardIndex];
    ns.rawLoss+=discardRawValue(ns,card);
    hand.splice(action.cardIndex,1);
    ns.knowledge[actor].splice(action.cardIndex,1);
    ns.discarded.push(card);
  }else if(ns.knowledge[actor]?.length){
    ns.knowledge[actor].splice(Math.min(action.cardIndex,ns.knowledge[actor].length-1),1);
  }
  ns.clues=Math.min(8,ns.clues+1);
  return ns;
}
function splitIdentity(key){
  const [color,number]=String(key).split("|");
  return {color,number:Number(number)};
}
function applyRootUnknownPlayBranches(st,action,rootAnalysis){
  const info=rootAnalysis?.[action.cardIndex];
  const entries=Object.entries(info?.byIdentity||{});
  if(!entries.length){
    const ns=cloneState(st);
    if(ns.knowledge[st.actor]?.length>action.cardIndex) ns.knowledge[st.actor].splice(action.cardIndex,1);
    return [{p:1,state:ns}];
  }
  const out=[];
  for(const [key,p] of entries){
    if(p<=0) continue;
    const ns=cloneState(st);
    if(ns.knowledge[st.actor]?.length>action.cardIndex) ns.knowledge[st.actor].splice(action.cardIndex,1);
    const card=splitIdentity(key);
    if(isPlayableCard(ns.fireworks,card)){
      ns.fireworks[card.color]=card.number;
      if(card.number===5 && ns.bonusMode==="original") ns.clues=Math.min(8,ns.clues+1);
    }else{
      ns.strikes++;
    }
    out.push({p:Number(p),state:ns});
  }
  return out;
}
function applyRootUnknownDiscard(st,action,rootAnalysis){
  const ns=cloneState(st);
  const info=rootAnalysis?.[action.cardIndex];
  let expectedRaw=0;
  for(const [key,p] of Object.entries(info?.byIdentity||{})){
    expectedRaw+=Number(p)*discardRawValue(ns,splitIdentity(key));
  }
  ns.rawLoss+=expectedRaw;
  if(ns.knowledge[st.actor]?.length>action.cardIndex) ns.knowledge[st.actor].splice(action.cardIndex,1);
  ns.clues=Math.min(8,ns.clues+1);
  return ns;
}
function strandedKnown(st){
  let n=0;
  for(let p=0;p<st.playerCount;p++){
    const hand=st.hands[p];
    if(!hand) continue;
    for(const card of hand) if(isPlayableCard(st.fireworks,card)) n++;
  }
  return n;
}
function terminalResult(st){
  return {
    score:scoreFireworks(st.fireworks),
    strikes:st.strikes,
    rawLoss:Number(st.rawLoss||0),
    stranded:strandedKnown(st),
    clues:st.clues,
    nodes:1
  };
}
function combineExpected(branches){
  let out={score:0,strikes:0,rawLoss:0,stranded:0,clues:0,nodes:1};
  let total=0;
  for(const b of branches){
    const p=Number(b.p||0);
    total+=p;
    for(const k of ["score","strikes","rawLoss","stranded","clues"]) out[k]+=p*Number(b.result[k]||0);
    out.nodes+=Number(b.result.nodes||0);
  }
  if(total>0 && Math.abs(total-1)>1e-9){
    for(const k of ["score","strikes","rawLoss","stranded","clues"]) out[k]/=total;
  }
  return out;
}
function better(a,b,tieBreak="score"){
  if(!b) return true;
  const eps=1e-9;
  if(a.score>b.score+eps) return true;
  if(a.score<b.score-eps) return false;
  if(a.strikes<b.strikes-eps) return true;
  if(a.strikes>b.strikes+eps) return false;
  if(tieBreak==="raw"){
    if(a.rawLoss<b.rawLoss-eps) return true;
    if(a.rawLoss>b.rawLoss+eps) return false;
    if(a.stranded<b.stranded-eps) return true;
    if(a.stranded>b.stranded+eps) return false;
  }else if(tieBreak==="stranded"){
    if(a.stranded<b.stranded-eps) return true;
    if(a.stranded>b.stranded+eps) return false;
    if(a.rawLoss<b.rawLoss-eps) return true;
    if(a.rawLoss>b.rawLoss+eps) return false;
  }
  return a.clues>b.clues+eps;
}
function stateKey(st){
  const fw=COLORS.map(c=>st.fireworks[c]||0).join(",");
  const parts=[st.actor,st.turnsLeft,st.clues,st.strikes,fw];
  for(let p=0;p<st.playerCount;p++){
    if(!st.hands[p]) continue;
    const hand=st.hands[p].map(c=>c.id||`${c.color}${c.number}`).join(".");
    const ks=(st.knowledge[p]||[]).map(k=>
      `${[...(k.possibleColors||[])].sort().join("")}/${[...(k.possibleNumbers||[])].sort().join("")}/`+
      `${k.playSignal?1:0}${k.deferredPlaySignal?1:0}${k.saveSignal?1:0}`
    ).join(";");
    parts.push(`${p}:${hand}:${ks}`);
  }
  return parts.join("|");
}
function normalizeActionKey(a){
  if(!a) return "NULL";
  if(a.type==="PLAY"||a.type==="DISCARD") return `${a.type}:${a.cardIndex}`;
  return `${a.type}:${a.targetIndex}:${a.hintType}:${a.value}:${a.convention?.focusIndex??"-"}:${a.convention?.intent??"-"}`;
}
function applyGenericAction(st,action){
  if(action.type==="HINT") return applyHintToState(st,action);
  if(action.type==="PLAY") return applyKnownPlay(st,action);
  if(action.type==="DISCARD") return applyKnownDiscard(st,action);
  return null;
}
function searchFinal(st,{
  base,
  tieBreak="score",
  useRawClues=true,
  allowFutureChain=true,
  maxHints=8,
  memo=new Map()
}={}){
  if(st.turnsLeft<=0 || st.strikes>=3 || scoreFireworks(st.fireworks)>=targetScore()) return terminalResult(st);
  const key=`${tieBreak}|${useRawClues?1:0}|${allowFutureChain?1:0}|${stateKey(st)}`;
  if(memo.has(key)) return memo.get(key);

  const actor=st.actor;
  const ownPlay=knownOwnPlayAction(st,actor);

  // In simulated future slots, PLAY signals / certain PLAYs keep precedence.
  // This prevents the root planner from exploiting the physical identity of
  // another player's hidden card when predicting their decision.
  if(ownPlay){
    const ns=applyKnownPlay(st,ownPlay);
    if(!ns) return terminalResult(st);
    advanceState(ns);
    const r=searchFinal(ns,{base,tieBreak,useRawClues,allowFutureChain,maxHints,memo});
    const out={...r,nodes:Number(r.nodes||0)+1};
    memo.set(key,out);
    return out;
  }

  const v=syntheticView(st,actor);
  let hints=useRawClues
    ? rawFinalPlayClues(st,actor,{maxHints,allowFutureChain})
    : diagnosePlayClues(base,v,st,actor,maxHints);

  // A discard is always a legal way to create one clue in a final slot.
  const discard={type:"DISCARD",cardIndex:publicDiscardIndex(st,actor),meta:{discardCause:"EXACT_FINAL_PROJECTED"}};
  const actions=[...hints,discard];
  let best=null;

  for(const action of actions){
    const ns=applyGenericAction(st,action);
    if(!ns) continue;
    advanceState(ns);
    const r=searchFinal(ns,{base,tieBreak,useRawClues,allowFutureChain,maxHints,memo});
    const candidate={...r,nodes:Number(r.nodes||0)+1};
    if(better(candidate,best,tieBreak)) best=candidate;
  }
  const out=best||terminalResult(st);
  memo.set(key,out);
  return out;
}
function evaluateRootAction(st,action,{
  base,tieBreak,useRawClues,allowFutureChain,maxHints,rootAnalysis
}={}){
  const memo=new Map();

  if(action.type==="PLAY"){
    const branches=[];
    for(const b of applyRootUnknownPlayBranches(st,action,rootAnalysis)){
      advanceState(b.state);
      branches.push({
        p:b.p,
        result:searchFinal(b.state,{base,tieBreak,useRawClues,allowFutureChain,maxHints,memo})
      });
    }
    return combineExpected(branches);
  }

  let ns;
  if(action.type==="DISCARD") ns=applyRootUnknownDiscard(st,action,rootAnalysis);
  else ns=applyHintToState(st,action);
  if(!ns) return null;
  advanceState(ns);
  return searchFinal(ns,{base,tieBreak,useRawClues,allowFutureChain,maxHints,memo});
}
function selectRootPlayAlternative(view,rootAnalysis){
  const signals=view.knowledge.map((k,index)=>({k,index,p:rootAnalysis[index]?.playableProbability||0}))
    .filter(x=>x.k?.playSignal && x.p>1e-9)
    .sort((a,b)=>b.p-a.p || Number(a.k.signalAge||0)-Number(b.k.signalAge||0));
  if(signals.length) return {type:"PLAY",cardIndex:signals[0].index,meta:{playCause:"SIGNAL",playableProbability:signals[0].p}};
  const deferred=view.knowledge.map((k,index)=>({k,index,p:rootAnalysis[index]?.playableProbability||0}))
    .filter(x=>x.k?.deferredPlaySignal && x.p>=0.999999)
    .sort((a,b)=>Number(a.k.signalAge||0)-Number(b.k.signalAge||0));
  if(deferred.length) return {type:"PLAY",cardIndex:deferred[0].index,meta:{playCause:"DEFERRED",playableProbability:deferred[0].p}};
  const certain=rootAnalysis.map((x,index)=>({index,...x}))
    .filter(x=>x.playableProbability>=0.999999)
    .sort((a,b)=>b.criticalProbability-a.criticalProbability);
  if(certain.length) return {type:"PLAY",cardIndex:certain[0].index,meta:{playCause:"CERTAIN",playableProbability:certain[0].playableProbability}};
  return null;
}


function exactActionDescriptor(action){
  if(!action) return {
    type:"NONE", label:"NONE", clueClass:null, targetIndex:null, distance:0
  };
  if(action.type==="HINT"){
    const clueClass=action.clueClass||"HINT";
    return {
      type:"HINT",
      label:`HINT_${clueClass}`,
      clueClass,
      targetIndex:Number.isInteger(action.targetIndex)?action.targetIndex:null,
      distance:Number(action.meta?.playDistance||action.convention?.playSignalDistance||0),
      hintType:action.hintType||null,
      value:action.value??null,
      focusIndex:Number.isInteger(action.convention?.focusIndex)?action.convention.focusIndex:null
    };
  }
  if(action.type==="PLAY"){
    return {
      type:"PLAY",
      label:`PLAY_${action.meta?.playCause||"OTHER"}`,
      clueClass:null,
      targetIndex:null,
      distance:0,
      cardIndex:Number.isInteger(action.cardIndex)?action.cardIndex:null
    };
  }
  if(action.type==="DISCARD"){
    return {
      type:"DISCARD",
      label:`DISCARD_${action.meta?.discardCause||"OTHER"}`,
      clueClass:null,
      targetIndex:null,
      distance:0,
      cardIndex:Number.isInteger(action.cardIndex)?action.cardIndex:null
    };
  }
  return {type:String(action.type),label:String(action.type),clueClass:null,targetIndex:null,distance:0};
}


function exactPolicyAllowsCandidate(policy, baseline, action, view){
  if(!action) return false;
  if(normalizeActionKey(action)===normalizeActionKey(baseline)) return true;

  const b=exactActionDescriptor(baseline);
  const a=exactActionDescriptor(action);
  const turns=Number(view.finalTurnsRemaining||0);
  const clues=Number(view.clues||0);
  const bPlayHint=b.type==="HINT" && b.clueClass==="PLAY";
  const aPlayHint=a.type==="HINT" && a.clueClass==="PLAY";
  const sameTarget=bPlayHint && aPlayHint && b.targetIndex===a.targetIndex;

  switch(String(policy||"all")){
    case "all":
      return true;
    case "hint-only":
      return bPlayHint && aPlayHint;
    case "hint-T5":
      return turns===5 && bPlayHint && aPlayHint;
    case "hint-TN":
      return turns===Number(view.playerCount||0) && bPlayHint && aPlayHint;
    case "hint-TN-Tprev": {
      const n=Number(view.playerCount||0);
      return (turns===n || turns===Math.max(1,n-1)) && bPlayHint && aPlayHint;
    }
    case "hint-T5-T4":
      return (turns===5 || turns===4) && bPlayHint && aPlayHint;
    case "hint-same":
      return sameTarget;
    case "hint-T5-same":
      return turns===5 && sameTarget;
    case "hint-T5-C1":
      return turns===5 && clues===1 && bPlayHint && aPlayHint;
    case "hint-T5-C12":
      return turns===5 && (clues===1 || clues===2) && bPlayHint && aPlayHint;
    case "discard-only":
      return bPlayHint && a.type==="DISCARD";
    case "hint-all-no-discard":
      return b.type==="HINT" && a.type==="HINT";
    default:
      throw new Error(`Policy Exact v1.13.2 non valida: ${policy}`);
  }
}

export function createExactFinalV1132Strategy({
  enableExactFinalScheduler=true,
  finalExactAllowPreemptPlay=false,
  finalExactUseRawClues=true,
  finalExactAllowFutureChain=true,
  finalExactTieBreak="score",
  finalExactMaxHints=8,
  finalExactOverridePolicy="all",
  ...baseOptions
}={}){
  const base=createEndgameConversionV112Strategy(baseOptions);

  return {
    name:`exact-final-v1.13.2-${enableExactFinalScheduler?"enabled":"baseline"}-${finalExactOverridePolicy}`,
    diagnosePlayClues(view){
      return typeof base.diagnosePlayClues==="function" ? base.diagnosePlayClues(view) : [];
    },
    chooseAction(view){
      const baseline=base.chooseAction(view);
      const inFinal=view.finalTurnsRemaining!==null && view.finalTurnsRemaining!==undefined;
      if(!enableExactFinalScheduler || !inFinal) return baseline;

      // If current PLAY preemption is disabled, preserve the established
      // signal/certain-play hierarchy exactly for the current player.
      if(!finalExactAllowPreemptPlay && baseline?.type==="PLAY") return baseline;

      const st=stateFromView(view);
      if(st.turnsLeft<=0) return baseline;

      const rootAnalysis=analyzeOwnHand(view,{mode:baseOptions.probabilityMode||"hybrid"});
      const candidates=[];
      const seen=new Set();
      const push=a=>{
        if(!a) return;
        const k=normalizeActionKey(a);
        if(seen.has(k)) return;
        seen.add(k);
        candidates.push(a);
      };

      push(baseline);
      push(selectRootPlayAlternative(view,rootAnalysis));

      const rootHints=finalExactUseRawClues
        ? rawFinalPlayClues(st,view.playerIndex,{
            maxHints:finalExactMaxHints,
            allowFutureChain:finalExactAllowFutureChain
          })
        : diagnosePlayClues(base,view,st,view.playerIndex,finalExactMaxHints);
      for(const h of rootHints) push(h);

      // Only add a discard alternative when it can actually replenish a clue.
      if(view.clues<8) push(rootDiscardAction(view));

      let bestAction=baseline,bestResult=null;
      for(const action of candidates){
        if(!finalExactAllowPreemptPlay && baseline?.type==="PLAY" && normalizeActionKey(action)!==normalizeActionKey(baseline)) continue;
        if(!exactPolicyAllowsCandidate(finalExactOverridePolicy,baseline,action,view)) continue;
        const r=evaluateRootAction(st,action,{
          base,
          tieBreak:finalExactTieBreak,
          useRawClues:finalExactUseRawClues,
          allowFutureChain:finalExactAllowFutureChain,
          maxHints:finalExactMaxHints,
          rootAnalysis
        });
        if(!r) continue;
        if(better(r,bestResult,finalExactTieBreak)){
          bestResult=r;
          bestAction=action;
        }
      }

      if(!bestAction) return baseline;
      const override=normalizeActionKey(bestAction)!==normalizeActionKey(baseline);
      const baselineDescriptor=exactActionDescriptor(baseline);
      const selectedDescriptor=exactActionDescriptor(bestAction);
      bestAction={
        ...bestAction,
        meta:{
          ...(bestAction.meta||{}),
          exactFinal:true,
          exactFinalOverride:override,
          exactFinalPreemptedPlay:Boolean(override && baseline?.type==="PLAY"),
          exactFinalProjectedScore:Number(bestResult?.score||scoreFireworks(view.fireworks)),
          exactFinalProjectedStranded:Number(bestResult?.stranded||0),
          exactFinalProjectedRawLoss:Number(bestResult?.rawLoss||0),
          exactFinalNodes:Number(bestResult?.nodes||0),
          exactFinalRawClue:Boolean(bestAction.meta?.exactFinalRawClue),

          // v1.13.1 profiler metadata. These are public-action descriptors only.
          exactFinalBaselineType:baselineDescriptor.type,
          exactFinalBaselineLabel:baselineDescriptor.label,
          exactFinalBaselineClueClass:baselineDescriptor.clueClass,
          exactFinalBaselineTargetIndex:baselineDescriptor.targetIndex,
          exactFinalBaselineDistance:baselineDescriptor.distance,
          exactFinalSelectedType:selectedDescriptor.type,
          exactFinalSelectedLabel:selectedDescriptor.label,
          exactFinalSelectedClueClass:selectedDescriptor.clueClass,
          exactFinalSelectedTargetIndex:selectedDescriptor.targetIndex,
          exactFinalSelectedDistance:selectedDescriptor.distance,
          exactFinalOverridePolicy:String(finalExactOverridePolicy||"all")
        }
      };
      return bestAction;
    }
  };
}
