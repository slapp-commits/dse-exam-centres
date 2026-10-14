(function () {
  var map = null;
  var markersById = {};
  var markerLayer = null;
  var selectedId = null;
  var userLatLng = null;

  var STATES = ["collapsed", "mid", "expanded"];
  var drawer = document.getElementById("drawer");
  var handleZone = document.getElementById("drawerHandle");
  var currentState = 1;
  var drag = null;

  var sortMode = document.getElementById("sortMode");

  function stateHeights() {
    var app = document.getElementById("app");
    var h = app.clientHeight;
    var topbar = document.querySelector(".topbar").offsetHeight || 52;
    return {
      collapsed: 56,
      mid: Math.round(h * 0.45),
      expanded: Math.max(200, h - topbar - 64), // leave strip for FAB (N18)
    };
  }

  function applyState(idx, animate) {
    currentState = Math.max(0, Math.min(2, idx));
    var name = STATES[currentState];
    var heights = stateHeights();
    var px = heights[name];
    if (!animate) drawer.classList.add("dragging");
    else drawer.classList.remove("dragging");
    drawer.style.height = px + "px";
    drawer.dataset.state = name;
    document.documentElement.style.setProperty("--drawer-h", px + "px");
    handleZone.setAttribute("aria-valuenow", String(currentState));
    if (!animate) {
      void drawer.offsetHeight;
      requestAnimationFrame(function () {
        drawer.classList.remove("dragging");
      });
    }
    setTimeout(function () {
      if (map) map.invalidateSize();
    }, 220);
  }

  function nearestState(heightPx) {
    var heights = stateHeights();
    var vals = [heights.collapsed, heights.mid, heights.expanded];
    var best = 0;
    var bestDist = Infinity;
    for (var i = 0; i < 3; i++) {
      var d = Math.abs(vals[i] - heightPx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (drag && Math.abs(drag.dy) > 8) {
      var goingUp = drag.dy < 0;
      if (goingUp && best <= currentState && best < 2) best = currentState + 1;
      if (!goingUp && best >= currentState && best > 0) best = currentState - 1;
    }
    return best;
  }

  function onHandleStart(e) {
    var t = e.touches ? e.touches[0] : e;
    drag = {
      y0: t.clientY,
      h0: drawer.offsetHeight,
      dy: 0,
    };
    drawer.classList.add("dragging");
    e.preventDefault();
  }
  function onHandleMove(e) {
    if (!drag) return;
    var t = e.touches ? e.touches[0] : e;
    drag.dy = t.clientY - drag.y0;
    var next = Math.max(48, drag.h0 - drag.dy);
    drawer.style.height = next + "px";
    document.documentElement.style.setProperty("--drawer-h", next + "px");
  }
  function onHandleEnd() {
    if (!drag) return;
    var h = drawer.offsetHeight;
    applyState(nearestState(h), true);
    drag = null;
  }

  handleZone.addEventListener("mousedown", onHandleStart);
  window.addEventListener("mousemove", onHandleMove);
  window.addEventListener("mouseup", onHandleEnd);
  handleZone.addEventListener("touchstart", onHandleStart, { passive: false });
  window.addEventListener("touchmove", onHandleMove, { passive: false });
  window.addEventListener("touchend", onHandleEnd);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function earliestTs(exam) {
    if (!exam.papers || !exam.papers.length) return Infinity;
    var min = Infinity;
    exam.papers.forEach(function (p) {
      if (!p.date) return;
      var t = Date.parse(p.date + "T" + (p.start || "00:00"));
      if (!isNaN(t) && t < min) min = t;
    });
    return min;
  }

  function daysUntil(exam) {
    var ts = earliestTs(exam);
    if (!isFinite(ts)) return null;
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.floor((ts - start) / 86400000);
  }

  function formatDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    if (p.length !== 3) return iso;
    return p[0] + "年" + Number(p[1]) + "月" + Number(p[2]) + "日";
  }

  function paperDisplayLabel(p) {
    if (p.labelZh) return p.labelZh;
    if (p.paper === "PRACTICAL") return "實習";
    return p.paper;
  }

  function navigateUrl(exam) {
    var dest;
    if (exam.lat != null && exam.lng != null && !isNaN(exam.lat) && !isNaN(exam.lng)) {
      dest = exam.lat + "," + exam.lng;
    } else {
      dest = exam.addressZh || exam.centreNameZh || "";
    }
    var url =
      "https://www.google.com/maps/dir/?api=1&destination=" +
      encodeURIComponent(dest);
    if (userLatLng) {
      url += "&origin=" + encodeURIComponent(userLatLng.lat + "," + userLatLng.lng);
    }
    return url;
  }

  function iconNavigate() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>';
  }
  function iconEdit() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
  }
  function iconDelete() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
  }

  function listedExams() {
    var mode = (sortMode && sortMode.value) || "input";
    if (ExamStore.sortedBy) return ExamStore.sortedBy(mode);
    return ExamStore.sorted();
  }

  if (sortMode) {
    try {
      var savedSort = localStorage.getItem("dse_sort_mode");
      if (savedSort === "input" || savedSort === "exam") sortMode.value = savedSort;
    } catch (e) {}
    sortMode.addEventListener("change", function () {
      try {
        localStorage.setItem("dse_sort_mode", sortMode.value);
      } catch (e) {}
      render();
    });
  }

  function initMap() {
    map = L.map("map", {
      center: [22.3193, 114.1694],
      zoom: 11,
      minZoom: 10,
      maxZoom: 20,
      zoomControl: false,
      attributionControl: true,
    });
    L.control.zoom({ position: "topright" }).addTo(map);

    L.tileLayer(
      "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png",
      {
        minZoom: 10,
        maxZoom: 20,
        attribution:
          '&copy; <a href="https://www.map.gov.hk/" target="_blank" rel="noopener">地政總署 LandsD</a>',
      }
    ).addTo(map);

    // optional labels layer if available
    L.tileLayer(
      "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png",
      {
        minZoom: 10,
        maxZoom: 20,
        opacity: 0.95,
      }
    ).addTo(map);

    markerLayer = L.layerGroup().addTo(map);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          userLatLng = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          L.circleMarker([userLatLng.lat, userLatLng.lng], {
            radius: 6,
            color: "#2563eb",
            fillColor: "#3b82f6",
            fillOpacity: 0.9,
            weight: 2,
          })
            .addTo(map)
            .bindTooltip("你的位置", { permanent: false });
        },
        function () {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    }

    setTimeout(function () {
      map.invalidateSize();
    }, 100);
  }


  function fitAllMarkers() {
    var bounds = [];
    Object.keys(markersById).forEach(function (id) {
      var m = markersById[id];
      if (m) bounds.push(m.getLatLng());
    });
    if (!bounds.length || !map) return;
    if (bounds.length === 1) {
      map.setView(bounds[0], 16);
    } else {
      map.fitBounds(L.latLngBounds(bounds).pad(0.25));
    }
    if (currentState === 2) applyState(1, true);
    else if (currentState === 0) applyState(1, true);
  }

  function clearMarkers() {
    markersById = {};
    if (markerLayer) markerLayer.clearLayers();
  }

  function upsertMarker(exam) {
    if (exam.lat == null || exam.lng == null || isNaN(exam.lat) || isNaN(exam.lng)) {
      return null;
    }
    var m = L.marker([exam.lat, exam.lng], {
      title: exam.centreNameZh || exam.subjectNameZh,
      riseOnHover: true,
    });
    m.on("click", function () {
      selectExam(exam.id, { fromPin: true });
    });
    m.addTo(markerLayer);
    markersById[exam.id] = m;
    return m;
  }

  function selectExam(id, opts) {
    opts = opts || {};
    selectedId = id;
    document.querySelectorAll(".exam-card").forEach(function (card) {
      var on = card.getAttribute("data-exam-id") === id;
      card.classList.toggle("selected", on);
      card.setAttribute("aria-pressed", on ? "true" : "false");
      if (on && opts.fromPin) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        if (currentState === 0) applyState(1, true);
      }
    });
    // N15 / E4: marker click = highlight only; drawer card = flyTo pin
    Object.keys(markersById).forEach(function (eid) {
      var m = markersById[eid];
      if (!m) return;
      m.setZIndexOffset(eid === id ? 1000 : 0);
    });
    if (opts.fromCard) {
      var pin = markersById[id];
      if (pin && map) {
        if (currentState === 2 || currentState === 0) applyState(1, true);
        var ll = pin.getLatLng();
        var z = map.getZoom();
        if (!z || z < 15) z = 15;
        if (z > 17) z = 16;
        map.flyTo(ll, z, { duration: 0.55 });
      }
    }
  }

  function showDefaultActions(actionsEl, exam) {
    actionsEl.classList.remove("confirming");
    actionsEl.innerHTML =
      '<a class="icon-btn" target="_blank" rel="noopener" href="' +
      navigateUrl(exam) +
      '">' +
      iconNavigate() +
      " 導航</a>" +
      '<a class="icon-btn" href="add.html?id=' +
      encodeURIComponent(exam.id) +
      '">' +
      iconEdit() +
      " 編輯</a>" +
      '<button type="button" class="icon-btn icon-btn-danger btn-delete" data-exam-id="' +
      escapeHtml(exam.id) +
      '">' +
      iconDelete() +
      " 刪除</button>";
    wireDeleteActions(actionsEl, exam);
  }

  function showConfirmActions(actionsEl, exam) {
    actionsEl.classList.add("confirming");
    actionsEl.innerHTML =
      '<span class="delete-confirm-msg">確認刪除此考試？</span>' +
      '<button type="button" class="icon-btn btn-cancel-delete">取消</button>' +
      '<button type="button" class="icon-btn icon-btn-danger btn-confirm-delete">確認刪除</button>';
    actionsEl.querySelector(".btn-cancel-delete").addEventListener("click", function (e) {
      e.stopPropagation();
      showDefaultActions(actionsEl, exam);
    });
    actionsEl.querySelector(".btn-confirm-delete").addEventListener("click", function (e) {
      e.stopPropagation();
      deleteExam(exam.id);
    });
  }

  function wireDeleteActions(actionsEl, exam) {
    var btn = actionsEl.querySelector(".btn-delete");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      selectExam(exam.id, {});
      showConfirmActions(actionsEl, exam);
    });
  }

  function deleteExam(id) {
    ExamStore.remove(id);
    if (selectedId === id) selectedId = null;
    
    render();
  }

  function renderCard(exam) {
    var card = document.createElement("article");
    card.className = "exam-card";
    card.setAttribute("data-exam-id", exam.id);
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", exam.id === selectedId ? "true" : "false");
    if (exam.id === selectedId) card.classList.add("selected");

    var d = daysUntil(exam);
    var countdown =
      d === null ? "" : d < 0 ? "已過" : d === 0 ? "今日" : "倒數 " + d + " 日";

    var papersHtml = (exam.papers || [])
      .map(function (p) {
        var time = (p.start || "") + (p.end ? "–" + p.end : "");
        return (
          '<div class="paper-line">' +
          escapeHtml(paperDisplayLabel(p)) +
          (p.date ? " · " + escapeHtml(formatDate(p.date)) : "") +
          (time ? " · " + escapeHtml(time) : "") +
          "</div>"
        );
      })
      .join("");

    card.innerHTML =
      '<div class="exam-card-main">' +
      '<div class="exam-title">' +
      escapeHtml(exam.subjectNameZh || exam.subjectId) +
      (exam.lang === "en" ? "（英文卷）" : exam.lang === "zh" ? "（中文卷）" : "") +
      "</div>" +
      (countdown ? '<div class="exam-countdown">' + escapeHtml(countdown) + "</div>" : "") +
      '<div class="exam-venue">' +
      escapeHtml(exam.centreCode || "") +
      " · " +
      escapeHtml(exam.centreNameZh || "") +
      "</div>" +
      '<div class="exam-addr">' +
      escapeHtml(exam.addressZh || "") +
      "</div>" +
      '<div class="exam-papers">' +
      papersHtml +
      "</div>" +
      "</div>" +
      '<div class="exam-actions"></div>';

    var actionsEl = card.querySelector(".exam-actions");
    showDefaultActions(actionsEl, exam);

    card.addEventListener("click", function (e) {
      if (e.target.closest(".exam-actions")) return;
      selectExam(exam.id, { fromCard: true });
    });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectExam(exam.id, { fromCard: true });
      }
    });
    return card;
  }

  function render() {
    var list = listedExams();
    var examList = document.getElementById("examList");
    var drawerCount = document.getElementById("drawerCount");
    examList.innerHTML = "";
    drawerCount.textContent = list.length ? "（" + list.length + "）" : "";

    clearMarkers();
    var bounds = [];

    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML =
        ExamStore.load().length === 0
          ? "尚未加入考試。<br/>撳右下＋新增。"
          : "尚未加入考試。";
      examList.appendChild(empty);
    } else {
      list.forEach(function (exam) {
        examList.appendChild(renderCard(exam));
        var m = upsertMarker(exam);
        if (m) bounds.push(m.getLatLng());
      });
    }

    // N7: do not auto-fit on every render/sort — only 「我的考試」 / first paint
    if (selectedId && markersById[selectedId]) {
      selectExam(selectedId, {}); // highlight only, no pan
    } else if (selectedId && !list.some(function (e) { return e.id === selectedId; })) {
      selectedId = null;
    }
  }

  var didInitialFit = false;
  function renderAndMaybeFit() {
    render();
    if (!didInitialFit) {
      didInitialFit = true;
      fitAllMarkers();
    }
  }

  window.addEventListener("resize", function () {
    applyState(currentState, false);
    if (map) map.invalidateSize();
  });

  document.querySelector(".drawer-title").addEventListener("click", function () {
    fitAllMarkers();
  });

  initMap();
  applyState(1, false);
  renderAndMaybeFit();
})();
