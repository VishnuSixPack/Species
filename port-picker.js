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
.pp-lbl{font-size:12px;font-weight:600;color:var(--muted,#6b7280)}
.pp-lbl .req{color:var(--bad-fg,#e63946)}
.pp-trigger{position:relative}
.pp-inp{width:100%;height:var(--ctl-h,40px);padding:0 32px 0 12px;border:1.5px solid var(--border,#e8eaf0);
  border-radius:10px;font:inherit;font-size:13px;color:var(--text,#1a1a2e);background:var(--surface,#fff);
  outline:none;cursor:pointer;transition:.14s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-inp:focus{border-color:var(--primary,#1a6fdb);box-shadow:0 0 0 3px rgba(26,111,219,.12)}
.pp-inp::placeholder{color:var(--dim,#c0c4d0)}
.pp-chev{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--dim);pointer-events:none;transition:.2s}
.pp-trigger.open .pp-chev{transform:translateY(-50%) rotate(180deg);color:var(--primary)}
.pp-clr{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:17px;height:17px;border-radius:50%;
  background:var(--bg,#eef0f5);border:none;cursor:pointer;display:none;align-items:center;justify-content:center;
  color:var(--dim);font-size:10px;padding:0;transition:.14s}
.pp-clr:hover{background:var(--bad-bg,#fff0f1);color:var(--bad-fg,#e63946)}
.pp-has-val .pp-clr{display:flex}
.pp-has-val .pp-chev{display:none}
/* cascade container */
.pp-cascade{position:absolute;top:calc(100% + 5px);left:0;display:none;z-index:9999;flex-direction:row;gap:0}
.pp-trigger.open .pp-cascade{display:flex}
.pp-col{width:260px;background:var(--surface,#fff);border:1px solid var(--border,#eef0f5);border-radius:14px;
  box-shadow:var(--shadow-1,0 4px 12px rgba(20,24,45,.07),0 16px 40px rgba(20,24,45,.1));overflow:hidden;
  animation:ppIn .14s ease-out}
.pp-col+.pp-col{margin-left:-1px;border-top-left-radius:4px;border-bottom-left-radius:4px}
@keyframes ppIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
.pp-sch{padding:7px 7px 3px;position:sticky;top:0;background:var(--surface,#fff);z-index:1}
.pp-sch input{width:100%;height:34px;border:1.5px solid var(--border);border-radius:9px;padding:0 10px;
  font:inherit;font-size:12.5px;outline:none;color:var(--text);background:var(--surface)}
.pp-sch input:focus{border-color:var(--primary)}
.pp-list{max-height:260px;overflow-y:auto;padding:3px 5px 5px}
.pp-list::-webkit-scrollbar{width:4px}
.pp-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
.pp-o{padding:9px 11px;border-radius:9px;cursor:pointer;transition:background .08s;display:flex;align-items:center;gap:6px}
.pp-o:hover,.pp-o.hov{background:var(--hover,#f0f4fa)}
.pp-o.on{background:var(--primary,#1a6fdb);color:#fff}
.pp-o-body{flex:1;min-width:0}
.pp-o-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-o-meta{font-size:11px;color:var(--muted,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-o.on .pp-o-meta{color:rgba(255,255,255,.7)}
.pp-o-arrow{color:var(--dim);font-size:14px;flex-shrink:0;line-height:1}
.pp-o.on .pp-o-arrow{color:rgba(255,255,255,.5)}
.pp-col-head{padding:9px 12px 6px;font-size:10px;font-weight:700;color:var(--dim,#9aa0b4);
  text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border)}
.pp-empty{padding:14px;text-align:center;color:var(--dim);font-size:12.5px}
.pp-berth-row{padding:8px 10px;border-top:1px solid var(--border)}
.pp-berth-inp{width:100%;height:34px;border:1.5px solid var(--border);border-radius:9px;padding:0 10px;
  font:inherit;font-size:12.5px;color:var(--text);background:var(--surface);outline:none}
.pp-berth-inp:focus{border-color:var(--primary)}
/* summary chip under the input */
.pp-sum{display:none;align-items:center;gap:5px;padding:6px 10px;background:var(--primary-soft,#e8f1fc);
  border:1px solid var(--border);border-radius:9px;margin-top:4px;font-size:11.5px;flex-wrap:wrap}
.pp-sum.vis{display:flex}
.pp-sum b{color:var(--primary,#1558b0);font-weight:600;font-size:12px}
.pp-sum .dim{color:var(--dim);font-size:10px}
`;
  document.head.appendChild(s);
}

const _e=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let _ppN=0;

class PortPicker{
  constructor(el,opts={}){
    this.root=typeof el==='string'?document.querySelector(el):el;
    this.sb=opts.supabase||null;
    this.o={label:opts.label||'Port',required:!!opts.required,
      showTerminal:opts.showTerminal!==false,showBerth:!!opts.showBerth,
      placeholder:opts.placeholder||'Search port by name, country or LOCODE…',
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
        <button class="pp-clr" data-clr="${u}" type="button" title="Clear">✕</button>
        <div class="pp-cascade" data-cas="${u}">
          <div class="pp-col" data-col="${u}-1">
            <div class="pp-sch"><input data-sch="${u}" placeholder="Search…" autocomplete="off"/></div>
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
        ${hasFac?'<span class="pp-o-arrow">›</span>':''}
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
    col.innerHTML=`<div class="pp-col-head">${_e(portName)} — Facilities</div>
      <div class="pp-list" data-list="${this._uid}-2"><div class="pp-empty">Loading…</div></div>`;
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
    const IC={'Terminal':'🚢','Port Area':'🏭','Berth':'⚓','Jetty':'🪝','Wharf':'🏗','Pier':'🛳','Dock':'🔧','Marina':'⛵'};
    list.innerHTML=facs.map(f=>`<div class="pp-o${this.v.terminal_id===f.id?' on':''}" data-fid="${f.id}" data-fname="${_e(f.name)}">
      <div class="pp-o-body"><div class="pp-o-name">${IC[f.facility_type]||'📍'} ${_e(f.name)}</div>
        <div class="pp-o-meta">${_e(f.facility_type||'')}</div></div>
      ${this.o.showBerth?'<span class="pp-o-arrow">›</span>':''}
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
    col.innerHTML=`<div class="pp-col-head">${_e(facName)} — Berth</div>
      <div class="pp-berth-row"><input class="pp-berth-inp" placeholder="Berth number or name" autocomplete="off"/></div>
      <div style="padding:6px 10px;"><button class="pp-o" style="justify-content:center;font-weight:600;font-size:12px;color:var(--primary);width:100%;" data-confirm="1">
        Confirm berth</button></div>`;
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
    if(inp){ inp.value=parts.join(' → ');
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
    if(this.v.terminal_name) parts.push(`<span class="dim">›</span> ${_e(this.v.terminal_name)}`);
    if(this.v.berth) parts.push(`<span class="dim">›</span> Berth ${_e(this.v.berth)}`);
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
    if(inp&&parts.length){ inp.value=parts.join(' → ');
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