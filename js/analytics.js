/** Soft.1 light analytics — Plausible custom events (no PII). */
(function (w) {
  var DOMAIN = w.DSE_PLAUSIBLE_DOMAIN || ""; // e.g. "slapp-commits.github.io"
  var queued = [];

  function ensureScript() {
    if (!DOMAIN || w.__dsePlausibleLoading) return;
    if (document.querySelector('script[data-dse-plausible]')) return;
    w.__dsePlausibleLoading = true;
    w.plausible =
      w.plausible ||
      function () {
        (w.plausible.q = w.plausible.q || []).push(arguments);
      };
    var s = document.createElement("script");
    s.defer = true;
    s.setAttribute("data-domain", DOMAIN);
    s.setAttribute("data-dse-plausible", "1");
    s.src = "https://plausible.io/js/script.manual.js";
    s.onload = function () {
      w.__dsePlausibleLoading = false;
      if (typeof w.plausible === "function") {
        w.plausible("pageview");
        queued.forEach(function (name) {
          w.plausible(name);
        });
        queued = [];
      }
    };
    document.head.appendChild(s);
  }

  function track(name) {
    if (!name) return;
    if (!DOMAIN) return; // disabled until domain configured
    ensureScript();
    if (typeof w.plausible === "function" && !w.__dsePlausibleLoading) {
      try {
        w.plausible(name);
      } catch (e) {}
    } else {
      queued.push(name);
    }
  }

  w.DseAnalytics = { track: track, domain: DOMAIN };
})(window);
