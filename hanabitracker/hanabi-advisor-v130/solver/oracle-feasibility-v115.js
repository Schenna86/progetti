import { COLORS, COPIES } from "../constants.js";
import { RNG } from "../rng.js";
import { HanabiGame } from "../game.js";

const COLOR_INDEX=Object.fromEntries(COLORS.map((c,i)=>[c,i]));

function codeOf(card){
  return COLOR_INDEX[card.color]*5+(Number(card.number)-1);
}
function colorOf(code){ return Math.floor(code/5); }
function rankOf(code){ return (code%5)+1; }
function scoreFw(fw){ return fw[0]+fw[1]+fw[2]+fw[3]+fw[4]; }
function fwCode(fw){
  return (((((fw[0]*6+fw[1])*6+fw[2])*6+fw[3])*6)+fw[4]);
}
function removeOneSorted(hand,code){
  const out=hand.slice();
  const i=out.indexOf(code);
  if(i<0) throw new Error(`Carta ${code} non presente nella mano`);
  out.splice(i,1);
  return out;
}
function addSorted(hand,code){
  const out=hand.slice();
  let i=0;
  while(i<out.length && out[i]<=code)i++;
  out.splice(i,0,code);
  return out;
}
function uniqueCodes(hand){
  const out=[];
  let prev=-1;
  for(const c of hand){
    if(c!==prev)out.push(c);
    prev=c;
  }
  return out;
}
function stateCoreKey(st){
  return [
    st.actor,st.deckPos,st.finalLeft,fwCode(st.fw),
    ...st.hands.map(h=>h.join("."))
  ].join("|");
}
function fullStateKey(st){
  return `${stateCoreKey(st)}|c${st.clues}`;
}

function buildInitialState(players,seed){
  const rng=new RNG(seed);
  const game=new HanabiGame({players,rng,bonusMode:"original"});
  const draws=[...game.deck].reverse().map(codeOf);
  const hands=game.hands.map(h=>h.map(codeOf).sort((a,b)=>a-b));
  return {
    players,
    draws,
    initial:{
      players,
      actor:0,
      deckPos:0,
      finalLeft:-1,
      clues:8,
      fw:[0,0,0,0,0],
      hands
    }
  };
}
function buildSuffix(draws){
  const n=draws.length;
  const suffix=Array.from({length:n+1},()=>new Uint8Array(25));
  for(let i=n-1;i>=0;i--){
    suffix[i].set(suffix[i+1]);
    suffix[i][draws[i]]++;
  }
  return suffix;
}
function handCounts(st){
  const counts=new Uint8Array(25);
  for(const h of st.hands)for(const c of h)counts[c]++;
  return counts;
}
function availableCount(st,suffix,handCount,code){
  return Number(suffix[st.deckPos][code]||0)+Number(handCount[code]||0);
}
function availabilityPossible(st,suffix,handCount){
  for(let ci=0;ci<5;ci++){
    for(let rank=st.fw[ci]+1;rank<=5;rank++){
      const code=ci*5+(rank-1);
      if(availableCount(st,suffix,handCount,code)<=0)return false;
    }
  }
  return true;
}
function remainingActionCapacity(st,drawCount){
  const needed=25-scoreFw(st.fw);
  if(needed<=0)return true;
  if(st.finalLeft>=0)return needed<=st.finalLeft;
  const deckRemaining=drawCount-st.deckPos;
  // Every scoring action before deck exhaustion consumes exactly one draw.
  // drawCard() sets players+1, then the same action's advanceTurn()
  // immediately decrements it because finalCountdownArmed is false.
  // Therefore exactly `players` further actions remain after the last draw.
  return needed<=deckRemaining+st.players;
}
function canWait(st){
  if(st.clues<=0)return false;
  for(let p=0;p<st.players;p++){
    if(p!==st.actor && st.hands[p].length>0)return true;
  }
  return false;
}
function playPriority(st,code){
  const ci=colorOf(code),rank=rankOf(code);
  let v=0;
  // Unlock cards already sitting in hands.
  const nextCode=ci*5+rank; // rank+1 identity, if rank<5
  if(rank<5){
    for(const h of st.hands){
      for(const c of h) if(c===nextCode) v+=20;
    }
  }
  if(rank===5)v+=8; // clue refund
  v+=(6-rank);
  return v;
}
function discardCandidates(st,suffix,handCount){
  const hand=st.hands[st.actor];
  const unique=uniqueCodes(hand);
  const obsolete=[];
  const future=[];
  for(const code of unique){
    const ci=colorOf(code),rank=rankOf(code);
    if(rank<=st.fw[ci]){
      obsolete.push(code);
      continue;
    }
    // For a path to 25, discarding is legal for the feasibility search only
    // if at least one copy of this still-needed identity remains afterward.
    if(availableCount(st,suffix,handCount,code)>=2){
      future.push(code);
    }
  }
  // All obsolete cards are equivalent for future score in Original mode.
  // Keeping different obsolete identities changes no prerequisite or resource,
  // so one representative is sufficient.
  const out=[];
  if(obsolete.length)out.push(obsolete[0]);
  out.push(...future);
  return out;
}
function drawAfterRemoval(st,hands,draws){
  let deckPos=st.deckPos;
  let finalLeft=st.finalLeft;
  if(deckPos<draws.length){
    const card=draws[deckPos++];
    hands[st.actor]=addSorted(hands[st.actor],card);
    if(deckPos===draws.length && finalLeft<0){
      finalLeft=st.players+1;
    }
  }
  return {deckPos,finalLeft};
}
function advanceAfterAction(st,next){
  let finalLeft=next.finalLeft;
  if(finalLeft>=0){
    finalLeft--;
  }
  next.finalLeft=finalLeft;
  next.actor=(st.actor+1)%st.players;
  return next;
}
function transitionPlay(st,code,draws){
  const ci=colorOf(code),rank=rankOf(code);
  const hands=st.hands.map(h=>h);
  hands[st.actor]=removeOneSorted(hands[st.actor],code);
  const fw=st.fw.slice();
  fw[ci]=rank;
  let clues=st.clues;
  if(rank===5)clues=Math.min(8,clues+1);

  const d=drawAfterRemoval(st,hands,draws);
  const next={
    players:st.players,
    actor:st.actor,deckPos:d.deckPos,finalLeft:d.finalLeft,
    clues,fw,hands
  };
  return advanceAfterAction(st,next);
}
function transitionDiscard(st,code,draws){
  const hands=st.hands.map(h=>h);
  hands[st.actor]=removeOneSorted(hands[st.actor],code);
  const clues=Math.min(8,st.clues+1);
  const d=drawAfterRemoval(st,hands,draws);
  const next={
    players:st.players,
    actor:st.actor,deckPos:d.deckPos,finalLeft:d.finalLeft,
    clues,fw:st.fw,hands
  };
  return advanceAfterAction(st,next);
}
function transitionWait(st){
  const next={
    players:st.players,
    actor:st.actor,
    deckPos:st.deckPos,
    finalLeft:st.finalLeft,
    clues:st.clues-1,
    fw:st.fw,
    hands:st.hands
  };
  return advanceAfterAction(st,next);
}


