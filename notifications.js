/* SmarTuna notifications bell
   Drop-in: <script src="notifications.js"></script> after the Supabase library.
   Uses the nav's .notif-btn when the page has one, otherwise adds a bell
   next to the account button. Reads smartuna.notifications (own rows only,
   enforced by row level security) and listens for new ones live. */
(function(){
  const URL_ = 'https://enbdaajcromxmhgcverp.supabase.co', KEY_ = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
  const LIMIT = 30, POLL_MS = 60000;
  let db, uid, items = [], open = false, btn, panel, badge;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ago = iso => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s/60) + ' min ago';
    if (s < 86400) return Math.floor(s/3600) + ' h ago';
    if (s < 604800) return Math.floor(s/86400) + ' d ago';
    return new Date(iso).toLocaleDateString(undefined, {day:'2-digit', month:'short'});
  };
  const ICON = {
    notice:'<svg viewBox="0 0 24 24"><path d="M5 3h14v18H5z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    scheduled:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
    actual:'<svg viewBox="0 0 24 24"><path d="M2 20c2 1.2 4 1.2 6 0s4-1.2 6 0 4 1.2 6 0"/><path d="M4 16.5 5 11h14l1 5.5"/><path d="M9 11V6.5h6V11"/></svg>',
    updated:'<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/></svg>'};
  const BELL = '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';

  const CSS = `
  .sn-wrap{position:relative;display:inline-flex}
  .sn-bell{width:36px;height:36px;border-radius:50%;border:1px solid rgba(127,127,127,.25);background:var(--white,#fff);display:grid;place-items:center;cursor:pointer;color:inherit;padding:0}
  .sn-bell svg,.sn-ic svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .sn-count{position:absolute;top:-3px;right:-4px;min-width:17px;height:17px;padding:0 5px;border-radius:999px;background:#e63946;color:#fff;font:400 10px/17px Consolas,"SFMono-Regular",Menlo,monospace;text-align:center;border:2px solid #fff;box-sizing:content-box;transform:scale(0);transition:transform .35s cubic-bezier(.34,1.56,.64,1);pointer-events:none}
  .sn-count.on{transform:scale(1)}
  .sn-host{position:relative}
  .sn-host.sn-pulse,.sn-wrap.sn-pulse{animation:snPulse .9s ease}
  @keyframes snPulse{0%,100%{transform:none}20%{transform:rotate(-14deg)}40%{transform:rotate(11deg)}60%{transform:rotate(-7deg)}80%{transform:rotate(4deg)}}
  .sn-panel{position:fixed;width:380px;max-width:calc(100vw - 20px);max-height:min(560px,calc(100vh - 90px));display:flex;flex-direction:column;background:#fff;color:#14161a;border:1px solid #e6e8ec;border-radius:18px;box-shadow:0 24px 60px rgba(16,24,40,.18);z-index:5000;opacity:0;visibility:hidden;transform:translateY(-6px) scale(.98);transform-origin:top right;transition:opacity .2s,transform .3s cubic-bezier(.16,1,.3,1),visibility .2s;font-family:Poppins,system-ui,sans-serif;font-weight:400;overflow:hidden}
  .sn-panel.open{opacity:1;visibility:visible;transform:none}
  .sn-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px 10px;border-bottom:1px solid #eef0f3}
  .sn-h b{font-weight:400;font-size:15px}
  .sn-h button{border:0;background:none;color:#2f6fed;font:inherit;font-size:12px;cursor:pointer;padding:4px 6px;border-radius:8px}
  .sn-h button:hover{background:#edf3fe}
  .sn-h button:disabled{color:#9aa1ad;cursor:default;background:none}
  .sn-list{overflow-y:auto;flex:1}
  .sn-i{display:grid;grid-template-columns:34px minmax(0,1fr) 8px;gap:10px;align-items:start;padding:11px 16px;text-decoration:none;color:inherit;border-bottom:1px solid #f2f3f5;transition:background .15s}
  .sn-i:hover{background:#f8faff}
  .sn-ic{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:#f5f1fd;color:#7c5cd6}
  .sn-i.k-scheduled .sn-ic{background:#edf3fe;color:#2f6fed}
  .sn-i.k-actual .sn-ic{background:#e8f6ee;color:#178a4c}
  .sn-i.k-updated .sn-ic{background:#fdf4e3;color:#b7791f}
  .sn-t{font-size:13px;line-height:1.35}
  .sn-b{font-size:12px;color:#6b7380;line-height:1.4;margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .sn-d{font-family:Consolas,"SFMono-Regular",Menlo,monospace;font-size:10.5px;color:#9aa1ad;margin-top:3px}
  .sn-u{width:8px;height:8px;border-radius:50%;background:#2f6fed;margin-top:6px}
  .sn-i.read .sn-u{visibility:hidden}
  .sn-i.read .sn-t{color:#4b5260}
  .sn-empty{padding:34px 20px;text-align:center;color:#6b7380;font-size:13px}
  .sn-f{display:block;text-align:center;padding:11px;font-size:12.5px;color:#2f6fed;text-decoration:none;border-top:1px solid #eef0f3}
  .sn-f:hover{background:#f8faff}
  @media print{.sn-panel,.sn-wrap,.sn-count{display:none!important}}`;

  function mount(){
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    btn = document.querySelector('.notif-btn');
    if (btn) {
      btn.classList.add('sn-host');
      btn.setAttribute('role', 'button'); btn.setAttribute('tabindex', '0'); btn.setAttribute('aria-label', 'Notifications');
      const dot = btn.querySelector('.notif-dot'); if (dot) dot.style.display = 'none';
    } else {
      const acct = document.querySelector('#navAvatar, #avatarBtn, #avatar, .avatar-wrap, .acct');
      const host = acct ? (acct.closest('.avatar-wrap, .acct') || acct) : null;
      if (!host) return false;
      const w = document.createElement('span'); w.className = 'sn-wrap';
      w.innerHTML = `<button type="button" class="sn-bell" aria-label="Notifications">${BELL}</button>`;
      host.parentNode.insertBefore(w, host);
      if (getComputedStyle(host.parentNode).display.includes('flex')) w.style.marginRight = '4px';
      btn = w;
    }
    badge = document.createElement('span'); badge.className = 'sn-count'; btn.appendChild(badge);
    panel = document.createElement('div'); panel.className = 'sn-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(panel);
    btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    document.addEventListener('click', e => { if (open && !panel.contains(e.target)) toggle(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) toggle(false); });
    window.addEventListener('resize', place);
    return true;
  }
  function place(){
    if (!open) return;
    const r = btn.getBoundingClientRect(), w = Math.min(380, innerWidth - 20);
    panel.style.top = (r.bottom + 10) + 'px';
    panel.style.left = Math.max(10, Math.min(innerWidth - w - 10, r.right - w)) + 'px';
  }
  function toggle(v){
    open = v === undefined ? !open : v;
    panel.classList.toggle('open', open);
    if (open) { place(); draw(); }
  }
  function draw(){
    const unread = items.filter(n => !n.read_at).length;
    badge.textContent = unread > 99 ? '99+' : unread; badge.classList.toggle('on', unread > 0);
    btn.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
    if (!open) return;
    panel.innerHTML = `<div class="sn-h"><b>Notifications</b><button type="button" data-all ${unread ? '' : 'disabled'}>Mark all as read</button></div>
      <div class="sn-list">${items.length ? items.map(n => `<a class="sn-i k-${esc(n.kind)} ${n.read_at ? 'read' : ''}" href="${esc(n.link || '#')}" data-id="${n.id}">
        <span class="sn-ic">${ICON[n.kind] || ICON.notice}</span><span><div class="sn-t">${esc(n.title)}</div>${n.body ? `<div class="sn-b">${esc(n.body)}</div>` : ''}<div class="sn-d">${esc(ago(n.created_at))}</div></span><span class="sn-u"></span></a>`).join('')
        : '<div class="sn-empty">You are all caught up. Shipment notices sent to your company show up here.</div>'}</div>
      <a class="sn-f" href="shipment-notice.html">All shipment notices</a>`;
    panel.querySelector('[data-all]').onclick = markAll;
    panel.querySelectorAll('.sn-i').forEach(a => a.addEventListener('click', async e => {
      const n = items.find(x => String(x.id) === a.dataset.id);
      if (n && !n.read_at) { e.preventDefault(); await markRead([n.id]); location.href = a.href; }
    }));
  }
  const tbl = () => db.schema('smartuna').from('notifications');
  async function load(){
    const { data, error } = await tbl().select('id,kind,title,body,link,shipment_id,created_at,read_at').order('created_at', { ascending: false }).limit(LIMIT);
    if (error) return;               /* the notifications table isn't installed yet: stay quiet */
    items = data || []; draw();
  }
  async function markRead(ids){
    const now = new Date().toISOString();
    items.forEach(n => { if (ids.includes(n.id)) n.read_at = now; }); draw();
    await tbl().update({ read_at: now }).in('id', ids);
  }
  async function markAll(){
    const ids = items.filter(n => !n.read_at).map(n => n.id); if (!ids.length) return;
    const now = new Date().toISOString(); items.forEach(n => { n.read_at = n.read_at || now; }); draw();
    await tbl().update({ read_at: now }).is('read_at', null);
  }
  function live(){
    try {
      db.channel('smt-notif-' + uid)
        .on('postgres_changes', { event: 'INSERT', schema: 'smartuna', table: 'notifications', filter: 'user_id=eq.' + uid }, p => {
          if (!p.new || items.some(n => n.id === p.new.id)) return;
          items.unshift(p.new); items = items.slice(0, LIMIT); draw();
          btn.classList.remove('sn-pulse'); void btn.offsetWidth; btn.classList.add('sn-pulse');
        }).subscribe();
    } catch (e) {}
  }
  async function start(){
    if (typeof supabase === 'undefined') return;
    db = window._sharedSupabase || (window._sharedSupabase = supabase.createClient(URL_, KEY_));
    const { data: { session } } = await db.auth.getSession();
    if (!session) return;
    uid = session.user.id;
    if (!mount()) return;
    await load(); live();
    setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    window.addEventListener('smt-notif-refresh', load);
  }
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
