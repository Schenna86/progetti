/*
 * ============================================================
 * CASINO LEVEL-UP MODAL V1
 * ============================================================
 *
 * Uso:
 *
 *   <script src="../shared/level-up-modal.js"></script>
 *
 * Poi, DOPO aver creato il client Supabase:
 *
 *   CasinoLevelUp.init(supabase);
 *
 * Quando il gioco ha FINITO la propria animazione / bonus:
 *
 *   const levelUp = await CasinoLevelUp.check();
 *
 *   if (levelUp?.balance != null) {
 *       state.balance = Number(levelUp.balance);
 *   }
 *
 * La modale NON assegna premi.
 * I premi sono già stati accreditati server-side.
 * ============================================================
 */

(function () {

  "use strict";


  const nf =
    new Intl.NumberFormat(
      "it-IT"
    );


  const multiplierFormatter =
    new Intl.NumberFormat(
      "it-IT",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    );


  let supabaseClient =
    null;


  let options =
    {
      balanceSelector:
        "#balanceValue",

      levelSelector:
        "#xpLevel"
    };


  let runningPromise =
    null;


  function formatNumber(
    value
  ) {

    return nf.format(
      Number(
        value || 0
      )
    );
  }


  function formatMultiplier(
    value
  ) {

    return `×${multiplierFormatter.format(
      Number(
        value || 0
      )
    )}`;
  }


  function escapeHtml(
    value
  ) {

    return String(
      value ?? ""
    )
      .replaceAll(
        "&",
        "&amp;"
      )
      .replaceAll(
        "<",
        "&lt;"
      )
      .replaceAll(
        ">",
        "&gt;"
      )
      .replaceAll(
        '"',
        "&quot;"
      )
      .replaceAll(
        "'",
        "&#039;"
      );
  }


  function packClass(
    packId
  ) {

    switch (
      String(
        packId || ""
      )
    ) {

      case "uncommon_pack":
        return "clu-pack-uncommon";

      case "rare_pack":
        return "clu-pack-rare";

      case "epic_pack":
        return "clu-pack-epic";

      case "legendary_pack":
        return "clu-pack-legendary";

      default:
        return "clu-pack-base";
    }
  }


  function injectStyle() {

    if (
      document.getElementById(
        "casino-level-up-style"
      )
    ) {

      return;
    }


    const style =
      document.createElement(
        "style"
      );


    style.id =
      "casino-level-up-style";


    style.textContent = `
      .clu-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: grid;
        place-items: center;
        padding: 18px;
        background:
          radial-gradient(
            circle at 50% 35%,
            rgba(91, 51, 145, .36),
            rgba(0, 0, 0, .90) 62%
          );
        backdrop-filter: blur(7px);
        -webkit-backdrop-filter: blur(7px);
      }

      .clu-card {
        position: relative;
        width: min(560px, 100%);
        max-height: min(92dvh, 850px);
        overflow: auto;
        border: 2px solid rgba(255, 220, 125, .92);
        border-radius: 24px;
        background:
          radial-gradient(
            circle at 50% -5%,
            rgba(255, 221, 117, .24),
            transparent 33%
          ),
          linear-gradient(
            180deg,
            #17213d 0%,
            #0d1223 58%,
            #070b14 100%
          );
        color: #f8f8fb;
        box-shadow:
          0 0 0 5px rgba(255, 206, 83, .06),
          0 30px 100px rgba(0, 0, 0, .70),
          0 0 44px rgba(136, 88, 255, .24);
        font-family:
          Inter,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
        text-align: center;
        animation:
          clu-enter .34s cubic-bezier(.18,.82,.28,1.12);
      }

      @keyframes clu-enter {
        from {
          opacity: 0;
          transform: scale(.90) translateY(20px);
        }

        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .clu-rays {
        position: absolute;
        z-index: 0;
        top: -145px;
        left: 50%;
        width: 360px;
        height: 360px;
        transform: translateX(-50%);
        border-radius: 50%;
        opacity: .17;
        background:
          repeating-conic-gradient(
            from 0deg,
            #ffe49c 0deg 7deg,
            transparent 7deg 15deg
          );
        animation:
          clu-rays-spin 18s linear infinite;
        pointer-events: none;
      }

      @keyframes clu-rays-spin {
        to {
          transform:
            translateX(-50%)
            rotate(360deg);
        }
      }

      .clu-content {
        position: relative;
        z-index: 1;
        padding: 25px 22px 21px;
      }

      .clu-kicker {
        color: #ffd86c;
        font-size: 15px;
        font-weight: 1000;
        letter-spacing: .18em;
        text-transform: uppercase;
        text-shadow:
          0 0 18px rgba(255, 206, 78, .35);
      }

      .clu-level {
        margin-top: 5px;
        color: #fff2be;
        font-size: clamp(34px, 8vw, 56px);
        font-weight: 1000;
        line-height: 1.02;
        text-shadow:
          0 2px 0 #704a09,
          0 0 24px rgba(255, 212, 87, .28);
      }

      .clu-gained {
        display: inline-flex;
        margin-top: 9px;
        padding: 5px 10px;
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 999px;
        background: rgba(255,255,255,.055);
        color: #cdd4e7;
        font-size: 12px;
        font-weight: 850;
      }

      .clu-section-title {
        margin: 20px 0 9px;
        color: #aeb7d1;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .14em;
        text-transform: uppercase;
      }

      .clu-rewards {
        display: grid;
        gap: 9px;
      }

      .clu-reward {
        display: flex;
        gap: 12px;
        align-items: center;
        min-height: 62px;
        padding: 10px 13px;
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 15px;
        background: rgba(255,255,255,.045);
        text-align: left;
      }

      .clu-icon {
        flex: 0 0 auto;
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 12px;
        background: rgba(0,0,0,.22);
        font-size: 23px;
      }

      .clu-reward-text {
        min-width: 0;
        flex: 1;
      }

      .clu-reward-label {
        color: #aeb7d1;
        font-size: 11px;
      }

      .clu-reward-value {
        margin-top: 1px;
        color: #fff;
        font-size: 19px;
        font-weight: 950;
      }

      .clu-reward-value strong {
        color: #ffe08a;
      }

      .clu-pack-base {
        border-color: rgba(198, 205, 218, .32);
      }

      .clu-pack-uncommon {
        border-color: rgba(95, 221, 139, .52);
        box-shadow:
          inset 0 0 18px rgba(53, 198, 105, .06);
      }

      .clu-pack-rare {
        border-color: rgba(91, 159, 255, .58);
        box-shadow:
          inset 0 0 18px rgba(61, 126, 255, .07);
      }

      .clu-pack-epic {
        border-color: rgba(199, 107, 255, .62);
        box-shadow:
          inset 0 0 18px rgba(173, 69, 255, .09);
      }

      .clu-pack-legendary {
        border-color: rgba(255, 205, 73, .82);
        box-shadow:
          inset 0 0 22px rgba(255, 190, 36, .10),
          0 0 18px rgba(255, 192, 38, .08);
      }

      .clu-daily {
        margin-top: 12px;
        padding: 13px;
        border: 1px solid rgba(114, 169, 255, .24);
        border-radius: 15px;
        background:
          linear-gradient(
            135deg,
            rgba(70, 89, 203, .10),
            rgba(148, 70, 203, .08)
          );
      }

      .clu-daily-label {
        color: #b7c0da;
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .08em;
      }

      .clu-daily-value {
        margin-top: 4px;
        font-size: 21px;
        font-weight: 950;
      }

      .clu-daily-old {
        color: #aab1c6;
      }

      .clu-arrow {
        padding: 0 7px;
        color: #ffd86d;
      }

      .clu-daily-new {
        color: #ffe18b;
      }

      .clu-details {
        margin-top: 13px;
        border: 1px solid rgba(255,255,255,.09);
        border-radius: 13px;
        overflow: hidden;
        background: rgba(0,0,0,.14);
        text-align: left;
      }

      .clu-details summary {
        padding: 10px 12px;
        cursor: pointer;
        color: #c4cbdd;
        font-size: 12px;
        font-weight: 850;
      }

      .clu-detail-row {
        display: grid;
        grid-template-columns: 70px 1fr;
        gap: 8px;
        padding: 8px 12px;
        border-top: 1px solid rgba(255,255,255,.07);
        font-size: 12px;
      }

      .clu-detail-level {
        color: #ffe08b;
        font-weight: 900;
      }

      .clu-detail-rewards {
        color: #d6d9e5;
      }

      .clu-error {
        min-height: 18px;
        margin-top: 10px;
        color: #ff9999;
        font-size: 12px;
      }

      .clu-continue {
        width: 100%;
        min-height: 52px;
        margin-top: 12px;
        border: 1px solid #ffe49b;
        border-radius: 13px;
        background:
          linear-gradient(
            180deg,
            #e2ac3f,
            #9c5b17
          );
        color: #fffaf0;
        font-size: 16px;
        font-weight: 1000;
        letter-spacing: .05em;
        text-shadow:
          0 1px 2px rgba(0,0,0,.7);
        cursor: pointer;
        box-shadow:
          inset 0 1px rgba(255,255,255,.34),
          0 8px 20px rgba(0,0,0,.25);
      }

      .clu-continue:disabled {
        opacity: .55;
        cursor: default;
      }

      @media (max-width: 560px) {

        .clu-overlay {
          padding: 10px;
        }

        .clu-content {
          padding: 20px 14px 15px;
        }

        .clu-card {
          border-radius: 19px;
        }

        .clu-level {
          font-size: 36px;
        }

        .clu-reward {
          min-height: 55px;
        }

        .clu-reward-value {
          font-size: 17px;
        }

      }

      @media (orientation: landscape) and (max-height: 600px) {

        .clu-overlay {
          padding: 7px;
        }

        .clu-card {
          width: min(650px, 96vw);
          max-height: 96dvh;
        }

        .clu-content {
          padding: 13px 16px 12px;
        }

        .clu-kicker {
          font-size: 11px;
        }

        .clu-level {
          font-size: 30px;
        }

        .clu-gained {
          margin-top: 4px;
        }

        .clu-section-title {
          margin: 10px 0 6px;
        }

        .clu-rewards {
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 6px;
        }

        .clu-reward {
          min-height: 47px;
          padding: 6px 9px;
        }

        .clu-icon {
          width: 34px;
          height: 34px;
          font-size: 19px;
        }

        .clu-reward-value {
          font-size: 15px;
        }

        .clu-daily {
          margin-top: 7px;
          padding: 8px;
        }

        .clu-daily-value {
          font-size: 17px;
        }

        .clu-details {
          margin-top: 7px;
        }

        .clu-continue {
          min-height: 40px;
          margin-top: 7px;
        }
      }
    `;


    document.head.appendChild(
      style
    );
  }


  function updateCommonUi(
    data
  ) {

    if (
      data?.balance != null
    ) {

      const balanceEl =
        document.querySelector(
          options.balanceSelector
        );


      if (balanceEl) {

        balanceEl.textContent =
          formatNumber(
            data.balance
          );
      }
    }


    if (
      data?.current_level != null
    ) {

      const levelEl =
        document.querySelector(
          options.levelSelector
        );


      if (levelEl) {

        levelEl.textContent =
          String(
            data.current_level
          );
      }
    }
  }


  function notifyBalance(
    data
  ) {

    updateCommonUi(
      data
    );


    try {

      if (
        "BroadcastChannel"
        in window
      ) {

        const channel =
          new BroadcastChannel(
            "slot-machine-sync"
          );


        channel.postMessage(
          {
            type:
              "balance-changed",

            source:
              "level-reward",

            balance:
              data?.balance
          }
        );


        channel.close();
      }

    } catch {}


    try {

      localStorage.setItem(
        "slot-machine-balance-sync",
        String(
          Date.now()
        )
      );

    } catch {}


    try {

      window.dispatchEvent(
        new CustomEvent(
          "casino:level-up",
          {
            detail:
              data
          }
        )
      );

    } catch {}
  }


  function rewardRows(
    data
  ) {

    const rows =
      [];


    if (
      Number(
        data?.chips_reward || 0
      ) > 0
    ) {

      rows.push(
        `
          <div class="clu-reward">
            <div class="clu-icon">🪙</div>

            <div class="clu-reward-text">
              <div class="clu-reward-label">
                Fiche
              </div>

              <div class="clu-reward-value">
                <strong>+${formatNumber(
                  data.chips_reward
                )}</strong>
              </div>
            </div>
          </div>
        `
      );
    }


    const packs =
      Array.isArray(
        data?.packs
      )
        ? data.packs
        : [];


    for (
      const pack
      of packs
    ) {

      rows.push(
        `
          <div class="clu-reward ${packClass(
            pack.pack_id
          )}">
            <div class="clu-icon">🎁</div>

            <div class="clu-reward-text">
              <div class="clu-reward-label">
                Pacchetto
              </div>

              <div class="clu-reward-value">
                ${escapeHtml(
                  pack.name
                  || pack.pack_id
                )}
                <strong>
                  ×${formatNumber(
                    pack.quantity
                  )}
                </strong>
              </div>
            </div>
          </div>
        `
      );
    }


    return rows.join(
      ""
    );
  }


  function detailRows(
    data
  ) {

    const levels =
      Array.isArray(
        data?.levels
      )
        ? data.levels
        : [];


    if (
      levels.length <= 1
    ) {

      return "";
    }


    const rows =
      levels.map(
        level => {

          const rewards =
            [];


          if (
            Number(
              level.chips_reward
              || 0
            ) > 0
          ) {

            rewards.push(
              `+${formatNumber(
                level.chips_reward
              )} fiche`
            );
          }


          if (
            level.pack_id
            &&
            Number(
              level.pack_quantity
              || 0
            ) > 0
          ) {

            rewards.push(
              `${escapeHtml(
                level.pack_name
                || level.pack_id
              )} ×${formatNumber(
                level.pack_quantity
              )}`
            );
          }


          return `
            <div class="clu-detail-row">
              <div class="clu-detail-level">
                Lv. ${escapeHtml(
                  level.level
                )}
              </div>

              <div class="clu-detail-rewards">
                ${rewards.join(
                  " · "
                )}
              </div>
            </div>
          `;
        }
      )
      .join("");


    return `
      <details class="clu-details">
        <summary>
          Dettaglio dei ${formatNumber(
            levels.length
          )} livelli
        </summary>

        ${rows}
      </details>
    `;
  }


  function buildOverlay(
    data
  ) {

    injectStyle();


    const overlay =
      document.createElement(
        "div"
      );


    overlay.className =
      "clu-overlay";


    overlay.setAttribute(
      "role",
      "dialog"
    );


    overlay.setAttribute(
      "aria-modal",
      "true"
    );


    overlay.setAttribute(
      "aria-label",
      "Aumento di livello"
    );


    const fromLevel =
      Number(
        data.from_level || 1
      );


    const toLevel =
      Number(
        data.to_level
        || data.current_level
        || 1
      );


    const levelsGained =
      Number(
        data.levels_gained
        || 1
      );


    const levelText =
      levelsGained > 1
        ? `LIVELLO ${formatNumber(
            fromLevel
          )} → ${formatNumber(
            toLevel
          )}`
        : `LIVELLO ${formatNumber(
            toLevel
          )}`;


    const gainedText =
      levelsGained > 1
        ? `+${formatNumber(
            levelsGained
          )} livelli`
        : "Nuovo livello raggiunto";


    overlay.innerHTML = `
      <div class="clu-card">

        <div class="clu-rays"></div>

        <div class="clu-content">

          <div class="clu-kicker">
            LEVEL UP!
          </div>

          <div class="clu-level">
            ${levelText}
          </div>

          <div class="clu-gained">
            ${gainedText}
          </div>

          <div class="clu-section-title">
            Ricompense ottenute
          </div>

          <div class="clu-rewards">
            ${rewardRows(
              data
            )}
          </div>

          <div class="clu-daily">
            <div class="clu-daily-label">
              Moltiplicatore bonus giornaliero
            </div>

            <div class="clu-daily-value">
              <span class="clu-daily-old">
                ${formatMultiplier(
                  data.daily_bonus_multiplier_before
                )}
              </span>

              <span class="clu-arrow">
                →
              </span>

              <span class="clu-daily-new">
                ${formatMultiplier(
                  data.daily_bonus_multiplier_after
                )}
              </span>
            </div>
          </div>

          ${detailRows(
            data
          )}

          <div
            class="clu-error"
            aria-live="polite"
          ></div>

          <button
            type="button"
            class="clu-continue"
          >
            CONTINUA
          </button>

        </div>
      </div>
    `;


    return overlay;
  }


  async function acknowledge(
    throughLevel
  ) {

    const {
      data,
      error
    } =
      await supabaseClient.rpc(
        "acknowledge_level_ups",
        {
          p_through_level:
            Number(
              throughLevel
            )
        }
      );


    if (error) {
      throw error;
    }


    return data;
  }


  function showModal(
    data
  ) {

    return new Promise(
      resolve => {

        const overlay =
          buildOverlay(
            data
          );


        const button =
          overlay.querySelector(
            ".clu-continue"
          );


        const errorEl =
          overlay.querySelector(
            ".clu-error"
          );


        const oldOverflow =
          document.body.style.overflow;


        document.body.appendChild(
          overlay
        );


        document.body.style.overflow =
          "hidden";


        requestAnimationFrame(
          () => {

            button.focus(
              {
                preventScroll:
                  true
              }
            );
          }
        );


        let closing =
          false;


        const close =
          async () => {

            if (closing) {
              return;
            }


            closing =
              true;


            button.disabled =
              true;


            errorEl.textContent =
              "";


            try {

              await acknowledge(
                data.to_level
              );


              overlay.remove();


              document.body.style.overflow =
                oldOverflow;


              resolve(
                data
              );

            } catch (
              error
            ) {

              console.error(
                "Errore acknowledge level-up:",
                error
              );


              errorEl.textContent =
                error?.message
                || String(
                  error
                );


              button.disabled =
                false;


              closing =
                false;
            }
          };


        button.addEventListener(
          "click",
          close
        );


        const onKeyDown =
          event => {

            if (
              event.key ===
              "Escape"
            ) {

              event.preventDefault();

              close();
            }
          };


        document.addEventListener(
          "keydown",
          onKeyDown
        );


        const originalResolve =
          resolve;


        resolve =
          value => {

            document.removeEventListener(
              "keydown",
              onKeyDown
            );


            originalResolve(
              value
            );
          };
      }
    );
  }


  async function runCheck() {

    if (!supabaseClient) {

      throw new Error(
        "CasinoLevelUp.init(supabase) non è stato chiamato."
      );
    }


    const {
      data,
      error
    } =
      await supabaseClient.rpc(
        "get_pending_level_ups"
      );


    if (error) {
      throw error;
    }


    updateCommonUi(
      data
    );


    if (
      !data?.pending
    ) {

      return data;
    }


    notifyBalance(
      data
    );


    return await showModal(
      data
    );
  }


  async function check() {

    if (
      runningPromise
    ) {

      return runningPromise;
    }


    runningPromise =
      runCheck()
        .finally(
          () => {

            runningPromise =
              null;
          }
        );


    return runningPromise;
  }


  function init(
    client,
    customOptions = {}
  ) {

    if (
      !client
      ||
      typeof client.rpc
        !== "function"
    ) {

      throw new Error(
        "Client Supabase non valido."
      );
    }


    supabaseClient =
      client;


    options =
      {
        ...options,
        ...customOptions
      };


    return api;
  }


  const api =
    {
      init,
      check
    };


  window.CasinoLevelUp =
    api;

})();
