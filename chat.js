/* Nataq — shared WhatsApp-style chat, one thread per session.
   Used by the staff review inbox, the patient profile and the patient chat page. */
(function () {
  'use strict';
  const N = window.Nataq;
  const REACT = ['👍', '❤️', '👏', '😊', '🔁', '🎧'];
  const EMOJI = ['👍', '👏', '❤️', '🌟', '💪', '😊', '🔁', '🎧'];
  const QUICK = ['qr.great', 'qr.again', 'qr.louder', 'qr.slow', 'qr.video'];

  function create(root, opts) {
    const st = { focus: opts.focus || null, pid: opts.pid, session: opts.session || null, replyTo: null, autoReply: true, pending: null, recording: false };
    const viewer = opts.viewer; // 'staff' | 'patient'
    const isStaff = viewer === 'staff';

    const P = () => N.getPatient(st.pid);
    const mine = m => (isStaff ? m.from === 'therapist' : m.from === 'patient');
    const maxSession = p => (p.status === 'finished' ? N.sessionsOf(p).length : p.current);
    const threadOf = (p, n) => N.msgsOf(p.id).filter(m => m.prog === p.programId && m.session === n);

    function canWrite(p) {
      if (isStaff) return N.can('respond') && p.status !== 'inactive';
      return p.status === 'active' && st.session === p.current;
    }
    function defaultReply(p) {
      if (!isStaff) return null;
      const w = threadOf(p, st.session).filter(m => N.isAttempt(m) && m.status === 'waiting');
      return w.length ? w[w.length - 1].id : null;
    }
    function authorLabel(m) {
      const { t } = N;
      if (m.from === 'therapist') return isStaff && m.by === N.me().id ? t('review.you') : N.esc(N.authorName(m.by));
      if (m.from === 'patient') return isStaff ? N.esc(N.L(P())) : t('review.you');
      return '';
    }
    function snippet(m) {
      const { t, esc } = N;
      if (!m) return t('chat.deleted');
      if (m.deleted) return '🚫 ' + t('chat.deletedMsg');
      if (m.type === 'audio') return N.icon('mic', 'icon-sm') + (N.isAttempt(m) ? t('review.voiceAttempt') + ' · <span class="ar">' + esc(m.letter) + '</span>' : t('review.voiceNote')) + ' · ' + N.fmtDur(m.dur);
      const txt = typeof m.text === 'string' ? m.text : N.L(m.text);
      return esc(txt.length > 90 ? txt.slice(0, 90) + '…' : txt);
    }

    /* ---------- render ---------- */
    function render(keepScroll) {
      const { t, esc, L, icon } = N, p = P();
      if (!p) { root.innerHTML = N.empty('chat', t('review.emptyTitle'), t('review.emptySub')); return; }
      const max = maxSession(p), ses = N.sessionsOf(p);
      if (st.focus) { const fm = N.msgsOf(p.id).find(x => x.id === st.focus); if (fm && fm.session && fm.session <= max) st.session = fm.session; }
      if (!st.session || st.session > max) st.session = max;
      if (st.autoReply) st.replyTo = defaultReply(p);
      const box0 = root.querySelector('.chat-msgs'), prevScroll = box0 ? box0.scrollTop : 0;
      const in0 = root.querySelector('[data-input]'), typed = in0 ? in0.value : '', hadFocus = in0 && document.activeElement === in0;
      if (isStaff) N.markSeen(p.id, st.session);

      const chips = [];
      for (let n = 1; n <= max; n++) {
        const th = threadOf(p, n);
        const w = th.filter(m => N.isAttempt(m) && m.status === 'waiting').length;
        const unread = isStaff ? th.filter(m => m.from === 'patient' && m.type === 'text' && m.seen === false).length
          : th.filter(m => m.from !== 'patient' && m.ts > (p.notifSeen || 0)).length;
        const done = p.status === 'finished' || n < p.current;
        chips.push(`<button class="s-chip ${n === st.session ? 'active' : ''} ${done ? 'done' : 'cur'}" data-session="${n}" title="${esc(L(ses[n - 1]))}">
          ${done ? icon('check', 'icon-sm') : '<span class="live-dot"></span>'}${t('chat.sChip', { n })} <span class="ar">${esc(ses[n - 1].letter)}</span>
          ${w ? `<span class="s-badge waiting">${w}</span>` : unread ? `<span class="s-badge">${unread}</span>` : ''}</button>`);
      }
      const lockedLeft = ses.length - max;
      if (lockedLeft > 0) chips.push(`<span class="s-chip locked" title="${t('ph.lockedBody')}">${icon('lock', 'icon-sm')}${t('chat.lockedN', { n: lockedLeft })}</span>`);

      const s = ses[st.session - 1], isDone = p.status === 'finished' || st.session < p.current;
      const thread = threadOf(p, st.session);
      let html = '', lastDay = null;
      thread.forEach(m => {
        const day = N.dayStart(m.ts);
        if (day !== lastDay) { html += `<div class="convo-day"><span>${N.fmtDay(m.ts)}</span></div>`; lastDay = day; }
        html += bubble(m);
      });

      const write = canWrite(p);
      const target = st.replyTo && N.msgsOf(p.id).find(m => m.id === st.replyTo);
      let foot;
      if (write) {
        foot = `
          ${isStaff ? `<div class="quick-replies">${QUICK.map(k => `<button class="qr-chip" data-qr="${k}">${t(k)}</button>`).join('')}</div>` : ''}
          ${target ? `<div class="reply-bar"><div class="quote ${target.from === 'patient' ? 'q-patient' : 'q-staff'}"><div class="q-name">${t('chat.replyingTo', { name: authorLabel(target) })}</div><div class="q-text">${snippet(target)}</div></div>
            <button class="icon-btn sm" data-cancelreply aria-label="${t('chat.cancelReply')}" title="${t('chat.cancelReply')}">${icon('x', 'icon-sm')}</button></div>` : ''}
          ${st.pending ? `<div class="pending-bar"><span class="text-xs font-semibold">${t('chat.preview')}</span>${N.audioHTML(st.pending.id, st.pending.src, st.pending.dur)}
            <button class="icon-btn sm" data-discard aria-label="${t('common.delete')}" title="${t('common.delete')}" style="color:var(--rose)">${icon('trash', 'icon-sm')}</button>
            <button class="btn btn-primary btn-sm" data-sendvoice>${icon('send', 'icon-sm')}${t('common.send')}</button></div>` : ''}
          <div class="convo-composer">
            <div class="emoji-wrap"><button class="icon-btn" data-emoji aria-label="${t('review.emoji')}">${icon('smile', 'icon-sm')}</button></div>
            <input type="text" class="composer-input" data-input placeholder="${t(target ? 'chat.typeReply' : 'review.typeMessage')}" aria-label="${t('review.typeMessage')}">
            <button class="icon-btn ${st.recording ? 'recording' : ''}" data-mic aria-label="${t('chat.recordVoice')}" title="${t('chat.recordVoice')}">${icon('mic', 'icon-sm')}</button>
            <button class="btn btn-primary" data-send aria-label="${t('common.send')}">${icon('send', 'icon-sm')}</button>
          </div>
          ${!isStaff ? `<div class="composer-hint">${t('chat.patientHint')}</div>` : ''}`;
      } else {
        let why;
        if (isStaff) why = N.can('respond') ? t('chat.roInactive') : t('review.noRespondPerm');
        else if (p.status !== 'active') why = t('chat.roPaused');
        else why = t('chat.roOld', { n: p.current });
        foot = `<div class="composer-locked">${icon('lock', 'icon-sm')}<span class="grow">${why}</span>${!isStaff && p.status === 'active' && st.session !== p.current ? `<button class="btn btn-primary btn-sm" data-session="${p.current}">${t('chat.goCurrent')}</button>` : ''}</div>`;
      }

      root.innerHTML = `<div class="chat">
        <div class="s-chips" role="tablist" aria-label="${t('chat.sessions')}">${chips.join('')}</div>
        <div class="s-info">${icon(isDone ? 'check' : 'clock', 'icon-sm')}<b>${t('common.sessionN', { n: st.session })}</b> · ${esc(L(s))} <span class="ar-letter">${esc(s.letter)}</span>
          <span class="muted">· ${isDone ? t('chat.sessionDone') : t('chat.sessionNow')}</span>
          ${s.video ? `<span class="s-info-video">${N.videoChip(s)}</span>` : ''}</div>
        <div class="chat-msgs">${html || N.empty('chat', t('chat.emptyTitle'), t(isStaff ? 'chat.emptyStaff' : 'chat.emptyPatient'))}</div>
        ${foot}
      </div>`;
      const box = root.querySelector('.chat-msgs');
      box.scrollTop = keepScroll ? prevScroll : box.scrollHeight;
      const input = root.querySelector('[data-input]');
      if (input && typed) input.value = typed;
      if (input && hadFocus) input.focus();
      if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });
      if (opts.onRender) opts.onRender(st);
      if (st.focus) { const f = st.focus; st.focus = null; setTimeout(() => jump(f), 60); }
    }

    function bubble(m) {
      const { t, esc, icon } = N;
      if (m.from === 'system') {
        return `<div class="sys-msg ${m.kind}" id="cm-${m.id}">${icon(N.sysIcon(m), 'icon-sm')}${N.sysText(m)} · ${N.fmtTime(m.ts)}</div>`;
      }
      const out = mine(m), canAct = isStaff ? N.can('respond') : P().status === 'active';
      if (m.deleted) {
        return `<div class="wa-row ${out ? 'out' : 'in'}" id="cm-${m.id}"><div class="wa-bubble is-deleted">
          ${!out ? `<div class="wa-name ${m.from}">${authorLabel(m)}</div>` : ''}
          <div class="wa-text deleted">🚫 ${t(out ? 'chat.youDeleted' : 'chat.wasDeleted')}</div>
          <div class="wa-meta"><span>${N.fmtTime(m.ts)}</span></div></div></div>`;
      }
      const del = N.canDelete(m);
      const q = m.replyTo ? N.msgsOf(st.pid).find(x => x.id === m.replyTo) : null;
      const attempt = N.isAttempt(m);
      return `<div class="wa-row ${out ? 'out' : 'in'}" id="cm-${m.id}">
        <div class="wa-bubble ${attempt ? 'attempt' : ''}">
          ${!out ? `<div class="wa-name ${m.from}">${authorLabel(m)}</div>` : ''}
          ${m.replyTo ? `<button class="quote ${q && q.from === 'patient' ? 'q-patient' : 'q-staff'}" data-jump="${esc(m.replyTo)}"><div class="q-name">${q ? authorLabel(q) : ''}</div><div class="q-text">${snippet(q)}</div></button>` : ''}
          ${attempt ? `<div class="wa-tag">${t('review.attempt')} · <span class="ar-letter">${esc(m.letter)}</span></div>` : ''}
          ${m.type === 'audio' ? N.audioHTML(m.id, m.audio, m.dur, 24) : `<div class="wa-text">${N.msgText(m)}</div>`}
          <div class="wa-meta">${attempt ? N.verdictBadge(m) : ''}<span>${N.fmtTime(m.ts)}</span>${out ? '<span class="ticks">✓✓</span>' : ''}</div>
          ${attempt && isStaff && N.can('respond') ? `<div class="verdict-row">
            <button class="btn btn-sm ${m.status === 'approved' ? 'btn-mint' : 'btn-secondary'}" data-verdict="approved" data-m="${m.id}">${icon('check', 'icon-sm')}${t('review.approve')}</button>
            <button class="btn btn-sm btn-secondary ${m.status === 'retry' ? 'is-retry' : ''}" data-verdict="retry" data-m="${m.id}">${icon('refresh', 'icon-sm')}${t('status.retry')}</button></div>` : ''}
          ${m.reaction ? `<span class="wa-reaction">${m.reaction}</span>` : ''}
        </div>
        ${canAct ? `<div class="wa-tools">
          <button class="wa-tool" data-reply="${m.id}" aria-label="${t('chat.reply')}" title="${t('chat.reply')}">↩</button>
          ${!out ? `<button class="wa-tool" data-react="${m.id}" aria-label="${t('review.react')}" title="${t('review.react')}">${icon('smile', 'icon-sm')}</button>` : ''}
          ${del ? `<button class="wa-tool del" data-delmsg="${m.id}" aria-label="${t('chat.delete')}" title="${t('chat.deleteFor', { n: N.deleteMinutesLeft(m) })}">${icon('trash', 'icon-sm')}</button>` : ''}
        </div>` : (del ? `<div class="wa-tools"><button class="wa-tool del" data-delmsg="${m.id}" aria-label="${t('chat.delete')}" title="${t('chat.deleteFor', { n: N.deleteMinutesLeft(m) })}">${icon('trash', 'icon-sm')}</button></div>` : '')}
      </div>`;
    }

    /* ---------- actions ---------- */
    function send(o) {
      const { t } = N, p = P();
      const m = N.chatSend(p.id, Object.assign({ session: st.session, replyTo: st.replyTo }, o));
      if (!m) return false;
      st.replyTo = null; st.autoReply = isStaff;
      if (isStaff) N.toast(t(o.type === 'audio' ? 'toast.voiceSent' : 'toast.responseSent'), t('toast.patientNotified', { name: N.esc(N.L(p)) }), 'success');
      else N.toast(t(o.type === 'audio' ? 'rec.sentToast' : 'chat.msgSent'), o.type === 'audio' ? t('rec.sentToastBody') : '', 'success');
      if (opts.onChange) opts.onChange();
      render();
      return true;
    }
    function sendText() {
      const input = root.querySelector('[data-input]'); if (!input) return;
      const text = input.value.trim();
      if (st.pending && !text) { sendVoice(); return; }
      if (!text) { N.toast(N.t('review.emptyMsg'), '', 'info'); input.focus(); return; }
      if (isStaff && !N.need('respond')) return;
      send({ type: 'text', text });
    }
    function sendVoice() {
      if (!st.pending) return;
      const pend = st.pending; N.Player.stop();
      if (send({ type: 'audio', audio: pend.src, dur: pend.dur })) st.pending = null;
    }
    async function record(btn) {
      const { t } = N;
      if (N.Recorder.busy) { N.Recorder.stop(); return; }
      if (isStaff && !N.need('respond')) return;
      N.Player.stop();
      st.recording = true; btn.classList.add('recording');
      const res = await N.Recorder.start({
        onStart: real => { if (!real) N.toast(t('rec.noMic'), t('rec.noMicBody'), 'info'); },
        onTick: s => { btn.innerHTML = N.icon('mic', 'icon-sm') + s.toFixed(1) + ' / ' + N.MAX_REC + '.0'; }
      });
      st.recording = false;
      if (!res) { render(true); return; }
      if (res.dur < 0.4) { N.toast(t('rec.tooShort'), t('rec.tooShortBody'), 'error'); render(true); return; }
      st.pending = { id: N.uid('pend'), src: res.src, dur: res.dur };
      render();
    }
    function jump(id) {
      const el = root.querySelector('#cm-' + (window.CSS && CSS.escape ? CSS.escape(id) : id));
      if (!el) {
        const m = N.msgsOf(st.pid).find(x => x.id === id);
        if (m && m.session !== st.session) { st.session = m.session; st.autoReply = isStaff; render(); setTimeout(() => jump(id), 30); }
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    }

    function onClick(e) {
      const { t } = N, p = P(); if (!p) return;
      const g = sel => e.target.closest(sel);
      let b;
      if ((b = g('[data-session]'))) { st.session = +b.dataset.session; st.autoReply = isStaff; st.pending = null; N.Player.stop(); render(); if (opts.onSession) opts.onSession(st.session); return; }
      if ((b = g('[data-jump]'))) { jump(b.dataset.jump); return; }
      if ((b = g('[data-delmsg]'))) {
        const m = N.msgsOf(p.id).find(x => x.id === b.dataset.delmsg);
        if (!N.canDelete(m)) { N.toast(t('chat.tooLate'), t('chat.tooLateBody'), 'error'); render(true); return; }
        N.confirmBox({ title: t('chat.deleteTitle'), body: t('chat.deleteBody', { n: N.deleteMinutesLeft(m) }), yes: t('chat.deleteYes'), danger: true,
          onYes: () => {
            if (!N.deleteMsg(p.id, m.id)) { N.toast(t('chat.tooLate'), t('chat.tooLateBody'), 'error'); }
            else { if (st.replyTo === m.id) st.replyTo = null; N.Player.stop(); N.toast(t('toast.msgDeleted'), '', 'success'); if (opts.onChange) opts.onChange(); }
            render(true);
          } });
        return;
      }
      if ((b = g('[data-reply]'))) { st.replyTo = b.dataset.reply; st.autoReply = false; render(true); const i = root.querySelector('[data-input]'); if (i) i.focus(); return; }
      if (g('[data-cancelreply]')) { st.replyTo = null; st.autoReply = false; render(true); return; }
      if ((b = g('[data-qr]'))) { const i = root.querySelector('[data-input]'); i.value = t(b.dataset.qr); i.focus(); return; }
      if (g('[data-send]')) { sendText(); return; }
      if (g('[data-sendvoice]')) { sendVoice(); return; }
      if (g('[data-discard]')) { N.Player.stop(); st.pending = null; render(true); return; }
      if ((b = g('[data-mic]'))) { record(b); return; }
      if ((b = g('[data-emoji]'))) {
        const wrap = b.parentElement, ex = wrap.querySelector('.emoji-pop');
        if (ex) { ex.remove(); return; }
        const pop = document.createElement('div'); pop.className = 'emoji-pop';
        pop.innerHTML = EMOJI.map(x => `<button type="button" data-ins="${x}">${x}</button>`).join('');
        wrap.appendChild(pop); return;
      }
      if ((b = g('[data-ins]'))) { const i = root.querySelector('[data-input]'); i.value += b.dataset.ins; b.parentElement.remove(); i.focus(); return; }
      if ((b = g('[data-react]'))) {
        root.querySelectorAll('.react-pop').forEach(x => x.remove());
        const pop = document.createElement('div'); pop.className = 'react-pop';
        pop.innerHTML = REACT.map(x => `<button type="button" data-pick="${x}" data-m="${b.dataset.react}">${x}</button>`).join('');
        b.closest('.wa-row').appendChild(pop); return;
      }
      if ((b = g('[data-pick]'))) {
        const m = N.msgsOf(p.id).find(x => x.id === b.dataset.m);
        m.reaction = m.reaction === b.dataset.pick ? null : b.dataset.pick; N.save();
        N.toast(t(m.reaction ? 'toast.reactionAdded' : 'toast.reactionRemoved'), m.reaction || '', 'success');
        render(true); return;
      }
      if ((b = g('[data-verdict]'))) {
        if (!N.need('respond')) return;
        const v = b.dataset.verdict;
        N.setVerdict(p.id, b.dataset.m, v);
        st.replyTo = b.dataset.m; st.autoReply = false;
        if (v === 'approved' && N.can('unlockSessions') && p.status === 'active' && st.session === p.current) {
          N.toast(t('toast.approved'), t('toast.approvedBody'), 'success', { label: t(p.current >= N.sessionsOf(p).length ? 'pd.finishProgram' : 'pd.unlockNext'), fn: () => { if (opts.onUnlock) opts.onUnlock(); } });
        } else N.toast(t(v === 'approved' ? 'toast.approved' : 'toast.retrySet'), v === 'approved' ? '' : t('toast.retrySetBody'), 'success');
        if (opts.onChange) opts.onChange();
        render(true);
        const i = root.querySelector('[data-input]'); if (i) i.focus();
        return;
      }
    }
    root.addEventListener('click', onClick);
    const outside = e => {
      if (!e.target.closest('.react-pop') && !e.target.closest('[data-react]')) root.querySelectorAll('.react-pop').forEach(x => x.remove());
      if (!e.target.closest('.emoji-wrap')) root.querySelectorAll('.emoji-pop').forEach(x => x.remove());
    };
    document.addEventListener('click', outside);
    const ticker = setInterval(() => { if (root.querySelector('[data-delmsg]') && !N.Recorder.busy && !document.querySelector('.mx')) render(true); }, 30000);

    return {
      render,
      setPatient(pid, session) { st.pid = pid; st.session = session || null; st.replyTo = null; st.autoReply = isStaff; st.pending = null; render(); },
      get session() { return st.session; },
      destroy() { clearInterval(ticker); root.removeEventListener('click', onClick); document.removeEventListener('click', outside); }
    };
  }

  window.NataqChat = { create };
})();
