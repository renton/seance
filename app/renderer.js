// A sortable, filterable table over seance list --json: one row per session, plus one per
// ticket worktree that has no session yet. The app keeps no data of its own; every refresh
// asks seance afresh. Only view settings (sort, filters) are remembered.
// All text goes in through textContent, never as HTML.

const REFRESH_MS = 5000;
const STATUSES = ['running', 'idle', 'open', 'stopped', 'none'];
const STATUS_LABEL = { running: 'Running', idle: 'Idle', open: 'Open elsewhere', stopped: 'Stopped', none: 'No session' };
const ACTION_LABEL = { attach: 'Attach', resume: 'Resume', open: 'Open' };

const $ = (id) => document.getElementById(id);
const filterInput = $('filter');
const repoSelect = $('repo-filter');

let data = null;
let home = '';
let lastJson = '';

const view = { sort: 'status', dir: 1, statuses: [...STATUSES], repo: '', tab: 'table', hidden: [], showHidden: false, ...load() };

// Rows hidden with the eye button, by key (a session id, or a worktree path). Kept only in this
// app's own storage, like the sort and filters; seance knows nothing about it.
const isHidden = (r) => view.hidden.includes(r.key);

function load() {
  try {
    return JSON.parse(localStorage.getItem('view'));
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem('view', JSON.stringify(view));
  } catch {}
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

// A stable colour per repo: its name hashed (FNV-1a) to a hue, so a repo looks the same in
// every view and on every launch without anything being stored.
function repoHue(name) {
  let hash = 2166136261;
  for (const ch of name) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
  return (hash >>> 0) % 360;
}

function hued(node, name) {
  node.style.setProperty('--h', String(repoHue(name)));
  return node;
}

const repoBadge = (name, cls = '') => hued(el('span', { class: `repo-badge ${cls}`.trim(), text: name }), name);

// A repo badge that filters the view to its repo, or clears that filter if it is already on.
function repoFilterBadge(name, cls = '') {
  const on = view.repo === name;
  return hued(el('button', {
    type: 'button',
    class: `repo-badge filter ${cls}${on ? ' active' : ''}`.trim(),
    title: on ? 'Show all repos' : `Show only ${name}`,
    'aria-pressed': on ? 'true' : 'false',
    text: name,
    onclick: (e) => {
      e.stopPropagation();
      view.repo = on ? '' : name;
      save();
      render();
    },
  }), name);
}
const repoDot = (name) => hued(el('span', { class: 'repo-dot', 'aria-hidden': 'true' }), name);

const tilde = (p) => (home && p && p.startsWith(home + '/') ? '~' + p.slice(home.length) : p);

function ago(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function toast(message, kind = 'info') {
  const box = $('toast');
  box.textContent = message;
  box.className = `toast ${kind}`;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('show'));
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    box.classList.remove('show');
    setTimeout(() => (box.hidden = true), 200);
  }, 4500);
}

// Turn seance's repos and sessions into table rows.
function buildRows() {
  const byPath = new Map();
  for (const repo of data.repos) for (const wt of repo.worktrees) byPath.set(wt.path, { repo, wt });

  const rows = data.sessions.map((s) => {
    const where = byPath.get(s.worktrees[0]) || byPath.get(s.cwd);
    const wt = where && where.wt;
    return {
      key: s.session_id,
      status: s.state,
      ticket: s.ticket || (wt && wt.repo_folder ? '' : wt && wt.ticket) || '',
      jiraUrl: s.jira_url || (wt && wt.jira_url) || null,
      place: wt && wt.repo_folder ? 'repo folder' : '',
      repos: s.repos,
      branch: (wt && wt.branch) || '',
      session: s,
      started: s.created || '',
    };
  });

  for (const repo of data.repos) {
    for (const wt of repo.worktrees) {
      if (wt.repo_folder || wt.session_ids.length) continue;
      const name = wt.ticket || tilde(wt.path);
      rows.push({
        key: wt.path,
        status: 'none',
        ticket: name,
        jiraUrl: wt.jira_url,
        place: '',
        repos: [repo.name],
        branch: wt.branch || '',
        session: null,
        started: '',
        // seance can start a session here only on a worktree it would have made itself.
        startable: Boolean(wt.ticket && wt.branch && (wt.branch === wt.ticket || wt.branch.endsWith('/' + wt.ticket))),
      });
    }
  }
  return rows;
}

