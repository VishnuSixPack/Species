/* =====================================================================
   PROJECT MANHATTAN — THEME CONTROLLER
   Load in <head>, BEFORE the page renders:

     <link rel="stylesheet" href="theme.css"/>
     <script src="theme.js"></script>

   Loading it at the end of <body> would let the browser paint the
   light theme first and then repaint dark — the flash you get when
   dark mode is "not applied on load".
   ===================================================================== */
(function(){
  'use strict';

  var KEY = 'manhattan-theme';

  function systemPref(){
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark' : 'light';
  }

  function stored(){
    try { return localStorage.getItem(KEY); } catch(e){ return null; }  // private mode
  }

  /* Runs immediately — documentElement exists before body does, which
     is why this works from <head> with no DOM ready wait. */
  var initial = stored() || systemPref();
  document.documentElement.setAttribute('data-theme', initial);
  document.documentElement.classList.add('theme-booting');

  window.addEventListener('DOMContentLoaded', function(){
    // Drop the transition guard one frame in, so the first paint is
    // instant but later toggles animate.
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        document.documentElement.classList.remove('theme-booting');
      });
    });
    renderToggle();
  });

  /* Follow the OS only while the user hasn't chosen for themselves. */
  if(window.matchMedia){
    try{
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e){
        if(!stored()) applyTheme(e.matches ? 'dark' : 'light', false);
      });
    }catch(e){ /* Safari < 14 */ }
  }

  function applyTheme(theme, persist){
    document.documentElement.setAttribute('data-theme', theme);
    if(persist !== false){
      try { localStorage.setItem(KEY, theme); } catch(e){}
      saveToProfile(theme);
    }
    renderToggle();
    swapImages(theme);
    window.dispatchEvent(new CustomEvent('themechange', {detail:{theme:theme}}));
  }

  /* Cross-device persistence. profiles.theme may not exist on every
     install, so a failure here is logged and ignored — localStorage
     has already made the change stick locally. */
  function saveToProfile(theme){
    var db = window.dbClient;
    if(!db || !db.auth) return;
    Promise.resolve(db.auth.getSession()).then(function(res){
      var session = res && res.data && res.data.session;
      if(!session) return;
      return db.from('profiles').update({theme: theme}).eq('id', session.user.id);
    }).then(function(r){
      if(r && r.error) console.warn('Theme not saved to profile:', r.error.message);
    }).catch(function(e){ console.warn('Theme not saved to profile:', e.message); });
  }

  window.getTheme = function(){
    return document.documentElement.getAttribute('data-theme') || 'light';
  };
  window.setTheme = function(t){ applyTheme(t, true); };
  window.toggleTheme = function(){
    applyTheme(window.getTheme() === 'dark' ? 'light' : 'dark', true);
  };

  /* Reads the saved preference once the user's profile is known, so a
     choice made on one device follows them to another. Call it after
     your own profile load. */
  window.applyProfileTheme = function(profile){
    if(!profile || !profile.theme) return;
    if(stored()) return;                       // local choice wins
    applyTheme(profile.theme, false);
  };

  /* Any <img data-dark-src="..."> gets its dark variant on a dark
     background. If that file is missing the browser's error handler
     puts the original back, so a missing asset degrades to the light
     logo rather than a broken image. */
  function swapImages(theme){
    var imgs = document.querySelectorAll('img[data-dark-src]');
    for(var i=0;i<imgs.length;i++){
      var img = imgs[i];
      if(!img.dataset.lightSrc) img.dataset.lightSrc = img.getAttribute('src');
      var want = theme === 'dark' ? img.dataset.darkSrc : img.dataset.lightSrc;
      if(img.getAttribute('src') !== want){
        img.onerror = function(){ this.onerror=null; this.src = this.dataset.lightSrc; };
        img.src = want;
      }
    }
  }
  window.addEventListener('DOMContentLoaded', function(){ swapImages(window.getTheme()); });

  var SUN = '<svg class="tt-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg class="tt-moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>';

  /* Injects the switch into any .avatar-menu on the page. */
  function renderToggle(){
    var menus = document.querySelectorAll('.avatar-menu');
    for(var i=0;i<menus.length;i++){
      var menu = menus[i];
      var btn = menu.querySelector('.theme-toggle');
      if(!btn){
        btn = document.createElement('button');
        btn.className = 'theme-toggle';
        btn.type = 'button';
        btn.onclick = function(e){ e.stopPropagation(); window.toggleTheme(); };
        menu.appendChild(btn);
      }
      var dark = window.getTheme() === 'dark';
      btn.innerHTML = SUN + MOON +
        '<span>' + (dark ? 'Light mode' : 'Dark mode') + '</span>' +
        '<span class="tt-state">' + (dark ? 'Dark' : 'Light') + '</span>';
    }
  }
  window.renderThemeToggle = renderToggle;
})();