function enumerateScorePreservingActions(st,suffix){
  const hc=handCounts(st);
  const hand=st.hands[st.actor];
  const plays=uniqueCodes(hand)
    .filter(code=>rankOf(code)===st.fw[colorOf(code)]+1)
    .map(code=>({type:"PLAY",code}));

  const discards=discardCandidates(st,suffix,hc);
  const obsolete=[];
  const future=[];
  for(const code of discards){
    const ci=colorOf(code),rank=rankOf(code);
    if(rank<=st.fw[ci])obsolete.push({type:"DISCARD",code});
    else future.push({type:"DISCARD",code});
  }
  const waits=canWait(st)?[{type:"WAIT"}]:[];
  return {plays,obsolete,future,waits,hc};
}

function transitionAction(st,a,draws){
  if(a.type==="PLAY")return transitionPlay(st,a.code,draws);
  if(a.type==="DISCARD")return transitionDiscard(st,a.code,draws);
  return transitionWait(st);
}

function compactPathAction(st,a,draws){
  return {
    type:a.type,
    actor:st.actor,
    card:a.code===undefined?null:{
      color:COLORS[colorOf(a.code)],
      number:rankOf(a.code)
    },
    scoreBefore:scoreFw(st.fw),
    cluesBefore:st.clues,
    deckRemaining:draws.length-st.deckPos,
    finalLeft:st.finalLeft
  };
}

function actorDistance(st,owner){
  return (owner-st.actor+st.players)%st.players;
}

function identityOwners(st,code){
  const out=[];
  for(let p=0;p<st.players;p++){
    if(st.hands[p].includes(code))out.push(p);
  }
  return out;
}

function firstFutureDrawOffset(draws,deckPos,code,limit=30){
  for(let i=deckPos;i<draws.length && i<deckPos+limit;i++){
    if(draws[i]===code)return i-deckPos;
  }
  return 999;
}

