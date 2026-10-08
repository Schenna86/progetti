import { COLORS, COPIES } from "../constants.js";

function scoreFireworks(fireworks){
  return Object.values(fireworks).reduce((a,b)=>a+Number(b||0),0);
}
function isPlayable(fireworks,card){
  return Boolean(card) && Number(card.number)===Number(fireworks[card.color]||0)+1;
}
function cardKey(card){
  return `${card.color}|${card.number}`;
}
function discardedCount(discarded,color,number){
  let n=0;
  for(const c of discarded||[]) if(c.color===color && Number(c.number)===Number(number)) n++;
  return n;
}
function remainingCopies(view,card){
  return Math.max(
    0,
    Number(COPIES[card.number]||0) -
    discardedCount(view.discarded,card.color,card.number)
  );
}
function maxReachableColor(fireworks,discarded,color,extraDiscard=null){
  let level=Number(fireworks[color]||0);
  for(let n=level+1;n<=5;n++){
    let rem=Number(COPIES[n]||0)-discardedCount(discarded,color,n);
    if(extraDiscard && extraDiscard.color===color && Number(extraDiscard.number)===n) rem--;
    if(rem<=0) break;
    level=n;
  }
  return level;
}
function rawLossIfDiscard(view,card){
  if(!card) return 0;
  const before=maxReachableColor(view.fireworks,view.discarded,card.color,null);
  const after=maxReachableColor(view.fireworks,view.discarded,card.color,card);
  return Math.max(0,before-after);
}
function allHands(view){
  if(Array.isArray(view.allHands)) return view.allHands;
  const out=Array(view.playerCount).fill(null).map((_,i)=>({playerIndex:i,hand:[]}));
  out[view.playerIndex]={playerIndex:view.playerIndex,hand:(view.ownHand||[]).map(c=>({...c}))};
  for(const op of view.otherHands||[]) out[op.playerIndex]={playerIndex:op.playerIndex,hand:(op.hand||[]).map(c=>({...c}))};
  return out;
}
function turnDistance(current,target,n){
  return (target-current+n)%n;
}

function visibleUnlockValue(view,card){
  const fw={...view.fireworks,[card.color]:card.number};
  let value=0;
  for(const entry of allHands(view)){
    for(const c of entry.hand||[]){
      if(c.id===card.id) continue;
      if(!isPlayable(fw,c)) continue;
      const d=turnDistance(view.playerIndex,entry.playerIndex,view.playerCount);
      const soon=d===0 ? view.playerCount : d;
      value += 12 + Math.max(0,6-soon)*3;
      if(c.number===5) value+=5;
    }
  }
  return value;
}
function sameColorChainValue(view,card){
  let v=0;
  const hands=allHands(view);
  for(const entry of hands){
    for(const c of entry.hand||[]){
      if(c.color!==card.color || c.id===card.id) continue;
      const delta=Number(c.number)-Number(card.number);
      if(delta===1) v+=18;
      else if(delta===2) v+=7;
    }
  }
  return v;
}
function playablePriority(view,card){
  let v=0;
  v+=visibleUnlockValue(view,card);
  v+=sameColorChainValue(view,card);
  if(remainingCopies(view,card)<=1) v+=25;
  if(view.bonusMode==="expansion" && Number(card.number)===5) v+=35;
  if(Number(card.number)===5) v+=8;
  // Prefer lower rank when all else is equal because it tends to unlock
  // a longer remaining chain.
  v+=(6-Number(card.number))*0.25;
  return v;
}
function chooseGreedyPlayable(view){
  const hand=view.ownHand||[];
  const playable=hand
    .map((card,index)=>({card,index,priority:playablePriority(view,card)}))
    .filter(x=>isPlayable(view.fireworks,x.card))
    .sort((a,b)=>b.priority-a.priority || a.index-b.index);
  return playable[0]||null;
}
function visibleCopiesInOtherHands(view,card){
  let n=0;
  for(const h of allHands(view)){
    if(h.playerIndex===view.playerIndex) continue;
    for(const c of h.hand||[]) if(cardKey(c)===cardKey(card)) n++;
  }
  return n;
}
function discardPriority(view,card,index){
  const level=Number(view.fireworks[card.color]||0);
  const useless=Number(card.number)<=level;
  const rawLoss=rawLossIfDiscard(view,card);
  const remaining=remainingCopies(view,card);
  const visibleOther=visibleCopiesInOtherHands(view,card);
  const distanceFromNeed=Math.max(0,Number(card.number)-(level+1));

  // Lower is better.
  let cost=rawLoss*100000;
  if(useless) cost-=10000;
  cost-=Math.max(0,remaining-1)*350;
  cost-=visibleOther*500;
  cost-=distanceFromNeed*80;
  if(Number(card.number)===5) cost+=300;
  cost+=Number(card.number)*3;
  cost+=index*0.001;
  return {cost,rawLoss,remaining,useless,visibleOther,distanceFromNeed};
}
function chooseOracleDiscard(view){
  const hand=view.ownHand||[];
  return hand
    .map((card,index)=>({card,index,...discardPriority(view,card,index)}))
    .sort((a,b)=>a.cost-b.cost || a.index-b.index)[0]||null;
}

