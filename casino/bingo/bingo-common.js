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
      minMissing = Math.min(minMissing, missing);
    }
  }

  return {
    completed,
    minMissing: completed > 0 ? 0 : minMissing,
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

  function renderPaytable(){
    $("#rtpLabel").textContent = rtpLabel;
    $("#paytable").innerHTML = paytable.map(p => {
      const from = Number(p.from);
      const to = Number(p.to);
      const label = from === to ? `${from}ª` : `${from}–${to}ª`;
      return `<div class="payrow" data-from="${from}" data-to="${to}"><span>${label}</span><strong>${mult(p.multiplier)}</strong></div>`;
    }).join("");
  }

  function highlightPaytable(drawNo){
    document.querySelectorAll(".payrow").forEach(el => {
      el.classList.toggle(
        "active",
        drawNo >= Number(el.dataset.from) && drawNo <= Number(el.dataset.to)
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
    $("#progressFill").style.width = `${Math.min(100,(card.marked.size/24)*100)}%`;
    $("#linesInfo").textContent = `${progress.completed}/12`;

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
      const visibleWin = card.first_line_draw != null && card.first_line_draw <= state.drawIndex && card.first_line_draw <= drawLimit;
      btn.className = "card-tab" + (index===state.activeCard?" active":"") + (visibleWin?" done":"");

      let sub;
      if(visibleWin){
        sub = `Bingo ${card.first_line_draw}ª · ${mult(card.multiplier)}`;
      }else if(progress.completed > 0){
        sub = progress.completed === 1 ? "1 linea" : `${progress.completed} linee`;
      }else{
        sub = `${card.marked.size}/24 · manca ${progress.minMissing}`;
      }

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

    const bingoCards = state.cards.filter(c => lineProgress(c).completed > 0).length;
    $("#phaseText").textContent = bingoCards
      ? `${bingoCards} cartell${bingoCards===1?"a":"e"} con Bingo`
      : "Cerchiamo la prima linea";

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
    const winning = state.cards.filter(c => c.first_line_draw != null && c.first_line_draw <= drawLimit && Number(c.multiplier || 0) > 0);

    const box = $("#resultBox");
    box.className = "result " + (net >= 0 ? "win" : "loss");
    box.innerHTML = `
      <div class="result-main"><span>Risultato round</span><strong>${fmtChips(total)} fiche</strong></div>
      <div class="result-sub">Giocato ${fmtChips(stake)} · Netto ${net>=0?"+":""}${fmtChips(net)} · ${winning.length}/${state.cards.length} cartelle vincenti</div>
      <div class="cards-result">
        ${state.cards.map(c => {
          const won = c.first_line_draw != null && c.first_line_draw <= drawLimit && Number(c.multiplier || 0) > 0;
          return `<div class="card-result-row${won?" won":""}">
            <b>#${c.card_no}</b>
            <span>${won?`Bingo ${c.first_line_draw}ª`:`Nessuna linea entro ${drawLimit}`}</span>
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
