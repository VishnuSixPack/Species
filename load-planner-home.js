/* ============================================================
   SmarTuna · Load Planner — landing page
   One job: the four-step addressing explainer.
   ============================================================ */

(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };

  /* The carton being described sits in Zone 2, Row 1. Each step moves the
     blue block to whatever that step is actually talking about, so the
     drawing always matches the words under it. The geometry below is in the
     SVG's own viewBox units and lines up with the bands in the markup. */
  var STEPS = {
    zone: {
      code: 'Z2',
      hit:  { x: 162, y: 64, w: 70, h: 66 },
      label: 'Z2',
      text: 'Zones count in from the doors, about a metre and a bit each. Z1 is ' +
            'the first thing you meet when the doors swing open; the highest ' +
            'number is hard against the nose wall.'
    },
    row: {
      code: 'Z2 · R1',
      hit:  { x: 162, y: 64, w: 70, h: 66 },
      label: 'R1',
      text: 'The width is halved. Stand at the open doors and look in: Row 1 is ' +
            'the half on your left, Row 2 the half on your right. No tape ' +
            'measure needed — just which hand it is on.'
    },
    layer: {
      code: 'Z2 · R1 · L5',
      hit:  { x: 162, y: 64, w: 70, h: 66 },
      label: 'L5',
      text: 'Layers climb off the floor, counted in cartons rather than ' +
            'centimetres. L1 sits on the container floor, L5 is the fifth one up. ' +
            'A pallet underneath is not a layer — it is the base the layers start from.'
    },
    stack: {
      code: 'Z2 · R1 · a · L5',
      hit:  { x: 162, y: 64, w: 70, h: 66 },
      label: '',
      text: 'Sometimes two narrow stacks share one zone and row. When that ' +
            'happens they get a letter — a is the one nearer the doors, then b. ' +
            'Most loads never need it, so the letter only appears when it has to.'
    }
  };

  var stage = $('.addr-stage');
  var index = $('#addrIndex');
  var hit   = $('#aHit');
  var hitLb = $('#aHitLabel');
  var code  = $('#addrCode');
  var text  = $('#addrText');

  if (!stage || !index) return;

  function show(key) {
    var s = STEPS[key];
    if (!s) return;

    stage.setAttribute('data-step', key);

    hit.setAttribute('x', s.hit.x);
    hit.setAttribute('y', s.hit.y);
    hit.setAttribute('width', s.hit.w);
    hit.setAttribute('height', s.hit.h);

    hitLb.setAttribute('x', s.hit.x + s.hit.w / 2);
    hitLb.setAttribute('y', s.hit.y + s.hit.h / 2 + 4);
    hitLb.textContent = s.label;

    code.textContent = s.code;
    text.textContent = s.text;

    index.querySelectorAll('button').forEach(function (b) {
      var on = b.dataset.step === key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-current', on ? 'true' : 'false');
    });
  }

  index.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-step]');
    if (b) show(b.dataset.step);
  });

  /* Arrow keys walk the list, which is what a keyboard user expects of
     something that looks and behaves like a set of tabs. */
  index.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var all = [].slice.call(index.querySelectorAll('button'));
    var i = all.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    var next = all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
    next.focus();
    show(next.dataset.step);
  });

  show('zone');
})();
