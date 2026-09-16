(() => {
  const api = {
    init(options = {}) {
      const selector = options.selector || "#gameHeader";
      const root = document.querySelector(selector);
      if (!root) return null;

      const title = String(options.title || root.dataset.title || "CASINO");
      const subtitle = String(options.subtitle || root.dataset.subtitle || "");
      const homeUrl = String(options.homeUrl || root.dataset.homeUrl || "../index.html");

      root.classList.add("game-header");
      root.innerHTML = `
        <div class="game-header__title">
          <strong id="gameHeaderTitle"></strong>
          <small id="gameHeaderSubtitle"></small>
        </div>

        <div class="game-header__xp">
          <div class="game-header__xp-info">
            <span class="game-header__xp-level">LV <strong id="xpLevel">1</strong></span>
            <span id="xpText" class="game-header__xp-text">0 XP</span>
          </div>
          <div class="game-header__xp-bar" aria-label="Progresso esperienza">
            <div id="xpFill" class="game-header__xp-fill"></div>
          </div>
        </div>

        <div class="game-header__actions">
          <div class="game-header__balance" title="Saldo">
            <span class="game-header__balance-icon" aria-hidden="true">🪙</span>
            <strong id="balanceValue">0</strong>
          </div>
          <button id="fullscreenBtn" class="game-header__button" type="button" title="Schermo intero" aria-label="Schermo intero">⛶</button>
          <button id="homeBtn" class="game-header__button" type="button" title="Home" aria-label="Home">⌂</button>
        </div>
      `;

      root.querySelector("#gameHeaderTitle").textContent = title;
      const subtitleEl = root.querySelector("#gameHeaderSubtitle");
      subtitleEl.textContent = subtitle;
      subtitleEl.hidden = !subtitle;

      const homeBtn = root.querySelector("#homeBtn");
      const fullscreenBtn = root.querySelector("#fullscreenBtn");

      homeBtn?.addEventListener("click", () => {
        location.href = homeUrl;
      });

      fullscreenBtn?.addEventListener("click", async () => {
        try {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
          } else {
            await document.exitFullscreen();
          }
        } catch (error) {
          console.warn("Fullscreen non disponibile:", error);
        }
      });

      return {
        root,
        setTitle(value) {
          root.querySelector("#gameHeaderTitle").textContent = String(value ?? "");
        },
        setSubtitle(value) {
          const el = root.querySelector("#gameHeaderSubtitle");
          const text = String(value ?? "");
          el.textContent = text;
          el.hidden = !text;
        }
      };
    }
  };

  window.CasinoGameHeader = api;
})();