const SORTERS = {
  status: (r) => STATUSES.indexOf(r.status),
  ticket: (r) => (r.ticket || r.place || '').toLowerCase(),
  repo: (r) => r.repos.join(',').toLowerCase(),
  branch: (r) => r.branch.toLowerCase(),
  session: (r) => (r.session ? r.session.name || '' : '').toLowerCase(),
  started: (r) => (r.started ? Date.parse(r.started) : 0),
};

function compare(a, b) {
  const key = SORTERS[view.sort] || SORTERS.status;
  const x = key(a);
  const y = key(b);
  if (x < y) return -view.dir;
  if (x > y) return view.dir;
  // Ties: newest first, then by ticket.
  const t = (Date.parse(b.started) || 0) - (Date.parse(a.started) || 0);
  return t || SORTERS.ticket(a).localeCompare(SORTERS.ticket(b));
}

function rowMatches(r, query) {
  if (isHidden(r) && !view.showHidden) return false;
  if (!view.statuses.includes(r.status)) return false;
  if (view.repo && !r.repos.includes(view.repo)) return false;
  if (!query) return true;
  const hay = [r.ticket, r.place, r.branch, ...r.repos, r.session && r.session.name, r.session && r.session.short_id]
    .filter(Boolean).join(' ').toLowerCase();
  return query.split(/\s+/).every((word) => hay.includes(word));
}

async function openSession(session, button) {
  button.disabled = true;
  button.classList.add('busy');
  const result = await window.seance.open(session.session_id);
  button.classList.remove('busy');
  button.disabled = false;
  if (result.ok) toast(`Opening ${session.name} in a terminal`);
  else toast(result.message, 'error');
  refresh();
}

async function openLink(url) {
  const result = await window.seance.openLink(url);
  if (!result.ok) toast(result.message, 'error');
}

function statusCell(status) {
  return el('span', { class: `status s-${status}` }, el('span', { class: 'dot' }), STATUS_LABEL[status]);
}

function ticketCell(r) {
  if (!r.ticket) return el('span', { class: 'muted', text: r.place || 'unknown' });
  if (!r.jiraUrl) return el('span', { class: 'ticket', title: r.ticket, text: r.ticket });
  return el('a', {
    class: 'ticket link',
    href: '#',
    title: `Open ${r.ticket} in Jira`,
    onclick: (e) => { e.preventDefault(); openLink(r.jiraUrl); },
  }, r.ticket, el('span', { class: 'ext', 'aria-hidden': 'true', text: '↗' }));
}

const JIRA_KEY = /^[A-Za-z][A-Za-z0-9]+-[0-9]+$/;
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function create(request, button) {
  if (button) {
    button.disabled = true;
    button.classList.add('busy');
  }
  const result = await window.seance.create(request);
  if (button) {
    button.classList.remove('busy');
    button.disabled = false;
  }
  if (result.ok) {
    const name = `${request.repos[0]}-${request.jira ? request.name.toUpperCase() : request.name}`;
    toast(request.fork ? `Forking into ${name} in a terminal` : `Starting ${name} in a terminal`);
    refresh();
  }
  return result;
}

