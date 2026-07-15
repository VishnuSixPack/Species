/**
 * PortPicker — Reusable cascading port/terminal/berth selector
 * Project Manhattan
 *
 * Usage:
 *   const picker = new PortPicker(containerEl, options);
 *   picker.getValue()  → { port_id, port_name, terminal_id, terminal_name, berth }
 *   picker.setValue({ port_id, port_name, terminal_id, terminal_name, berth })
 *   picker.reset()
 *
 * Options:
 *   label        {string}   — Label above the picker (default: 'Port')
 *   required     {boolean}  — Show * on label
 *   showTerminal {boolean}  — Show terminal level (default: true)
 *   showBerth    {boolean}  — Show berth field (default: true)
 *   placeholder  {string}   — Port search placeholder
 *   onChange     {function} — Called with { port_id, port_name, terminal_id, terminal_name, berth }
 *   supabase     {object}   — Supabase client (required)
 *
 * CSS is injected once into <head> automatically.
 */

(function(global){

// ── Inject CSS once ────────────────────────────────────────────────────
const PP_STYLE_ID = 'port-picker-styles';
if(!document.getElementById(PP_STYLE_ID)){
  const s = document.createElement('style');
  s.id = PP_STYLE_ID;
  s.textContent = `
.pp-wrap{display:flex;flex-direction:column;gap:5px}
.pp-label{font-size:12px;font-weight:600;color:var(--muted,#6b7280);letter-spacing:.01em}
.pp-label .pp-req{color:var(--danger,#e63946)}
.pp-row{display:grid;grid-template-columns:1fr;gap:10px}
.pp-row.pp-has-terminal{grid-template-columns:1fr 1fr}
.pp-row.pp-has-berth{grid-template-columns:1fr 1fr 1fr}
.pp-field{display:flex;flex-direction:column;gap:4px;position:relative}
.pp-field-label{font-size:11px;font-weight:600;color:var(--soft,#9aa0b4);text-transform:uppercase;letter-spacing:.04em;display:flex;align-items:center;gap:5px}
.pp-connector{font-size:10px;color:var(--soft,#9aa0b4);margin-left:2px}
/* Search input */
.pp-input-wrap{position:relative}
.pp-input{width:100%;height:44px;padding:0 36px 0 14px;border:1.5px solid var(--border,#e8eaf0);border-radius:10px;font-family:inherit;font-size:13.5px;color:var(--text,#1a1a2e);background:#fff;outline:none;transition:border-color .14s,box-shadow .14s;cursor:pointer}
.pp-input:focus{border-color:var(--primary,#1a6fdb);box-shadow:0 0 0 3.5px rgba(26,111,219,.12)}
.pp-input::placeholder{color:#c0c4d0}
.pp-input:disabled{background:var(--line,#eef0f5);color:var(--soft,#9aa0b4);cursor:not-allowed;border-color:var(--border,#e8eaf0)}
.pp-input-icon{position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--soft,#9aa0b4);pointer-events:none;transition:transform .2s,color .2s}
.pp-input-wrap.open .pp-input-icon{transform:translateY(-50%) rotate(180deg);color:var(--primary,#1a6fdb)}
.pp-clear{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:var(--line,#eef0f5);border:none;cursor:pointer;display:none;align-items:center;justify-content:center;color:var(--soft,#9aa0b4);font-size:11px;transition:.14s;padding:0}
.pp-clear:hover{background:var(--danger-soft,#fff0f1);color:var(--danger,#e63946)}
.pp-has-value .pp-clear{display:flex}
.pp-has-value .pp-input-icon{display:none}
/* Dropdown panel */
.pp-panel{position:absolute;top:calc(100% + 6px);left:0;width:100%;min-width:220px;background:#fff;border:1px solid var(--line,#eef0f5);border-radius:14px;box-shadow:0 4px 12px rgba(20,24,45,.07),0 20px 48px rgba(20,24,45,.11);z-index:9999;opacity:0;visibility:hidden;transform:translateY(-6px) scale(.98);transform-origin:top center;transition:opacity .15s,transform .15s,visibility .15s;overflow:hidden}
.pp-panel.open{opacity:1;visibility:visible;transform:translateY(0) scale(1)}
.pp-panel.drop-up{top:auto;bottom:calc(100% + 6px);transform-origin:bottom center;transform:translateY(6px) scale(.98)}
.pp-panel.drop-up.open{transform:translateY(0) scale(1)}
.pp-search{padding:8px 8px 4px;position:sticky;top:0;background:#fff;z-index:1}
.pp-search input{width:100%;height:36px;border:1.5px solid var(--border,#e8eaf0);border-radius:9px;padding:0 10px;font:inherit;font-size:13px;outline:none;color:var(--text,#1a1a2e)}
.pp-search input:focus{border-color:var(--primary,#1a6fdb)}
.pp-opts{max-height:240px;overflow-y:auto;padding:4px 6px 6px}
.pp-opts::-webkit-scrollbar{width:5px}
.pp-opts::-webkit-scrollbar-thumb{background:#d1d5e0;border-radius:99px}
.pp-opt{padding:10px 12px;border-radius:9px;cursor:pointer;transition:background .1s;display:flex;flex-direction:column;gap:2px}
.pp-opt:hover{background:var(--primary-soft,#e8f1fc)}
.pp-opt.active{background:var(--primary,#1a6fdb);color:#fff}
.pp-opt-name{font-size:13.5px;font-weight:600}
.pp-opt-meta{font-size:11.5px;color:var(--muted,#6b7280)}
.pp-opt.active .pp-opt-meta{color:rgba(255,255,255,.75)}
.pp-empty{padding:16px;text-align:center;color:var(--soft,#9aa0b4);font-size:13px}
.pp-loading{padding:16px;text-align:center;color:var(--soft,#9aa0b4);font-size:13px}
/* Berth is just a plain input */
.pp-berth-input{width:100%;height:44px;padding:0 14px;border:1.5px solid var(--border,#e8eaf0);border-radius:10px;font-family:inherit;font-size:13.5px;color:var(--text,#1a1a2e);background:#fff;outline:none;transition:.14s}
.pp-berth-input:focus{border-color:var(--primary,#1a6fdb);box-shadow:0 0 0 3.5px rgba(26,111,219,.12)}
.pp-berth-input::placeholder{color:#c0c4d0}
/* Selected summary chip */
.pp-summary{display:none;align-items:center;gap:6px;padding:8px 12px;background:var(--primary-soft,#e8f1fc);border:1px solid var(--primary-mid,#d0e4f8);border-radius:10px;margin-top:6px;font-size:12.5px;flex-wrap:wrap}
.pp-summary.visible{display:flex}
.pp-summary-item{display:flex;align-items:center;gap:4px;color:var(--primary-dark,#1558b0);font-weight:600}
.pp-summary-arrow{color:var(--primary-mid,#d0e4f8);font-size:11px}
.pp-summary-edit{margin-left:auto;font-size:11.5px;color:var(--primary,#1a6fdb);cursor:pointer;font-weight:600;text-decoration:none;background:none;border:none;padding:0;font-family:inherit}
.pp-summary-edit:hover{text-decoration:underline}
`;
  document.head.appendChild(s);
}

// ── PortPicker Class ────────────────────────────────────────────────────
class PortPicker {
  constructor(container, options = {}){
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.sb = options.supabase;
    this.opts = {
      label: options.label || 'Port',
      required: options.required || false,
      showTerminal: options.showTerminal !== false,
      showBerth: options.showBerth !== false,
      placeholder: options.placeholder || 'Search port by name, country or UN/LOCODE…',
      onChange: options.onChange || null,
      mode: options.mode || 'full', // 'full' | 'port-only' | 'port-terminal'
    };
    this._value = { port_id:null, port_name:'', terminal_id:null, terminal_name:'', berth:'' };
    this._portCache = null;
    this._terminalCache = {};
    this._render();
  }

  // ── Internal render ──────────────────────────────────────────────────
  _render(){
    const o = this.opts;
    this.container.innerHTML = `
      <div class="pp-wrap">
        <div class="pp-label">${o.label}${o.required?' <span class="pp-req">*</span>':''}</div>
        <div class="pp-row" id="ppRow">
          <!-- Port field -->
          <div class="pp-field" id="ppPortField">
            <div class="pp-field-label">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/></svg>
              Port
            </div>
            <div class="pp-input-wrap" id="ppPortWrap">
              <input class="pp-input" id="ppPortInput" placeholder="${o.placeholder}" autocomplete="off" readonly/>
              <svg class="pp-input-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>
              <button class="pp-clear" id="ppPortClear" type="button" title="Clear">✕</button>
              <div class="pp-panel" id="ppPortPanel">
                <div class="pp-search"><input type="text" id="ppPortSearch" placeholder="Search…" autocomplete="off"/></div>
                <div class="pp-opts" id="ppPortOpts"><div class="pp-loading">Loading ports…</div></div>
              </div>
            </div>
          </div>
          <!-- Terminal field (hidden until port selected) -->
          ${o.showTerminal ? `
          <div class="pp-field" id="ppTerminalField" style="display:none">
            <div class="pp-field-label">
              <span class="pp-connector">→</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2"/></svg>
              Terminal / Wharf <span style="font-weight:400;text-transform:none;color:var(--soft);font-size:10px">(optional)</span>
            </div>
            <div class="pp-input-wrap" id="ppTerminalWrap">
              <input class="pp-input" id="ppTerminalInput" placeholder="Select terminal…" autocomplete="off" readonly disabled/>
              <svg class="pp-input-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>
              <button class="pp-clear" id="ppTerminalClear" type="button" title="Clear">✕</button>
              <div class="pp-panel" id="ppTerminalPanel">
                <div class="pp-opts" id="ppTerminalOpts"><div class="pp-loading">Select a port first</div></div>
              </div>
            </div>
          </div>` : ''}
          <!-- Berth field (hidden until terminal selected or port selected with skip) -->
          ${o.showBerth ? `
          <div class="pp-field" id="ppBerthField" style="display:none">
            <div class="pp-field-label">
              <span class="pp-connector">→</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              Berth <span style="font-weight:400;text-transform:none;color:var(--soft);font-size:10px">(optional)</span>
            </div>
            <input class="pp-berth-input" id="ppBerthInput" placeholder="Berth number or name" autocomplete="off"/>
          </div>` : ''}
        </div>
        <!-- Summary strip shown when full selection made -->
        <div class="pp-summary" id="ppSummary">
          <span class="pp-summary-item" id="ppSumPort"></span>
          <span class="pp-summary-arrow" id="ppSumArrow1" style="display:none">›</span>
          <span class="pp-summary-item" id="ppSumTerminal" style="display:none"></span>
          <span class="pp-summary-arrow" id="ppSumArrow2" style="display:none">›</span>
          <span class="pp-summary-item" id="ppSumBerth" style="display:none"></span>
          <button class="pp-summary-edit" type="button" onclick="this.closest('.pp-wrap').dispatchEvent(new CustomEvent('pp-edit'))">Edit</button>
        </div>
      </div>`;

    this._bindEvents();
    this._loadPorts();
  }

  // ── Load ports from Supabase ─────────────────────────────────────────
  async _loadPorts(){
    if(!this.sb) return;
    const {data} = await this.sb.from('ports')
      .select('id,main_port_name,un_locode,country,region_name,port_type')
      .order('main_port_name');
    this._portCache = data || [];
    this._renderPortOpts('');
  }

  _renderPortOpts(q){
    const el = document.getElementById('ppPortOpts'); if(!el) return;
    const list = q
      ? this._portCache.filter(p =>
          (p.main_port_name||'').toLowerCase().includes(q) ||
          (p.un_locode||'').toLowerCase().includes(q) ||
          (p.country||'').toLowerCase().includes(q)
        )
      : this._portCache;
    if(!list.length){ el.innerHTML=`<div class="pp-empty">${q?'No ports match':'No ports registered yet'}</div>`; return; }
    el.innerHTML = list.map(p=>`
      <div class="pp-opt${this._value.port_id===p.id?' active':''}" data-id="${p.id}" data-name="${_esc(p.main_port_name)}">
        <div class="pp-opt-name">${_esc(p.main_port_name)}</div>
        <div class="pp-opt-meta">${[p.country, p.un_locode, p.port_type].filter(Boolean).map(_esc).join(' · ')}</div>
      </div>`).join('');
    el.querySelectorAll('.pp-opt').forEach(opt=>{
      opt.addEventListener('click', ()=> this._selectPort(opt.dataset.id, opt.dataset.name));
    });
  }

  async _selectPort(id, name){
    this._value.port_id = id;
    this._value.port_name = name;
    this._value.terminal_id = null;
    this._value.terminal_name = '';
    this._value.berth = '';
    // Update port input
    const inp = document.getElementById('ppPortInput');
    if(inp){ inp.value = name; inp.closest('.pp-input-wrap').classList.add('pp-has-value'); }
    this._closePanel('ppPortPanel');
    // Show terminal field, load its options
    if(this.opts.showTerminal){
      const tf = document.getElementById('ppTerminalField');
      if(tf){ tf.style.display=''; }
      const row = document.getElementById('ppRow');
      if(row){ row.className = 'pp-row pp-has-terminal'; }
      await this._loadTerminals(id);
      const ti = document.getElementById('ppTerminalInput');
      if(ti){ ti.disabled = false; ti.value = ''; ti.closest('.pp-input-wrap').classList.remove('pp-has-value'); }
    }
    // Show berth if not using terminal
    if(this.opts.showBerth && !this.opts.showTerminal){
      const bf = document.getElementById('ppBerthField');
      if(bf){ bf.style.display=''; }
    }
    this._updateSummary();
    this._fireChange();
  }

  async _loadTerminals(portId){
    const optsEl = document.getElementById('ppTerminalOpts'); if(!optsEl) return;
    optsEl.innerHTML = '<div class="pp-loading">Loading terminals…</div>';
    if(!this._terminalCache[portId]){
      const {data} = await this.sb.from('port_terminals')
        .select('id,terminal_name,terminal_type,terminal_wharf_type,berth')
        .eq('port_id', portId)
        .order('terminal_name');
      this._terminalCache[portId] = data || [];
    }
    const terms = this._terminalCache[portId];
    if(!terms.length){
      optsEl.innerHTML = `<div class="pp-empty" style="padding:14px">
        <div style="margin-bottom:4px;font-weight:600">No terminals registered</div>
        <div style="font-size:11.5px">You can still save port-only, or add terminals in the Port module.</div>
      </div>`;
      return;
    }
    optsEl.innerHTML = `<div class="pp-opt${!this._value.terminal_id?' active':''}" data-id="" data-name="">
        <div class="pp-opt-name" style="color:var(--muted)">— Port only (no specific terminal) —</div>
      </div>` +
      terms.map(t=>`
      <div class="pp-opt${this._value.terminal_id===t.id?' active':''}" data-id="${t.id}" data-name="${_esc(t.terminal_name)}">
        <div class="pp-opt-name">${_esc(t.terminal_name)}</div>
        <div class="pp-opt-meta">${[t.terminal_type, t.terminal_wharf_type].filter(Boolean).map(_esc).join(' · ')}</div>
      </div>`).join('');
    optsEl.querySelectorAll('.pp-opt').forEach(opt=>{
      opt.addEventListener('click', ()=> this._selectTerminal(opt.dataset.id, opt.dataset.name));
    });
  }

  _selectTerminal(id, name){
    this._value.terminal_id = id||null;
    this._value.terminal_name = name||'';
    const inp = document.getElementById('ppTerminalInput');
    const wrap = inp?.closest('.pp-input-wrap');
    if(inp){
      inp.value = name || ''; 
      wrap?.classList.toggle('pp-has-value', !!name);
    }
    this._closePanel('ppTerminalPanel');
    // Show berth field
    if(this.opts.showBerth){
      const bf = document.getElementById('ppBerthField');
      if(bf){ bf.style.display=''; }
      const row = document.getElementById('ppRow');
      if(row) row.className='pp-row pp-has-berth';
    }
    this._updateSummary();
    this._fireChange();
  }

  // ── Panels ────────────────────────────────────────────────────────────
  _openPanel(panelId){
    // Close all other pp panels first
    document.querySelectorAll('.pp-panel.open').forEach(p=>{
      if(p.id!==panelId){ p.classList.remove('open','drop-up'); p.previousElementSibling?.classList.remove('open'); }
    });
    const panel = document.getElementById(panelId); if(!panel) return;
    const wrap = panel.closest('.pp-input-wrap');
    // Flip up if needed
    const rect = wrap?.getBoundingClientRect();
    if(rect){
      const spaceBelow = window.innerHeight - rect.bottom;
      if(spaceBelow < 300 && rect.top > 300) panel.classList.add('drop-up');
      else panel.classList.remove('drop-up');
    }
    panel.classList.add('open');
    wrap?.classList.add('open');
  }
  _closePanel(panelId){
    const panel = document.getElementById(panelId); if(!panel) return;
    panel.classList.remove('open','drop-up');
    panel.closest('.pp-input-wrap')?.classList.remove('open');
  }
  _closeAllPanels(){
    this.container.querySelectorAll('.pp-panel').forEach(p=>{
      p.classList.remove('open','drop-up');
      p.closest('.pp-input-wrap')?.classList.remove('open');
    });
  }

  // ── Events ────────────────────────────────────────────────────────────
  _bindEvents(){
    // Port input click → open panel
    const portInp = document.getElementById('ppPortInput');
    portInp?.addEventListener('click', e=>{
      e.stopPropagation();
      if(document.getElementById('ppPortPanel').classList.contains('open')){
        this._closePanel('ppPortPanel');
      } else {
        this._openPanel('ppPortPanel');
        setTimeout(()=>document.getElementById('ppPortSearch')?.focus(), 20);
      }
    });
    // Port search
    document.getElementById('ppPortSearch')?.addEventListener('input', e=>{
      this._renderPortOpts(e.target.value.toLowerCase().trim());
    });
    document.getElementById('ppPortSearch')?.addEventListener('click', e=>e.stopPropagation());
    // Port clear
    document.getElementById('ppPortClear')?.addEventListener('click', e=>{
      e.stopPropagation(); this.reset();
    });
    // Terminal input click
    const termInp = document.getElementById('ppTerminalInput');
    termInp?.addEventListener('click', e=>{
      if(termInp.disabled) return;
      e.stopPropagation();
      if(document.getElementById('ppTerminalPanel')?.classList.contains('open')){
        this._closePanel('ppTerminalPanel');
      } else {
        this._openPanel('ppTerminalPanel');
      }
    });
    // Terminal clear
    document.getElementById('ppTerminalClear')?.addEventListener('click', e=>{
      e.stopPropagation();
      this._selectTerminal('','');
      const bf = document.getElementById('ppBerthField');
      if(bf) bf.style.display='none';
      const row = document.getElementById('ppRow');
      if(row) row.className='pp-row pp-has-terminal';
    });
    // Berth input
    document.getElementById('ppBerthInput')?.addEventListener('input', e=>{
      this._value.berth = e.target.value;
      this._updateSummary();
      this._fireChange();
    });
    // Edit button on summary
    this.container.querySelector('.pp-wrap')?.addEventListener('pp-edit', ()=>{
      const summary = document.getElementById('ppSummary');
      if(summary) summary.classList.remove('visible');
    });
    // Close on outside click
    document.addEventListener('click', this._outsideClick = ()=> this._closeAllPanels());
    this.container.addEventListener('click', e=> e.stopPropagation());
  }

  // ── Summary strip ─────────────────────────────────────────────────────
  _updateSummary(){
    const s = document.getElementById('ppSummary'); if(!s) return;
    const v = this._value;
    if(!v.port_name){ s.classList.remove('visible'); return; }
    const sumPort = document.getElementById('ppSumPort');
    const sumTerm = document.getElementById('ppSumTerminal');
    const sumBerth = document.getElementById('ppSumBerth');
    const arr1 = document.getElementById('ppSumArrow1');
    const arr2 = document.getElementById('ppSumArrow2');
    if(sumPort) sumPort.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/></svg> ${_esc(v.port_name)}`;
    if(sumTerm){ sumTerm.textContent = v.terminal_name||''; sumTerm.style.display = v.terminal_name?'':'none'; }
    if(sumBerth){ sumBerth.textContent = v.berth?`Berth: ${v.berth}`:''; sumBerth.style.display = v.berth?'':'none'; }
    if(arr1) arr1.style.display = v.terminal_name?'':'none';
    if(arr2) arr2.style.display = v.berth?'':'none';
    s.classList.add('visible');
  }

  // ── Public API ────────────────────────────────────────────────────────
  getValue(){ return { ...this._value }; }

  setValue(v){
    if(!v) return;
    this._value = { port_id:v.port_id||null, port_name:v.port_name||'', terminal_id:v.terminal_id||null, terminal_name:v.terminal_name||'', berth:v.berth||'' };
    // Restore port input
    const portInp = document.getElementById('ppPortInput');
    if(portInp && v.port_name){
      portInp.value = v.port_name;
      portInp.closest('.pp-input-wrap')?.classList.add('pp-has-value');
    }
    // Show + restore terminal
    if(this.opts.showTerminal && v.port_id){
      const tf = document.getElementById('ppTerminalField');
      if(tf) tf.style.display='';
      const ti = document.getElementById('ppTerminalInput');
      if(ti){
        ti.disabled=false;
        ti.value = v.terminal_name||'';
        if(v.terminal_name) ti.closest('.pp-input-wrap')?.classList.add('pp-has-value');
      }
      this._loadTerminals(v.port_id);
      const row = document.getElementById('ppRow');
      if(row) row.className='pp-row'+(v.terminal_name?' pp-has-berth':' pp-has-terminal');
    }
    // Show + restore berth
    if(this.opts.showBerth && v.berth){
      const bf = document.getElementById('ppBerthField');
      if(bf) bf.style.display='';
      const bi = document.getElementById('ppBerthInput');
      if(bi) bi.value = v.berth;
    }
    this._updateSummary();
  }

  reset(){
    this._value = { port_id:null, port_name:'', terminal_id:null, terminal_name:'', berth:'' };
    const portInp = document.getElementById('ppPortInput');
    if(portInp){ portInp.value=''; portInp.closest('.pp-input-wrap')?.classList.remove('pp-has-value'); }
    const termInp = document.getElementById('ppTerminalInput');
    if(termInp){ termInp.value=''; termInp.disabled=true; termInp.closest('.pp-input-wrap')?.classList.remove('pp-has-value'); }
    const berthInp = document.getElementById('ppBerthInput');
    if(berthInp) berthInp.value='';
    document.getElementById('ppTerminalField')?.setAttribute('style','display:none');
    document.getElementById('ppBerthField')?.setAttribute('style','display:none');
    document.getElementById('ppRow')?.setAttribute('class','pp-row');
    document.getElementById('ppSummary')?.classList.remove('visible');
    this._renderPortOpts('');
    this._closeAllPanels();
    this._fireChange();
  }

  _fireChange(){
    if(this.opts.onChange) this.opts.onChange({ ...this._value });
  }

  destroy(){
    document.removeEventListener('click', this._outsideClick);
    this.container.innerHTML='';
  }
}

// ── Utility ────────────────────────────────────────────────────────────
function _esc(s){ return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ── Export ─────────────────────────────────────────────────────────────
global.PortPicker = PortPicker;

})(window);
