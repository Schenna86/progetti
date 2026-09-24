import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://jhpppwqdaceratwjnbzi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocHBwd3FkYWNlcmF0d2puYnppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzNzcwOTIsImV4cCI6MjA4MDk1MzA5Mn0.0SL_piY3zI04UTogAPJxl5nlzmm3AFD5pTGPFKaqEyE";

const LEVELS_CACHE_KEY = "casino-levels:v1";
const LEVELS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const nf = new Intl.NumberFormat("it-IT");
const $ = (s) => document.querySelector(s);

const LINE_INDEXES = [
  [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
  [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
  [0,6,12,18,24], [4,8,12,16,20]
];

function fmt(v){ return nf.format(Number(v || 0)); }
function fmtChips(v){
  return window.CasinoFormat?.formatChips
    ? window.CasinoFormat.formatChips(v)
    : nf.format(Number(v || 0));
}
function fmtCompact(v){
  return window.CasinoFormat?.formatCompact
    ? window.CasinoFormat.formatCompact(v)
    : nf.format(Number(v || 0));
}
function mult(v){ return v == null ? "—" : `×${fmt(v)}`; }
function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function normalizeGrid(grid){
  return (Array.isArray(grid) ? grid : []).map(row =>
    (Array.isArray(row) ? row : []).map(v => Number(v ?? 0))
  );
}

function normalizeCards(cards){
  return (cards || []).map(c => ({
    ...c,
    id: c.id || null,
    card_no: Number(c.card_no),
    grid: normalizeGrid(c.grid),
    numbers: (c.numbers || []).map(Number),
    first_line_draw: c.first_line_draw == null ? null : Number(c.first_line_draw),
    lines_completed: c.lines_completed == null ? null : Number(c.lines_completed),
    multiplier: c.multiplier == null ? null : Number(c.multiplier),
    payout: c.payout == null ? null : Number(c.payout),
    marked: new Set()
  })).sort((a,b) => a.card_no - b.card_no);
}

function flatGrid(card){ return card.grid.flat(); }

function lineProgress(card){
  const flat = flatGrid(card);
  let completed = 0;
  let minMissing = 5;
  let incompleteLines = 0;
  const completedCells = new Set();

  for(const line of LINE_INDEXES){
    let missing = 0;
    for(const idx of line){
      const value = Number(flat[idx] || 0);
      if(value !== 0 && !card.marked.has(value)) missing++;
    }
    if(missing === 0){
      completed++;
      line.forEach(idx => completedCells.add(idx));
    }else{
      incompleteLines++;
      minMissing = Math.min(minMissing, missing);
    }
  }

  return {
    completed,
    minMissing: incompleteLines ? minMissing : 0,
    completedCells
  };
}

function currentVisibleMultiplier(card, drawIndex, drawLimit){
  if(card.first_line_draw == null) return null;
  if(card.first_line_draw > drawLimit) return null;
  if(drawIndex < card.first_line_draw) return null;
  return card.multiplier;
}

export async function initBingoBotPage(options){
  const variant = options.variant;
  const title = options.title || "AMERICAN BINGO";
  const subtitle = options.subtitle || "CLASSIC";
  const storageKey = options.storageKey || `casino-${variant}-active-v1`;
  const rtpLabel = options.rtpLabel || "RTP 97,50%";
  const scoringMode = options.scoringMode || "classic";
  const minWinningLines = Number(options.minWinningLines || (scoringMode === "lines" ? 2 : 1));
  const paytableUnit = options.paytableUnit || (scoringMode === "lines" ? "lines" : "draw");

  const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }
  );

  window.CasinoGameHeader?.init({ title, subtitle, homeUrl:"../index.html" });
  window.CasinoLevelUp?.init(supabase,{ balanceSelector:"#balanceValue", levelSelector:"#xpLevel" });

  let session = null;
  let config = null;
  let paytable = [];
  let levels = [];
  let animationTimer = null;
  let paused = false;

  let state = {
    roundId:null,
    requestId:null,
    cards:[],
    draws:[],
    drawIndex:0,
    activeCard:0,
    result:null,
    seedHash:null,
    seed:null,
    finalBalance:null
  };

  function status(text,bad=false){
    $("#status").textContent = text;
    $("#status").style.color = bad ? "var(--bad)" : "#ffd083";
  }
  function showLoading(text="Caricamento…"){
    $("#loadingText").textContent = text;
    $("#loadingError").textContent = "";
    $("#loadingOverlay").classList.remove("hidden");
  }
  function hideLoading(){ $("#loadingOverlay").classList.add("hidden"); }
  function fail(e){
    console.error(e);
    $("#loadingText").textContent = "Errore";
    $("#loadingError").textContent = e?.message || String(e);
    $("#loadingOverlay").classList.remove("hidden");
  }

  async function loadLevels(){
    try{
      const raw = localStorage.getItem(LEVELS_CACHE_KEY);
      if(raw){
        const cached = JSON.parse(raw);
        const age = Date.now() - Number(cached?.savedAt || 0);
        if(Array.isArray(cached?.levels) && cached.levels.length && age >= 0 && age < LEVELS_CACHE_TTL_MS){
          levels = cached.levels;
          return;
        }
      }
    }catch(e){ console.warn("Cache livelli:",e); }

    const {data,error} = await supabase.from("levels").select("level,xp_required").order("level");
    if(error) throw error;
    levels = data || [];
    try{
      localStorage.setItem(LEVELS_CACHE_KEY,JSON.stringify({savedAt:Date.now(),levels}));
    }catch(e){ console.warn("Cache livelli:",e); }
  }

  function updateXp(xp,lvl){
    xp = Number(xp || 0);
    lvl = Number(lvl || 1);
    $("#xpLevel").textContent = lvl;
    if(lvl >= 500){
      $("#xpFill").style.width = "100%";
      $("#xpText").textContent = `${fmtCompact(xp)} XP · MAX`;
      return;
    }
    const current = levels.find(x => Number(x.level) === lvl);
    const next = levels.find(x => Number(x.level) === lvl + 1);
    const currentXp = current ? Number(current.xp_required) : (lvl === 1 ? 0 : null);
    const nextXp = next ? Number(next.xp_required) : null;
    if(currentXp == null || nextXp == null){
      $("#xpText").textContent = `${fmtCompact(xp)} XP`;
      return;
    }
    const into = Math.max(0,xp-currentXp);
    const need = Math.max(1,nextXp-currentXp);
    $("#xpFill").style.width = `${Math.max(0,Math.min(100,into/need*100))}%`;
    $("#xpText").textContent = `${fmtCompact(into)} / ${fmtCompact(need)} XP`;
  }

  async function loadProfile(){
    const uid = session.user.id;
    const [{data:p,error:pe},{data:x,error:xe}] = await Promise.all([
      supabase.from("profiles").select("chips").eq("user_id",uid).single(),
      supabase.from("user_progression").select("xp,level").eq("user_id",uid).maybeSingle()
    ]);
    if(pe) throw pe;
    if(xe) throw xe;
    $("#balanceValue").textContent = fmtChips(p.chips);
    updateXp(x?.xp || 0,x?.level || 1);
  }

  async function checkLevelUp(){
    try{
      const r = await window.CasinoLevelUp?.check?.();
      if(r?.balance != null){
        state.finalBalance = Number(r.balance);
        $("#balanceValue").textContent = fmtChips(r.balance);
      }
      return r;
    }catch(e){
      console.error("Level-up:",e);
      return null;
    }
  }

  function paytableMultiplier(value){
    value = Number(value);
    const row = paytable.find(p => value >= Number(p.from) && value <= Number(p.to));
    return row ? Number(row.multiplier || 0) : 0;
  }

  function renderPaytable(){
    $("#rtpLabel").textContent = rtpLabel;
    $("#paytable").innerHTML = paytable.map(p => {
      const from = Number(p.from);
      const to = Number(p.to);
      let label;
      if(paytableUnit === "lines"){
        if(from === to) label = `${from} ${from === 1 ? "linea" : "linee"}`;
        else label = `${from}–${to} linee`;
      }else{
        label = from === to ? `${from}ª` : `${from}–${to}ª`;
      }
      return `<div class="payrow" data-from="${from}" data-to="${to}"><span>${label}</span><strong>${mult(p.multiplier)}</strong></div>`;
    }).join("");
  }

  function highlightPaytable(value){
    document.querySelectorAll(".payrow").forEach(el => {
      el.classList.toggle(
        "active",
        value >= Number(el.dataset.from) && value <= Number(el.dataset.to)
      );
    });
  }

  async function loadConfig(){
    const {data,error} = await supabase.rpc("get_bingo_bot_config",{p_variant:variant});
    if(error) throw error;
    config = data.game;
    paytable = data.paytable || [];
    $("#balanceValue").textContent = fmtChips(data.balance);

    const maxBet = config.max_bet == null ? Number.MAX_SAFE_INTEGER : Number(config.max_bet);
    const bets = (config.allowed_bets || []).map(Number).filter(v => v > 0 && v <= maxBet);
    $("#betSelect").innerHTML = bets.map(v => `<option value="${v}">${fmtChips(v)}</option>`).join("");

    const maxCards = Math.max(1,Number(config.max_cards || 50));
    $("#cardCountSelect").innerHTML = Array.from({length:maxCards},(_,i) =>
      `<option value="${i+1}"${i===0?" selected":""}>${i+1}</option>`
    ).join("");

    const maxBetText = Number.isFinite(maxBet) && maxBet < Number.MAX_SAFE_INTEGER
      ? ` · Max ${fmtChips(maxBet)} per cartella`
      : "";
    $("#gameLimits").textContent = `Max ${maxCards} cartelle${maxBetText}`;
    renderPaytable();
    updateControls();
  }

  function renderBoard(){
    const board = $("#board");
    board.innerHTML = "";
    for(let n=1;n<=75;n++){
      const el = document.createElement("div");
      el.className = "board-num";
      el.id = `bn-${n}`;
      el.textContent = n;
      board.appendChild(el);
    }
  }

  function renderCard(){
    const card = state.cards[state.activeCard];
    const root = $("#cardGrid");
    if(!card){
      root.innerHTML = Array.from({length:25},(_,i) =>
        `<div class="card-cell${i===12?" free":""}">${i===12?"FREE":""}</div>`
      ).join("");
      $("#activeCardLabel").textContent = "—";
      $("#coveredCount").textContent = "0/24";
      $("#linesInfo").textContent = "0/12";
      $("#nextLineInfo").textContent = "—";
      $("#cardPrizeInfo").textContent = "—";
      highlightPaytable(0);
      return;
    }

    $("#activeCardLabel").textContent = `${card.card_no}/${state.cards.length}`;
    const progress = lineProgress(card);
    const flat = flatGrid(card);
    root.innerHTML = "";

    flat.forEach((value,idx) => {
      const el = document.createElement("div");
      const isFree = Number(value) === 0;
      el.className = "card-cell" + (isFree ? " free marked" : "");
      el.textContent = isFree ? "FREE" : value;
      if(!isFree && card.marked.has(Number(value))) el.classList.add("marked");
      if(progress.completedCells.has(idx)) el.classList.add("linedone");
      root.appendChild(el);
    });

    $("#coveredCount").textContent = `${card.marked.size}/24`;
    $("#progressFill").style.width = `${Math.min(100,(state.drawIndex/Math.max(1,state.draws.length || Number(config?.draw_limit || 45)))*100)}%`;
    $("#linesInfo").textContent = `${progress.completed}/12`;

    if(scoringMode === "classic"){
      if(progress.completed > 0){
        const firstAt = card.first_line_draw && state.drawIndex >= card.first_line_draw
          ? ` alla ${card.first_line_draw}ª`
          : "";
        $("#nextLineInfo").textContent = `BINGO${firstAt}`;
      }else{
        $("#nextLineInfo").textContent = `Manca ${progress.minMissing} alla linea`;
      }

      const visibleMult = currentVisibleMultiplier(card,state.drawIndex,Number(config?.draw_limit || 45));
      if(visibleMult != null){
        $("#cardPrizeInfo").textContent = `${mult(visibleMult)} · ${fmtChips(card.payout)} fiche`;
      }else if(state.drawIndex >= Number(config?.draw_limit || 45) && card.first_line_draw > Number(config?.draw_limit || 45)){
        $("#cardPrizeInfo").textContent = "Nessun premio";
      }else{
        $("#cardPrizeInfo").textContent = "—";
      }
      highlightPaytable(state.drawIndex);
    }else{
      if(progress.completed >= 12){
        $("#nextLineInfo").textContent = "Tutte le 12 linee";
      }else if(progress.completed === minWinningLines - 1){
        $("#nextLineInfo").textContent = `🔥 ${progress.completed} ${progress.completed===1?"linea":"linee"} · una linea al premio`;
      }else if(progress.completed > 0){
        $("#nextLineInfo").textContent = `${progress.completed} ${progress.completed===1?"linea":"linee"} · manca ${progress.minMissing} alla prossima`;
      }else{
        $("#nextLineInfo").textContent = `Manca ${progress.minMissing} alla 1ª linea`;
      }

      const liveMult = paytableMultiplier(progress.completed);
      if(liveMult > 0){
        const livePayout = Math.floor(Number($("#betSelect").value || 0) * liveMult);
        $("#cardPrizeInfo").textContent = `${mult(liveMult)} · premio attuale ${fmtChips(livePayout)}`;
      }else{
        $("#cardPrizeInfo").textContent = `Premio da ${minWinningLines} linee`;
      }
      highlightPaytable(progress.completed);
    }
  }

  function renderTabs(){
    const root = $("#cardTabs");
    root.innerHTML = "";

    const drawLimit = Number(config?.draw_limit || 45);
    const ordered = state.cards
      .map((card,index) => ({card,index,progress:lineProgress(card)}))
      .sort((a,b) =>
        b.progress.completed - a.progress.completed ||
        a.progress.minMissing - b.progress.minMissing ||
        a.card.card_no - b.card.card_no
      );

    for(const {card,index,progress} of ordered){
      const btn = document.createElement("button");
      let visibleWin = false;
      let sub = "";

      if(scoringMode === "classic"){
        visibleWin = card.first_line_draw != null && card.first_line_draw <= state.drawIndex && card.first_line_draw <= drawLimit;
        if(visibleWin){
          sub = `Bingo ${card.first_line_draw}ª · ${mult(card.multiplier)}`;
        }else if(progress.completed > 0){
          sub = progress.completed === 1 ? "1 linea" : `${progress.completed} linee`;
        }else{
          sub = `${card.marked.size}/24 · manca ${progress.minMissing}`;
        }
      }else{
        const liveMult = paytableMultiplier(progress.completed);
        visibleWin = liveMult > 0;
        if(visibleWin){
          sub = `${progress.completed} linee · ${mult(liveMult)}`;
        }else if(progress.completed === minWinningLines - 1){
          sub = `🔥 ${progress.completed} ${progress.completed===1?"linea":"linee"} · una al premio`;
        }else if(progress.completed > 0){
          sub = `${progress.completed} ${progress.completed===1?"linea":"linee"} · manca ${progress.minMissing}`;
        }else{
          sub = `${card.marked.size}/24 · manca ${progress.minMissing}`;
        }
      }

      btn.className = "card-tab" + (index===state.activeCard?" active":"") + (visibleWin?" done":"");
      btn.innerHTML = `<b>Cartella ${card.card_no}</b><span>${esc(sub)}</span>`;
      btn.onclick = () => {
        state.activeCard = index;
        renderTabs();
        renderCard();
        persist();
      };
      root.appendChild(btn);
    }
  }

  function updateControls(){
    const bet = Number($("#betSelect").value || 0);
    const count = Number($("#cardCountSelect").value || 1);
    $("#totalBetValue").textContent = `${fmtChips(bet*count)} fiche`;
  }

  async function hashHex(text){
    const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,"0")).join("");
  }

  async function revealFairness(){
    if(!state.seed) return;
    $("#seedReveal").textContent = state.seed;
    $("#revealWrap").classList.remove("hidden");
    const ok = (await hashHex(state.seed)) === state.seedHash;
    $("#fairStatus").textContent = ok ? "✓ Hash verificato" : "⚠ Hash non corrispondente";
    $("#fairStatus").className = ok ? "ok" : "bad";
  }

  function resetVisual(){
    clearTimeout(animationTimer);
    paused = false;
    state = {
      roundId:null,requestId:null,cards:[],draws:[],drawIndex:0,activeCard:0,
      result:null,seedHash:null,seed:null,finalBalance:null
    };
    renderBoard();
    renderCard();
    renderTabs();
    $("#currentBall").textContent = "—";
    $("#drawCount").textContent = "0";
    $("#phaseText").textContent = "Pronto";
    $("#remainingText").textContent = `${Number(config?.draw_limit || 45)} estrazioni`;
    $("#seedHash").textContent = "—";
    $("#revealWrap").classList.add("hidden");
    $("#resultBox").classList.add("hidden");
    highlightPaytable(0);
  }

  function persist(){
    if(!state.roundId){
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey,JSON.stringify({
      roundId:state.roundId,
      requestId:state.requestId,
      cards:state.cards.map(c => ({...c,marked:[...c.marked]})),
      draws:state.draws,
      drawIndex:state.drawIndex,
      activeCard:state.activeCard,
      result:state.result,
      seedHash:state.seedHash,
      seed:state.seed,
      finalBalance:state.finalBalance,
      bet:$("#betSelect").value,
      count:$("#cardCountSelect").value
    }));
  }

  function applyDraw(n){
    for(const card of state.cards){
      if(card.numbers.includes(n)) card.marked.add(n);
    }
  }

  function restoreMarks(){
    for(const card of state.cards) card.marked = new Set();
    for(let i=0;i<state.drawIndex;i++) applyDraw(Number(state.draws[i]));
  }

  function renderDrawnBoard(){
    renderBoard();
    for(let i=0;i<state.drawIndex;i++) $("#bn-"+state.draws[i])?.classList.add("drawn");
    if(state.drawIndex){
      const n = state.draws[state.drawIndex-1];
      $("#bn-"+n)?.classList.add("last");
      $("#currentBall").textContent = n;
    }
  }

  function animateNext(){
    if(paused) return;
    if(state.drawIndex >= state.draws.length){
      completeAnimation();
      return;
    }

    document.querySelectorAll(".board-num.last").forEach(e => e.classList.remove("last"));
    const n = Number(state.draws[state.drawIndex++]);
    applyDraw(n);
    $("#bn-"+n)?.classList.add("drawn","last");
    $("#currentBall").textContent = n;
    $("#drawCount").textContent = `${state.drawIndex}/${state.draws.length}`;
    $("#remainingText").textContent = `${state.draws.length-state.drawIndex} rimaste`;
    highlightPaytable(state.drawIndex);

    if(scoringMode === "classic"){
      const bingoCards = state.cards.filter(c => lineProgress(c).completed > 0).length;
      $("#phaseText").textContent = bingoCards
        ? `${bingoCards} cartell${bingoCards===1?"a":"e"} con Bingo`
        : "Cerchiamo la prima linea";
    }else{
      const progresses = state.cards.map(c => lineProgress(c));
      const prizeCards = progresses.filter(p => paytableMultiplier(p.completed) > 0).length;
      const maxLines = progresses.reduce((m,p) => Math.max(m,p.completed),0);
      if(prizeCards > 0){
        $("#phaseText").textContent = `${prizeCards} cartell${prizeCards===1?"a":"e"} a premio · max ${maxLines} linee`;
      }else if(maxLines === minWinningLines - 1){
        $("#phaseText").textContent = `🔥 Una linea al premio`;
      }else{
        $("#phaseText").textContent = `Obiettivo: ${minWinningLines} linee`;
      }
    }

    renderTabs();
    renderCard();
    persist();
    animationTimer = setTimeout(animateNext,Math.max(50,Number($("#speedSelect").value) || 400));
  }

  async function finishRound(){
    const {data,error} = await supabase.rpc("finish_bingo_bot",{p_round_id:state.roundId});
    if(error) throw error;
    state.draws = (data.draws || []).map(Number);
    const results = normalizeCards(data.cards);
    const old = state.cards;
    state.cards = results.map(r => ({
      ...r,
      marked:old.find(x => x.card_no === r.card_no)?.marked || new Set()
    }));
    state.result = data;
    state.seed = data.fairness?.server_seed || null;
    state.finalBalance = data.balance;
    persist();
  }

  async function completeAnimation(){
    clearTimeout(animationTimer);
    animationTimer = null;
    $("#playBtn").disabled = false;
    $("#betSelect").disabled = false;
    $("#cardCountSelect").disabled = false;
    $("#pauseBtn").classList.add("hidden");
    $("#resumeBtn").classList.add("hidden");

    const d = state.result;
    const total = Number(d?.total_payout || 0);
    const stake = Number(d?.total_staked || 0);
    const net = Number(d?.net_result || 0);
    const drawLimit = Number(d?.draw_limit || config?.draw_limit || 45);
    const winning = state.cards.filter(c => Number(c.multiplier || 0) > 0);

    const box = $("#resultBox");
    box.className = "result " + (net >= 0 ? "win" : "loss");
    box.innerHTML = `
      <div class="result-main"><span>Risultato round</span><strong>${fmtChips(total)} fiche</strong></div>
      <div class="result-sub">Giocato ${fmtChips(stake)} · Netto ${net>=0?"+":""}${fmtChips(net)} · ${winning.length}/${state.cards.length} cartelle vincenti</div>
      <div class="cards-result">
        ${state.cards.map(c => {
          const won = Number(c.multiplier || 0) > 0;
          const resultText = scoringMode === "classic"
            ? (won ? `Bingo ${c.first_line_draw}ª` : `Nessuna linea entro ${drawLimit}`)
            : `${Number(c.lines_completed || 0)} ${Number(c.lines_completed || 0)===1?"linea":"linee"}`;
          return `<div class="card-result-row${won?" won":""}">
            <b>#${c.card_no}</b>
            <span>${resultText}</span>
            <strong>${won?mult(c.multiplier):"×0"}</strong>
            <span>${fmtChips(c.payout || 0)}</span>
          </div>`;
        }).join("")}
      </div>`;

    $("#balanceValue").textContent = fmtChips(state.finalBalance);
    $("#phaseText").textContent = "Round completato";
    $("#remainingText").textContent = "0 rimaste";
    renderTabs();
    renderCard();
    status(`Round completato · ${winning.length}/${state.cards.length} cartelle vincenti · ritorno ${fmtChips(total)} fiche`);
    await revealFairness();
    localStorage.removeItem(storageKey);
    state.roundId = null;
    state.requestId = null;

    try{
      const ch = new BroadcastChannel("slot-machine-sync");
      ch.postMessage({type:"balance-changed"});
      ch.close();
    }catch{}

    await checkLevelUp();
  }

  async function play(){
    const bet = Number($("#betSelect").value);
    const count = Number($("#cardCountSelect").value);
    if(!bet || !count) return;

    $("#playBtn").disabled = true;
    $("#betSelect").disabled = true;
    $("#cardCountSelect").disabled = true;
    showLoading("Creo le cartelle Bingo…");

    try{
      const requestId = crypto.randomUUID();
      const {data,error} = await supabase.rpc("start_bingo_bot",{
        p_variant:variant,
        p_card_price:bet,
        p_card_count:count,
        p_request_id:requestId
      });
      if(error) throw error;

      resetVisual();
      state.roundId = data.round_id;
      state.requestId = data.request_id || requestId;
      state.cards = normalizeCards(data.cards);
      state.seedHash = data.seed_hash;
      $("#seedHash").textContent = state.seedHash || "—";
      $("#balanceValue").textContent = fmtChips(data.balance);
      if(data.xp) updateXp(data.xp.total,data.xp.new_level);
      renderTabs();
      renderCard();
      persist();
      status("Round creato · risultato bloccato sul server");

      await finishRound();
      hideLoading();
      $("#pauseBtn").classList.remove("hidden");
      status("Estrazione in corso…");
      animateNext();
    }catch(e){
      $("#playBtn").disabled = false;
      $("#betSelect").disabled = false;
      $("#cardCountSelect").disabled = false;
      hideLoading();
      status(e?.message || String(e),true);
      console.error(e);
    }
  }

  async function restore(){
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem(storageKey) || "null"); }catch{}
    if(!saved?.roundId) return;

    state.roundId = saved.roundId;
    state.requestId = saved.requestId;
    state.cards = normalizeCards(saved.cards || []);
    state.draws = (saved.draws || []).map(Number);
    state.drawIndex = Number(saved.drawIndex || 0);
    state.activeCard = Math.min(Number(saved.activeCard || 0),Math.max(0,state.cards.length-1));
    state.result = saved.result;
    state.seedHash = saved.seedHash;
    state.seed = saved.seed;
    state.finalBalance = saved.finalBalance;

    if(saved.bet && [...$("#betSelect").options].some(o => o.value === String(saved.bet))) $("#betSelect").value = saved.bet;
    if(saved.count && [...$("#cardCountSelect").options].some(o => o.value === String(saved.count))) $("#cardCountSelect").value = saved.count;

    restoreMarks();
    renderDrawnBoard();
    renderTabs();
    renderCard();
    $("#seedHash").textContent = state.seedHash || "—";
    $("#drawCount").textContent = `${state.drawIndex}/${state.draws.length || Number(config?.draw_limit || 45)}`;
    updateControls();

    $("#playBtn").disabled = true;
    $("#betSelect").disabled = true;
    $("#cardCountSelect").disabled = true;

    if(!state.result){
      showLoading("Ripristino round…");
      await finishRound();
      hideLoading();
    }

    if(state.drawIndex >= state.draws.length){
      await completeAnimation();
    }else{
      $("#pauseBtn").classList.remove("hidden");
      status(`Partita ripristinata dalla ${state.drawIndex+1}ª estrazione`);
      animateNext();
    }
  }

  async function init(){
    const {data:{session:s}} = await supabase.auth.getSession();
    session = s;
    if(!session){
      location.href = "../index.html";
      return;
    }

    await Promise.all([loadLevels(),loadProfile(),loadConfig()]);
    resetVisual();
    updateControls();
    await restore();
    hideLoading();
    if(!state.roundId) await checkLevelUp();
  }

  $("#betSelect").addEventListener("change",updateControls);
  $("#cardCountSelect").addEventListener("change",updateControls);
  $("#playBtn").addEventListener("click",play);
  $("#pauseBtn").addEventListener("click",() => {
    paused = true;
    clearTimeout(animationTimer);
    $("#pauseBtn").classList.add("hidden");
    $("#resumeBtn").classList.remove("hidden");
    status("Estrazione in pausa");
  });
  $("#resumeBtn").addEventListener("click",() => {
    paused = false;
    $("#resumeBtn").classList.add("hidden");
    $("#pauseBtn").classList.remove("hidden");
    status("Estrazione ripresa");
    animateNext();
  });

  window.addEventListener("beforeunload",persist);
  renderBoard();
  renderCard();
  init().catch(fail);
}