function stateBeamFeatures(st,draws,suffix){
  const score=scoreFw(st.fw);
  const deckRemaining=draws.length-st.deckPos;
  const actionsRemaining=st.finalLeft>=0 ? st.finalLeft : deckRemaining+st.players;
  const need=25-score;
  const slack=actionsRemaining-need;

  let playable=0;
  let playableSoon=0;
  let nextNeededInHands=0;
  let nextNeededSoon=0;
  let securedDistinct=0;
  let securedHigh=0;
  let futureUrgency=0;
  let blockedColors=0;
  let chainPairs=0;

  const present=new Uint8Array(25);
  for(const h of st.hands)for(const code of h)present[code]=1;

  for(let ci=0;ci<5;ci++){
    const level=st.fw[ci];
    if(level>=5)continue;
    const nextCode=ci*5+level;
    const owners=identityOwners(st,nextCode);
    if(owners.length){
      nextNeededInHands++;
      const bestDist=Math.min(...owners.map(o=>actorDistance(st,o)));
      nextNeededSoon+=Math.max(0,st.players-bestDist);
    }else{
      const off=firstFutureDrawOffset(draws,st.deckPos,nextCode,40);
      if(off===999)blockedColors++;
      else futureUrgency+=Math.max(0,20-off);
    }

    for(let r=level+1;r<=5;r++){
      const code=ci*5+(r-1);
      if(present[code]){
        securedDistinct++;
        if(r>=4)securedHigh++;
      }
    }
    if(level<4){
      const a=ci*5+level;
      const b=ci*5+level+1;
      if(present[a]&&present[b])chainPairs++;
    }
  }

  for(let p=0;p<st.players;p++){
    const dist=actorDistance(st,p);
    for(const code of st.hands[p]){
      if(rankOf(code)===st.fw[colorOf(code)]+1){
        playable++;
        playableSoon+=Math.max(0,st.players-dist);
      }
    }
  }

  return {
    score,deckRemaining,actionsRemaining,need,slack,
    playable,playableSoon,nextNeededInHands,nextNeededSoon,
    securedDistinct,securedHigh,futureUrgency,blockedColors,chainPairs
  };
}

function mix32(x){
  x=(x+0x9e3779b9)>>>0;
  x=Math.imul(x^(x>>>16),0x21f0aaad)>>>0;
  x=Math.imul(x^(x>>>15),0x735a2d97)>>>0;
  return (x^(x>>>15))>>>0;
}

function stateHash32(st,salt=0){
  const key=stateCoreKey(st)+`|${st.clues}`;
  let h=(2166136261^Number(salt||0))>>>0;
  for(let i=0;i<key.length;i++){
    h^=key.charCodeAt(i);
    h=Math.imul(h,16777619)>>>0;
  }
  return mix32(h);
}

function beamHeuristic(st,draws,suffix,variant=0,salt=0){
  const f=stateBeamFeatures(st,draws,suffix);

  // All variants share the same dominant objective: get points onto the table
  // while retaining enough physical action capacity to finish.
  let v=f.score*1_000_000;
  v+=Math.min(10,f.slack)*22_000;
  v+=f.nextNeededInHands*9_000;
  v+=f.nextNeededSoon*1_200;
  v+=f.playable*6_000;
  v+=f.playableSoon*700;
  v+=f.securedDistinct*1_000;
  v+=f.securedHigh*1_800;
  v+=f.chainPairs*2_200;
  v+=f.futureUrgency*80;
  v-=f.blockedColors*200_000;

  // Drawing through the deck is useful, but variants deliberately disagree on
  // how aggressively to consume it and how valuable clue flexibility is.
  const deckProgress=30-f.deckRemaining;
  if(variant===0){
    v+=deckProgress*650 + st.clues*300;
  }else if(variant===1){
    v+=deckProgress*950 + st.clues*120;
    v+=f.nextNeededSoon*700;
  }else if(variant===2){
    v+=deckProgress*350 + st.clues*650;
    v+=f.securedHigh*2_000;
  }else if(variant===3){
    v+=deckProgress*750 + st.clues*350;
    v+=f.chainPairs*3_000 + f.playableSoon*900;
  }else if(variant===4){
    v+=deckProgress*500 + st.clues*500;
    v+=f.securedDistinct*1_500 + f.nextNeededInHands*3_000;
  }else{
    v+=deckProgress*700 + st.clues*300;
  }

  // Tiny deterministic jitter only breaks otherwise similar states. It never
  // participates in any proof of impossibility.
  const jitter=(stateHash32(st,salt)%10000)/10000;
  v+=jitter*250;
  return v;
}

