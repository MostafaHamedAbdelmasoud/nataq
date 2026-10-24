/* Nataq — shared runtime
   Data store (localStorage) · i18n · auth & roles · layout · toasts · modals
   Real microphone recording (3 s max) and playback */
(function () {
  'use strict';

  const KEYS = { db: 'nataq_db_v4', session: 'nataq_session', lang: 'nataq_lang', drafts: 'nataq_drafts', flash: 'nataq_flash' };
  const MAX_REC = 3; // seconds
  const STAFF_PASSWORD = 'nataq2026';
  const PATIENT_CODE = '1234';
  const I18N = window.NATAQ_I18N || { en: {}, ar: {} };
  let lang = localStorage.getItem(KEYS.lang) === 'ar' ? 'ar' : 'en';
  let _db = null;
  let page = null;

  /* ---------------- storage ---------------- */
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast(t('toast.storageFull'), t('toast.storageFullBody'), 'error'); return false; }
  }

  /* ---------------- i18n ---------------- */
  function t(key, p) {
    let s = I18N[lang] && I18N[lang][key];
    if (s == null) s = I18N.en[key];
    if (s == null) { console.warn('[i18n] missing key:', key); s = key; }
    if (p) Object.keys(p).forEach(k => { s = s.split('{' + k + '}').join(p[k]); });
    return s;
  }
  function L(o) { if (!o) return ''; if (typeof o === 'string') return o; return o[lang] || o.en || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function getLang() { return lang; }
  function applyDir() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }
  function applyStatic(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  }
  function setLang(l) {
    lang = l === 'ar' ? 'ar' : 'en';
    localStorage.setItem(KEYS.lang, lang);
    applyDir();
    rerender();
    toast(t('toast.langSwitched'), lang === 'ar' ? 'العربية' : 'English', 'info');
  }

  /* ---------------- time formatting ---------------- */
  function locale() { return lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'; }
  function fmtDate(ts) { return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }); }
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }); }
  function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function fmtDay(ts) {
    const diff = Math.round((dayStart(Date.now()) - dayStart(ts)) / 86400000);
    if (diff === 0) return t('time.today');
    if (diff === 1) return t('time.yesterday');
    return new Date(ts).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function rel(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return t('time.now');
    if (d < 3600) return t('time.min', { n: Math.floor(d / 60) });
    if (d < 86400) return t('time.hr', { n: Math.floor(d / 3600) });
    const days = Math.floor(d / 86400);
    if (days === 1) return t('time.yesterday');
    if (days < 7) return t('time.days', { n: days });
    return fmtDate(ts);
  }
  function shortTime(ts) {
    if (dayStart(ts) === dayStart(Date.now())) return fmtTime(ts);
    if (Date.now() - ts < 6 * 86400000) return new Date(ts).toLocaleDateString(locale(), { weekday: 'short' });
    return fmtDate(ts);
  }
  function fmtDur(s) { return '0:' + String(Math.min(59, Math.round(s || 0))).padStart(2, '0'); }

  /* ---------------- random helpers ---------------- */
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = typeof seed === 'number' ? seed : hash(String(seed));
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  }
  function uid(p) { return (p || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function pick(arr, r) { return arr[Math.floor(r() * arr.length)]; }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  /* ---------------- seed data ---------------- */
  const PROGRAM_DEFS = [
    { id: 'nasal', en: 'Nasal sounds', ar: 'الأصوات الأنفية', letters: ['م', 'ن'], bg: '#FEE2E2', fg: '#B91C1C' },
    { id: 'labial', en: 'Labial sounds', ar: 'الأصوات الشفوية', letters: ['ب', 'ف', 'و'], bg: '#DBEAFE', fg: '#1E40AF' },
    { id: 'dental', en: 'Dental sounds', ar: 'الأصوات الأسنانية', letters: ['ت', 'د', 'ث', 'ذ'], bg: '#FEF3C7', fg: '#92400E' },
    { id: 'alveolar', en: 'Alveolar sounds', ar: 'الأصوات اللثوية', letters: ['س', 'ز', 'ل', 'ر'], bg: '#EDE9FE', fg: '#5B21B6' },
    { id: 'palatal', en: 'Palatal sounds', ar: 'الأصوات الحنكية', letters: ['ش', 'ج', 'ي'], bg: '#CFFAFE', fg: '#155E75' },
    { id: 'guttural', en: 'Guttural sounds', ar: 'الأصوات الحلقية', letters: ['ع', 'ح', 'خ', 'غ', 'ق', 'ك'], bg: '#FCE7F3', fg: '#9D174D' }
  ];
  const FIRST = [['Youssef', 'يوسف'], ['Nour', 'نور'], ['Ahmed', 'أحمد'], ['Mariam', 'مريم'], ['Omar', 'عمر'], ['Hana', 'هنا'], ['Salma', 'سلمى'], ['Karim', 'كريم'],
    ['Laila', 'ليلى'], ['Adam', 'آدم'], ['Malak', 'ملك'], ['Ziad', 'زياد'], ['Farida', 'فريدة'], ['Hamza', 'حمزة'], ['Jana', 'جنى'], ['Seif', 'سيف'],
    ['Rokaya', 'رقية'], ['Eyad', 'إياد'], ['Habiba', 'حبيبة'], ['Mostafa', 'مصطفى'], ['Tala', 'تالا'], ['Yassin', 'ياسين'], ['Lamar', 'لمار'], ['Ali', 'علي']];
  const LAST = [['Adel', 'عادل'], ['Mahmoud', 'محمود'], ['Hassan', 'حسن'], ['Khaled', 'خالد'], ['El-Sayed', 'السيد'], ['Rashid', 'رشيد'], ['Farouk', 'فاروق'], ['Nabil', 'نبيل'],
    ['Mansour', 'منصور'], ['Saleh', 'صالح'], ['Fathy', 'فتحي'], ['Gamal', 'جمال'], ['Shawky', 'شوقي'], ['Ezzat', 'عزت'], ['Hamdy', 'حمدي'], ['Tarek', 'طارق']];
  const GOOD = [
    { en: 'Great job! The placement is correct now.', ar: 'أحسنت! المخرج صحيح الآن.' },
    { en: 'Much better — keep your tongue tip up.', ar: 'أفضل بكثير — حافظ على رفع طرف لسانك.' },
    { en: 'Excellent! You are ready for the next session.', ar: 'ممتاز! أنت جاهز للجلسة التالية.' },
    { en: 'Very clear sound. Well done!', ar: 'صوت واضح جداً. أحسنت!' }
  ];
  const INTRO = [
    { en: 'Session {n} is open 🎯 Watch the video on {l}, then send me a 3-second attempt.', ar: 'الجلسة {n} مفتوحة 🎯 شاهد فيديو حرف {l} ثم أرسل لي محاولة مدتها ٣ ثوانٍ.' },
    { en: 'New session! Today we practise {l}. Watch the video slowly first.', ar: 'جلسة جديدة! نتدرب اليوم على حرف {l}. شاهد الفيديو بهدوء أولاً.' },
    { en: 'Ready for {l}? Remember: lips relaxed, then say it clearly.', ar: 'جاهز لحرف {l}؟ تذكّر: الشفايف مرتاحة ثم انطقه بوضوح.' }
  ];
  const PT_RETRY = [
    { en: 'Okay, I will try again 💪', ar: 'حاضر، هحاول تاني 💪' },
    { en: 'Is this one better?', ar: 'كده أحسن؟' },
    { en: 'He practised in front of the mirror, sending again.', ar: 'اتمرن قدام المراية، هبعت تاني.' }
  ];
  const PT_THANKS = [
    { en: 'Thank you doctor! 🙏', ar: 'شكراً يا دكتورة! 🙏' },
    { en: 'Yaay he is so happy 😊', ar: 'فرحان جداً 😊' },
    { en: 'Great, waiting for the next session!', ar: 'تمام، مستنيين الجلسة الجاية!' }
  ];
  const PT_Q = [
    { en: 'Should he say it slowly or normally?', ar: 'ينطقه ببطء ولا بسرعة عادية؟' },
    { en: 'We will record tonight after school.', ar: 'هنسجّل بالليل بعد المدرسة.' }
  ];
  const RETRY = [
    { en: 'Almost there — try once more, a bit louder.', ar: 'اقتربت — حاول مرة أخرى بصوت أعلى قليلاً.' },
    { en: 'Nice try. Watch the video again, then record.', ar: 'محاولة جيدة. شاهد الفيديو مرة أخرى ثم سجّل.' },
    { en: 'Slow down a little and say it clearly.', ar: 'تمهّل قليلاً وانطقه بوضوح.' }
  ];

  function seed() {
    const r = rng(20261023), now = Date.now(), H = 3600000, D = 86400000;
    const programs = PROGRAM_DEFS.map(def => {
      const sessions = []; let n = 0;
      const tpl = [['Placement of {l}', 'مخرج حرف {l}'], ['{l} in words', 'حرف {l} في الكلمات']];
      def.letters.forEach(l => tpl.forEach(([en, ar]) => { n++; sessions.push({ id: def.id + '-s' + n, en: en.replace('{l}', l), ar: ar.replace('{l}', l), letter: l }); }));
      n++; sessions.push({ id: def.id + '-s' + n, en: 'Full review', ar: 'مراجعة شاملة', letter: def.letters[0] });
      sessions.forEach((s, i) => { s.video = i < sessions.length - 2 ? { name: def.id + '-session-' + (i + 1) + '.mp4', size: (6 + Math.round(r() * 24)) + ' MB', at: now - (40 - i) * D } : null; });
      return { id: def.id, en: def.en, ar: def.ar, letters: def.letters.slice(), bg: def.bg, fg: def.fg, sessions };
    });

    const allPerms = { viewPatients: true, editPatients: true, registerPatients: true, reviewRecordings: true, respond: true, unlockSessions: true, managePrograms: true };
    const team = [
      { id: 'u1', en: 'Dr. Hala Ibrahim', ar: 'د. هالة إبراهيم', phone: '+20 100 111 2222', role: 'superadmin', active: true, color: 5, added: now - 80 * D, perms: allPerms },
      { id: 'u2', en: 'Mariam Ashraf', ar: 'مريم أشرف', phone: '+20 109 234 5678', role: 'assistant', active: true, color: 6, added: now - 50 * D,
        perms: { viewPatients: true, editPatients: false, registerPatients: false, reviewRecordings: true, respond: true, unlockSessions: true, managePrograms: false } },
      { id: 'u3', en: 'Khaled Fouad', ar: 'خالد فؤاد', phone: '+20 112 876 5432', role: 'assistant', active: true, color: 3, added: now - 39 * D,
        perms: { viewPatients: true, editPatients: false, registerPatients: false, reviewRecordings: true, respond: true, unlockSessions: false, managePrograms: false } },
      { id: 'u4', en: 'Noha Samir', ar: 'نهى سمير', phone: '+20 100 345 6789', role: 'assistant', active: true, color: 7, added: now - 22 * D,
        perms: { viewPatients: true, editPatients: true, registerPatients: true, reviewRecordings: true, respond: true, unlockSessions: false, managePrograms: false } }
    ];

    const FIXED = [
      { f: 0, l: 0, prog: 'alveolar', cur: 7, wait: 2, age: 6, status: 'active', phone: '+20 101 234 5678',
        notes: 'Youssef can produce ر in isolation but loses the trill inside words. Add tongue-flutter warm-ups before each attempt.' },
      { f: 1, l: 1, prog: 'alveolar', cur: 3, wait: 1, age: 8, status: 'active', phone: '+20 106 987 1234' },
      { f: 2, l: 2, prog: 'palatal', cur: 1, wait: 1, age: 7, status: 'active', phone: '+20 112 345 6789' },
      { f: 3, l: 3, prog: 'guttural', cur: 4, wait: 2, age: 5, status: 'active', phone: '+20 109 555 0142' },
      { f: 4, l: 4, prog: 'palatal', cur: 6, wait: 0, ready: true, age: 9, status: 'active', phone: '+20 100 987 6543' },
      { f: 5, l: 5, prog: 'nasal', cur: 3, wait: 0, ready: true, age: 7, status: 'active', phone: '+20 115 432 1098' },
      { f: 6, l: 6, prog: 'labial', cur: 7, wait: 0, age: 6, status: 'finished', phone: '+20 101 876 5432' },
      { f: 7, l: 7, prog: 'dental', cur: 2, wait: 0, age: 10, status: 'inactive', idle: 9, phone: '+20 100 123 7654' }
    ];

    const patients = [], messages = {};
    for (let i = 0; i < 42; i++) {
      let cfg;
      if (i < FIXED.length) cfg = FIXED[i];
      else {
        const def = PROGRAM_DEFS[Math.floor(r() * PROGRAM_DEFS.length)];
        const total = def.letters.length * 2 + 1;
        const st = r();
        const status = st < 0.08 ? 'paused' : st < 0.15 ? 'finished' : st < 0.19 ? 'inactive' : 'active';
        const wait = status === 'active' && r() < 0.22 ? (r() < 0.3 ? 2 : 1) : 0;
        cfg = { f: Math.floor(r() * FIRST.length), l: Math.floor(r() * LAST.length), prog: def.id,
          cur: status === 'finished' ? total : 1 + Math.floor(r() * (total - 1)), wait, ready: status === 'active' && !wait && r() < 0.3,
          age: 4 + Math.floor(r() * 8), status, idle: status === 'inactive' ? 6 + Math.floor(r() * 10) : status === 'paused' ? 3 + Math.floor(r() * 5) : (status === 'active' && !wait && r() < 0.25 ? 5 + Math.floor(r() * 4) : 0),
          phone: '+20 1' + ['0', '1', '2', '5'][Math.floor(r() * 4)] + String(Math.floor(r() * 10)) + ' ' + String(100 + Math.floor(r() * 900)) + ' ' + String(1000 + Math.floor(r() * 9000)) };
      }
      if (cfg.idle && cfg.status === 'active') cfg.ready = false;
      const pr = programs.find(p => p.id === cfg.prog);
      const id = 'p' + (i + 1);
      const p = {
        id, en: FIRST[cfg.f][0] + ' ' + LAST[cfg.l][0], ar: FIRST[cfg.f][1] + ' ' + LAST[cfg.l][1],
        phone: cfg.phone, age: cfg.age, guardian: { en: 'Mr. ' + LAST[cfg.l][0], ar: 'أ. ' + LAST[cfg.l][1] },
        programId: pr.id, current: cfg.cur, status: cfg.status, color: (i % 8) + 1,
        notes: cfg.notes || '', notif: { push: true, inapp: true, sms: i % 3 === 0 }, history: [], notifSeen: now - 3 * D
      };
      messages[id] = seedMessages(p, cfg, pr, r, now, H, i < FIXED.length);
      p.since = (messages[id][0] ? messages[id][0].ts : now) - 2 * D;
      patients.push(p);
    }
    return { v: 4, programs, team, patients, messages, created: now };
  }

  function fill(o, vars) { const f = x => Object.keys(vars).reduce((a, k) => a.split('{' + k + '}').join(vars[k]), x); return { en: f(o.en), ar: f(o.ar) }; }
  function seedMessages(p, cfg, pr, r, now, H, full) {
    const ev = [], n = pr.sessions.length, finished = p.status === 'finished';
    const lastDone = finished ? n : p.current - 1;
    const by = () => (r() < 0.75 ? 'u1' : (r() < 0.5 ? 'u2' : 'u4'));
    const add = o => { o.id = 'm' + p.id + '_' + ev.length; o.prog = pr.id; ev.push(o); return o; };
    const L = s => pr.sessions[s - 1].letter;
    const att = (s, status) => add({ from: 'patient', type: 'audio', audio: null, dur: +(1.3 + r() * 1.7).toFixed(1), session: s, letter: L(s), status, reaction: null });
    const th = (s, text, replyTo) => {
      const voice = r() < 0.25;
      return add({ from: 'therapist', type: voice ? 'audio' : 'text', text: voice ? null : text, audio: null, dur: voice ? +(1.6 + r() * 1.4).toFixed(1) : undefined, session: s, by: by(), replyTo: replyTo || null, reaction: null });
    };
    const pt = (s, text, replyTo) => add({ from: 'patient', type: 'text', text, session: s, replyTo: replyTo || null, seen: true, reaction: null });
    const sys = (kind, s) => add({ from: 'system', kind, session: s, by: 'u1' });
    const intro = s => th(s, fill(pick(INTRO, r), { n: s, l: L(s) }));

    const first = full ? 1 : Math.max(1, lastDone - 2);
    if (first === 1) sys('unlock', 1);
    for (let s = first; s <= lastDone; s++) {
      intro(s);
      let a = att(s, r() < 0.5 ? 'retry' : 'approved');
      let guard = 0;
      while (a.status === 'retry' && guard++ < 2) {
        const tr = th(s, pick(RETRY, r), a.id);
        if (r() < 0.7) pt(s, pick(PT_RETRY, r), tr.id);
        a = att(s, guard >= 2 || r() < 0.6 ? 'approved' : 'retry');
      }
      if (r() < 0.45) a.reaction = pick(['👍', '👏', '❤️'], r);
      const good = th(s, pick(GOOD, r), a.id);
      if (r() < 0.5) { pt(s, pick(PT_THANKS, r), good.id); if (r() < 0.5) good.reaction = '❤️'; }
      sys(s < n ? 'unlock' : 'finished', s < n ? s + 1 : s);
    }
    if (!finished) {
      const c = p.current;
      intro(c);
      if (cfg.ready) { const a = att(c, 'approved'); if (r() < 0.5) a.reaction = '👏'; th(c, pick(GOOD, r), a.id); }
      else if (cfg.wait) {
        if (r() < 0.6) { const a = att(c, 'retry'); const tr = th(c, pick(RETRY, r), a.id); pt(c, pick(PT_RETRY, r), tr.id); }
      } else if (r() < 0.4) { const q = pt(c, pick(PT_Q, r)); q.seen = false; }
    }
    // timestamps: walk backwards from "recently"
    let ts = now - (cfg.idle || 0) * 86400000 - (cfg.wait ? 26 : 3) * H - r() * 6 * H;
    for (let i = ev.length - 1; i >= 0; i--) {
      ev[i].ts = Math.round(ts);
      const e = ev[i], prev = ev[i - 1];
      ts -= e.from === 'system' ? (0.2 + r() * 0.6) * H
        : prev && prev.from === 'system' ? (0.1 + r() * 0.3) * H
        : e.from === 'therapist' ? (0.5 + r() * 6) * H
        : (1 + r() * 18) * H;
    }
    if (!finished && cfg.wait) {
      const base = ev[ev.length - 1].ts;
      for (let k = 0; k < cfg.wait; k++) {
        const m = att(p.current, 'waiting');
        m.ts = Math.round(base + (k + 1) * (now - base) / (cfg.wait + 1) * 0.9);
      }
    }
    return ev;
  }

  /* ---------------- data access ---------------- */
  function db() {
    if (!_db) {
      _db = lsGet(KEYS.db, null);
      if (!_db || _db.v !== 4) { _db = seed(); lsSet(KEYS.db, _db); }
    }
    return _db;
  }
  function save() { return lsSet(KEYS.db, db()); }
  function resetDemo() {
    localStorage.removeItem(KEYS.db); localStorage.removeItem(KEYS.drafts);
    _db = null; db();
  }
  function getPatient(id) { return db().patients.find(p => p.id === id); }
  function getProgram(id) { return db().programs.find(p => p.id === id); }
  function getMember(id) { return db().team.find(u => u.id === id); }
  function sessionsOf(p) { const pr = getProgram(p.programId); return pr ? pr.sessions : []; }
  function currentSession(p) { const s = sessionsOf(p); return s[Math.max(0, Math.min(p.current, s.length) - 1)]; }
  function msgsOf(pid) { const d = db(); if (!d.messages[pid]) d.messages[pid] = []; return d.messages[pid]; }
  function isAttempt(m) { return m.from === 'patient' && m.type === 'audio' && !m.deleted; }
  function waitingOf(pid) { return msgsOf(pid).filter(m => isAttempt(m) && m.status === 'waiting'); }
  function unseenTexts(pid) { return msgsOf(pid).filter(m => m.from === 'patient' && m.type === 'text' && m.seen === false && !m.deleted); }
  function totalWaiting() { return db().patients.reduce((a, p) => a + (p.status === 'inactive' ? 0 : waitingOf(p.id).length), 0); }
  function lastMsg(pid) { const m = msgsOf(pid); return m[m.length - 1]; }
  function lastActivity(p) { const m = msgsOf(p.id).filter(x => x.kind !== 'reminder'); return m.length ? m[m.length - 1].ts : p.since; }
  function lastReminder(pid) { const r = msgsOf(pid).filter(m => m.kind === 'reminder'); return r.length ? r[r.length - 1] : null; }
  function pct(p) { const n = sessionsOf(p).length || 1; return p.status === 'finished' ? 100 : Math.round((p.current - 1) / n * 100); }
  function isReady(p) {
    if (p.status !== 'active') return false;
    const ms = msgsOf(p.id).filter(m => isAttempt(m) && m.session === p.current && m.prog === p.programId);
    if (!ms.length || ms.some(m => m.status === 'waiting')) return false;
    return ms[ms.length - 1].status === 'approved';
  }
  function authorName(id) { const u = getMember(id); return u ? L(u) : t('role.therapist'); }

  /* ---------------- domain actions ---------------- */
  function addMsg(pid, m) { const full = Object.assign({ id: uid('m'), ts: Date.now() }, m); msgsOf(pid).push(full); return full; }
  function unlockNext(pid) {
    const p = getPatient(pid), n = sessionsOf(p).length, u = me();
    if (p.status === 'finished') return 'already';
    if (p.current >= n) { p.status = 'finished'; addMsg(pid, { from: 'system', kind: 'finished', prog: p.programId, by: u.id }); }
    else { p.current++; addMsg(pid, { from: 'system', kind: 'unlock', session: p.current, prog: p.programId, by: u.id }); }
    save();
    return p.status === 'finished' ? 'finished' : 'unlocked';
  }
  function relock(pid) {
    const p = getPatient(pid);
    if (p.status === 'finished') p.status = 'active';
    else if (p.current > 1) p.current--;
    else return false;
    addMsg(pid, { from: 'system', kind: 'relock', session: p.current, prog: p.programId, by: me().id });
    save();
    return true;
  }
  const REMIND_GAP = 30 * 60000;
  function remind(pid) {
    const p = getPatient(pid); if (!p) return { res: 'none' };
    if (p.status !== 'active') return { res: 'blocked', p };
    const last = lastReminder(pid);
    if (last && Date.now() - last.ts < REMIND_GAP) return { res: 'recent', p, last };
    addMsg(pid, { from: 'system', kind: 'reminder', session: p.current, prog: p.programId, by: me().id });
    if (!save()) { msgsOf(pid).pop(); return { res: 'none' }; }
    return { res: 'sent', p };
  }
  function remindToast(pid) {
    const r = remind(pid), name = r.p ? esc(L(r.p)) : '';
    if (r.res === 'sent') toast(t('toast.reminderSent'), t('toast.reminderSentBody', { name }), 'success');
    else if (r.res === 'recent') toast(t('toast.reminderRecent'), t('toast.reminderRecentBody', { name, t: rel(r.last.ts) }), 'info');
    else if (r.res === 'blocked') toast(t('toast.reminderBlocked'), t('toast.reminderBlockedBody', { name, s: t('status.' + r.p.status) }), 'error');
    return r.res;
  }
  function setVerdict(pid, mid, v) {
    const m = msgsOf(pid).find(x => x.id === mid);
    if (!m) return null;
    m.status = v; m.reviewedBy = me().id; m.reviewedAt = Date.now();
    save();
    return m;
  }
  function reply(pid, o) {
    const m = addMsg(pid, Object.assign({ from: 'therapist', by: me().id }, o));
    waitingOf(pid).forEach(w => { w.status = 'reviewed'; w.reviewedBy = me().id; w.reviewedAt = Date.now(); });
    if (!save()) { msgsOf(pid).pop(); return null; }
    return m;
  }
  function chatSend(pid, o) {
    const p = getPatient(pid), r = role(), u = me();
    const session = o.session || p.current, ses = sessionsOf(p)[session - 1];
    const m = { from: r === 'patient' ? 'patient' : 'therapist', type: o.type, session, prog: p.programId, replyTo: o.replyTo || null, reaction: null };
    if (o.type === 'text') m.text = o.text; else { m.audio = o.audio; m.dur = o.dur; }
    if (m.from === 'therapist') {
      m.by = u.id;
      const target = o.replyTo && msgsOf(pid).find(x => x.id === o.replyTo);
      const toMark = target && isAttempt(target) ? [target] : msgsOf(pid).filter(x => isAttempt(x) && x.session === session && x.prog === p.programId);
      toMark.forEach(w => { if (w.status === 'waiting') { w.status = 'reviewed'; w.reviewedBy = u.id; w.reviewedAt = Date.now(); } });
    } else if (o.type === 'audio') { m.status = 'waiting'; m.letter = ses ? ses.letter : ''; }
    else m.seen = false;
    const full = addMsg(pid, m);
    if (!save()) { msgsOf(pid).pop(); return null; }
    return full;
  }
  const DELETE_WINDOW = 15 * 60000;
  function isMine(m) {
    const r = role(), u = me(); if (!u) return false;
    return r === 'patient' ? m.from === 'patient' : (m.from === 'therapist' && m.by === u.id);
  }
  function canDelete(m) {
    if (!m || m.deleted || m.from === 'system' || !isMine(m)) return false;
    if (Date.now() - m.ts > DELETE_WINDOW) return false;
    if (isAttempt(m) && m.status !== 'waiting') return false; // already reviewed by the therapist
    return true;
  }
  function deleteMinutesLeft(m) { return Math.max(1, Math.ceil((DELETE_WINDOW - (Date.now() - m.ts)) / 60000)); }
  function deleteMsg(pid, mid) {
    const m = msgsOf(pid).find(x => x.id === mid);
    if (!canDelete(m)) return false;
    m.deleted = true; m.deletedAt = Date.now();
    delete m.text; m.audio = null; m.reaction = null; m.status = null; m.seen = true;
    save();
    return true;
  }
  function markSeen(pid, session) {
    let ch = false;
    msgsOf(pid).forEach(m => { if (m.from === 'patient' && m.type === 'text' && m.seen === false && (!session || m.session === session)) { m.seen = true; ch = true; } });
    if (ch) save();
  }
  function patientSend(pid, o) {
    const p = getPatient(pid), s = currentSession(p);
    addMsg(pid, { from: 'patient', type: 'audio', audio: o.audio, dur: o.dur, session: p.current, letter: s ? s.letter : '', prog: p.programId, status: 'waiting', reaction: null, replyTo: null });
    if (!save()) { msgsOf(pid).pop(); return false; }
    return true;
  }

  /* ---------------- auth & roles ---------------- */
  const ADMIN_ONLY = ['deleteUsers', 'manageTeam'];
  function session() { return lsGet(KEYS.session, null); }
  function me() {
    const s = session(); if (!s) return null;
    return s.role === 'patient' ? getPatient(s.userId) : getMember(s.userId);
  }
  function role() { const s = session(); return s ? s.role : null; }
  function can(perm) {
    const s = session(); if (!s) return false;
    if (s.role === 'superadmin') return true;
    if (s.role !== 'assistant') return false;
    if (ADMIN_ONLY.includes(perm)) return false;
    const u = me(); return !!(u && u.perms && u.perms[perm]);
  }
  function need(perm) {
    if (can(perm)) return true;
    toast(t('toast.permError'), t('toast.permErrorBody'), 'error');
    return false;
  }
  function findAccount(r, phone) {
    const d = digits(phone).replace(/^20/, '').replace(/^0/, '');
    const match = x => digits(x.phone).replace(/^20/, '').replace(/^0/, '') === d;
    if (r === 'patient') return db().patients.find(match);
    return db().team.find(u => u.role === r && match(u));
  }
  function signIn(r, id) { lsSet(KEYS.session, { role: r, userId: id, at: Date.now() }); }
  function signOut() { localStorage.removeItem(KEYS.session); location.href = 'login.html'; }
  function homeFor(r) { return r === 'patient' ? 'patient-home.html' : r ? 'dashboard.html' : 'login.html'; }

  /* ---------------- icons ---------------- */
  const IC = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    chat: '<path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H9l-6 4V7z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    book: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    back: '<polyline points="15 18 9 12 15 6"/>',
    next: '<polyline points="9 18 15 12 9 6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    pausec: '<circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>',
    userx: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/>',
    usercheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'
  };
  const MIRROR = { arrow: 1, back: 1, next: 1, send: 1, logout: 1 };
  function icon(n, c) { return '<svg class="icon ' + (c || '') + (MIRROR[n] ? ' icon-mirror' : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

  /* ---------------- small UI helpers ---------------- */
  function initials(o) {
    if (!o) return '?';
    if (lang === 'ar' && o.ar) return o.ar.replace(/^د\.\s*/, '').trim().charAt(0);
    const w = (o.en || '').replace(/^Dr\.?\s*/, '').split(/\s+/).filter(Boolean);
    return (((w[0] || '?')[0]) + ((w[1] || '')[0] || '')).toUpperCase();
  }
  function avatar(o, size) { return '<div class="avatar ' + (size || '') + ' color-' + ((o && o.color) || 5) + '">' + esc(initials(o)) + '</div>'; }
  function roleBadge(r) { return '<span class="role-badge ' + r + '">' + t('role.' + r) + '</span>'; }
  function waitingLabel(n) { return '<span class="waiting-label"><span class="dot"></span>' + t('status.waiting') + (n > 1 ? ' · ' + n : '') + '</span>'; }
  function patientBadge(p) {
    const w = waitingOf(p.id).length;
    if (w && p.status !== 'inactive') return waitingLabel(w);
    if (isReady(p)) return '<span class="badge badge-indigo"><span class="badge-dot"></span>' + t('status.ready') + '</span>';
    const map = { active: 'mint', paused: 'amber', finished: 'indigo', inactive: 'rose' };
    return '<span class="badge badge-' + map[p.status] + '"><span class="badge-dot"></span>' + t('status.' + p.status) + '</span>';
  }
  function verdictBadge(m) {
    if (m.status === 'waiting') return waitingLabel(1);
    const map = { approved: 'mint', retry: 'amber', reviewed: 'neutral' };
    return '<span class="badge badge-' + (map[m.status] || 'neutral') + '"><span class="badge-dot"></span>' + t('status.' + m.status) + '</span>';
  }
  function letterChip(l) { return '<span class="ar-letter">' + esc(l) + '</span>'; }
  function progressBar(v, cls) { return '<div class="progress"><div class="progress-bar ' + (cls || '') + '" style="width:' + v + '%"></div></div>'; }
  function ring(v, color, size) {
    size = size || 56; const r = size / 2 - 6, c = 2 * Math.PI * r;
    return '<div class="ring" style="width:' + size + 'px;height:' + size + 'px"><svg width="' + size + '" height="' + size + '"><circle class="track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '"/><circle class="fill" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke="' + (color || '#5D5FEF') + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - v / 100)).toFixed(1) + '"/></svg><div class="ring-label">' + v + '%</div></div>';
  }
  function empty(iconName, title, sub) {
    return '<div class="empty"><div class="empty-icon">' + icon(iconName) + '</div><div class="empty-title">' + title + '</div>' + (sub ? '<div class="empty-sub">' + sub + '</div>' : '') + '</div>';
  }
  function msgText(m) { if (m.deleted) return '🚫 ' + t('chat.deletedMsg'); return esc(typeof m.text === 'string' ? m.text : L(m.text)); }
  function sysText(m) {
    if (m.kind === 'unlock') return t('sys.unlock', { n: m.session });
    if (m.kind === 'relock') return t('sys.relock', { n: m.session });
    if (m.kind === 'finished') return t('sys.finished');
    if (m.kind === 'reminder') return role() === 'patient' ? t('sys.reminderPatient', { n: m.session }) : t('sys.reminder');
    return '';
  }
  function sysIcon(m) { return { relock: 'lock', finished: 'star', reminder: 'bell' }[m.kind] || 'unlock'; }
  function param(name) { return new URLSearchParams(location.search).get(name); }

  /* ---------------- toast ---------------- */
  function toast(title, body, kind, action) {
    kind = kind || 'success';
    let box = document.getElementById('toast-container');
    if (!box) { box = document.createElement('div'); box.id = 'toast-container'; box.className = 'toast-container'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.setAttribute('role', 'status');
    const ic = { success: 'check', error: 'alert', info: 'info' }[kind];
    el.innerHTML = '<div class="toast-icon">' + icon(ic, 'icon-sm') + '</div><div class="toast-body"><div class="toast-title">' + title + '</div>' +
      (body ? '<div class="toast-sub">' + body + '</div>' : '') + (action ? '<button class="toast-action">' + action.label + '</button>' : '') +
      '</div><button class="toast-close" aria-label="' + t('common.close') + '">×</button>';
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    let timer;
    const dismiss = () => { clearTimeout(timer); el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
    el.querySelector('.toast-close').onclick = dismiss;
    if (action) el.querySelector('.toast-action').onclick = () => { dismiss(); action.fn(); };
    timer = setTimeout(dismiss, action ? 6000 : 3500);
  }
  function flash(title, body, kind) { sessionStorage.setItem(KEYS.flash, JSON.stringify({ title, body, kind })); }

  /* ---------------- modal ---------------- */
  function modal(o) {
    const depth = document.querySelectorAll('.mx').length;
    const bd = document.createElement('div'); bd.className = 'mx-backdrop'; bd.style.zIndex = 100 + depth * 20;
    const el = document.createElement('div'); el.className = 'mx' + (o.side ? ' mx-side' : '') + (o.wide ? ' mx-wide' : ''); el.style.zIndex = 110 + depth * 20;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="mx-head"><div><div class="mx-title">' + o.title + '</div>' + (o.sub ? '<div class="mx-sub">' + o.sub + '</div>' : '') +
      '</div><button class="close-btn" data-x aria-label="' + t('common.close') + '">' + icon('x', 'icon-sm') + '</button></div><div class="mx-body">' + (o.body || '') + '</div><div class="mx-foot"></div>';
    const foot = el.querySelector('.mx-foot');
    const close = () => {
      bd.classList.remove('open'); el.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { bd.remove(); el.remove(); }, 220);
      if (o.onClose) o.onClose();
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    (o.actions || [{ label: t('common.close') }]).forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn btn-' + (a.kind || 'secondary');
      b.innerHTML = a.label;
      b.onclick = () => { if (a.onClick) { if (a.onClick(el, close) !== false) close(); } else close(); };
      foot.appendChild(b);
    });
    if (!foot.children.length) foot.remove();
    bd.onclick = close;
    el.querySelector('[data-x]').onclick = close;
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bd); document.body.appendChild(el);
    requestAnimationFrame(() => { bd.classList.add('open'); el.classList.add('open'); const f = el.querySelector('input,textarea,select'); if (f) f.focus(); });
    return { el, close };
  }
  function confirmBox(o) {
    return modal({ title: o.title, sub: o.body, actions: [
      { label: t('common.cancel') },
      { label: o.yes || t('common.confirm'), kind: o.danger ? 'danger' : 'primary', onClick: () => { o.onYes(); } }
    ] });
  }
  function fieldError(el, sel, msg) {
    const f = el.querySelector(sel); if (!f) return;
    f.classList.add('invalid'); f.focus();
    toast(msg, '', 'error');
    f.addEventListener('input', () => f.classList.remove('invalid'), { once: true });
  }

  /* ---------------- CSV ---------------- */
  function downloadCSV(name, rows) {
    const csv = '\ufeff' + rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------------- charts ---------------- */
  function lineChart(o) {
    const W = 700, H = o.height || 220, pl = 34, pr = 14, pt = 14, pb = 28;
    const max = Math.max(4, ...o.series.reduce((a, s) => a.concat(s.values), []));
    const step = Math.ceil(max / 4), top = step * 4, n = o.labels.length;
    const x = i => pl + (n <= 1 ? 0 : i * (W - pl - pr) / (n - 1));
    const y = v => pt + (H - pt - pb) * (1 - v / top);
    let g = '';
    for (let k = 0; k <= 4; k++) { const yy = y(k * step); g += '<line x1="' + pl + '" y1="' + yy + '" x2="' + (W - pr) + '" y2="' + yy + '" stroke="#E6E9F2"/><text x="' + (pl - 8) + '" y="' + (yy + 3) + '" text-anchor="end" font-size="10" fill="#9CA2BB">' + k * step + '</text>'; }
    const every = Math.ceil(n / 7);
    o.labels.forEach((l, i) => { if (i % every === 0 || i === n - 1) g += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#9CA2BB">' + esc(l) + '</text>'; });
    o.series.forEach(s => {
      const pts = s.values.map((v, i) => x(i) + ',' + y(v)).join(' ');
      g += '<polygon points="' + x(0) + ',' + y(0) + ' ' + pts + ' ' + x(n - 1) + ',' + y(0) + '" fill="' + s.color + '" opacity=".08"/>';
      g += '<polyline points="' + pts + '" fill="none" stroke="' + s.color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
      s.values.forEach((v, i) => { g += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="3" fill="#fff" stroke="' + s.color + '" stroke-width="2"><title>' + esc(s.name) + ': ' + v + ' · ' + esc(o.labels[i]) + '</title></circle>'; });
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" role="img" aria-label="' + esc(o.label || '') + '">' + g + '</svg>';
  }
  function legend(series) { return '<div class="legend">' + series.map(s => '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>').join('') + '</div>'; }
  function hbars(items) {
    const max = Math.max(1, ...items.map(i => i.value));
    return '<div class="hbars">' + items.map(i => '<div class="hbar"><div class="hbar-label">' + i.label + '</div><div class="hbar-track"><div class="hbar-fill" style="width:' + Math.round(i.value / max * 100) + '%;background:' + (i.color || 'var(--indigo)') + '"></div></div><div class="hbar-val">' + i.value + (i.suffix || '') + '</div></div>').join('') + '</div>';
  }
  function activitySeries(days) {
    const labels = [], att = [], resp = [];
    const start = dayStart(Date.now()) - (days - 1) * 86400000;
    for (let i = 0; i < days; i++) { labels.push(fmtDate(start + i * 86400000)); att.push(0); resp.push(0); }
    const d = db();
    Object.keys(d.messages).forEach(pid => d.messages[pid].forEach(m => {
      const idx = Math.floor((dayStart(m.ts) - start) / 86400000);
      if (idx < 0 || idx >= days) return;
      if (isAttempt(m)) att[idx]++; else if (m.from === 'therapist') resp[idx]++;
    }));
    return { labels, att, resp };
  }

  /* ---------------- audio: waveform, demo sound, player ---------------- */
  const AUDIO = {}, DEMO = {};
  function waveHTML(seedStr, n) {
    const r = rng('w' + seedStr); let s = '';
    for (let i = 0; i < (n || 28); i++) s += '<i class="b" style="height:' + (22 + Math.round(r() * 74)) + '%"></i>';
    return '<div class="wave">' + s + '</div>';
  }
  function audioHTML(id, src, dur, bars) {
    AUDIO[id] = { src: src || null, dur: dur || 2 };
    const playing = Player.cur && Player.cur.id === id && !Player.cur.a.paused;
    return '<div class="audio-row" data-audio="' + esc(id) + '"><button type="button" class="play-btn' + (playing ? ' playing' : '') + '" data-play="' + esc(id) + '" aria-label="' + t('audio.play') + '">' + icon(playing ? 'pause' : 'play') + '</button>' +
      waveHTML(id, bars) + '<span class="dur">' + fmtDur(dur) + '</span></div>';
  }
  function demoWav(seedStr, dur) {
    if (DEMO[seedStr]) return DEMO[seedStr];
    const sr = 8000, len = Math.max(0.6, Math.min(MAX_REC, dur || 2)), n = Math.floor(sr * len);
    const r = rng('a' + seedStr), f0 = 165 + r() * 90, trill = 18 + r() * 10;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / sr;
      const env = Math.min(1, tt * 10) * Math.min(1, (len - tt) * 6);
      const syl = 0.55 + 0.45 * Math.sin(2 * Math.PI * 2.1 * tt);
      const tr = 0.62 + 0.38 * Math.sin(2 * Math.PI * trill * tt);
      ph += 2 * Math.PI * f0 * (1 + 0.03 * Math.sin(2 * Math.PI * 5 * tt)) / sr;
      const s = (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph) + 0.12 * Math.sin(4 * ph)) / 1.9 * env * syl * tr * 0.6;
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
    }
    const bytes = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return (DEMO[seedStr] = 'data:audio/wav;base64,' + btoa(bin));
  }
  function setAudioUI(id, playing, frac) {
    document.querySelectorAll('[data-audio="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]').forEach(row => {
      const btn = row.querySelector('.play-btn');
      if (btn) { btn.classList.toggle('playing', playing); btn.innerHTML = icon(playing ? 'pause' : 'play'); btn.setAttribute('aria-label', t(playing ? 'audio.pause' : 'audio.play')); }
      const bars = row.querySelectorAll('.b'), on = Math.round(bars.length * Math.min(1, frac));
      bars.forEach((b, i) => b.classList.toggle('on', i < on));
    });
  }
  const Player = {
    cur: null,
    toggle(id) {
      const reg = AUDIO[id]; if (!reg) return;
      if (this.cur && this.cur.id === id) { const a0 = this.cur.a, d0 = isFinite(a0.duration) && a0.duration > 0 ? a0.duration : reg.dur;
        if (a0.paused) { const pr = a0.play(); if (pr && pr.catch) pr.catch(() => {}); setAudioUI(id, true, a0.currentTime / d0); } else { a0.pause(); setAudioUI(id, false, a0.currentTime / d0); }
        return; }
      this.stop();
      const a = new Audio(reg.src || demoWav(id, reg.dur));
      this.cur = { id, a };
      const tick = () => {
        if (!this.cur || this.cur.a !== a) return;
        const d = isFinite(a.duration) && a.duration > 0 ? a.duration : reg.dur;
        setAudioUI(id, !a.paused, d ? a.currentTime / d : 0);
      };
      a.addEventListener('timeupdate', tick); a.addEventListener('play', tick); a.addEventListener('pause', tick);
      a.addEventListener('ended', () => this.stop());
      const pr = a.play(); setAudioUI(id, true, 0); if (pr && pr.catch) pr.catch(() => { toast(t('audio.error'), t('audio.errorBody'), 'error'); this.stop(); });
    },
    stop() { if (!this.cur) return; const { id, a } = this.cur; this.cur = null; a.pause(); setAudioUI(id, false, 0); }
  };

  /* ---------------- audio: recorder (3 s max) ---------------- */
  const Recorder = {
    st: null,
    get busy() { return !!this.st; },
    async start(o) {
      if (this.st) return null;
      o = o || {};
      const st = { chunks: [], real: false };
      this.st = st;
      const done = new Promise(res => { st.resolve = res; });
      let stream = null;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) throw new Error('unsupported');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) { stream = null; st.micError = e && e.name; }
      if (this.st !== st) { if (stream) stream.getTracks().forEach(x => x.stop()); return null; }
      st.t0 = Date.now();
      st.tick = setInterval(() => o.onTick && o.onTick(Math.min(MAX_REC, (Date.now() - st.t0) / 1000)), 50);
      if (stream) {
        st.real = true; st.stream = stream;
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
        st.mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        st.mr.ondataavailable = e => { if (e.data && e.data.size) st.chunks.push(e.data); };
        st.mr.onstop = () => this._finish(st);
        st.mr.start();
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          st.ctx = new AC(); const an = st.ctx.createAnalyser(); an.fftSize = 64;
          st.ctx.createMediaStreamSource(stream).connect(an);
          const data = new Uint8Array(an.frequencyBinCount);
          const loop = () => { an.getByteFrequencyData(data); if (o.onLevel) o.onLevel(data); st.raf = requestAnimationFrame(loop); };
          loop();
        } catch (e) { /* level meter is optional */ }
      }
      if (o.onStart) o.onStart(st.real);
      st.auto = setTimeout(() => this.stop(), MAX_REC * 1000);
      return done;
    },
    stop() {
      const st = this.st; if (!st || st.stopping || !st.t0) return;
      st.stopping = true;
      clearTimeout(st.auto); clearInterval(st.tick); cancelAnimationFrame(st.raf);
      st.dur = Math.round(Math.min(MAX_REC, (Date.now() - st.t0) / 1000) * 10) / 10;
      if (st.mr && st.mr.state !== 'inactive') st.mr.stop(); else this._finish(st);
    },
    cancel() { const st = this.st; if (!st) return; st.cancelled = true; this.stop(); },
    _finish(st) {
      if (st.stream) st.stream.getTracks().forEach(x => x.stop());
      if (st.ctx) st.ctx.close().catch(() => {});
      this.st = null;
      if (st.cancelled) { st.resolve(null); return; }
      if (st.real && st.chunks.length) {
        const fr = new FileReader();
        fr.onload = () => st.resolve({ src: fr.result, dur: st.dur, real: true });
        fr.onerror = () => st.resolve({ src: demoWav('rec' + Date.now(), st.dur), dur: st.dur, real: false });
        fr.readAsDataURL(new Blob(st.chunks, { type: st.chunks[0].type || 'audio/webm' }));
      } else {
        st.resolve({ src: demoWav('rec' + Date.now(), st.dur), dur: st.dur, real: false, micError: st.micError });
      }
    }
  };
  function getDrafts(pid) { return lsGet(KEYS.drafts, []).filter(d => d.pid === pid); }
  function setDrafts(pid, list) {
    const others = lsGet(KEYS.drafts, []).filter(d => d.pid !== pid);
    return lsSet(KEYS.drafts, others.concat(list));
  }

  /* ---------------- video storage (IndexedDB — holds real video files) ---------------- */
  const VideoStore = {
    _db: null, urls: {},
    open() {
      if (this._db) return this._db;
      this._db = new Promise((res, rej) => {
        if (!window.indexedDB) { rej(new Error('no-idb')); return; }
        let r;
        try { r = indexedDB.open('nataq_videos', 1); } catch (e) { rej(e); return; }
        r.onupgradeneeded = () => r.result.createObjectStore('videos');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      this._db.catch(() => { this._db = null; });
      return this._db;
    },
    async tx(mode, fn) {
      const d = await this.open();
      return new Promise((res, rej) => {
        const tx = d.transaction('videos', mode), req = fn(tx.objectStore('videos'));
        tx.oncomplete = () => res(req ? req.result : undefined);
        tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      });
    },
    put(key, blob) { return this.tx('readwrite', st => st.put(blob, key)); },
    get(key) { return this.tx('readonly', st => st.get(key)); },
    del(key) { if (this.urls[key]) { URL.revokeObjectURL(this.urls[key]); delete this.urls[key]; } return this.tx('readwrite', st => st.delete(key)).catch(() => {}); },
    clear() { return this.tx('readwrite', st => st.clear()).catch(() => {}); },
    async url(key) {
      if (this.urls[key]) return this.urls[key];
      const b = await this.get(key);
      return b ? (this.urls[key] = URL.createObjectURL(b)) : null;
    }
  };
  function findSession(id) { for (const pr of db().programs) { const s = pr.sessions.find(x => x.id === id); if (s) return s; } return null; }
  function videoChip(s) {
    if (!s.video) return '<span class="vid-chip missing">' + icon('alert', 'icon-sm') + t('pd.noVideo') + '</span>';
    if (s.video.key) return '<button type="button" class="vid-chip" data-video="' + esc(s.id) + '" title="' + t('video.preview') + '">' + icon('play', 'icon-sm') + esc(s.video.name) + ' · ' + esc(s.video.size) + '</button>';
    return '<button type="button" class="vid-chip sample" data-video="' + esc(s.id) + '" title="' + t('video.sampleBody') + '">' + icon('video', 'icon-sm') + esc(s.video.name) + ' · ' + t('video.sample') + '</button>';
  }
  function videoMissingHTML() { return '<div class="vid-msg">' + icon('alert') + '<div>' + t('video.missing') + '</div><small>' + t('video.missingBody') + '</small></div>'; }
  async function mountVideo(box, s) {
    box.innerHTML = '<div class="vid-msg">' + t('video.loading') + '</div>';
    let u = null;
    try { u = await VideoStore.url(s.video.key); } catch (e) { u = null; }
    if (!u) { box.innerHTML = videoMissingHTML(); return false; }
    Player.stop();
    box.innerHTML = '<video controls playsinline autoplay preload="metadata" src="' + u + '"></video>';
    return true;
  }
  function previewVideo(s) {
    if (!s || !s.video) return;
    if (!s.video.key) { toast(t('video.sample'), t('video.sampleBody'), 'info'); return; }
    const m = modal({ wide: true, title: esc(L(s)), sub: esc(s.video.name) + ' · ' + esc(s.video.size), body: '<div class="vid-wrap"></div>' });
    mountVideo(m.el.querySelector('.vid-wrap'), s);
  }

  /* ---------------- layout ---------------- */
  const NAV = [
    { id: 'dashboard', href: 'dashboard.html', key: 'nav.dashboard', icon: 'grid' },
    { id: 'review', href: 'review.html', key: 'nav.review', icon: 'chat', perm: 'reviewRecordings', count: totalWaiting },
    { id: 'patients', href: 'patients.html', key: 'nav.patients', icon: 'users', perm: 'viewPatients' },
    { id: 'programs', href: 'programs.html', key: 'nav.programs', icon: 'book' },
    { id: 'analytics', href: 'analytics.html', key: 'nav.analytics', icon: 'chart' },
    { id: 'team', href: 'team.html', key: 'nav.team', icon: 'shield', perm: 'manageTeam' }
  ];
  function langSwitch() {
    return '<div class="lang-switch"><button class="lang-btn' + (lang === 'en' ? ' active' : '') + '" data-lang="en">EN</button><button class="lang-btn ar' + (lang === 'ar' ? ' active' : '') + '" data-lang="ar">العربية</button></div>';
  }
  function staffNotifs() {
    const list = [];
    db().patients.forEach(p => { if (p.status !== 'inactive') { waitingOf(p.id).forEach(m => list.push({ p, m })); unseenTexts(p.id).forEach(m => list.push({ p, m })); } });
    return list.sort((a, b) => b.m.ts - a.m.ts);
  }
  function patientNotifs(p) {
    return msgsOf(p.id).filter(m => !m.deleted && (m.from === 'therapist' || (m.from === 'system' && m.kind !== 'relock'))).slice().sort((a, b) => b.ts - a.ts);
  }
  function bellHTML() {
    const r = role();
    let items, count;
    if (r === 'patient') {
      const p = me(); const all = patientNotifs(p);
      count = all.filter(m => m.ts > (p.notifSeen || 0)).length;
      items = all.slice(0, 6).map(m => '<a class="notif-item' + (m.ts > (p.notifSeen || 0) ? ' unread' : '') + '" href="patient-chat.html?s=' + (m.session || p.current) + '&m=' + m.id + '"><div class="notif-ic">' + icon(m.from === 'system' ? sysIcon(m) : 'chat', 'icon-sm') + '</div><div><div class="notif-title">' +
        (m.from === 'system' ? sysText(m) : t('notif.newReply', { name: authorName(m.by) })) + '</div><div class="notif-time">' + rel(m.ts) + '</div></div></a>').join('');
    } else {
      const all = staffNotifs(); count = all.length;
      items = all.slice(0, 6).map(({ p, m }) => {
        const txt = isAttempt(m) ? t('notif.newRecording', { name: esc(L(p)), letter: esc(m.letter) })
          : t('notif.newMessage', { name: esc(L(p)), text: esc((typeof m.text === 'string' ? m.text : L(m.text)).slice(0, 60)) });
        return '<a class="notif-item unread" href="review.html?p=' + p.id + '&s=' + m.session + '&m=' + m.id + '"><div class="notif-ic">' + icon(isAttempt(m) ? 'mic' : 'chat', 'icon-sm') + '</div><div><div class="notif-title">' +
          txt + '</div><div class="notif-time">' + t('chat.sChip', { n: m.session }) + ' · ' + rel(m.ts) + '</div></div></a>';
      }).join('');
    }
    return '<div class="dd" data-bell="' + (r === 'patient' ? 'patient' : 'staff') + '"><button class="icon-btn" data-dd aria-label="' + t('nav.notifications') + '">' + icon('bell') + (count ? '<span class="dot-count">' + count + '</span>' : '') +
      '</button><div class="dd-panel notif-panel"><div class="dd-head">' + t('nav.notifications') + '</div>' + (items || '<div class="notif-empty">' + t('notif.empty') + '</div>') +
      (r !== 'patient' && count ? '<a class="dd-foot" href="review.html">' + t('notif.openInbox') + '</a>' : '') + '</div></div>';
  }
  function userMenuHTML() {
    const u = me(), r = role();
    return '<div class="dd"><button class="topbar-user" data-dd aria-label="' + t('auth.account') + '">' + avatar(u, 'avatar-sm') + '</button><div class="dd-panel"><div class="dd-head"><div>' + esc(L(u)) + '</div><div class="dd-sub">' + roleBadge(r) + '</div></div>' +
      '<a class="dd-item" href="index.html">' + icon('grid', 'icon-sm') + t('auth.allScreens') + '</a>' +
      '<button class="dd-item" data-reset>' + icon('refresh', 'icon-sm') + t('auth.reset') + '</button>' +
      '<button class="dd-item danger" data-signout>' + icon('logout', 'icon-sm') + t('auth.signOut') + '</button></div></div>';
  }
  function renderStaffShell() {
    const sb = document.getElementById('sidebar'), tb = document.getElementById('topbar');
    const u = me(), r = role();
    const items = NAV.filter(n => !n.perm || can(n.perm));
    sb.innerHTML = '<div class="brand"><div class="brand-mark">ن</div><div><div class="brand-name">' + t('brand.name') + '</div><div class="brand-tag">' + t('brand.workspace') + '</div></div></div>' +
      '<div class="nav-group"><div class="nav-group-label">' + t('nav.workspace') + '</div>' +
      items.map(n => { const c = n.count ? n.count() : 0; return '<a href="' + n.href + '" class="nav-item' + (n.id === page.nav ? ' active' : '') + '">' + icon(n.icon) + '<span>' + t(n.key) + '</span>' + (c ? '<span class="count">' + c + '</span>' : '') + '</a>'; }).join('') + '</div>' +
      (r === 'assistant' ? '<div class="perm-note">' + icon('lock', 'icon-sm') + '<span>' + t('auth.assistantNote') + '</span></div>' : '') +
      '<div class="sidebar-footer"><div class="sidebar-user">' + avatar(u) + '<div class="sidebar-user-info"><div class="sidebar-user-name">' + esc(L(u)) + '</div><div class="sidebar-user-role">' + roleBadge(r) + '</div></div>' +
      '<button class="icon-btn sm" data-signout aria-label="' + t('auth.signOut') + '" title="' + t('auth.signOut') + '">' + icon('logout', 'icon-sm') + '</button></div></div>';
    const crumbs = page.crumbs ? page.crumbs() : [];
    tb.innerHTML = '<button class="icon-btn menu-toggle" data-menu aria-label="' + t('nav.menu') + '">' + icon('menu') + '</button><div class="topbar-crumbs">' +
      crumbs.map((c, i) => i === crumbs.length - 1 ? '<span class="current">' + c + '</span>' : (c.href ? '<a href="' + c.href + '">' + c.label + '</a>' : '<span>' + c + '</span>') + '<span class="sep">/</span>').join('') +
      '</div><div class="topbar-right">' + langSwitch() + bellHTML() + userMenuHTML() + '</div>';
  }
  function renderPatientShell() {
    const tb = document.getElementById('ptopbar');
    const tabs = [['home', 'patient-home.html', 'home', 'ph.navHome'], ['record', 'patient-record.html', 'mic', 'ph.navRecord'], ['chat', 'patient-chat.html', 'chat', 'ph.navChat']];
    tb.innerHTML = '<a class="brand plain" href="patient-home.html"><div class="brand-mark">ن</div><div class="brand-name">' + t('brand.name') + '</div></a><nav class="ptabs">' +
      tabs.map(([id, href, ic, key]) => '<a href="' + href + '" class="ptab' + (page.nav === id ? ' active' : '') + '">' + icon(ic, 'icon-sm') + '<span>' + t(key) + '</span></a>').join('') +
      '</nav><div class="topbar-right">' + langSwitch() + bellHTML() + userMenuHTML() + '</div>';
  }
  function rerender() {
    applyDir();
    if (page) {
      if (page.title) document.title = t(page.title) + ' — ' + t('brand.name');
      if (page.shell === 'staff') renderStaffShell();
      if (page.shell === 'patient') renderPatientShell();
      if (page.render) page.render();
    }
    applyStatic();
  }
  function refreshShell() { if (page && page.shell === 'staff') renderStaffShell(); if (page && page.shell === 'patient') renderPatientShell(); }

  function boot(o) {
    page = o; applyDir();
    const s = session();
    if (o.roles) {
      if (!s || !o.roles.includes(s.role) || !me()) { location.replace(s && me() ? homeFor(s.role) : 'login.html'); return; }
      const u = me();
      if ((u.active === false) || u.status === 'inactive') { localStorage.removeItem(KEYS.session); flash(t('auth.deactivated'), t('auth.deactivatedBody'), 'error'); location.replace('login.html'); return; }
    }
    if (o.perm && !can(o.perm)) { flash(t('toast.permError'), t('toast.permErrorBody'), 'error'); location.replace(homeFor(s.role)); return; }
    const content = document.getElementById('content');
    if (content && o.click) content.addEventListener('click', o.click);
    if (content && o.input) content.addEventListener('input', o.input);
    if (content && o.change) content.addEventListener('change', o.change);
    rerender();
    const f = sessionStorage.getItem(KEYS.flash);
    if (f) { sessionStorage.removeItem(KEYS.flash); try { const x = JSON.parse(f); toast(x.title, x.body, x.kind); } catch (e) { /* ignore */ } }
  }

  /* ---------------- global delegation ---------------- */
  document.addEventListener('click', e => {
    const vb = e.target.closest('[data-video]');
    if (vb) { e.preventDefault(); previewVideo(findSession(vb.dataset.video)); return; }
    const play = e.target.closest('[data-play]');
    if (play) { e.preventDefault(); Player.toggle(play.dataset.play); return; }
    const lb = e.target.closest('[data-lang]');
    if (lb) { e.preventDefault(); if (lb.dataset.lang !== lang) setLang(lb.dataset.lang); return; }
    if (e.target.closest('[data-signout]')) { e.preventDefault(); signOut(); return; }
    if (e.target.closest('[data-reset]')) {
      e.preventDefault();
      confirmBox({ title: t('auth.resetTitle'), body: t('auth.resetBody'), yes: t('auth.reset'), danger: true, onYes: async () => { await VideoStore.clear(); resetDemo(); flash(t('toast.resetDone'), '', 'success'); location.reload(); } });
      return;
    }
    if (e.target.closest('[data-menu]')) { document.body.classList.toggle('sb-open'); return; }
    if (e.target.classList && e.target.classList.contains('sb-backdrop')) { document.body.classList.remove('sb-open'); return; }
    const ddBtn = e.target.closest('[data-dd]');
    if (ddBtn) {
      e.preventDefault();
      const dd = ddBtn.closest('.dd'), wasOpen = dd.classList.contains('open');
      document.querySelectorAll('.dd.open').forEach(x => x.classList.remove('open'));
      if (!wasOpen) {
        dd.classList.add('open');
        if (dd.dataset.bell === 'patient') { const p = me(); p.notifSeen = Date.now(); save(); const dc = dd.querySelector('.dot-count'); if (dc) dc.remove(); }
      }
      return;
    }
    if (!e.target.closest('.dd-panel')) document.querySelectorAll('.dd.open').forEach(x => x.classList.remove('open'));
  });
  if (!document.querySelector('.sb-backdrop')) { const b = document.createElement('div'); b.className = 'sb-backdrop'; document.body.appendChild(b); }
  window.addEventListener('storage', e => { if (e.key === KEYS.db) { _db = null; rerender(); } });

  window.Nataq = {
    MAX_REC, STAFF_PASSWORD, PATIENT_CODE,
    t, L, esc, getLang, setLang, applyStatic, rel, fmtDate, fmtTime, fmtDay, shortTime, fmtDur, dayStart, digits, uid,
    db, save, resetDemo, getPatient, getProgram, getMember, sessionsOf, currentSession, msgsOf, waitingOf, totalWaiting, lastMsg, lastActivity, pct, isReady, authorName,
    addMsg, unlockNext, relock, setVerdict, reply, patientSend, chatSend, markSeen, isAttempt, unseenTexts, isMine, canDelete, deleteMsg, deleteMinutesLeft, DELETE_WINDOW, remind, remindToast, lastReminder, sysIcon,
    session, me, role, can, need, findAccount, signIn, signOut, homeFor,
    icon, avatar, initials, roleBadge, waitingLabel, patientBadge, verdictBadge, letterChip, progressBar, ring, empty, msgText, sysText, param,
    toast, flash, modal, confirmBox, fieldError, downloadCSV, lineChart, legend, hbars, activitySeries,
    audioHTML, waveHTML, Player, Recorder, demoWav, getDrafts, setDrafts,
    VideoStore, findSession, videoChip, mountVideo, previewVideo, videoMissingHTML,
    boot, rerender, refreshShell
  };
})();
