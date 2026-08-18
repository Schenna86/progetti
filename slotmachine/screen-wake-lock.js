/*
 * ============================================================
 * SLOT MACHINE - SCREEN WAKE LOCK
 * ============================================================
 *
 * File condiviso per tutte le slot.
 *
 * Uso:
 *   <script src="../screen-wake-lock.js" defer></script>
 *
 * oppure, se il file è in una cartella shared:
 *   <script src="../shared/screen-wake-lock.js" defer></script>
 *
 * Cerca #topBar e aggiunge automaticamente:
 *
 *   SCHERMO OFF
 *   SCHERMO ON
 *
 * La preferenza viene salvata globalmente in localStorage.
 *
 * ============================================================
 */

(() => {

  const STORAGE_KEY =
    "slot-machine-screen-awake";


  let wakeLock =
    null;


  let enabled =
    false;


  let requesting =
    false;


  // ==========================================================
  // PREFERENZA
  // ==========================================================

  try {

    enabled =
      localStorage.getItem(
        STORAGE_KEY
      ) === "1";

  } catch {

    enabled =
      false;
  }


  // ==========================================================
  // UI
  // ==========================================================

  function ensureStyle() {

    if (
      document.getElementById(
        "slotWakeLockStyle"
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        "style"
      );


    style.id =
      "slotWakeLockStyle";


    style.textContent = `
      #wakeLockBtn {
        min-height: 2.9vw;
        padding: .42vw .78vw;
        border: .12vw solid rgba(245,201,92,.72);
        border-radius: 100vw;
        background: rgba(2,14,20,.82);
        color: white;
        cursor: pointer;
        font: inherit;
        font-size: clamp(9px, .82vw, 16px);
        font-weight: 900;
        letter-spacing: .035em;
        white-space: nowrap;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      #wakeLockBtn[data-enabled="true"] {
        border-color: rgba(124,255,140,.9);
        box-shadow: 0 0 .55vw rgba(124,255,140,.28);
      }

      #wakeLockBtn:disabled {
        opacity: .42;
        cursor: default;
      }
    `;


    document.head.appendChild(
      style
    );
  }


  function ensureButton() {

    let button =
      document.getElementById(
        "wakeLockBtn"
      );


    if (button) {
      return button;
    }


    const topBar =
      document.getElementById(
        "topBar"
      );


    if (!topBar) {
      return null;
    }


    button =
      document.createElement(
        "button"
      );


    button.id =
      "wakeLockBtn";


    button.type =
      "button";


    button.title =
      "Mantieni lo schermo acceso";


    /*
     * Inserimento prima del fullscreen, se presente.
     */
    const fullscreen =
      document.getElementById(
        "fullscreenBtn"
      );


    if (
      fullscreen
      &&
      fullscreen.parentElement === topBar
    ) {

      topBar.insertBefore(
        button,
        fullscreen
      );

    } else {

      topBar.appendChild(
        button
      );
    }


    return button;
  }


  function updateButton() {

    const button =
      ensureButton();


    if (!button) {
      return;
    }


    const supported =
      "wakeLock" in navigator;


    button.disabled =
      !supported;


    button.dataset.enabled =
      enabled
      ? "true"
      : "false";


    if (!supported) {

      button.textContent =
        "SCHERMO N/D";


      button.title =
        "Wake Lock non disponibile su questo browser";

      return;
    }


    button.textContent =
      enabled
      ? "SCHERMO ON"
      : "SCHERMO OFF";


    button.title =
      enabled
      ? "Schermo mantenuto acceso"
      : "Consenti allo schermo di spegnersi";
  }


  // ==========================================================
  // WAKE LOCK
  // ==========================================================

  async function requestWakeLock() {

    if (
      !enabled
      ||
      requesting
      ||
      document.visibilityState !== "visible"
      ||
      !("wakeLock" in navigator)
    ) {

      updateButton();

      return;
    }


    if (
      wakeLock
      &&
      !wakeLock.released
    ) {

      updateButton();

      return;
    }


    requesting =
      true;


    try {

      wakeLock =
        await navigator.wakeLock.request(
          "screen"
        );


      wakeLock.addEventListener(
        "release",
        () => {

          wakeLock =
            null;


          /*
           * Se è ancora attivo nelle preferenze,
           * visibilitychange tenterà di riacquisirlo
           * quando la pagina torna visibile.
           */
          updateButton();
        },
        {
          once: true
        }
      );

    } catch (error) {

      console.warn(
        "Screen Wake Lock:",
        error
      );


      wakeLock =
        null;

    } finally {

      requesting =
        false;


      updateButton();
    }
  }


  async function releaseWakeLock() {

    const current =
      wakeLock;


    wakeLock =
      null;


    if (
      current
      &&
      !current.released
    ) {

      try {

        await current.release();

      } catch (error) {

        console.warn(
          "Release Screen Wake Lock:",
          error
        );
      }
    }


    updateButton();
  }


  async function setEnabled(
    value
  ) {

    enabled =
      Boolean(
        value
      );


    try {

      localStorage.setItem(
        STORAGE_KEY,
        enabled
          ? "1"
          : "0"
      );

    } catch {
      // La funzione continua anche senza localStorage.
    }


    updateButton();


    if (enabled) {

      await requestWakeLock();

    } else {

      await releaseWakeLock();
    }
  }


  async function toggleWakeLock() {

    await setEnabled(
      !enabled
    );
  }


  // ==========================================================
  // EVENTI
  // ==========================================================

  function bindButton() {

    const button =
      ensureButton();


    if (
      !button
      ||
      button.dataset.wakeLockBound === "1"
    ) {
      return;
    }


    button.dataset.wakeLockBound =
      "1";


    button.addEventListener(
      "click",
      toggleWakeLock
    );
  }


  /*
   * Il sistema/browser può rilasciare il wake lock quando
   * la pagina diventa nascosta.
   *
   * Se il flag dell'utente è ancora ON,
   * lo richiediamo nuovamente quando torna visibile.
   */
  document.addEventListener(
    "visibilitychange",
    () => {

      if (
        document.visibilityState === "visible"
      ) {

        requestWakeLock();
      }
    }
  );


  /*
   * Sincronizza il flag tra eventuali tab/slot aperte.
   */
  window.addEventListener(
    "storage",
    event => {

      if (
        event.key !== STORAGE_KEY
      ) {
        return;
      }


      enabled =
        event.newValue === "1";


      updateButton();


      if (enabled) {

        requestWakeLock();

      } else {

        releaseWakeLock();
      }
    }
  );


  // ==========================================================
  // INIT
  // ==========================================================

  function init() {

    ensureStyle();

    bindButton();

    updateButton();


    /*
     * Se era già ON da una sessione precedente,
     * proviamo a riattivarlo.
     */
    if (enabled) {

      requestWakeLock();
    }
  }


  if (
    document.readyState === "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );

  } else {

    init();
  }


  /*
   * API opzionale disponibile anche al codice delle slot.
   */
  window.slotWakeLock = {

    enable:
      () =>
        setEnabled(true),

    disable:
      () =>
        setEnabled(false),

    toggle:
      toggleWakeLock,

    get enabled() {
      return enabled;
    },

    get active() {
      return Boolean(
        wakeLock
        &&
        !wakeLock.released
      );
    }
  };

})();