export function findOriginalFeasibilityBeam({
  players=5,
  seed=1,
  beamWidth=20_000,
  maxDepth=80,
  heuristicVariant=0,
  searchSalt=0,
  timeLimitMs=30_000
}={}){
  const {draws,initial}=buildInitialState(players,seed);
  const suffix=buildSuffix(draws);
  const started=performance.now();

  let beam=[{st:initial,path:[]}];
  let expanded=0;
  let generated=0;
  let deduped=0;
  let peakBeam=1;

  for(let depth=0;depth<maxDepth;depth++){
    const nextByCore=new Map();

    for(const node of beam){
      if(timeLimitMs>0 && performance.now()-started>=timeLimitMs){
        return {
          seed,players,status:"UNKNOWN",feasible:false,cutoff:true,
          finder:"beam",beamWidth,maxDepth,heuristicVariant,searchSalt,
          depth,expanded,generated,deduped,peakBeam,
          elapsedMs:performance.now()-started,path:null
        };
      }

      const st=node.st;
      if(scoreFw(st.fw)===25){
        return {
          seed,players,status:"FEASIBLE_25",feasible:true,cutoff:false,
          finder:"beam",beamWidth,maxDepth,heuristicVariant,searchSalt,
          depth,expanded,generated,deduped,peakBeam,
          elapsedMs:performance.now()-started,path:node.path
        };
      }
      if(st.finalLeft===0)continue;
      if(!remainingActionCapacity(st,draws.length))continue;

      const hc=handCounts(st);
      if(!availabilityPossible(st,suffix,hc))continue;

      const groups=enumerateScorePreservingActions(st,suffix);
      const actions=[
        ...groups.plays,
        ...groups.obsolete,
        ...groups.waits,
        ...groups.future
      ];
      expanded++;

      for(const a of actions){
        const ns=transitionAction(st,a,draws);
        generated++;

        if(!remainingActionCapacity(ns,draws.length))continue;
        const nhc=handCounts(ns);
        if(!availabilityPossible(ns,suffix,nhc))continue;

        const action=compactPathAction(st,a,draws);
        const path=[...node.path,action];

        if(scoreFw(ns.fw)===25){
          return {
            seed,players,status:"FEASIBLE_25",feasible:true,cutoff:false,
            finder:"beam",beamWidth,maxDepth,heuristicVariant,searchSalt,
            depth:depth+1,expanded,generated,deduped,peakBeam,
            elapsedMs:performance.now()-started,path
          };
        }

        const core=stateCoreKey(ns);
        const prev=nextByCore.get(core);
        if(prev && prev.st.clues>=ns.clues){
          deduped++;
          continue;
        }
        const priority=beamHeuristic(ns,draws,suffix,heuristicVariant,searchSalt);
        if(!prev || ns.clues>prev.st.clues || priority>prev.priority){
          nextByCore.set(core,{st:ns,path,priority});
        }
      }
    }

    if(!nextByCore.size){
      return {
        seed,players,status:"PROVEN_IMPOSSIBLE_WITHIN_BEAM_SPACE",
        feasible:false,cutoff:false,finder:"beam",
        beamWidth,maxDepth,heuristicVariant,searchSalt,
        depth:depth+1,expanded,generated,deduped,peakBeam,
        elapsedMs:performance.now()-started,path:null
      };
    }

    const all=[...nextByCore.values()];
    all.sort((a,b)=>b.priority-a.priority);
    beam=all.slice(0,beamWidth).map(x=>({st:x.st,path:x.path}));
    peakBeam=Math.max(peakBeam,beam.length);
  }

  return {
    seed,players,status:"UNKNOWN",feasible:false,cutoff:true,
    finder:"beam",beamWidth,maxDepth,heuristicVariant,searchSalt,
    depth:maxDepth,expanded,generated,deduped,peakBeam,
    elapsedMs:performance.now()-started,path:null
  };
}


