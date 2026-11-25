/**
 * PortPicker — Cascading fly-out port / facility / berth selector
 * Project Manhattan — multi-instance safe
 *
 * Hover a port with facilities → Level 2 slides out to the right.
 * Hover a facility → Level 3 (berth) slides out.
 * Click at any level to confirm — you're never forced to drill down.
 */
(function(global){

if(!document.getElementById('pp-css')){
  const s=document.createElement('style'); s.id='pp-css';
  s.textContent=`
.pp{display:flex;flex-direction:column;gap:5px}
.pp-lbl{font-family:Consolas,"SFMono-Regular",Menlo,monospace;font-size:11px;font-weight:400;color:var(--faint,#9aa1ad)}
.pp-lbl .req{color:var(--crit,#d64545)}
.pp-trigger{position:relative}
.pp-inp{width:100%;height:var(--ctl-h,40px);padding:0 34px 0 13px;border:1px solid var(--line,#e6e8ec);border-radius:10px;font:inherit;font-size:13px;font-weight:300;color:var(--ink,#14161a);background:#fff;outline:none;cursor:pointer;transition:border-color .2s,box-shadow .2s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-inp:focus,.pp-trigger.open .pp-inp{border-color:var(--accent,#2f6fed);box-shadow:0 0 0 4px rgba(47,111,237,.10)}
.pp-inp::placeholder{color:#b3bac6}
.pp-chev{position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--faint,#9aa1ad);pointer-events:none;transition:transform .2s,color .2s}
.pp-trigger.open .pp-chev{transform:translateY(-50%) rotate(180deg);color:var(--accent,#2f6fed)}
.pp-clr{position:absolute;right:9px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:50%;background:#f3f4f6;border:none;cursor:pointer;display:none;align-items:center;justify-content:center;color:#6b7380;font-size:14px;line-height:1;padding:0;transition:background .2s,color .2s}
.pp-clr:hover{background:#fdeceb;color:#d64545}
.pp-has-val .pp-clr{display:flex}
.pp-has-val .pp-chev{display:none}
.pp-cascade{position:absolute;top:calc(100% + 6px);left:0;display:none;z-index:9999;flex-direction:row;gap:6px}
.pp-trigger.open .pp-cascade{display:flex}
.pp-col{width:270px;background:#fff;border:1px solid var(--line,#e6e8ec);border-radius:16px;box-shadow:0 14px 34px rgba(16,24,40,.12);overflow:hidden;animation:ppIn .18s ease-out}
@keyframes ppIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
.pp-sch{padding:8px 8px 4px;position:sticky;top:0;background:#fff;z-index:1}
.pp-sch input{width:100%;height:34px;border:1px solid var(--line,#e6e8ec);border-radius:999px;padding:0 13px;font:inherit;font-size:12.5px;font-weight:300;outline:none;color:var(--ink,#14161a);background:#fff}
.pp-sch input:focus{border-color:var(--accent,#2f6fed)}
.pp-list{max-height:270px;overflow-y:auto;padding:3px 6px 6px}
.pp-list::-webkit-scrollbar{width:4px}
.pp-list::-webkit-scrollbar-thumb{background:#e6e8ec;border-radius:99px}
.pp-o{padding:8px 11px;border-radius:10px;cursor:pointer;transition:background .12s;display:flex;align-items:center;gap:9px;border:0;background:none;font:inherit;text-align:left}
.pp-o:hover,.pp-o.hov{background:#f3f6fb}
.pp-o.on{background:var(--accent,#2f6fed);color:#fff}
.pp-o-ic{width:28px;height:28px;border-radius:9px;background:#edf3fe;color:var(--accent,#2f6fed);display:grid;place-items:center;flex:none}
.pp-o.on .pp-o-ic{background:rgba(255,255,255,.2);color:#fff}
.pp-o-body{flex:1;min-width:0}
.pp-o-name{font-size:13px;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-o-meta{font-size:11px;font-weight:300;color:#6b7380;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-o.on .pp-o-meta{color:rgba(255,255,255,.8)}
.pp-o-arrow{color:#b3bac6;flex-shrink:0;display:flex}
.pp-o.on .pp-o-arrow{color:rgba(255,255,255,.7)}
.pp-col-head{padding:10px 13px 8px;font-family:Consolas,"SFMono-Regular",Menlo,monospace;font-size:11px;font-weight:400;color:var(--accent,#2f6fed);border-bottom:1px solid #eef0f3}
.pp-empty{padding:16px;text-align:center;color:#9aa1ad;font-size:12.5px;font-weight:300}
.pp-berth-row{padding:10px}
.pp-berth-inp{width:100%;height:36px;border:1px solid var(--line,#e6e8ec);border-radius:10px;padding:0 12px;font:inherit;font-size:12.5px;font-weight:300;color:var(--ink,#14161a);background:#fff;outline:none}
.pp-berth-inp:focus{border-color:var(--accent,#2f6fed)}
.pp-confirm{width:100%;height:34px;border:0;border-radius:999px;background:var(--accent,#2f6fed);color:#fff;font:inherit;font-size:12.5px;font-weight:300;cursor:pointer}
.pp-sum{display:none;align-items:center;gap:6px;padding:5px 12px;background:#edf3fe;border:1px solid #cddcf8;border-radius:999px;margin-top:4px;font-size:11.5px;flex-wrap:wrap;align-self:flex-start}
.pp-sum.vis{display:flex}
.pp-sum b{color:var(--accent,#2f6fed);font-weight:400;font-size:12px}
.pp-sum .dim{color:#9aa1ad;font-size:11px}
`;
  document.head.appendChild(s);
}


/* line icons per facility type (replaces the emoji set) */
const _FAC=(function(){
  const s=p=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">'+p+'</svg>';
  const anchor=s('<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 13H3a9 9 0 0018 0h-2"/>');
  const pier=s('<path d="M2 18h20M6 18V9M12 18V9M18 18V9M4 9h16"/>');
  return {'Port Area':s('<path d="M3 21h18M5 21V10l5 3v-3l5 3V5h4v16"/>'),
    'Terminal':s('<rect x="3" y="7" width="8" height="5" rx="1"/><rect x="13" y="7" width="8" height="5" rx="1"/><rect x="8" y="12" width="8" height="5" rx="1"/><path d="M2 21h20"/>'),
    'Berth':anchor,'Anchorage':anchor,'Jetty':pier,'Pier':pier,
    'Wharf':s('<path d="M2 15h20M4 15v5M20 15v5M8 15V4l7 3.5L8 11"/>'),
    'Dock':s('<path d="M3 6v12h18V6M3 12h18"/>'),
    'Marina':s('<path d="M12 3v12M12 3l7 10h-7M3 19c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0"/>'),
    'Offshore Platform':s('<path d="M4 10h16M6 10l-2 11M18 10l2 11M9 10V4h6v6M2 21h20"/>'),
    'Other':s('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>')};
})();
const _facIcon=t=>_FAC[t]||_FAC.Other;

const _e=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let _ppN=0;

class PortPicker{
  constructor(el,opts={}){
    this.root=typeof el==='string'?document.querySelector(el):el;
    this.sb=opts.supabase||null;
    this.o={label:opts.label||'Port',required:!!opts.required,
      showTerminal:opts.showTerminal!==false,showBerth:!!opts.showBerth,
      placeholder:opts.placeholder||'Search port by name, country or LOCODE...',
      onChange:opts.onChange||null,
      filterCountry:opts.filterCountry||null};  // function that returns country name or null
    this.v={port_id:null,port_name:'',terminal_id:null,terminal_name:'',berth:''};
    this._ports=[]; this._facCache={}; this._facCountCache={};
    this._uid='pp'+(_ppN++); this._hovPort=null; this._hovFac=null;
    this._build();
  }

  $(s){ return this.root.querySelector(s); }
  $$(s){ return this.root.querySelectorAll(s); }

  _build(){
    const u=this._uid, o=this.o;
    this.root.innerHTML=`<div class="pp">
      <div class="pp-lbl">${_e(o.label)}${o.required?' <span class="req">*</span>':''}</div>
      <div class="pp-trigger" data-t="${u}">
        <input class="pp-inp" data-in="${u}" placeholder="${_e(o.placeholder)}" readonly autocomplete="off"/>
        <svg class="pp-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>
        <button class="pp-clr" data-clr="${u}" type="button" title="Clear">&times;</button>
        <div class="pp-cascade" data-cas="${u}">
          <div class="pp-col" data-col="${u}-1">
            <div class="pp-sch"><input data-sch="${u}" placeholder="Search..." autocomplete="off"/></div>
            <div class="pp-list" data-list="${u}-1"></div>
          </div>
        </div>
      </div>
      <div class="pp-sum" data-sum="${u}"></div>
    </div>`;
    this._bind(); this._load();
  }

  /* ── Data ─────────────────────────────────────────────────────── */
  async _load(){
    if(!this.sb) return;
    try{
      const [{data:ports},{data:facCounts}]=await Promise.all([
        this.sb.from('ports').select('id,main_port_name,un_locode,country,region_name,port_type').order('main_port_name'),
        this.sb.from('port_facilities').select('port_id').is('parent_facility_id',null)
      ]);
      this._ports=ports||[];
      /* Build a set of port IDs that have at least one facility */
      (facCounts||[]).forEach(f=>{ this._facCountCache[f.port_id]=true; });
    }catch(e){ this._ports=[]; }
    this._renderL1('');
  }

  _renderL1(q){
    const el=this.$(`[data-list="${this._uid}-1"]`); if(!el) return;
    let filtered=this._ports;
    const country=typeof this.o.filterCountry==='function'?this.o.filterCountry():this.o.filterCountry;
    if(country) filtered=filtered.filter(p=>(p.country||'').toLowerCase()===country.toLowerCase());
    const list=q?filtered.filter(p=>
      [p.main_port_name,p.un_locode,p.country].some(s=>(s||'').toLowerCase().includes(q)))
      :filtered;
    if(!list.length){ el.innerHTML=`<div class="pp-empty">${q?'No ports match':'No ports loaded'}</div>`; return; }
    el.innerHTML=list.map(p=>{
      const hasFac=!!this._facCountCache[p.id];
      return `<div class="pp-o${this.v.port_id===p.id?' on':''}" data-pid="${p.id}" data-pname="${_e(p.main_port_name)}" data-has="${hasFac?1:0}">
        <div class="pp-o-body"><div class="pp-o-name">${_e(p.main_port_name)}</div>
          <div class="pp-o-meta">${[p.country,p.un_locode,p.port_type].filter(Boolean).map(_e).join(' · ')}</div></div>
        ${hasFac?'<span class="pp-o-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>':''}
      </div>`;
    }).join('');
    el.querySelectorAll('.pp-o').forEach(opt=>{
      opt.addEventListener('click',e=>{ e.stopPropagation(); this._pickPort(opt.dataset.pid,opt.dataset.pname); });
      if(opt.dataset.has==='1'){
        opt.addEventListener('mouseenter',()=>this._showL2(opt.dataset.pid,opt.dataset.pname,opt));
      }else{
        opt.addEventListener('mouseenter',()=>this._hideL2());
      }
    });
  }

  async _showL2(portId,portName,optEl){
    if(this._hovPort===portId) return;
    this._hovPort=portId;
    /* highlight the hovered port row */
    this.$$(`[data-list="${this._uid}-1"] .pp-o`).forEach(o=>o.classList.remove('hov'));
    optEl.classList.add('hov');

    const cas=this.$(`[data-cas="${this._uid}"]`);
    /* remove old L2+L3 columns */
    cas.querySelectorAll('[data-col$="-2"],[data-col$="-3"]').forEach(c=>c.remove());

    /* create L2 column */
    const col=document.createElement('div');
    col.className='pp-col'; col.setAttribute('data-col',this._uid+'-2');
    col.innerHTML=`<div class="pp-col-head">${_e(portName)} / facilities</div>
      <div class="pp-list" data-list="${this._uid}-2"><div class="pp-empty">Loading...</div></div>`;
    cas.appendChild(col);

    /* load facilities */
    if(!this._facCache[portId]){
      try{
        const {data}=await this.sb.from('port_facilities')
          .select('id,name,facility_type,parent_facility_id')
          .eq('port_id',portId).is('parent_facility_id',null)
          .order('sort_order').order('created_at');
        this._facCache[portId]=data||[];
      }catch(e){ this._facCache[portId]=[]; }
    }
    /* if hover moved away while loading, don't render stale */
    if(this._hovPort!==portId) return;

    const facs=this._facCache[portId];
    const list=col.querySelector('.pp-list');
    if(!facs.length){
      list.innerHTML=`<div class="pp-empty">No facilities registered</div>`;
      return;
    }
    list.innerHTML=facs.map(f=>`<div class="pp-o${this.v.terminal_id===f.id?' on':''}" data-fid="${f.id}" data-fname="${_e(f.name)}">
      <span class="pp-o-ic">${_facIcon(f.facility_type)}</span><div class="pp-o-body"><div class="pp-o-name">${_e(f.name)}</div>
        <div class="pp-o-meta">${_e(f.facility_type||'')}</div></div>
      ${this.o.showBerth?'<span class="pp-o-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>':''}
    </div>`).join('');
    list.querySelectorAll('.pp-o').forEach(opt=>{
      opt.addEventListener('click',e=>{
        e.stopPropagation();
        this._pickPort(portId,portName);
        this._pickFacility(opt.dataset.fid,opt.dataset.fname);
      });
      if(this.o.showBerth){
        opt.addEventListener('mouseenter',()=>this._showL3(opt.dataset.fid,opt.dataset.fname,portId,portName));
      }
    });
    /* keep L2 open when mouse is over it */
    col.addEventListener('mouseenter',()=>{ /* stay */ });
  }

  _hideL2(){
    this._hovPort=null;
    this.$$(`[data-list="${this._uid}-1"] .pp-o`).forEach(o=>o.classList.remove('hov'));
    const cas=this.$(`[data-cas="${this._uid}"]`);
    cas?.querySelectorAll('[data-col$="-2"],[data-col$="-3"]').forEach(c=>c.remove());
  }

  _showL3(facId,facName,portId,portName){
    this._hovFac=facId;
    const cas=this.$(`[data-cas="${this._uid}"]`);
    cas?.querySelectorAll('[data-col$="-3"]').forEach(c=>c.remove());
    const col=document.createElement('div');
    col.className='pp-col'; col.setAttribute('data-col',this._uid+'-3');
    col.innerHTML=`<div class="pp-col-head">${_e(facName)} / berth</div>
      <div class="pp-berth-row"><input class="pp-berth-inp" placeholder="Berth number or name" autocomplete="off"/></div>
      <div style="padding:0 10px 10px;"><button class="pp-confirm" data-confirm="1">Confirm berth</button></div>`;
    cas.appendChild(col);
    const berthInp=col.querySelector('.pp-berth-inp');
    berthInp.focus();
    col.querySelector('[data-confirm]').addEventListener('click',e=>{
      e.stopPropagation();
      this._pickPort(portId,portName);
      this._pickFacility(facId,facName);
      this.v.berth=berthInp.value;
      this._done();
    });
    berthInp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault();
        this._pickPort(portId,portName);
        this._pickFacility(facId,facName);
        this.v.berth=berthInp.value;
        this._done();
      }
    });
  }

  _pickPort(id,name){
    this.v.port_id=id; this.v.port_name=name;
    this.v.terminal_id=null; this.v.terminal_name=''; this.v.berth='';
    this._done();   // clicking a port always confirms — hover is for drilling down
  }
  _pickFacility(id,name){
    this.v.terminal_id=id||null; this.v.terminal_name=name||'';
    this._done();   // clicking a facility confirms — berth is optional via hover/L3
  }

  _done(){
    const inp=this.$(`[data-in="${this._uid}"]`);
    const parts=[this.v.port_name,this.v.terminal_name,this.v.berth?'Berth '+this.v.berth:null].filter(Boolean);
    if(inp){ inp.value=parts.join(' / ');
      inp.closest('.pp-trigger')?.classList.add('pp-has-val'); }
    this._close(); this._updateSum(); this._fire();
  }

  /* ── Panels ────────────────────────────────────────────────────── */
  _open(){
    const t=this.$(`[data-t="${this._uid}"]`);
    t?.classList.add('open');
    setTimeout(()=>this.$(`[data-sch="${this._uid}"]`)?.focus(),20);
  }
  _close(){
    const t=this.$(`[data-t="${this._uid}"]`);
    t?.classList.remove('open');
    this._hovPort=null; this._hovFac=null;
    const cas=this.$(`[data-cas="${this._uid}"]`);
    cas?.querySelectorAll('[data-col$="-2"],[data-col$="-3"]').forEach(c=>c.remove());
  }

  _bind(){
    const u=this._uid;
    this.$(`[data-in="${u}"]`)?.addEventListener('click',e=>{
      e.stopPropagation();
      const t=this.$(`[data-t="${u}"]`);
      t.classList.contains('open')?this._close():this._open();
    });
    this.$(`[data-sch="${u}"]`)?.addEventListener('input',e=>{
      this._hideL2(); this._renderL1(e.target.value.toLowerCase().trim());
    });
    this.$(`[data-sch="${u}"]`)?.addEventListener('click',e=>e.stopPropagation());
    this.$(`[data-clr="${u}"]`)?.addEventListener('click',e=>{ e.stopPropagation(); this.reset(); });
    /* clicking a port WITHOUT facilities selects it immediately */
    /* (handled in _renderL1 click handler — _pickPort then _done) */
    this._outsideClick=()=>this._close();
    document.addEventListener('click',this._outsideClick);
    this.root.addEventListener('click',e=>e.stopPropagation());
  }

  _updateSum(){
    const s=this.$(`[data-sum="${this._uid}"]`); if(!s) return;
    if(!this.v.port_name){ s.classList.remove('vis'); s.innerHTML=''; return; }
    const parts=[`<b>${_e(this.v.port_name)}</b>`];
    if(this.v.terminal_name) parts.push(`<span class="dim">/</span> ${_e(this.v.terminal_name)}`);
    if(this.v.berth) parts.push(`<span class="dim">/</span> Berth ${_e(this.v.berth)}`);
    s.innerHTML=parts.join(' ');
    s.classList.add('vis');
  }

  _fire(){ if(this.o.onChange) this.o.onChange({...this.v}); }

  /* ── Public API ─────────────────────────────────────────────────── */
  getValue(){ return {...this.v}; }

  setValue(val){
    if(!val) return;
    this.v={port_id:val.port_id||null,port_name:val.port_name||'',
      terminal_id:val.terminal_id||null,terminal_name:val.terminal_name||'',berth:val.berth||''};
    const parts=[this.v.port_name,this.v.terminal_name,this.v.berth?'Berth '+this.v.berth:null].filter(Boolean);
    const inp=this.$(`[data-in="${this._uid}"]`);
    if(inp&&parts.length){ inp.value=parts.join(' / ');
      inp.closest('.pp-trigger')?.classList.add('pp-has-val'); }
    this._updateSum();
  }

  reset(){
    this.v={port_id:null,port_name:'',terminal_id:null,terminal_name:'',berth:''};
    const inp=this.$(`[data-in="${this._uid}"]`);
    if(inp){ inp.value=''; inp.closest('.pp-trigger')?.classList.remove('pp-has-val'); }
    this.$(`[data-sum="${this._uid}"]`)?.classList.remove('vis');
    this._renderL1(''); this._close(); this._fire();
  }

  destroy(){ document.removeEventListener('click',this._outsideClick); this.root.innerHTML=''; }
}

global.PortPicker=PortPicker;
})(window);