function actionCell(r) {
  const s = r.session;
  if (!s) {
    if (!r.startable) return el('span', { class: 'muted small-text', title: `Branch ${r.branch} was not made by seance`, text: 'not a seance worktree' });
    const request = { name: r.ticket, jira: JIRA_KEY.test(r.ticket), repos: r.repos };
    const button = el('button', { class: 'btn', type: 'button', text: 'Start', title: `Start a session for ${r.ticket}` });
    button.addEventListener('click', async () => {
      const result = await create(request, button);
      if (!result.ok) toast(result.message, 'error');
    });
    return button;
  }
  const canOpen = s.action !== 'open' && (s.action !== 'resume' || s.resumable);
  const why = s.action === 'open' ? `Already open in another terminal (pid ${s.pid})` : 'Its worktree has been removed';
  const button = el('button', {
    class: `btn ${s.action === 'attach' ? 'primary' : ''}`,
    type: 'button',
    text: ACTION_LABEL[s.action] || 'Open',
    disabled: !canOpen,
    title: canOpen ? `${ACTION_LABEL[s.action]} ${s.name} in a terminal` : why,
  });
  button.addEventListener('click', (e) => { e.stopPropagation(); openSession(s, button); });
  const fork = el('button', {
    class: 'btn fork',
    type: 'button',
    title: `Fork ${s.name}: a new session that starts with this conversation, on another ticket`,
    'aria-label': `Fork ${s.name}`,
  }, forkIcon(), 'Fork');
  fork.addEventListener('click', (e) => { e.stopPropagation(); openCreate(s); });
  return el('div', { class: 'actions' }, button, fork);
}

function forkIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const [cx, cy] of [[4, 3.5], [12, 3.5], [8, 12.5]]) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', '1.75');
    svg.append(c);
  }
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M4 5.25v1.5a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-1.5M8 8.75v2');
  svg.append(p);
  return svg;
}

function renderRow(r) {
  const s = r.session;
  const tr = el('tr', { class: `row s-${r.status}${isHidden(r) ? ' is-hidden' : ''}` },
    el('td', { class: 'col-status' }, statusCell(r.status)),
    el('td', {}, el('div', { class: 'ticket-cell' },
      ticketCell(r),
      r.branch && el('code', { class: 'branch', title: r.branch, text: r.branch }),
    )),
    el('td', {}, el('div', { class: 'repos' },
      r.repos.map((name, i) => repoFilterBadge(name, i === 0 ? 'main' : '')),
    )),
    el('td', {}, s
      ? el('div', { class: 'session' },
          el('span', { class: 'name-line' },
            el('span', { class: 'session-name', title: s.name, text: s.name || '(unnamed)' }),
            renameButton(s)),
          el('span', { class: 'session-sub' },
            el('code', { class: 'id', title: s.session_id, text: s.short_id }),
            s.forked_from && el('span', { text: `fork of ${s.forked_from.slice(0, 8)}` }),
            !s.from_seance && el('span', { text: 'not from seance' }),
          ))
      : el('span', { class: 'muted', text: 'none yet' })),
    el('td', { class: 'col-started', title: r.started ? new Date(Date.parse(r.started)).toLocaleString() : '' },
      el('span', { class: 'muted', text: ago(r.started) })),
    el('td', { class: 'col-action' }, el('div', { class: 'actions' }, actionCell(r), hideButton(r))),
  );
  if (s) tr.addEventListener('dblclick', () => {
    const button = tr.querySelector('button');
    if (button && !button.disabled) openSession(s, button);
  });
  return tr;
}

function renderChips(rows) {
  const counts = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  for (const r of rows) counts[r.status]++;
  $('status-chips').replaceChildren(...STATUSES.map((k) => el('button', {
    type: 'button',
    class: `chip-toggle s-${k}${view.statuses.includes(k) ? ' on' : ''}`,
    'aria-pressed': view.statuses.includes(k) ? 'true' : 'false',
    onclick: () => {
      view.statuses = view.statuses.includes(k) ? view.statuses.filter((x) => x !== k) : [...view.statuses, k];
      save();
      render();
    },
  }, el('span', { class: 'dot' }), STATUS_LABEL[k], el('span', { class: 'n', text: String(counts[k]) }))));
}