function guidedStateValue(st,draws,suffix,variant=0){
  const f=stateBeamFeatures(st,draws,suffix);
  const deckProgress=30-f.deckRemaining;

  // Deliberately much flatter than beamHeuristic: a WAIT/DISCARD that routes
  // future draws correctly must be allowed to outrank an immediate PLAY.
  let v=f.score*3500;
  v+=Math.max(-5,Math.min(12,f.slack))*1200;
  v+=f.nextNeededInHands*1800;
  v+=f.nextNeededSoon*260;
  v+=f.playable*700;
  v+=f.playableSoon*120;
  v+=f.securedDistinct*260;
  v+=f.securedHigh*900;
  v+=f.chainPairs*750;
  v+=f.futureUrgency*30;
  v-=f.blockedColors*12000;

  if(variant===0){
    v+=deckProgress*240 + st.clues*150;
  }else if(variant===1){
    v+=deckProgress*500 + st.clues*40;
    v+=f.nextNeededSoon*220;
  }else if(variant===2){
    v+=deckProgress*100 + st.clues*420;
    v+=f.securedHigh*650;
  }else if(variant===3){
    v+=deckProgress*260 + st.clues*180;
    v+=f.chainPairs*950 + f.playableSoon*180;
  }else if(variant===4){
    v+=deckProgress*170 + st.clues*260;
    v+=f.securedDistinct*420 + f.nextNeededInHands*700;
  }else if(variant===5){
    // Strongly scheduling-oriented.
    v+=deckProgress*80 + st.clues*320;
    v+=f.nextNeededSoon*500 + f.chainPairs*1100;
  }else if(variant===6){
    // Strongly draw-through oriented.
    v+=deckProgress*750 + st.clues*20;
    v+=f.securedHigh*300;
  }
  return v;
}

function actionHashUnit(st,a,salt=0){
  const key=stateCoreKey(st);
  const x=a.type==="WAIT" ? 991 :
    a.type==="PLAY" ? 100+Number(a.code||0) :
    500+Number(a.code||0);
  let h=(2166136261 ^ Number(salt||0))>>>0;
  for(let i=0;i<key.length;i++){
    h^=key.charCodeAt(i);
    h=Math.imul(h,16777619)>>>0;
  }
  h^=x;
  h=Math.imul(h,16777619)>>>0;
  h=mix32(h);
  return h/4294967295;
}

function guidedActionScore(st,a,draws,suffix,variant=0,salt=0,noise=0.35){
  const ns=transitionAction(st,a,draws);
  let v=guidedStateValue(ns,draws,suffix,variant);

  // Direct action priors, intentionally small relative to the randomized
  // perturbation at high noise levels.
  if(a.type==="PLAY"){
    v+=900;
    if(rankOf(a.code)===5)v+=800;
  }else if(a.type==="WAIT"){
    v+=st.clues>=5 ? 180 : -250;
  }else{
    const ci=colorOf(a.code),rank=rankOf(a.code);
    if(rank<=st.fw[ci])v+=450;
    else v-=200;
  }

  // Scale noise to the useful score range of a single decision, not the whole
  // state's absolute value. Different noise bands explore from strongly guided
  // to nearly randomized orderings.
  const unit=actionHashUnit(st,a,salt)*2-1;
  v+=unit*Number(noise||0)*12000;
  return v;
}


class CompactDominanceTable {
  constructor(power=24, maxLoad=0.72){
    if(power<18 || power>26) throw new Error("compactTablePower deve essere 18..26");
    this.power=power;
    this.capacity=2**power;
    this.mask=this.capacity-1;
    this.maxEntries=Math.max(1,Math.floor(this.capacity*maxLoad));
    this.lo=new BigUint64Array(this.capacity);
    this.hi=new BigUint64Array(this.capacity);
    this.cluePlusOne=new Uint8Array(this.capacity);
    this.entries=0;
    this.resets=0;
    this.peakEntries=0;
    this.probes=0;
    this.hits=0;
    this.upgrades=0;
  }

  reset(){
    this.cluePlusOne.fill(0);
    this.entries=0;
    this.resets++;
  }

  encode(st){
    let key=0n;
    let shift=0n;
    for(let p=0;p<st.players;p++){
      const hand=st.hands[p];
      for(let i=0;i<4;i++){
        const v=i<hand.length ? Number(hand[i])+1 : 0;
        key|=BigInt(v)<<shift;
        shift+=5n;
      }
    }
    for(let ci=0;ci<5;ci++){
      key|=BigInt(Number(st.fw[ci]||0))<<shift;
      shift+=3n;
    }
    key|=BigInt(Number(st.actor||0))<<shift;
    shift+=3n;
    key|=BigInt(Number(st.deckPos||0))<<shift;
    shift+=5n;
    key|=BigInt(Number(st.finalLeft)+1)<<shift;
    const lo=BigInt.asUintN(64,key);
    const hi=BigInt.asUintN(64,key>>64n);
    return [lo,hi];
  }

  hash(lo,hi){
    let h=0x9e3779b9;
    h=Math.imul(h^(Number(lo&0xffffffffn)>>>0),0x85ebca6b);
    h=Math.imul(h^(Number((lo>>32n)&0xffffffffn)>>>0),0xc2b2ae35);
    h=Math.imul(h^(Number(hi&0xffffffffn)>>>0),0x27d4eb2f);
    h=Math.imul(h^(Number((hi>>32n)&0xffffffffn)>>>0),0x165667b1);
    h^=h>>>16;
    return h>>>0;
  }

