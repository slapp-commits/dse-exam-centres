(function () {
  var map = null;
  var markersById = {};
  var markerLayer = null;
  var selectedId = null;
  var userLatLng = null;
  var highlightedIds = null;
  var clusterByKey = {};
  var anchorById = {};
  var groupKeyByExamId = {};
  var spiderGroupKey = null;
  var spiderCenter = null;
  var spiderChildren = [];
  var spiderLegs = [];
  var spiderHub = null;
  var spiderOpenedAt = 0;

  var STATES = ["collapsed", "mid", "expanded"];
  var drawer = document.getElementById("drawer");
  var handleZone = document.getElementById("drawerHandle");
  var currentState = 1;
  var drag = null;

  var sortMode = document.getElementById("sortMode");

  function isHighlighted(eid) {
    if (highlightedIds && highlightedIds.length) {
      for (var i = 0; i < highlightedIds.length; i++) {
        if (highlightedIds[i] === eid) return true;
      }
      return false;
    }
    return eid === selectedId;
  }

  function highlightRestoreOpts() {
    if (highlightedIds && highlightedIds.length > 1) {
      return { highlightIds: highlightedIds.slice() };
    }
    return {};
  }

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


  function examEndTs(exam) {
    if (!exam.papers || !exam.papers.length) return null;
    var max = -Infinity;
    exam.papers.forEach(function (p) {
      if (!p.date) return;
      var time = p.end || p.start || "00:00";
      var t = Date.parse(p.date + "T" + time);
      if (!isNaN(t) && t > max) max = t;
    });
    return isFinite(max) ? max : null;
  }

  function isExamDone(exam) {
    var end = examEndTs(exam);
    return end != null && end < Date.now();
  }

  function findLastExamId(list) {
    var bestId = null;
    var bestEnd = -Infinity;
    var bestCreated = -Infinity;
    (list || []).forEach(function (exam) {
      if (isExamDone(exam)) return;
      var end = examEndTs(exam);
      if (end == null) return;
      var created = Date.parse(exam.createdAt || "") || 0;
      if (end > bestEnd || (end === bestEnd && created > bestCreated)) {
        bestEnd = end;
        bestCreated = created;
        bestId = exam.id;
      }
    });
    return bestId;
  }

  function examPinState(exam, lastId) {
    if (isExamDone(exam)) return "done";
    if (lastId && exam.id === lastId) return "last";
    return "upcoming";
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
    map.on("click", function () {
      if (!spiderGroupKey) return;
      if (Date.now() - spiderOpenedAt < 450) return;
      collapseSpider();
    });
    map.on("zoom viewreset", function () {
      repositionSpider();
    });

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
    var seen = {};
    Object.keys(anchorById).forEach(function (id) {
      var m = anchorById[id];
      if (!m) return;
      var ll = m.getLatLng();
      var key = ll.lat.toFixed(5) + "," + ll.lng.toFixed(5);
      if (seen[key]) return;
      seen[key] = true;
      bounds.push(ll);
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
    anchorById = {};
    clusterByKey = {};
    spiderChildren = [];
    spiderLegs = [];
    spiderHub = null;
    if (markerLayer) markerLayer.clearLayers();
  }

  function pinIcon(num, selected, state, badgeText) {
    state = state || "upcoming";
    var cls =
      "pin-drop pin-drop--" +
      state +
      (selected ? " is-selected" : "");
    var glyph;
    if (state === "done") {
      glyph =
        '<span class="pin-drop-glyph"><span class="pin-drop-check">✓</span><span class="pin-drop-done-label">完</span></span>';
    } else if (state === "last") {
      glyph =
        '<span class="pin-drop-glyph pin-drop-glyph--last"><span class="pin-drop-ray" aria-hidden="true"></span>' +
        String(num) +
        '<span class="pin-drop-ray" aria-hidden="true"></span></span>';
    } else {
      glyph = '<span class="pin-drop-glyph">' + String(num) + "</span>";
    }
    var badgeHtml = "";
    if (badgeText) {
      cls += " pin-drop--cluster";
      badgeHtml = '<span class="pin-multi-pill">' + escapeHtml(badgeText) + "</span>";
    }
    return L.divIcon({
      className: cls,
      html: '<span class="pin-drop-inner">' + glyph + badgeHtml + "</span>",
      iconSize: [36, 48],
      // Tip of the rotated teardrop (28px box, top 2px, sharp corner down): y = 2+14+14√2 ≈ 35.8
      iconAnchor: [18, 36],
      popupAnchor: [0, -42],
    });
  }

  function hasCoords(exam) {
    return (
      exam &&
      exam.lat != null &&
      exam.lng != null &&
      !isNaN(exam.lat) &&
      !isNaN(exam.lng)
    );
  }

  function upsertMarker(exam, num, state) {
    if (!hasCoords(exam) || num == null) return null;
    state = state || "upcoming";
    var titleBit =
      state === "done"
        ? "完"
        : String(num);
    var m = L.marker([exam.lat, exam.lng], {
      title: titleBit + " · " + (exam.centreNameZh || exam.subjectNameZh || ""),
      riseOnHover: true,
      icon: pinIcon(num, isHighlighted(exam.id), state),
      keyboard: true,
    });
    m._dseNum = num;
    m._dseState = state;
    m.on("click", function () {
      selectExam(exam.id, { fromPin: true });
    });
    m.addTo(markerLayer);
    markersById[exam.id] = m;
    return m;
  }

  function groupKeyOf(group) {
    return group
      .map(function (item) {
        return String(item.exam.id);
      })
      .sort()
      .join("|");
  }

  function groupByLocation(items) {
    var n = items.length;
    var parent = new Array(n);
    var i;
    for (i = 0; i < n; i++) parent[i] = i;
    function find(idx) {
      while (parent[idx] !== idx) {
        parent[idx] = parent[parent[idx]];
        idx = parent[idx];
      }
      return idx;
    }
    function union(a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    var byCoord = {};
    var byCentre = {};
    for (i = 0; i < n; i++) {
      var exam = items[i].exam;
      var ck = Number(exam.lat).toFixed(5) + "," + Number(exam.lng).toFixed(5);
      if (byCoord[ck] != null) union(i, byCoord[ck]);
      else byCoord[ck] = i;
      var code = exam.centreCode == null ? "" : String(exam.centreCode).trim();
      if (code) {
        if (byCentre[code] != null) union(i, byCentre[code]);
        else byCentre[code] = i;
      }
    }
    var buckets = {};
    var order = [];
    for (i = 0; i < n; i++) {
      var root = find(i);
      if (!buckets[root]) {
        buckets[root] = [];
        order.push(root);
      }
      buckets[root].push(items[i]);
    }
    return order.map(function (root) {
      return buckets[root];
    });
  }

  function groupLatLng(group) {
    var lat = 0;
    var lng = 0;
    group.forEach(function (item) {
      lat += Number(item.exam.lat);
      lng += Number(item.exam.lng);
    });
    return L.latLng(lat / group.length, lng / group.length);
  }

  function spiderOffsets(count) {
    // Arms are short on purpose: a centre rarely has more than a few exams.
    // N=2 sits near 52px. N=3–6 stay under the old 80–132px band, with
    // neighbouring pin heads still far enough apart to tap.
    var minChord = 46;
    var leg;
    var pts = [];
    if (count <= 1) return [{ dx: 0, dy: -48 }];
    if (count === 2) {
      leg = 52;
      return [
        { dx: -leg, dy: -6 },
        { dx: leg, dy: -6 },
      ];
    }
    var step = Math.PI / (count - 1);
    leg = minChord / (2 * Math.sin(step / 2));
    if (leg < 56) leg = 56;
    if (leg > 76) leg = 76;
    for (var i = 0; i < count; i++) {
      var angle = Math.PI - step * i;
      pts.push({
        dx: Math.cos(angle) * leg,
        dy: -Math.sin(angle) * leg - 4,
      });
    }
    return pts;
  }

  function offsetLatLng(center, dx, dy) {
    var p = map.latLngToLayerPoint(center);
    return map.layerPointToLatLng(L.point(p.x + dx, p.y + dy));
  }

  function refreshClusterIcons() {
    Object.keys(clusterByKey).forEach(function (key) {
      var cluster = clusterByKey[key];
      if (!cluster || !cluster._dseGroup) return;
      var on = false;
      for (var i = 0; i < cluster._dseGroup.length; i++) {
        if (isHighlighted(cluster._dseGroup[i].exam.id)) {
          on = true;
          break;
        }
      }
      cluster.setZIndexOffset(on ? 1000 : 420);
      cluster.setIcon(
        pinIcon(cluster._dseNum, on, cluster._dseState || "upcoming", cluster._dseBadge)
      );
    });
  }

  function removeSpiderVisuals() {
    spiderChildren.forEach(function (child) {
      if (child._dseExamId && markersById[child._dseExamId] === child) {
        delete markersById[child._dseExamId];
      }
      if (markerLayer) markerLayer.removeLayer(child);
    });
    spiderLegs.forEach(function (line) {
      if (markerLayer) markerLayer.removeLayer(line);
    });
    if (spiderHub && markerLayer) markerLayer.removeLayer(spiderHub);
    spiderChildren = [];
    spiderLegs = [];
    spiderHub = null;
  }

  function collapseSpider() {
    var key = spiderGroupKey;
    removeSpiderVisuals();
    spiderGroupKey = null;
    spiderCenter = null;
    selectedId = null;
    highlightedIds = null;
    document.querySelectorAll(".exam-card").forEach(function (card) {
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    });
    Object.keys(markersById).forEach(function (eid) {
      var m = markersById[eid];
      if (!m || m._dseNum == null) return;
      m.setZIndexOffset(0);
      m.setIcon(pinIcon(m._dseNum, false, m._dseState || "upcoming", m._dseBadge || null));
    });
    var cluster = key && clusterByKey[key];
    if (cluster && markerLayer && !markerLayer.hasLayer(cluster)) {
      cluster.addTo(markerLayer);
    }
    if (cluster) refreshClusterIcons();
  }

  function repositionSpider() {
    if (!map || !spiderCenter || !spiderChildren.length) return;
    spiderChildren.forEach(function (child, i) {
      var pos = offsetLatLng(spiderCenter, child._spiderDx, child._spiderDy);
      child.setLatLng(pos);
      if (spiderLegs[i]) spiderLegs[i].setLatLngs([spiderCenter, pos]);
    });
    if (spiderHub) spiderHub.setLatLng(spiderCenter);
  }

  function openSpider(group) {
    var key = groupKeyOf(group);
    if (spiderChildren.length) {
      var prevKey = spiderGroupKey;
      removeSpiderVisuals();
      if (prevKey && prevKey !== key) {
        var prev = clusterByKey[prevKey];
        if (prev && markerLayer && !markerLayer.hasLayer(prev)) prev.addTo(markerLayer);
      }
    }
    spiderGroupKey = key;
    spiderOpenedAt = Date.now();
    var cluster = clusterByKey[key];
    var center = cluster ? cluster.getLatLng() : groupLatLng(group);
    spiderCenter = L.latLng(center.lat, center.lng);
    if (cluster && markerLayer && markerLayer.hasLayer(cluster)) {
      markerLayer.removeLayer(cluster);
    }
    spiderHub = L.marker(spiderCenter, {
      icon: L.divIcon({
        className: "pin-spider-hub",
        html: '<span class="pin-spider-hub-dot"></span>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
      keyboard: true,
      title: "收合",
      zIndexOffset: 640,
    });
    spiderHub.on("click", function (ev) {
      if (ev && ev.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent);
      if (Date.now() - spiderOpenedAt < 450) return;
      collapseSpider();
    });
    spiderHub.addTo(markerLayer);

    var offsets = spiderOffsets(group.length);
    group.forEach(function (item, index) {
      var off = offsets[index];
      var pos = offsetLatLng(spiderCenter, off.dx, off.dy);
      var line = L.polyline([spiderCenter, pos], {
        color: "#2c2c2c",
        weight: 2,
        opacity: 0.45,
        interactive: false,
      });
      line.addTo(markerLayer);
      spiderLegs.push(line);

      var titleBit = item.state === "done" ? "完" : String(item.num);
      var selected = isHighlighted(item.exam.id);
      var child = L.marker(pos, {
        title: titleBit + " · " + (item.exam.centreNameZh || item.exam.subjectNameZh || ""),
        riseOnHover: true,
        icon: pinIcon(item.num, selected, item.state),
        keyboard: true,
        zIndexOffset: selected ? 1100 : 860,
      });
      child._dseNum = item.num;
      child._dseState = item.state;
      child._dseExamId = item.exam.id;
      child._spiderDx = off.dx;
      child._spiderDy = off.dy;
      child.on("click", function (ev) {
        if (ev && ev.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent);
        selectExam(item.exam.id, { fromPin: true });
      });
      child.addTo(markerLayer);
      markersById[item.exam.id] = child;
      spiderChildren.push(child);
    });
  }

  function upsertCluster(group) {
    var head = group[0];
    var ids = group.map(function (item) {
      return item.exam.id;
    });
    var badge = "共" + group.length;
    var center = groupLatLng(group);
    var on = false;
    for (var i = 0; i < ids.length; i++) {
      if (isHighlighted(ids[i])) {
        on = true;
        break;
      }
    }
    var cluster = L.marker(center, {
      title: badge + " · " + (head.exam.centreNameZh || head.exam.subjectNameZh || ""),
      riseOnHover: true,
      icon: pinIcon(head.num, on, head.state, badge),
      keyboard: true,
      zIndexOffset: on ? 1000 : 420,
    });
    cluster._dseNum = head.num;
    cluster._dseState = head.state;
    cluster._dseBadge = badge;
    cluster._dseGroup = group;
    cluster._dseKey = groupKeyOf(group);
    cluster.on("click", function (ev) {
      if (ev && ev.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent);
      var key = cluster._dseKey;
      if (spiderGroupKey === key) {
        if (Date.now() - spiderOpenedAt < 450) return;
        collapseSpider();
        return;
      }
      openSpider(group);
      selectExam(ids[0], { fromPin: true, highlightIds: ids });
    });
    cluster.addTo(markerLayer);
    clusterByKey[cluster._dseKey] = cluster;
    return cluster;
  }

  function placeSpiderfyMarkers(entries, bounds) {
    groupKeyByExamId = {};
    var located = [];
    entries.forEach(function (entry) {
      if (!hasCoords(entry.exam) || entry.num == null) return;
      located.push(entry);
    });
    var groups = groupByLocation(located);
    var reopen = null;
    groups.forEach(function (group) {
      var key = groupKeyOf(group);
      group.forEach(function (entry) {
        groupKeyByExamId[entry.exam.id] = key;
      });
      if (group.length < 2) {
        var single = upsertMarker(group[0].exam, group[0].num, group[0].state);
        if (single) {
          anchorById[group[0].exam.id] = single;
          bounds.push(single.getLatLng());
        }
        return;
      }
      var cluster = upsertCluster(group);
      group.forEach(function (entry) {
        anchorById[entry.exam.id] = cluster;
      });
      if (cluster) bounds.push(cluster.getLatLng());
      if (spiderGroupKey === key) reopen = group;
    });
    if (spiderGroupKey && !reopen) {
      spiderGroupKey = null;
      spiderCenter = null;
    }
    if (reopen) openSpider(reopen);
  }

  function selectExam(id, opts) {
    opts = opts || {};
    if (spiderGroupKey && (opts.fromCard || opts.fromPin)) {
      var stayKey = groupKeyByExamId[id];
      if (stayKey !== spiderGroupKey) collapseSpider();
    }
    selectedId = id;
    if (opts.highlightIds && opts.highlightIds.length > 1) {
      highlightedIds = opts.highlightIds.slice();
    } else {
      highlightedIds = null;
    }
    document.querySelectorAll(".exam-card").forEach(function (card) {
      var eid = card.getAttribute("data-exam-id");
      var on = isHighlighted(eid);
      card.classList.toggle("selected", on);
      card.setAttribute("aria-pressed", on ? "true" : "false");
      if (on && opts.fromPin && eid === id) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        if (currentState === 0) applyState(1, true);
      }
    });
    // N15 / E4: marker click = highlight only; drawer card = flyTo pin
    Object.keys(markersById).forEach(function (eid) {
      var m = markersById[eid];
      if (!m) return;
      var on = isHighlighted(eid);
      m.setZIndexOffset(on ? 1000 : 0);
      if (m._dseNum != null) {
        m.setIcon(pinIcon(m._dseNum, on, m._dseState || "upcoming", m._dseBadge || null));
      }
    });
    refreshClusterIcons();
    if (opts.fromCard) {
      var pin = markersById[id];
      if ((!pin || pin._spiderDx != null) && anchorById[id]) {
        pin = anchorById[id];
      }
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
      '<a class="icon-btn btn-navigate" target="_blank" rel="noopener" href="' +
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
    var nav = actionsEl.querySelector(".btn-navigate");
    if (nav) {
      nav.addEventListener("click", function () {
        if (window.DseAnalytics) window.DseAnalytics.track("navigate_tap");
      });
    }
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

  function renderCard(exam, num, state) {
    var card = document.createElement("article");
    card.className = "exam-card";
    card.setAttribute("data-exam-id", exam.id);
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", isHighlighted(exam.id) ? "true" : "false");
    if (isHighlighted(exam.id)) card.classList.add("selected");
    if (num != null) card.setAttribute("data-pin-num", String(num));

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

    state = state || "upcoming";
    var badgeHtml = "";
    if (num != null) {
      var badgeGlyph =
        state === "done"
          ? "✓完"
          : state === "last"
            ? "✦" + String(num)
            : String(num);
      badgeHtml =
        '<span class="card-pin-badge card-pin-badge--' +
        state +
        '" aria-hidden="true">' +
        badgeGlyph +
        "</span>";
    }

    card.innerHTML =
      badgeHtml +
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
      var lastId = findLastExamId(list);
      var pinOrdinal = 0;
      var entries = [];
      list.forEach(function (exam) {
        var num = null;
        if (hasCoords(exam)) {
          pinOrdinal += 1;
          num = pinOrdinal;
        }
        var state = examPinState(exam, lastId);
        examList.appendChild(renderCard(exam, num, state));
        entries.push({ exam: exam, num: num, state: state });
      });
      placeSpiderfyMarkers(entries, bounds);
    }

    if (highlightedIds && highlightedIds.length) {
      highlightedIds = highlightedIds.filter(function (id) {
        return list.some(function (e) {
          return e.id === id;
        });
      });
      if (highlightedIds.length < 2) highlightedIds = null;
    }
    if (selectedId && !list.some(function (e) { return e.id === selectedId; })) {
      selectedId = null;
    }

    // N7: do not auto-fit on every render/sort — only 「我的考試」 / first paint
    if (selectedId && (markersById[selectedId] || anchorById[selectedId])) {
      selectExam(selectedId, highlightRestoreOpts()); // highlight only, no pan
    } else if (highlightedIds && highlightedIds.length) {
      selectExam(highlightedIds[0], highlightRestoreOpts());
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

  // Soft: install / share guidance
  var SHARE_URL = "https://slapp-commits.github.io/dse-exam-centres/";
  var TIP_KEY = "dse_install_tip_v1";
  var installSheet = document.getElementById("installSheet");
  var installTip = document.getElementById("installTip");
  var btnInstallHelp = document.getElementById("btnInstallHelp");

  function openInstallSheet() {
    if (!installSheet) return;
    installSheet.classList.add("open");
    installSheet.setAttribute("aria-hidden", "false");
  }
  function closeInstallSheet() {
    if (!installSheet) return;
    installSheet.classList.remove("open");
    installSheet.setAttribute("aria-hidden", "true");
  }

  if (btnInstallHelp) {
    btnInstallHelp.addEventListener("click", openInstallSheet);
  }
  var tipOpen = document.getElementById("tipOpenHelp");
  var tipDismiss = document.getElementById("tipDismiss");
  if (tipOpen) {
    tipOpen.addEventListener("click", function () {
      try { localStorage.setItem(TIP_KEY, "1"); } catch (e) {}
      if (installTip) installTip.classList.remove("open");
      openInstallSheet();
    });
  }
  if (tipDismiss) {
    tipDismiss.addEventListener("click", function () {
      try { localStorage.setItem(TIP_KEY, "1"); } catch (e) {}
      if (installTip) installTip.classList.remove("open");
    });
  }
  if (installSheet) {
    installSheet.addEventListener("click", function (e) {
      if (e.target === installSheet) closeInstallSheet();
    });
  }
  var btnCloseInstall = document.getElementById("btnCloseInstall");
  if (btnCloseInstall) btnCloseInstall.addEventListener("click", closeInstallSheet);

  var btnShareApp = document.getElementById("btnShareApp");
  if (btnShareApp) {
    btnShareApp.addEventListener("click", function () {
      if (navigator.share) {
        navigator
          .share({
            title: "我的試場",
            text: "我的試場 — DSE 試場地圖",
            url: SHARE_URL,
          })
          .catch(function () {});
      } else {
        copyShareUrl();
      }
    });
  }
  function copyShareUrl() {
    var ok = function () {
      var b = document.getElementById("btnCopyLink");
      if (b) {
        var old = b.textContent;
        b.textContent = "已複製";
        setTimeout(function () { b.textContent = old; }, 1200);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(SHARE_URL).then(ok).catch(function () {
        window.prompt("複製呢條連結：", SHARE_URL);
      });
    } else {
      window.prompt("複製呢條連結：", SHARE_URL);
    }
  }
  var btnCopyLink = document.getElementById("btnCopyLink");
  if (btnCopyLink) btnCopyLink.addEventListener("click", copyShareUrl);

  try {
    if (!localStorage.getItem(TIP_KEY) && installTip) {
      installTip.classList.add("open");
    }
  } catch (e) {}

  if (window.DseAnalytics) window.DseAnalytics.track("app_open");

  // app_install: standalone / display-mode or iOS home-screen
  try {
    var isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (isStandalone && !localStorage.getItem("dse_tracked_install")) {
      localStorage.setItem("dse_tracked_install", "1");
      if (window.DseAnalytics) window.DseAnalytics.track("app_install");
    }
  } catch (e) {}

  initMap();
  applyState(1, false);
  renderAndMaybeFit();
})();