function renderRepoSelect(rows) {
  const names = [...new Set(rows.flatMap((r) => r.repos))].sort();
  if (view.repo && !names.includes(view.repo)) names.unshift(view.repo);
  const current = [...repoSelect.options].map((o) => o.value).join('\n');
  const wanted = ['', ...names].join('\n');
  if (current !== wanted) {
    repoSelect.replaceChildren(el('option', { value: '', text: 'All repos' }), ...names.map((n) => el('option', { value: n, text: n })));
  }
  repoSelect.value = view.repo;
}

function renderHeaders() {
  for (const th of document.querySelectorAll('th[data-key]')) {
    const active = th.dataset.key === view.sort;
    th.classList.toggle('sorted', active);
    th.setAttribute('aria-sort', active ? (view.dir > 0 ? 'ascending' : 'descending') : 'none');
    th.dataset.dir = active ? (view.dir > 0 ? 'asc' : 'desc') : '';
  }
}

function render() {
  if (!data) return;
  const every = buildRows();
  pruneHidden(every);
  const hiddenCount = every.filter(isHidden).length;
  $('hidden-count').textContent = String(hiddenCount);
  $('show-hidden').checked = view.showHidden;
  $('show-hidden-wrap').classList.toggle('dim', !hiddenCount);
  const all = view.showHidden ? every : every.filter((r) => !isHidden(r));
  renderChips(all);
  renderRepoSelect(all);
  renderHeaders();

  renderTabs();

  const query = filterInput.value.trim().toLowerCase();
  const shown = all.filter((r) => rowMatches(r, query)).sort(compare);
  const filtered = Boolean(query || view.repo || view.statuses.length !== STATUSES.length || view.showHidden);
  $('reset').hidden = !filtered;
  $('count').textContent = `${shown.length} of ${all.length} ${all.length === 1 ? 'row' : 'rows'}`;

  if (view.tab === 'repos') renderCards(shown, all, filtered);
  else {
    $('rows').replaceChildren(...shown.map(renderRow));
    const empty = $('empty');
    empty.hidden = shown.length > 0;
    $('table').classList.toggle('is-empty', !shown.length);
    if (!shown.length) empty.replaceChildren(...emptyState(all.length));
  }
}

function emptyState(total) {
  return [
    el('div', { class: 'empty-title', text: total ? 'Nothing matches these filters' : 'Nothing in progress' }),
    el('div', { class: 'empty-sub', text: total ? 'Try clearing the search or turning statuses back on.' : 'Press + to start a session.' }),
  ];
}