  shouldPruneOrUpdate(st,clues){
    if(this.entries>=this.maxEntries)this.reset();

    const [lo,hi]=this.encode(st);
    let idx=this.hash(lo,hi)&this.mask;
    let step=1;
    for(;;){
      this.probes++;
      if(this.cluePlusOne[idx]===0){
        this.lo[idx]=lo;
        this.hi[idx]=hi;
        this.cluePlusOne[idx]=Number(clues)+1;
        this.entries++;
        if(this.entries>this.peakEntries)this.peakEntries=this.entries;
        return false;
      }

      if(this.lo[idx]===lo && this.hi[idx]===hi){
        this.hits++;
        const seen=this.cluePlusOne[idx]-1;
        if(seen>=clues)return true;
        this.cluePlusOne[idx]=Number(clues)+1;
        this.upgrades++;
        return false;
      }

      // Quadratic-ish probing avoids primary clustering while preserving exact
      // key comparison. No hash collision can create a false prune.
      idx=(idx+step)&this.mask;
      step++;
    }
  }
}

export function solveOriginalFeasibility({
  players=5,
  seed=1,
  maxNodes=5_000_000,
  timeLimitMs=5000,
  returnPath=false,
  searchMode="play-obsolete-wait-future",
  searchSalt=0,
  heuristicVariant=0,
  guidedNoise=0.35,
  maxDeadMemoStates=4_000_000,
  maxDominanceStates=4_000_000,
  compactTablePower=0,
  compactTableMaxLoad=0.72
}={}){
  if(players<2||players>5)throw new Error("players deve essere 2..5");
  const {draws,initial}=buildInitialState(players,seed);
  const suffix=buildSuffix(draws);
  const started=performance.now();

  let nodes=0;
  let memoHits=0;
  let dominancePrunes=0;
  let availabilityPrunes=0;
  let capacityPrunes=0;
  let noActionPrunes=0;
  let cutoff=false;
  let foundPath=null;

  // Core state -> greatest clue count already reached. More clues weakly
  // dominate fewer clues with identical physical state.
  const compactDominance=compactTablePower>0
    ? new CompactDominanceTable(compactTablePower,compactTableMaxLoad)
    : null;

  let maxCluesByCore=compactDominance?null:new Map();
  let deadMemo=compactDominance?null:new Set();
  let deadMemoResets=0;
  let dominanceResets=0;
  let peakDeadMemoStates=0;
  let peakDominanceStates=0;
  const path=[];

  function rememberDead(key){
    if(compactDominance)return;
    if(maxDeadMemoStates>0 && deadMemo.size>=maxDeadMemoStates){
      deadMemo=new Set();
      deadMemoResets++;
    }
    deadMemo.add(key);
    if(deadMemo.size>peakDeadMemoStates) peakDeadMemoStates=deadMemo.size;
  }

  function rememberDominance(key,clues){
    if(compactDominance)return;
    if(maxDominanceStates>0 && maxCluesByCore.size>=maxDominanceStates){
      maxCluesByCore=new Map();
      dominanceResets++;
    }
    maxCluesByCore.set(key,clues);
    if(maxCluesByCore.size>peakDominanceStates) peakDominanceStates=maxCluesByCore.size;
  }

  function overLimit(){
    if(maxNodes>0 && nodes>=maxNodes)return true;
    if(timeLimitMs>0 && performance.now()-started>=timeLimitMs)return true;
    return false;
  }

  function dfs(st){
    if(scoreFw(st.fw)===25){
      if(returnPath)foundPath=path.slice();
      return true;
    }
    if(st.finalLeft===0)return false;
    if(overLimit()){
      cutoff=true;
      return false;
    }
    nodes++;

    const fkey=compactDominance?null:fullStateKey(st);
    if(!compactDominance && deadMemo.has(fkey)){
      memoHits++;
      return false;
    }

    let core=null;
    if(compactDominance){
      if(compactDominance.shouldPruneOrUpdate(st,st.clues)){
        dominancePrunes++;
        return false;
      }
    }else{
      core=stateCoreKey(st);
      const seenClues=maxCluesByCore.get(core);
      if(seenClues!==undefined && seenClues>=st.clues){
        dominancePrunes++;
        return false;
      }
      rememberDominance(core,st.clues);
    }

    if(!remainingActionCapacity(st,draws.length)){
      capacityPrunes++;
      rememberDead(fkey);
      return false;
    }

    const hc=handCounts(st);
    if(!availabilityPossible(st,suffix,hc)){
      availabilityPrunes++;
      rememberDead(fkey);
      return false;
    }

    const hand=st.hands[st.actor];
    const plays=uniqueCodes(hand)
      .filter(code=>rankOf(code)===st.fw[colorOf(code)]+1)
      .sort((a,b)=>playPriority(st,b)-playPriority(st,a));

    const discards=discardCandidates(st,suffix,hc);

    // Search order is not a pruning rule: all legal score-preserving branches
    // are still explored if necessary.
    const obsoleteActions=[];
    const futureActions=[];
    for(const code of discards){
      const ci=colorOf(code),rank=rankOf(code);
      if(rank<=st.fw[ci])obsoleteActions.push({type:"DISCARD",code});
      else futureActions.push({type:"DISCARD",code});
    }
    const playActions=plays.map(code=>({type:"PLAY",code}));
    const waitActions=canWait(st)?[{type:"WAIT"}]:[];

    const modes={
      "play-obsolete-wait-future":[playActions,obsoleteActions,waitActions,futureActions],
      "play-wait-obsolete-future":[playActions,waitActions,obsoleteActions,futureActions],
      "wait-play-obsolete-future":[waitActions,playActions,obsoleteActions,futureActions],
      "play-future-wait-obsolete":[playActions,futureActions,waitActions,obsoleteActions],
      "obsolete-play-wait-future":[obsoleteActions,playActions,waitActions,futureActions],
      "play-wait-future-obsolete":[playActions,waitActions,futureActions,obsoleteActions]
    };
    let actions;
    if(searchMode==="hashed"){
      actions=[...playActions,...obsoleteActions,...waitActions,...futureActions];
      const coreHash=stateCoreKey(st);
      const hashAction=a=>{
        const x=a.type==="WAIT" ? 997 : (a.type==="PLAY"?100+a.code:500+a.code);
        let h=(2166136261 ^ Number(searchSalt||0))>>>0;
        for(let i=0;i<coreHash.length;i++){
          h^=coreHash.charCodeAt(i);
          h=Math.imul(h,16777619)>>>0;
        }
        h^=x; h=Math.imul(h,16777619)>>>0;
        return h;
      };
      actions.sort((a,b)=>hashAction(a)-hashAction(b));
    }else if(searchMode==="guided"){
      actions=[...playActions,...obsoleteActions,...waitActions,...futureActions];
      actions.sort((a,b)=>
        guidedActionScore(st,b,draws,suffix,heuristicVariant,searchSalt,guidedNoise)-
        guidedActionScore(st,a,draws,suffix,heuristicVariant,searchSalt,guidedNoise)
      );
    }else if(searchMode==="heuristic"){
      actions=[...playActions,...obsoleteActions,...waitActions,...futureActions];
      actions.sort((a,b)=>{
        const na=transitionAction(st,a,draws);
        const nb=transitionAction(st,b,draws);
        return beamHeuristic(nb,draws,suffix,heuristicVariant,searchSalt)-
               beamHeuristic(na,draws,suffix,heuristicVariant,searchSalt);
      });
    }else{
      const groups=modes[searchMode]||modes["play-obsolete-wait-future"];
      actions=groups.flat();
    }

    if(!actions.length){
      noActionPrunes++;
      rememberDead(fkey);
      return false;
    }

    for(const a of actions){
      if(overLimit()){
        cutoff=true;
        break;
      }
      let ns;
      if(a.type==="PLAY")ns=transitionPlay(st,a.code,draws);
      else if(a.type==="DISCARD")ns=transitionDiscard(st,a.code,draws);
      else ns=transitionWait(st);

      if(returnPath)path.push({
        type:a.type,
        actor:st.actor,
        card:a.code===undefined?null:{
          color:COLORS[colorOf(a.code)],
          number:rankOf(a.code)
        },
        scoreBefore:scoreFw(st.fw),
        cluesBefore:st.clues,
        deckRemaining:draws.length-st.deckPos,
        finalLeft:st.finalLeft
      });
      if(dfs(ns))return true;
      if(returnPath)path.pop();
      if(cutoff)break;
    }

    if(!cutoff)rememberDead(fkey);
    return false;
  }

  const feasible=dfs(initial);
  const elapsedMs=performance.now()-started;
  const status=feasible ? "FEASIBLE_25" : cutoff ? "UNKNOWN" : "PROVEN_IMPOSSIBLE_25";
  return {
    seed,players,status,feasible,
    provenImpossible:status==="PROVEN_IMPOSSIBLE_25",
    cutoff,
    nodes,memoHits,dominancePrunes,availabilityPrunes,capacityPrunes,noActionPrunes,
    memoStates:compactDominance?0:deadMemo.size,
    dominanceStates:compactDominance?compactDominance.entries:maxCluesByCore.size,
    deadMemoResets,
    dominanceResets:compactDominance?compactDominance.resets:dominanceResets,
    peakDeadMemoStates,
    peakDominanceStates:compactDominance?compactDominance.peakEntries:peakDominanceStates,
    compactDominance:Boolean(compactDominance),
    compactTablePower:compactDominance?compactDominance.power:0,
    compactTableCapacity:compactDominance?compactDominance.capacity:0,
    compactTableResets:compactDominance?compactDominance.resets:0,
    compactTableProbes:compactDominance?compactDominance.probes:0,
    compactTableHits:compactDominance?compactDominance.hits:0,
    compactTableUpgrades:compactDominance?compactDominance.upgrades:0,
    elapsedMs,
    path:foundPath
  };
}