function parseIsoDate(v){
  return v ? new Date(v) : null;
}
function countdownText(target, nowValue){
  const targetDate = parseIsoDate(target);
  const nowDate = parseIsoDate(nowValue) || new Date();
  if(!targetDate) return '—';
  let diff = Math.max(0, targetDate.getTime() - nowDate.getTime());
  const s = Math.floor(diff / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if(h > 0) return `${h}h ${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function formatDateTime(v){
  if(!v) return '—';
  try{
    return new Intl.DateTimeFormat('it-IT',{
      day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'
    }).format(new Date(v));
  }catch{ return String(v); }
}
function numberLetter(n){
  n = Number(n);
  if(n >= 1 && n <= 15) return 'B';
  if(n <= 30) return 'I';
  if(n <= 45) return 'N';
  if(n <= 60) return 'G';
  return 'O';
}
function normalizePvpCards(cards){
  return (cards || []).map(c => ({
    id: c.id || null,
    card_no: Number(c.card_no || 0),
    grid: normalizeGrid(c.card || c.grid || []),
    marked: new Set(),
    line_win: !!c.line_win,
    three_lines_win: !!c.three_lines_win,
    blackout_win: !!c.blackout_win,
    lines: Number(c.lines || 0)
  })).sort((a,b) => a.card_no - b.card_no);
}

export async function initBingoPvpPage(options={}){
  const title = options.title || 'AMERICAN BINGO';
  const subtitle = options.subtitle || 'PVP';
  const roomStorageKey = options.roomStorageKey || 'casino-bingo-pvp-room-v1';
  const focusStorageKey = options.focusStorageKey || 'casino-bingo-pvp-focus-v1';
  const activeCardStorageKey = options.activeCardStorageKey || 'casino-bingo-pvp-active-card-v1';

  const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }
  );

  window.CasinoGameHeader?.init({ title, subtitle, homeUrl:'../index.html' });
  window.CasinoLevelUp?.init(supabase,{ balanceSelector:'#balanceValue', levelSelector:'#xpLevel' });

  let session = null;
  let levels = [];
  let rooms = [];
  let current = null;
  let selectedRoomId = localStorage.getItem(roomStorageKey) || null;
  let focusRoundId = localStorage.getItem(focusStorageKey) || null;
  let activeCardIndex = Number(localStorage.getItem(activeCardStorageKey) || 0);
  let pollTimer = null;
  let clockTimer = null;
  let lastNotifiedXpRound = null;
  let loadingRoom = false;

  function status(text,bad=false){
    $('#status').textContent = text;
    $('#status').style.color = bad ? 'var(--bad)' : '#ffd083';
  }
  function showLoading(text='Caricamento…'){
    $('#loadingText').textContent = text;
    $('#loadingError').textContent = '';
    $('#loadingOverlay').classList.remove('hidden');
  }
  function hideLoading(){ $('#loadingOverlay').classList.add('hidden'); }
  function fail(e){
    console.error(e);
    $('#loadingText').textContent = 'Errore';
    $('#loadingError').textContent = e?.message || String(e);
    $('#loadingOverlay').classList.remove('hidden');
  }

  async function loadLevels(){
    try{
      const raw = localStorage.getItem(LEVELS_CACHE_KEY);
      if(raw){
        const cached = JSON.parse(raw);
        const age = Date.now() - Number(cached?.savedAt || 0);
        if(Array.isArray(cached?.levels) && cached.levels.length && age >= 0 && age < LEVELS_CACHE_TTL_MS){
          levels = cached.levels;
          return;
        }
      }
    }catch(e){ console.warn('Cache livelli:', e); }
    const {data,error} = await supabase.from('levels').select('level,xp_required').order('level');
    if(error) throw error;
    levels = data || [];
    try{ localStorage.setItem(LEVELS_CACHE_KEY, JSON.stringify({savedAt:Date.now(), levels})); }catch{}
  }
  function updateXp(xp,lvl){
    xp = Number(xp || 0);
    lvl = Number(lvl || 1);
    $('#xpLevel').textContent = lvl;
    if(lvl >= 500){
      $('#xpFill').style.width = '100%';
      $('#xpText').textContent = `${fmtCompact(xp)} XP · MAX`;
      return;
    }
    const currentLevel = levels.find(x => Number(x.level) === lvl);
    const next = levels.find(x => Number(x.level) === lvl + 1);
    const currentXp = currentLevel ? Number(currentLevel.xp_required) : (lvl === 1 ? 0 : null);
    const nextXp = next ? Number(next.xp_required) : null;
    if(currentXp == null || nextXp == null){
      $('#xpText').textContent = `${fmtCompact(xp)} XP`;
      return;
    }
    const into = Math.max(0, xp - currentXp);
    const need = Math.max(1, nextXp - currentXp);
    $('#xpFill').style.width = `${Math.max(0,Math.min(100,into/need*100))}%`;
    $('#xpText').textContent = `${fmtCompact(into)} / ${fmtCompact(need)} XP`;
  }
  async function loadProfile(){
    const uid = session.user.id;
    const [{data:p,error:pe},{data:x,error:xe}] = await Promise.all([
      supabase.from('profiles').select('chips').eq('user_id',uid).single(),
      supabase.from('user_progression').select('xp,level').eq('user_id',uid).maybeSingle()
    ]);
    if(pe) throw pe;
    if(xe) throw xe;
    $('#balanceValue').textContent = fmtChips(p.chips);
    updateXp(x?.xp || 0, x?.level || 1);
  }

  function persist(){
    if(selectedRoomId) localStorage.setItem(roomStorageKey, selectedRoomId);
    else localStorage.removeItem(roomStorageKey);
    if(focusRoundId) localStorage.setItem(focusStorageKey, focusRoundId);
    else localStorage.removeItem(focusStorageKey);
    localStorage.setItem(activeCardStorageKey, String(activeCardIndex || 0));
  }

  function restorePvpMarks(cards, draws){
    for(const card of cards){
      card.marked = new Set();
      const nums = flatGrid(card).filter(v => Number(v) !== 0);
      for(const n of draws){ if(nums.includes(Number(n))) card.marked.add(Number(n)); }
    }
  }

  async function refreshLobby(){
    const {data,error} = await supabase.rpc('get_bingo_pvp_lobby');
    if(error) throw error;
    rooms = data?.rooms || [];
    if(!selectedRoomId || !rooms.some(r => r.id === selectedRoomId)) selectedRoomId = rooms[0]?.id || null;
    renderRoomList();
  }

  function selectedRoom(){ return rooms.find(r => r.id === selectedRoomId) || null; }

  async function fetchSelectedState(){
    if(!selectedRoomId) return null;

    // Always advance the room first, so scheduled/running rounds progress server-side.
    const {data:advanced,error:advError} = await supabase.rpc('advance_bingo_pvp_room',{ p_room_id:selectedRoomId });
    if(advError) throw advError;

    if(focusRoundId){
      const {data,error} = await supabase.rpc('get_bingo_pvp_round_state',{ p_round_id:focusRoundId });
      if(!error && data){
        return data;
      }
      focusRoundId = null;
      persist();
    }

    return advanced;
  }

  async function loadSelectedRoom(forceLoading=false){
    if(!selectedRoomId || loadingRoom) return;
    loadingRoom = true;
    if(forceLoading) showLoading('Aggiorno sala Bingo PvP…');
    try{
      await refreshLobby();
      const data = await fetchSelectedState();
      current = data ? {
        ...data,
        draws:(data.draws || []).map(x => Number(x.number ?? x)),
        drawObjects:(data.draws || []).map(x => ({ draw_no:Number(x.draw_no), number:Number(x.number), drawn_at:x.drawn_at })),
        my_cards: normalizePvpCards(data.my_cards || [])
      } : null;
      if(current){
        if(current.balance != null) $('#balanceValue').textContent = fmtChips(current.balance);
        if(current.round_id) focusRoundId = current.round_id;
        else focusRoundId = null;
      }
      renderCurrent();
      if(current?.round_id && current?.my_card_count > 0 && (current.status === 'running' || current.status === 'completed') && lastNotifiedXpRound !== current.round_id){
        lastNotifiedXpRound = current.round_id;
        try{ await window.CasinoLevelUp?.check?.(); }catch(e){ console.warn('Level-up pvp:', e); }
        try{ await loadProfile(); }catch(e){ console.warn('Profile refresh:', e); }
      }
      persist();
      schedulePoll();
    }catch(e){
      console.error(e);
      status(e?.message || String(e), true);
      if(forceLoading) fail(e);
    }finally{
      loadingRoom = false;
      if(forceLoading) hideLoading();
    }
  }

  function schedulePoll(){
    clearTimeout(pollTimer);
    let delay = 2500;
    if(current?.status === 'scheduled') delay = 1000;
    else if(current?.status === 'running') delay = 800;
    else if(current?.status === 'completed') delay = 3500;
    pollTimer = setTimeout(() => loadSelectedRoom(false), delay);
  }

  function renderRoomList(){
    const root = $('#roomList');
    if(!root) return;
    root.innerHTML = '';
    for(const room of rooms){
      const joinable = room.joinable_round || {};
      const active = room.active_round || null;
      const selected = room.id === selectedRoomId;
      const players = Number(joinable.players || 0);
      const cards = Number(joinable.cards || 0);
      const my = Number(room.my_cards_next_round || 0);
      const btn = document.createElement('button');
      btn.className = 'room-card' + (selected ? ' active' : '');
      btn.innerHTML = `
        <div class="room-top"><strong>${esc(room.name)}</strong><span>${fmtChips(room.card_price)}</span></div>
        <div class="room-mid">
          <span>Prossimo: ${players} giocat. · ${cards} cart.</span>
          <span>I miei: ${my}</span>
        </div>
        <div class="room-bot">
          <span>LINE ${fmtChips(joinable.line_pool || 0)}</span>
          <span>3L ${fmtChips(joinable.three_lines_pool || 0)}</span>
          <span>BO ${fmtChips(joinable.blackout_pool || 0)}</span>
        </div>
        <div class="room-foot">${active ? `IN CORSO · ${Number(active.draw_count || 0)} palline` : `Start ${countdownText(joinable.scheduled_start_at, new Date().toISOString())}`}</div>`;
      btn.onclick = () => {
        if(selectedRoomId !== room.id){
          selectedRoomId = room.id;
          focusRoundId = null;
          activeCardIndex = 0;
          persist();
          renderRoomList();
          loadSelectedRoom(true);
        }
      };
      root.appendChild(btn);
    }
  }

  function updateRoomControls(){
    const room = selectedRoom();
    const price = Number(room?.card_price || 0);
    const qty = Number($('#cardCountSelect').value || 1);
    $('#selectedRoomName').textContent = room?.name || '—';
    $('#selectedRoomPrice').textContent = price ? fmtChips(price) : '—';
    $('#selectedRoomLimit').textContent = room ? `Max ${room.max_cards_per_user} cartelle` : '—';
    $('#totalBetValue').textContent = `${fmtChips(price * qty)} fiche`;
  }

  function renderBoard(draws){
    const root = $('#board');
    root.innerHTML = '';
    const last = draws.length ? Number(draws[draws.length - 1]) : null;
    for(let n=1;n<=75;n++){
      const el = document.createElement('div');
      const letter = numberLetter(n);
      el.className = 'board-num';
      if(draws.includes(n)) el.classList.add('drawn');
      if(last === n) el.classList.add('last');
      el.innerHTML = `<small>${letter}</small><span>${n}</span>`;
      root.appendChild(el);
    }
    $('#currentBall').textContent = last ? `${numberLetter(last)}-${last}` : '—';
  }

  function currentCardEntries(){
    const cards = current?.my_cards || [];
    const ordered = cards.map((card,index) => ({card,index,progress:lineProgress(card)}))
      .sort((a,b) =>
        b.progress.completed - a.progress.completed ||
        a.progress.minMissing - b.progress.minMissing ||
        (b.card.blackout_win?1:0) - (a.card.blackout_win?1:0) ||
        (b.card.three_lines_win?1:0) - (a.card.three_lines_win?1:0) ||
        (b.card.line_win?1:0) - (a.card.line_win?1:0) ||
        a.card.card_no - b.card.card_no
      );
    return ordered;
  }

  function renderCardTabs(){
    const root = $('#cardTabs');
    root.innerHTML = '';
    const entries = currentCardEntries();
    if(activeCardIndex >= entries.length) activeCardIndex = 0;
    entries.forEach((entry,orderIndex) => {
      const {card,index,progress} = entry;
      const wins = [card.line_win ? 'LINE' : null, card.three_lines_win ? '3L' : null, card.blackout_win ? 'BO' : null].filter(Boolean).join(' · ');
      const sub = wins || (progress.completed > 0 ? `${progress.completed} ${progress.completed===1?'linea':'linee'} · manca ${progress.minMissing}` : `0 linee · manca ${progress.minMissing}`);
      const btn = document.createElement('button');
      btn.className = 'card-tab' + (orderIndex===activeCardIndex ? ' active' : '') + (wins ? ' done' : '');
      btn.innerHTML = `<b>Cartella ${card.card_no}</b><span>${esc(sub)}</span>`;
      btn.onclick = () => {
        activeCardIndex = orderIndex;
        persist();
        renderCardTabs();
        renderCard();
      };
      root.appendChild(btn);
    });
  }

  function activeCardEntry(){
    const entries = currentCardEntries();
    return entries[activeCardIndex] || null;
  }

  function renderCard(){
    const root = $('#cardGrid');
    const entry = activeCardEntry();
    if(!entry){
      root.innerHTML = Array.from({length:25},(_,i) => `<div class="card-cell${i===12?' free':''}">${i===12?'FREE':''}</div>`).join('');
      $('#activeCardLabel').textContent = '—';
      $('#coveredCount').textContent = '0/24';
      $('#linesInfo').textContent = '0/12';
      $('#nextLineInfo').textContent = '—';
      $('#cardPrizeInfo').textContent = '—';
      return;
    }
    const {card,progress} = entry;
    $('#activeCardLabel').textContent = `${card.card_no}/${current.my_cards.length}`;
    $('#coveredCount').textContent = `${card.marked.size}/24`;
    $('#linesInfo').textContent = `${progress.completed}/12`;

    const statusBits = [];
    if(card.line_win) statusBits.push('🏁 LINE vinta');
    if(card.three_lines_win) statusBits.push('🏆 3 LINES vinte');
    if(card.blackout_win) statusBits.push('🎉 BLACKOUT');
    $('#cardPrizeInfo').textContent = statusBits.length ? statusBits.join(' · ') : 'Nessun premio ancora';

    if(card.blackout_win) $('#nextLineInfo').textContent = 'Cartella completata';
    else if(progress.completed >= 3) $('#nextLineInfo').textContent = `🔥 ${progress.completed} linee · vicina al BLACKOUT`;
    else if(progress.completed > 0) $('#nextLineInfo').textContent = `${progress.completed} ${progress.completed===1?'linea':'linee'} · manca ${progress.minMissing}`;
    else $('#nextLineInfo').textContent = `Manca ${progress.minMissing} alla linea`;

    const flat = flatGrid(card);
    root.innerHTML = '';
    flat.forEach((value,idx) => {
      const isFree = Number(value) === 0;
      const el = document.createElement('div');
      el.className = 'card-cell' + (isFree ? ' free marked' : '');
      el.textContent = isFree ? 'FREE' : value;
      if(!isFree && card.marked.has(Number(value))) el.classList.add('marked');
      if(progress.completedCells.has(idx)) el.classList.add('linedone');
      root.appendChild(el);
    });
  }

  function renderWinners(){
    const root = $('#winnersList');
    const winners = current?.winners || [];
    if(!winners.length){
      root.innerHTML = '<div class="winner-empty">Nessun premio assegnato finora.</div>';
      return;
    }
    root.innerHTML = winners.map(w => `
      <div class="winner-row">
        <div><b>${esc(w.username || 'Giocatore')}</b><span>${w.prize_type === 'line' ? 'LINE' : w.prize_type === 'three_lines' ? '3 LINES' : 'BLACKOUT'} · ${w.cards_won} cart.</span></div>
        <div style="text-align:right"><strong>${fmtChips(w.amount)}</strong><span>${w.draw_no}ª pallina</span></div>
      </div>`).join('');
  }

  function renderCurrent(){
    updateRoomControls();
    const room = selectedRoom();
    const data = current;
    const draws = data?.draws || [];
    if(data?.my_cards) restorePvpMarks(data.my_cards, draws);

    $('#roomSummary').textContent = room ? `${room.name} · ${fmtChips(room.card_price)} a cartella` : 'Seleziona una stanza';
    $('#drawCount').textContent = data ? `${draws.length}/75` : '0/75';
    $('#progressFill').style.width = `${Math.max(0,Math.min(100,(draws.length/75)*100))}%`;
    $('#playersStat').textContent = data ? String(data.total_players || 0) : '0';
    $('#cardsStat').textContent = data ? String(data.total_cards || 0) : '0';
    $('#myCardsStat').textContent = data ? String(data.my_card_count || 0) : '0';
    $('#mySpentStat').textContent = data ? fmtChips(data.my_spent || 0) : fmtChips(0);
    $('#linePool').textContent = fmtChips(data?.line_pool || 0);
    $('#threeLinesPool').textContent = fmtChips(data?.three_lines_pool || 0);
    $('#blackoutPool').textContent = fmtChips(data?.blackout_pool || 0);
    $('#houseAmount').textContent = fmtChips(data?.house_amount || 0);

    let phase = 'Sala pronta';
    let detail = 'Acquista cartelle per entrare nel prossimo round';
    if(data){
      if(data.status === 'idle'){
        phase = 'In attesa del prossimo round';
        detail = `Partenza tra ${countdownText(data.scheduled_start_at, data.server_now)}`;
      }else if(data.status === 'scheduled'){
        phase = 'Round programmato';
        detail = `Start tra ${countdownText(data.scheduled_start_at, data.server_now)} · acquisti fino a ${countdownText(data.purchase_close_at, data.server_now)}`;
      }else if(data.status === 'running'){
        phase = 'Round in corso';
        detail = data.next_draw_at ? `Prossima pallina tra ${countdownText(data.next_draw_at, data.server_now)}` : 'Estrazione in corso';
      }else if(data.status === 'completed'){
        phase = 'Round completato';
        detail = `Concluso il ${formatDateTime(data.finished_at)}`;
      }else if(data.status === 'cancelled'){
        phase = 'Round annullato';
        detail = data.cancel_reason || 'Annullato';
      }
    }
    $('#phaseText').textContent = phase;
    $('#remainingText').textContent = detail;

    const last = draws.length ? Number(draws[draws.length - 1]) : null;
    $('#lastBallCaption').textContent = last ? `${numberLetter(last)}-${last}` : '—';
    renderBoard(draws);
    renderCardTabs();
    renderCard();
    renderWinners();

    if(data?.round_id){
      const extra = focusRoundId && focusRoundId === data.round_id && data.status === 'scheduled' && (room?.active_round?.round_id && room.active_round.round_id !== data.round_id)
        ? ' · stai guardando il tuo prossimo round' : '';
      status(`${phase} · ${data.total_players || 0} giocatori · ${data.total_cards || 0} cartelle${extra}`);
    }else{
      status('Nessun round attivo: puoi acquistare cartelle per il prossimo giro.');
    }
  }

  async function buyCards(){
    const room = selectedRoom();
    if(!room) return;
    const quantity = Number($('#cardCountSelect').value || 1);
    if(quantity < 1 || quantity > 50) return;
    $('#buyBtn').disabled = true;
    showLoading('Acquisto cartelle Bingo PvP…');
    try{
      const requestId = crypto.randomUUID();
      const {data,error} = await supabase.rpc('buy_bingo_pvp_cards',{
        p_room_id: room.id,
        p_quantity: quantity,
        p_request_id: requestId
      });
      if(error) throw error;
      focusRoundId = data.round_id || null;
      activeCardIndex = 0;
      if(data.balance != null) $('#balanceValue').textContent = fmtChips(data.balance);
      persist();
      await loadSelectedRoom(false);
      status(`Acquistate ${quantity} cartell${quantity===1?'a':'e'} in ${room.name}${data.xp_pending_until_round_start ? ' · XP assegnati alla partenza del round' : ''}`);
    }catch(e){
      console.error(e);
      status(e?.message || String(e), true);
    }finally{
      $('#buyBtn').disabled = false;
      hideLoading();
    }
  }

  function tickClock(){
    if(current) renderCurrent();
  }

  async function init(){
    const {data:{session:s}} = await supabase.auth.getSession();
    session = s;
    if(!session){
      location.href = '../index.html';
      return;
    }

    await Promise.all([loadLevels(), loadProfile(), refreshLobby()]);
    const maxCards = Math.max(...rooms.map(r => Number(r.max_cards_per_user || 50)), 50);
    $('#cardCountSelect').innerHTML = Array.from({length:maxCards}, (_,i) => `<option value="${i+1}">${i+1}</option>`).join('');
    $('#cardCountSelect').value = '1';
    updateRoomControls();
    renderRoomList();
    renderBoard([]);
    renderCard();
    renderWinners();
    await loadSelectedRoom(true);
    clockTimer = setInterval(tickClock, 1000);
    hideLoading();
  }

  $('#cardCountSelect').addEventListener('change', updateRoomControls);
  $('#buyBtn').addEventListener('click', buyCards);
  $('#refreshBtn').addEventListener('click', () => loadSelectedRoom(true));
  $('#showCurrentRoomBtn').addEventListener('click', () => { focusRoundId = null; persist(); loadSelectedRoom(true); });
  window.addEventListener('beforeunload', () => { persist(); clearTimeout(pollTimer); if(clockTimer) clearInterval(clockTimer); });
  init().catch(fail);
}
