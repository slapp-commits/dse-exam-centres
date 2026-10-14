/**
 * localStorage helpers for DSE exam entries — v0.3 schema (used by v0.4 UI)
 * Key: dse_exams_v3
 * Migrates from dse_exams_v2: drops monolithic "eng"; strips nested PRACTICAL
 * from music/pe written entries. Clears legacy dse_exams (v0.1).
 *
 * One subjectId = one saved entry = one venue pin.
 * English: eng_p12 / eng_p3 / eng_p4
 * Practicals: music_prac / pe_prac (not nested under music / pe)
 */
(function (global) {
  const KEY = "dse_exams_v3";
  const PREV_KEY = "dse_exams_v2";
  const LEGACY_KEY = "dse_exams";
  const SCHEMA_VERSION = 3;

  function migrateEntry(e) {
    if (!e || !e.subjectId || !Array.isArray(e.papers)) return null;
    if (e.subjectId === "eng") return null;

    var papers = e.papers;
    if (e.subjectId === "music" || e.subjectId === "pe") {
      papers = papers.filter(function (p) {
        return p && p.paper !== "PRACTICAL";
      });
      if (!papers.length) return null;
    }

    return Object.assign({}, e, {
      papers: papers,
      schemaVersion: SCHEMA_VERSION,
    });
  }

  function migrateIfNeeded() {
    try {
      if (localStorage.getItem(KEY)) return;

      var prev = localStorage.getItem(PREV_KEY);
      if (prev) {
        try {
          var arr = JSON.parse(prev);
          var kept = [];
          if (Array.isArray(arr)) {
            arr.forEach(function (e) {
              var next = migrateEntry(e);
              if (next) kept.push(next);
            });
          }
          localStorage.setItem(KEY, JSON.stringify(kept));
        } catch (err) {
          /* ignore */
        }
        localStorage.removeItem(PREV_KEY);
      }

      if (localStorage.getItem(LEGACY_KEY)) {
        localStorage.removeItem(LEGACY_KEY);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function load() {
    migrateIfNeeded();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (e) {
        return e && e.subjectId && Array.isArray(e.papers);
      });
    } catch (e) {
      return [];
    }
  }

  function saveAll(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function add(entry) {
    entry.schemaVersion = SCHEMA_VERSION;
    const list = load();
    list.push(entry);
    saveAll(list);
    return entry;
  }

  function update(id, patch) {
    const list = load();
    const i = list.findIndex(function (e) {
      return e.id === id;
    });
    if (i < 0) return null;
    list[i] = Object.assign({}, list[i], patch, {
      schemaVersion: SCHEMA_VERSION,
    });
    saveAll(list);
    return list[i];
  }

  function remove(id) {
    saveAll(
      load().filter(function (e) {
        return e.id !== id;
      })
    );
  }

  function get(id) {
    return (
      load().find(function (e) {
        return e.id === id;
      }) || null
    );
  }

  function findBySubject(subjectId, excludeId) {
    return (
      load().find(function (e) {
        return e.subjectId === subjectId && e.id !== excludeId;
      }) || null
    );
  }

  function sorted() {
    return sortedBy("exam");
  }

  function sortedBy(mode) {
    var list = load().slice();
    if (mode === "input") {
      return list.sort(function (a, b) {
        var ta = Date.parse(a.createdAt || "") || 0;
        var tb = Date.parse(b.createdAt || "") || 0;
        if (ta !== tb) return ta - tb;
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
    }
    return list.sort(function (a, b) {
      return earliestTs(a) - earliestTs(b);
    });
  }

  function earliestTs(exam) {
    if (!exam.papers || !exam.papers.length) return Infinity;
    let min = Infinity;
    exam.papers.forEach(function (p) {
      if (!p.date) return;
      const t = Date.parse(p.date + "T" + (p.start || "00:00"));
      if (!isNaN(t) && t < min) min = t;
    });
    return min;
  }

  function uid() {
    return (
      "e_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  global.ExamStore = {
    KEY: KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    load: load,
    saveAll: saveAll,
    add: add,
    update: update,
    remove: remove,
    get: get,
    findBySubject: findBySubject,
    sorted: sorted,
    sortedBy: sortedBy,
    uid: uid,
  };
})(typeof window !== "undefined" ? window : globalThis);