// Exact final-round scheduler for ORIGINAL mode.
// At deck exhaustion every remaining player has at most one action, so there
// are no future draws. With perfect information a hint is dominated by a PLAY
// whenever a PLAY exists and otherwise cannot itself score a point.
function cloneFinalState(st){
  return {
    actor:st.actor,
    turnsLeft:st.turnsLeft,
    fireworks:{...st.fireworks},
    hands:st.hands.map(h=>h.map(c=>({...c})))
  };
}
function finalStateKey(st){
  return [
    st.actor,
    st.turnsLeft,
    COLORS.map(c=>st.fireworks[c]||0).join(","),
    ...st.hands.map(h=>h.map(c=>c.id||`${c.color}${c.number}`).join("."))
  ].join("|");
}
function finalSearchOriginal(st,memo=new Map()){
  if(st.turnsLeft<=0 || scoreFireworks(st.fireworks)>=25){
    return {score:scoreFireworks(st.fireworks),firstAction:null,nodes:1};
  }
  const key=finalStateKey(st);
  if(memo.has(key)) return memo.get(key);

  const hand=st.hands[st.actor]||[];
  const playable=hand
    .map((card,index)=>({card,index}))
    .filter(x=>isPlayable(st.fireworks,x.card));

  const actions=playable.length
    ? playable.map(x=>({type:"PLAY",cardIndex:x.index}))
    : [{type:"DISCARD",cardIndex:0}];

  let best=null;
  for(const action of actions){
    const ns=cloneFinalState(st);
    if(action.type==="PLAY"){
      const card=ns.hands[ns.actor][action.cardIndex];
      ns.hands[ns.actor].splice(action.cardIndex,1);
      ns.fireworks[card.color]=card.number;
    }else if(ns.hands[ns.actor].length){
      ns.hands[ns.actor].splice(Math.min(action.cardIndex,ns.hands[ns.actor].length-1),1);
    }
    ns.actor=(ns.actor+1)%ns.hands.length;
    ns.turnsLeft--;
    const child=finalSearchOriginal(ns,memo);
    const candidate={
      score:child.score,
      firstAction:action,
      nodes:Number(child.nodes||0)+1
    };
    if(
      !best ||
      candidate.score>best.score ||
      (candidate.score===best.score && action.type==="PLAY" && best.firstAction?.type!=="PLAY")
    ) best=candidate;
  }
  memo.set(key,best);
  return best;
}
function chooseExactFinalOriginal(view){
  if(
    view.bonusMode!=="original" ||
    view.finalTurnsRemaining===null ||
    view.finalTurnsRemaining===undefined
  ) return null;

  const hands=allHands(view)
    .sort((a,b)=>a.playerIndex-b.playerIndex)
    .map(x=>(x.hand||[]).map(c=>({...c})));

  const st={
    actor:view.playerIndex,
    turnsLeft:Number(view.finalTurnsRemaining||0),
    fireworks:{...view.fireworks},
    hands
  };
  if(st.turnsLeft<=0) return null;
  const result=finalSearchOriginal(st,new Map());
  if(!result?.firstAction) return null;
  const selectedAction={...result.firstAction};
  if(selectedAction.type==="DISCARD") {
    selectedAction.cardIndex=chooseOracleDiscard(view)?.index??0;
  }
  return {
    ...selectedAction,
    meta:{
      oracle:true,
      oracleMode:"perfect-visible-final",
      oracleFinalExact:true,
      oracleProjectedFinalScore:Number(result.score||scoreFireworks(view.fireworks)),
      oracleSearchNodes:Number(result.nodes||0),
      ...(result.firstAction.type==="PLAY"
        ? {playCause:"ORACLE_EXACT",playableProbability:1}
        : {discardCause:"ORACLE_EXACT_FINAL"})
    }
  };
}

export function createOracleVisibleV114Strategy({
  exactFinalOriginal=true
}={}){
  return {
    name:`oracle-visible-v1.14-${exactFinalOriginal?"final-exact":"greedy"}`,
    perfectInformation:true,
    chooseAction(view){
      if(!Array.isArray(view.ownHand)){
        throw new Error("Oracle v1.14 richiede perfectInformation view con ownHand");
      }

      if(exactFinalOriginal){
        const exact=chooseExactFinalOriginal(view);
        if(exact) return exact;
      }

      const play=chooseGreedyPlayable(view);
      if(play){
        return {
          type:"PLAY",
          cardIndex:play.index,
          meta:{
            oracle:true,
            oracleMode:"perfect-visible",
            oraclePlayPriority:Number(play.priority||0),
            playCause:"ORACLE_VISIBLE",
            playableProbability:1
          }
        };
      }

      const discard=chooseOracleDiscard(view);
      return {
        type:"DISCARD",
        cardIndex:discard?.index??0,
        meta:{
          oracle:true,
          oracleMode:"perfect-visible",
          discardCause:"ORACLE_VISIBLE",
          oracleDiscardRawLoss:Number(discard?.rawLoss||0),
          oracleDiscardCost:Number(discard?.cost||0),
          oracleDiscardRemainingCopies:Number(discard?.remaining||0),
          oracleDiscardUseless:Boolean(discard?.useless),
          oracleDiscardVisibleOtherCopies:Number(discard?.visibleOther||0)
        }
      };
    }
  };
}
