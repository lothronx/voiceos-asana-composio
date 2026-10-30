/*
 * Behaviour of create_task's confirmation card (inlined by build.ts).
 * Runs in VoiceOS's sandboxed iframe: plain ES5-style browser JS, no imports, no network.
 *
 * Contract with the host (via widgetKit's bridge script, which runs after this one):
 *  - On `voiceos:init` the host sends the pending tool args. Our handler runs
 *    first and renders from them; the kit then copies args into every element
 *    with a data-voiceos-key (here: the title input and four hidden inputs).
 *  - An 'input' event on a keyed element stages that value; staged values
 *    replace the agent's args when the user presses the host's Create task.
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  /** Set a keyed field and stage it with the host (programmatic changes don't fire 'input'). */
  function stage(el, value) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- Dates (all local time, matching due.ts on the server) ----
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var parse = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
  };
  /** "14:30" -> "2:30 PM"; anything unparseable is shown as-is. */
  var clock = function (v) {
    var m = /^(\d{1,2}):(\d{2})/.exec(v);
    if (!m) return v;
    var h = +m[1];
    return ((h + 11) % 12 + 1) + ':' + m[2] + (h < 12 ? ' AM' : ' PM');
  };

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var plus = function (n) { var d = new Date(today); d.setDate(d.getDate() + n); return d; };
  var quick = { today: ymd(today), tomorrow: ymd(plus(1)), mon: ymd(plus((8 - today.getDay()) % 7 || 7)) };
  var view = new Date(today.getFullYear(), today.getMonth(), 1); // first day of the month the calendar shows

  // ---- Option lists: [{v, l}], the first entry is the "none" choice ----
  var menus = {
    due_time: [{ v: '', l: 'No time' }],
    project: [{ v: '', l: 'No project' }],
    section: [{ v: '', l: 'Default section' }],
  };
  for (var h = 0; h < 24; h++) {
    for (var m = 0; m < 60; m += 30) {
      var t = pad(h) + ':' + pad(m);
      menus.due_time.push({ v: t, l: clock(t) });
    }
  }
  /** Add an option unless present: the value that will execute always gets one, so the card never shows less than it sends. */
  function ensure(key, v, label) {
    if (!v) return;
    for (var i = 0; i < menus[key].length; i++) if (menus[key][i].v === v) return;
    menus[key].push({ v: v, l: label || v });
  }
  function labelOf(key, v) {
    for (var i = 0; i < menus[key].length; i++) if (menus[key][i].v === v) return menus[key][i].l;
    return v;
  }

  // ---- Popovers: at most one open, floating under its row ----
  var openId = '';

  /** Open the popover with id `except` (or none for '') and close every other one. */
  function closeAll(except) {
    openId = except || '';
    var pops = document.querySelectorAll('.as-pop');
    for (var i = 0; i < pops.length; i++) pops[i].hidden = pops[i].id !== openId;
    var vals = document.querySelectorAll('.as-val');
    for (var j = 0; j < vals.length; j++) {
      vals[j].setAttribute('aria-expanded', String('as-pop-' + vals[j].getAttribute('data-menu') === openId));
    }
    place();
  }

  /*
   * Anchor the open popover under its row. The frame is only as tall as the
   * document, so when the popover would run past the card bottom the document
   * grows (min-height) instead of the rows moving; 52px keeps the list clear of
   * the host's floating confirm button.
   */
  function place() {
    var root = document.documentElement;
    root.style.minHeight = '';
    if (!openId) return;
    var pop = $(openId);
    var btn = document.querySelector('[data-menu="' + openId.slice('as-pop-'.length) + '"]');
    pop.style.top = (btn.getBoundingClientRect().bottom - document.querySelector('.as').getBoundingClientRect().top + 4) + 'px';
    var need = Math.ceil(pop.getBoundingClientRect().bottom + 52);
    if (need > root.getBoundingClientRect().height) root.style.minHeight = need + 'px';
  }

  // ---- Rendering ----

  /** Refresh one list-backed field: its button label and its option list. */
  function renderMenu(key) {
    var btn = document.querySelector('[data-menu="' + key + '"]');
    var v = $('as-' + key).value;
    btn.hidden = key === 'due_time' && !$('as-due_on').value; // no time without a date
    btn.querySelector('span').textContent = key === 'due_time' && !v ? 'Add time' : labelOf(key, v);
    btn.classList.toggle('as-empty', !v);

    var list = $('as-pop-' + key).firstChild;
    list.textContent = '';
    menus[key].forEach(function (o, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'as-opt' + (i === 0 ? ' as-none' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('data-key', key);
      b.setAttribute('data-v', o.v);
      b.setAttribute('aria-selected', String(o.v === v));
      var s = document.createElement('span');
      s.textContent = o.l;
      b.appendChild(s);
      list.appendChild(b);
    });
  }

  /** Refresh the Due button, the quick picks, the month grid and (since it depends on the date) the time field. */
  function renderDate() {
    var v = $('as-due_on').value;
    var d = parse(v);

    var chips = document.querySelectorAll('.as-c[data-q]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-pressed', String(quick[chips[i].getAttribute('data-q')] === v));
    }

    var btn = $('as-due-btn');
    btn.querySelector('span').textContent =
      !d ? 'No due date'
      : v === quick.today ? 'Today'
      : v === quick.tomorrow ? 'Tomorrow'
      : DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() +
        (d.getFullYear() !== today.getFullYear() ? ', ' + d.getFullYear() : '');
    btn.classList.toggle('as-empty', !d);
    $('as-clear').disabled = !v;

    $('as-month').textContent = MONTHS[view.getMonth()] + ' ' + view.getFullYear();
    var grid = $('as-grid');
    grid.textContent = '';
    'Su Mo Tu We Th Fr Sa'.split(' ').forEach(function (t) {
      var s = document.createElement('span');
      s.textContent = t;
      grid.appendChild(s);
    });
    for (var k = 0; k < view.getDay(); k++) grid.appendChild(document.createElement('span')); // leading blanks
    var daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    for (var day = 1; day <= daysInMonth; day++) {
      var dd = new Date(view.getFullYear(), view.getMonth(), day);
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = day;
      b.setAttribute('data-v', ymd(dd));
      b.className = +dd === +today ? 'as-today' : dd < today ? 'as-past' : '';
      b.setAttribute('aria-pressed', String(ymd(dd) === v));
      grid.appendChild(b);
    }

    renderMenu('due_time');
  }

  /** Set (or clear with '') the due date. Clearing the date also clears its time. */
  function setDate(v) {
    stage($('as-due_on'), v);
    if (!v && $('as-due_time').value) stage($('as-due_time'), '');
    renderDate();
  }

  /** Scroll an open list so its selected option (or 9:00 AM) is in the middle. */
  function centerSelection(pop) {
    var list = pop.firstChild;
    var sel = pop.querySelector('[aria-selected=true]:not(.as-none)') || pop.querySelector('[data-v="09:00"]');
    if (sel) list.scrollTop = sel.offsetTop - list.offsetTop - (list.clientHeight - sel.offsetHeight) / 2;
  }

  // ---- Interaction: one delegated click handler for the whole card ----
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var chip = t.closest('.as-c[data-q]');
    if (chip) { setDate(quick[chip.getAttribute('data-q')]); closeAll(''); return; }
    if (t.closest('#as-clear')) { setDate(''); closeAll(''); return; }
    if (t.closest('#as-prev')) { view.setMonth(view.getMonth() - 1); renderDate(); place(); return; }
    if (t.closest('#as-next')) { view.setMonth(view.getMonth() + 1); renderDate(); place(); return; }

    var day = t.closest('#as-grid>button');
    if (day) { setDate(day.getAttribute('data-v')); closeAll(''); return; }

    var val = t.closest('.as-val');
    if (val) {
      var key = val.getAttribute('data-menu');
      var opening = val.getAttribute('aria-expanded') !== 'true';
      if (opening && key === 'cal') {
        var d = parse($('as-due_on').value) || today;
        view = new Date(d.getFullYear(), d.getMonth(), 1);
        renderDate();
      }
      closeAll(opening ? 'as-pop-' + key : '');
      if (opening && key !== 'cal') centerSelection($('as-pop-' + key));
      return;
    }

    var opt = t.closest('.as-opt');
    if (opt) {
      var k = opt.getAttribute('data-key');
      stage($('as-' + k), opt.getAttribute('data-v'));
      closeAll('');
      renderMenu(k);
      return;
    }

    // A click anywhere outside the open popover dismisses it.
    if (!t.closest('.as-pop')) closeAll('');
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(''); });

  // ---- Hydration from the agent's args ----
  addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || e.data.type !== 'voiceos:init') return;
    var a = e.data.args || {};

    [['project', a.project_choices], ['section', a.section_choices]].forEach(function (p) {
      (Array.isArray(p[1]) ? p[1] : []).forEach(function (c) {
        if (c && c.gid != null) ensure(p[0], String(c.gid), String(c.name || c.gid));
      });
    });
    ensure('project', a.project ? String(a.project) : '');
    ensure('section', a.section ? String(a.section) : '');
    ensure('due_time', a.due_time ? String(a.due_time) : '', a.due_time ? clock(String(a.due_time)) : '');

    ['due_on', 'due_time', 'project', 'section'].forEach(function (k) {
      $('as-' + k).value = a[k] == null ? '' : String(a[k]);
    });
    var d = parse(a.due_on);
    if (d) view = new Date(d.getFullYear(), d.getMonth(), 1);

    renderDate();
    renderMenu('project');
    renderMenu('section');
  });

  // First paint before init arrives (empty card).
  renderDate();
  renderMenu('project');
  renderMenu('section');
})();