function renderTabs() {
  for (const tab of document.querySelectorAll('.tabs [data-view]')) {
    const on = tab.dataset.view === view.tab;
    tab.classList.toggle('on', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  $('table-view').hidden = view.tab === 'repos';
  $('cards').hidden = view.tab !== 'repos';
  document.body.dataset.tab = view.tab;
}

// The Repos view: a card per repo with its worktrees and the sessions in each. A session
// across several repos appears under each of them, as in seance list.
function renderCards(shown, all, filtered) {
  const visible = new Set(shown.map((r) => r.key));
  const rowsBySession = new Map(all.filter((r) => r.session).map((r) => [r.key, r]));
  const rowsByPath = new Map(all.filter((r) => !r.session).map((r) => [r.key, r]));
  const cards = [];
  const quiet = [];

  for (const repo of data.repos) {
    const worktrees = [];
    for (const wt of repo.worktrees) {
      const sessions = wt.session_ids.filter((id) => visible.has(id)).map((id) => rowsBySession.get(id)).sort(compare);
      const bare = rowsByPath.get(wt.path);
      if (sessions.length || (bare && visible.has(bare.key))) worktrees.push({ wt, sessions, bare });
    }
    if (!worktrees.length) {
      if (!filtered && repo.worktrees.every((w) => w.repo_folder)) quiet.push(repo);
      continue;
    }
    const count = repo.worktrees.filter((w) => !w.repo_folder).length;
    cards.push(hued(el('section', { class: 'card' },
      el('header', { class: 'card-head' },
        el('h2', {}, repoBadge(repo.name, 'big')),
        el('span', { class: 'path', text: tilde(repo.path) }),
        el('span', { class: 'spacer' }),
        !repo.present && el('span', { class: 'chip warn', text: 'Folder missing' }),
        count > 0 && el('span', { class: 'count-chip', text: `${count} worktree${count === 1 ? '' : 's'}` }),
      ),
      worktrees.map(({ wt, sessions, bare }) => el('div', { class: `wt${wt.repo_folder ? ' is-folder' : ''}` },
        el('div', { class: 'wt-head' },
          wt.repo_folder ? el('span', { class: 'wt-folder', text: 'Repo folder' }) : ticketCell({ ticket: wt.ticket || tilde(wt.path), jiraUrl: wt.jira_url }),
          wt.branch && el('code', { class: 'branch', text: wt.branch }),
        ),
        sessions.map((r) => cardSession(r, repo.name)),
        bare && !sessions.length && el('div', { class: 'card-session s-none' },
          el('div', { class: 'card-session-main' }, statusCell('none')),
          el('div', { class: 'actions' }, actionCell(bare), hideButton(bare)),
        ),
      )),
    ), repo.name));
  }

  if (!cards.length) cards.push(el('div', { class: 'card empty' }, ...emptyState(all.length)));
  if (quiet.length) {
    cards.push(el('details', { class: 'quiet' },
      el('summary', { text: `${quiet.length} repo${quiet.length === 1 ? '' : 's'} with nothing in progress` }),
      el('div', { class: 'quiet-list' }, quiet.map((r) => el('div', { class: 'quiet-repo' },
        el('span', { class: 'quiet-name', text: r.name }),
        el('code', { class: 'branch', text: (r.worktrees[0] && r.worktrees[0].branch) || '' }),
        el('span', { class: 'path', text: tilde(r.path) }),
      ))),
    ));
  }
  const open = $('cards').querySelector('details.quiet[open]');
  $('cards').replaceChildren(...cards);
  if (open) {
    const again = $('cards').querySelector('details.quiet');
    if (again) again.open = true;
  }
}

function cardSession(r, repoName) {
  const s = r.session;
  const others = s.repos.filter((x) => x !== repoName);
  return el('div', { class: `card-session s-${r.status}${isHidden(r) ? ' is-hidden' : ''}`, ondblclick: (e) => {
    const button = e.currentTarget.querySelector('button');
    if (button && !button.disabled) button.click();
  } },
    el('div', { class: 'card-session-main' },
      statusCell(r.status),
      el('div', { class: 'session' },
        el('span', { class: 'name-line' },
          el('span', { class: 'session-name', title: s.name, text: s.name || '(unnamed)' }),
          renameButton(s)),
        el('span', { class: 'session-sub' },
          el('code', { class: 'id', title: s.session_id, text: s.short_id }),
          others.length > 0 && el('span', { class: 'also', title: 'Also works in these repos' }, '+', others.map((name) => repoFilterBadge(name, 'small'))),
          s.forked_from && el('span', { text: `fork of ${s.forked_from.slice(0, 8)}` }),
          !s.from_seance && el('span', { text: 'not from seance' }),
          r.started && el('span', { title: new Date(Date.parse(r.started)).toLocaleString(), text: ago(r.started) }),
        ),
      ),
    ),
    el('div', { class: 'actions' }, actionCell(r), hideButton(r)),
  );
}

// Forget hidden keys whose session or worktree is gone for good.
function pruneHidden(rows) {
  const keys = new Set(rows.map((r) => r.key));
  const kept = view.hidden.filter((k) => keys.has(k));
  if (kept.length !== view.hidden.length) {
    view.hidden = kept;
    save();
  }
}

function eyeIcon(crossed) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const shapes = [['path', { d: 'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z' }], ['circle', { cx: 8, cy: 8, r: 2 }]];
  if (crossed) shapes.push(['path', { d: 'M2.5 13.5l11-11' }]);
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

function hideButton(r) {
  const hidden = isHidden(r);
  return el('button', {
    type: 'button',
    class: `btn icon hide${hidden ? ' on' : ''}`,
    title: hidden ? 'Unhide this row' : 'Hide this row (Show hidden brings it back)',
    'aria-label': hidden ? 'Unhide' : 'Hide',
    onclick: (e) => {
      e.stopPropagation();
      view.hidden = hidden ? view.hidden.filter((k) => k !== r.key) : [...view.hidden, r.key];
      save();
      if (!hidden && !view.showHidden) toast('Hidden. Turn on Show hidden to see it again.');
      render();
    },
  }, eyeIcon(!hidden));
}

async function refresh() {
  const result = await window.seance.list();
  const error = $('error');
  if (!result.ok) {
    error.textContent = `Could not read seance: ${result.message}`;
    error.hidden = false;
    return;
  }
  error.hidden = true;
  home = result.home || '';
  $('updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  const { generated, ...rest } = result.data;
  const json = JSON.stringify(rest);
  if (json === lastJson) {
    render();
    return;
  }
  lastJson = json;
  data = result.data;
  render();
}

for (const th of document.querySelectorAll('th[data-key]')) {
  th.tabIndex = 0;
  const sort = () => {
    if (view.sort === th.dataset.key) view.dir = -view.dir;
    else {
      view.sort = th.dataset.key;
      view.dir = th.dataset.key === 'started' ? -1 : 1;
    }
    save();
    render();
  };
  th.addEventListener('click', sort);
  th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
}

repoSelect.addEventListener('change', () => { view.repo = repoSelect.value; save(); render(); });
$('show-hidden').addEventListener('change', (e) => { view.showHidden = e.target.checked; save(); render(); });
for (const tab of document.querySelectorAll('.tabs [data-view]')) {
  tab.addEventListener('click', () => { view.tab = tab.dataset.view; save(); render(); });
}
filterInput.addEventListener('input', render);
$('reset').addEventListener('click', () => {
  filterInput.value = '';
  view.repo = '';
  view.statuses = [...STATUSES];
  view.showHidden = false;
  save();
  render();
});
// Renaming: a pencil by each seance session's name opens a dialog for the few words that
// end its name, saved with seance title.

const renameDialog = $('rename');
const renameWords = $('rename-words');
let renaming = null;

// The same rule seance applies: lowercase, hyphens, at most five words and 40 characters.
function slugify(words) {
  return words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .split('-').slice(0, 5).join('-').slice(0, 40).replace(/-+$/, '');
}

function renameButton(s) {
  if (!s.from_seance) return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M10.5 2.5l3 3L6 13l-3.5.5L3 10z');
  svg.append(path);
  return el('button', {
    type: 'button',
    class: 'rename',
    title: 'Rename this session',
    'aria-label': `Rename ${s.name}`,
    onclick: (e) => { e.stopPropagation(); openRename(s); },
  }, svg);
}

function namePrefix(s) {
  return `${s.repos[0]}-${s.ticket}-`;
}

function updateRename() {
  const slug = slugify(renameWords.value);
  $('rename-preview').textContent = namePrefix(renaming) + (slug || '<words>');
  $('rename-submit').disabled = !slug;
  const hint = $('rename-hint');
  hint.classList.remove('error');
  hint.textContent = renameWords.value.trim() && slug.split('-').length >= 5 && renameWords.value.trim().split(/[^A-Za-z0-9]+/).filter(Boolean).length > 5
    ? 'Only the first five words are kept.'
    : '';
}

function openRename(s) {
  if (renameDialog.open || dialog.open) return;
  renaming = s;
  renameWords.value = s.title ? s.title.replace(/-/g, ' ') : '';
  updateRename();
  renameDialog.showModal();
  renameWords.focus();
  renameWords.select();
}

renameWords.addEventListener('input', updateRename);
$('rename-cancel').addEventListener('click', () => renameDialog.close());
renameDialog.addEventListener('click', (e) => { if (e.target === renameDialog) renameDialog.close(); });
$('rename-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('rename-submit');
  if (button.disabled || !renaming) return;
  button.disabled = true;
  const result = await window.seance.title({ sessionId: renaming.session_id, words: renameWords.value });
  button.disabled = false;
  if (result.ok) {
    renameDialog.close();
    toast(`Renamed to ${namePrefix(renaming)}${slugify(renameWords.value)}`);
    refresh();
  } else {
    const hint = $('rename-hint');
    hint.textContent = result.message;
    hint.classList.add('error');
  }
});

// The New session dialog.

const dialog = $('create');
const nameInput = $('create-name');
const jiraBox = $('create-jira');
const baseInput = $('create-base');
const titleInput = $('create-title-words');

// A branch to start from, as seance --base takes it: origin/ is optional and dropped.
const BASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
function baseValue() {
  return baseInput.value.trim().replace(/^origin\//, '');
}
function baseProblem() {
  const base = baseValue();
  if (!base) return '';
  const bad = !BASE_NAME.test(base) || base.includes('..') || base.includes('//') || base.endsWith('/') || base.endsWith('.lock');
  return bad ? 'Not a branch name. Something like develop or release/2.4.' : '';
}
const repoSearch = $('create-repo-search');
const submit = $('create-submit');
let chosen = [];

function nameProblem() {
  const name = nameInput.value.trim();
  if (!name) return '';
  if (jiraBox.checked) return JIRA_KEY.test(name) ? '' : 'A Jira key looks like PROJ-123. Untick Jira ticket for any other name.';
  return PLAIN_NAME.test(name) ? '' : 'Use letters, digits, ".", "_" and "-", starting with a letter or digit.';
}

function renderRepoList() {
  const query = repoSearch.value.trim().toLowerCase();
  const repos = data.repos.filter((r) => !query || r.name.toLowerCase().includes(query));
  $('create-repos').replaceChildren(...(repos.length ? repos.map((r) => {
    const box = el('input', { type: 'checkbox', value: r.name, disabled: !r.present });
    box.checked = chosen.includes(r.name);
    box.addEventListener('change', () => {
      chosen = box.checked ? [...chosen, r.name] : chosen.filter((x) => x !== r.name);
      updateCreate();
    });
    return el('label', { class: `repo-option${r.present ? '' : ' missing'}` },
      box,
      el('span', { class: 'box', 'aria-hidden': 'true' }),
      repoDot(r.name),
      el('span', { class: 'repo-option-name', text: r.name }),
      el('span', { class: 'order', 'data-repo': r.name }),
      el('span', { class: 'repo-option-path', text: r.present ? tilde(r.path) : 'folder missing' }),
    );
  }) : [el('div', { class: 'muted repo-none', text: 'No repo matches.' })]));
  updateCreate();
}

function updateCreate() {
  for (const badge of document.querySelectorAll('#create-repos .order')) {
    const i = chosen.indexOf(badge.dataset.repo);
    badge.textContent = i < 0 ? '' : i === 0 ? 'runs here' : `${i + 1}`;
    badge.classList.toggle('first', i === 0);
  }
  $('create-picked').replaceChildren(...chosen.map((name, i) => el('span', { class: `picked-chip${i === 0 ? ' first' : ''}` },
    el('span', { class: 'picked-n', text: String(i + 1) }),
    repoDot(name),
    name,
    el('button', {
      type: 'button',
      class: 'picked-x',
      'aria-label': `Remove ${name}`,
      text: '×',
      onclick: () => { chosen = chosen.filter((x) => x !== name); renderRepoList(); },
    }),
  )));

  const name = nameInput.value.trim();
  const problem = nameProblem();
  const hint = $('create-name-hint');
  hint.textContent = problem;
  hint.classList.toggle('error', Boolean(problem));
  nameInput.classList.toggle('invalid', Boolean(problem));
  nameInput.placeholder = jiraBox.checked ? 'PROJ-123' : 'fix-ci-cache';

  const shownName = name ? (jiraBox.checked ? name.toUpperCase() : name) : jiraBox.checked ? '<TICKET>' : '<name>';
  const base = baseValue();
  const baseHint = $('create-base-hint');
  baseHint.textContent = baseProblem();
  baseHint.classList.toggle('error', Boolean(baseProblem()));
  baseInput.classList.toggle('invalid', Boolean(baseProblem()));
  const titleSlug = slugify(titleInput.value);
  $('create-command').textContent = `seance ${titleSlug ? `--title "${titleSlug.replace(/-/g, ' ')}" ` : ''}${base && !baseProblem() ? `--base ${base} ` : ''}${jiraBox.checked ? '' : '-n '}${chosen.length ? chosen.join(',') : '<repos>'} ${shownName}${forkSource ? ' ' + forkSource.short_id : ''}`;
  submit.disabled = !name || Boolean(problem) || Boolean(baseProblem()) || !chosen.length;
}

// With a session, the dialog forks it: the new session starts with that conversation.
let forkSource = null;

function openCreate(source = null) {
  if (!data || dialog.open) return;
  forkSource = source;
  $('create-title').textContent = source ? 'Fork session' : 'New session';
  $('create-intro').textContent = source
    ? 'A new session that starts with the whole conversation below, in a fresh worktree for another ticket. The original is left as it is.'
    : 'A worktree and branch in each repo you choose, and a Claude session across them.';
  $('create-source').hidden = !source;
  if (source) {
    $('create-source-name').replaceChildren(
      el('span', { text: source.name || '(unnamed)' }),
      el('code', { class: 'id', text: ` ${source.short_id}` }),
      source.ticket && el('span', { class: 'muted', text: `  from ${source.ticket}` }),
    );
  }
  submit.textContent = source ? 'Fork' : 'Create';
  nameInput.value = '';
  jiraBox.checked = true;
  baseInput.value = '';
  titleInput.value = '';
  repoSearch.value = '';
  const present = new Set(data.repos.filter((r) => r.present).map((r) => r.name));
  chosen = source ? source.repos.filter((r) => present.has(r)) : view.repo ? [view.repo] : [];
  renderRepoList();
  dialog.showModal();
  nameInput.focus();
}

$('new').addEventListener('click', () => openCreate());
$('create-cancel').addEventListener('click', () => dialog.close());
nameInput.addEventListener('input', updateCreate);
baseInput.addEventListener('input', updateCreate);
titleInput.addEventListener('input', updateCreate);
jiraBox.addEventListener('change', updateCreate);
repoSearch.addEventListener('input', renderRepoList);
repoSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submit.disabled) return;
  const request = { name: nameInput.value.trim(), jira: jiraBox.checked, repos: chosen };
  if (forkSource) request.fork = forkSource.session_id;
  if (baseValue()) request.base = baseValue();
  if (slugify(titleInput.value)) request.title = titleInput.value.trim();
  const result = await create(request, submit);
  if (result.ok) dialog.close();
  else {
    const hint = $('create-name-hint');
    hint.textContent = result.message;
    hint.classList.add('error');
  }
});

document.addEventListener('keydown', (e) => {
  if (dialog.open || renameDialog.open) return;
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (e.key === 'n' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    openCreate();
  } else if (e.key === '/' && document.activeElement !== filterInput) {
    e.preventDefault();
    filterInput.focus();
    filterInput.select();
  } else if (e.key === 'Escape' && document.activeElement === filterInput) {
    filterInput.value = '';
    render();
  }
});
window.addEventListener('focus', refresh);
setInterval(refresh, REFRESH_MS);
refresh();