export function solveOriginalFeasibilityPortfolio({
  players=5,
  seed=1,
  passMaxNodes=120_000,
  passTimeLimitMs=500,
  finalMaxNodes=5_000_000,
  finalTimeLimitMs=5000,
  returnPath=false
}={}){
  const modes=[
    "play-wait-obsolete-future",
    "obsolete-play-wait-future",
    "play-obsolete-wait-future",
    "wait-play-obsolete-future",
    "play-future-wait-obsolete",
    "play-wait-future-obsolete"
  ];

  const attempts=[];
  let totalNodes=0,totalMs=0;

  for(const mode of modes){
    const r=solveOriginalFeasibility({
      players,seed,
      maxNodes:passMaxNodes,
      timeLimitMs:passTimeLimitMs,
      returnPath,
      searchMode:mode
    });
    attempts.push({
      mode,status:r.status,nodes:r.nodes,elapsedMs:r.elapsedMs
    });
    totalNodes+=r.nodes; totalMs+=r.elapsedMs;
    if(r.feasible){
      return {
        ...r,
        portfolio:true,
        solvedByMode:mode,
        totalPortfolioNodes:totalNodes,
        totalPortfolioMs:totalMs,
        attempts
      };
    }
    if(r.provenImpossible){
      return {
        ...r,
        portfolio:true,
        solvedByMode:mode,
        totalPortfolioNodes:totalNodes,
        totalPortfolioMs:totalMs,
        attempts
      };
    }
  }

  // Deterministic hashed child orderings are cheap extra attempts to find
  // sparse solution branches without changing the exact state space.
  for(let salt=1;salt<=8;salt++){
    const r=solveOriginalFeasibility({
      players,seed,
      maxNodes:Math.max(20_000,Math.floor(passMaxNodes/2)),
      timeLimitMs:Math.max(100,Math.floor(passTimeLimitMs/2)),
      returnPath,
      searchMode:"hashed",
      searchSalt:salt
    });
    attempts.push({
      mode:`hashed-${salt}`,status:r.status,nodes:r.nodes,elapsedMs:r.elapsedMs
    });
    totalNodes+=r.nodes; totalMs+=r.elapsedMs;
    if(r.feasible){
      return {
        ...r,
        portfolio:true,
        solvedByMode:`hashed-${salt}`,
        totalPortfolioNodes:totalNodes,
        totalPortfolioMs:totalMs,
        attempts
      };
    }
    if(r.provenImpossible){
      return {
        ...r,
        portfolio:true,
        solvedByMode:`hashed-${salt}`,
        totalPortfolioNodes:totalNodes,
        totalPortfolioMs:totalMs,
        attempts
      };
    }
  }

  // One final exhaustive-oriented pass with the largest budget.
  const mode="play-wait-obsolete-future";
  const r=solveOriginalFeasibility({
    players,seed,
    maxNodes:finalMaxNodes,
    timeLimitMs:finalTimeLimitMs,
    returnPath,
    searchMode:mode
  });
  attempts.push({
    mode:`${mode}:final`,
    status:r.status,nodes:r.nodes,elapsedMs:r.elapsedMs
  });
  totalNodes+=r.nodes; totalMs+=r.elapsedMs;

  return {
    ...r,
    portfolio:true,
    solvedByMode:r.status==="UNKNOWN"?null:mode,
    totalPortfolioNodes:totalNodes,
    totalPortfolioMs:totalMs,
    attempts
  };
}
