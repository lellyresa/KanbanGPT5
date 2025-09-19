// Data model and persistence
const StorageKeys = {
  projects: 'kanban_gpt5_projects_v1',
  activeProjectId: 'kanban_gpt5_active_project_v1',
  today: 'kanban_gpt5_today_v1',
  pomodoro: 'kanban_gpt5_pomodoro_v1'
};

function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function debounce(fn, wait = 200) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}

// Initial state
let projects = loadJson(StorageKeys.projects, []);
let activeProjectId = localStorage.getItem(StorageKeys.activeProjectId) || null;
let todayTaskIds = loadJson(StorageKeys.today, []);
let searchQuery = '';
let searchQueryNormalized = '';
let currentTaskInspector = null;

if (projects.length === 0) {
  const demo = {
    id: generateId('project'),
    name: 'Project 1',
    columns: [
      { id: generateId('col'), name: 'To-do' },
      { id: generateId('col'), name: 'In progress' },
      { id: generateId('col'), name: 'Done' }
    ],
    tasks: [
      { id: generateId('task'), title: 'Welcome', notes: 'Click to expand me', due: null, createdAt: Date.now(), pinned: false },
    ]
  };
  projects = [demo];
  activeProjectId = 'overview';
  saveJson(StorageKeys.projects, projects);
  localStorage.setItem(StorageKeys.activeProjectId, activeProjectId);
}

// Ensure columns exist and assign default columnId to tasks
projects.forEach(p => {
  if (!Array.isArray(p.columns) || p.columns.length === 0) {
    p.columns = [
      { id: generateId('col'), name: 'To-do' },
      { id: generateId('col'), name: 'In progress' },
      { id: generateId('col'), name: 'Done' }
    ];
  }
  const defaultColId = p.columns[0].id;
  if (Array.isArray(p.tasks)) {
    p.tasks.forEach(t => { if (!t.columnId) t.columnId = defaultColId; });
    // Initialize ordering per column if missing
    p.columns.forEach(col => {
      const inCol = p.tasks
        .filter(t => t.columnId === col.id)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      inCol.forEach((t, idx) => { if (typeof t.order !== 'number') t.order = idx; });
    });
  }
});
saveJson(StorageKeys.projects, projects);

// DOM refs
const els = {
  boardTitle: document.getElementById('board-title'),
  boardList: document.getElementById('board-list'),
  boardArea: document.querySelector('.board'),
  todayList: document.getElementById('today-list'),
  todayDropzone: document.getElementById('today-dropzone'),
  addTask: document.getElementById('add-task'),
  addProject: document.getElementById('add-project'),
  currentProjectBtn: document.getElementById('current-project'),
  projectMenu: document.getElementById('project-menu'),
  searchInput: document.getElementById('board-search')
};

const handleSearchInput = debounce((value) => {
  searchQuery = value;
  searchQueryNormalized = value.trim().toLowerCase();
  renderBoard();
  renderToday();
}, 180);

if (els.searchInput) {
  const emitSearch = () => handleSearchInput(els.searchInput.value);
  searchQuery = els.searchInput.value || '';
  searchQueryNormalized = searchQuery.trim().toLowerCase();
  els.searchInput.addEventListener('input', emitSearch);
  els.searchInput.addEventListener('search', emitSearch);
}

if (els.boardArea) {
  const handleBoardDragover = (ev) => {
    const payload = dragPayload;
    if (!payload?.fromToday) return;
    if (eventTargetsColumn(ev)) {
      ev.dataTransfer.dropEffect = 'none';
      return;
    }
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
  };
  const handleBoardDrop = (ev) => {
    const transferData = ev.dataTransfer.getData('application/json') || ev.dataTransfer.getData('text/plain');
    let parsed = null;
    if (transferData) {
      try { parsed = JSON.parse(transferData); } catch {}
    }
    const data = dragPayload || parsed;
    if (!data?.fromToday) return;
    if (eventTargetsColumn(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    removeTaskFromToday(data.taskId);
  };
  els.boardArea.addEventListener('dragover', handleBoardDragover);
  els.boardArea.addEventListener('drop', handleBoardDrop);
}

function getProjectById(projectId) {
  return projects.find(p => p.id === projectId);
}

function getActiveProject() {
  return getProjectById(activeProjectId) || projects[0];
}

function setActiveProject(projectId) {
  activeProjectId = projectId;
  localStorage.setItem(StorageKeys.activeProjectId, activeProjectId);
  render();
}

// Rendering
function render() {
  renderProjectSwitcher();
  renderProjectTabs();
  renderBoard();
  renderToday();
}

function renderProjectSwitcher() {
  const active = getActiveProject();
  els.currentProjectBtn.textContent = active ? active.name : 'Project';
  const menu = els.projectMenu;
  menu.innerHTML = '';

  // Overview (pressing tasks across boards)
  const overviewBtn = document.createElement('button');
  overviewBtn.className = 'btn subtle';
  overviewBtn.style.width = '100%';
  overviewBtn.textContent = 'Overview';
  overviewBtn.onclick = () => setActiveProject('overview');
  menu.appendChild(overviewBtn);

  // Divider
  const hr = document.createElement('div');
  hr.style.height = '1px';
  hr.style.background = 'var(--border)';
  hr.style.margin = '6px 0';
  menu.appendChild(hr);

  projects.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'btn ghost';
    btn.style.width = '100%';
    btn.textContent = p.name;
    btn.onclick = () => setActiveProject(p.id);
    menu.appendChild(btn);
  });

  const add = document.createElement('button');
  add.className = 'btn primary';
  add.style.width = '100%';
  add.textContent = 'New Project';
  add.onclick = () => openProjectModal();
  menu.appendChild(add);
}

function renderProjectTabs() {
  const wrap = document.getElementById('project-tabs');
  if (!wrap) return;
  wrap.innerHTML = '';
  const isOverview = activeProjectId === 'overview';
  const ov = document.createElement('button');
  ov.className = 'tab' + (isOverview ? ' active' : '');
  ov.textContent = 'Overview';
  ov.onclick = () => setActiveProject('overview');
  wrap.appendChild(ov);

  projects.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (p.id === activeProjectId ? ' active' : '');
    btn.textContent = p.name;
    btn.onclick = () => setActiveProject(p.id);
    wrap.appendChild(btn);
  });

  const add = document.createElement('button');
  add.className = 'tab add';
  add.textContent = '＋';
  add.title = 'New Project';
  add.onclick = () => openProjectModal();
  wrap.appendChild(add);
}

function taskMatchesQuery(task) {
  if (!searchQueryNormalized) return true;
  const title = (task?.title || '').toLowerCase();
  const notes = (task?.notes || '').toLowerCase();
  return title.includes(searchQueryNormalized) || notes.includes(searchQueryNormalized);
}

function isInteractiveTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(target.closest('button, .icon-btn, .pill-btn, a, input, textarea, select, label'));
}

function isInsideBoardColumn(target) {
  if (!target) return false;
  if (target instanceof Element) return Boolean(target.closest('.column'));
  if (typeof Node !== 'undefined' && target instanceof Node && target.nodeType === Node.TEXT_NODE) {
    const parent = target.parentElement;
    if (parent) return Boolean(parent.closest('.column'));
  }
  return false;
}

function eventTargetsColumn(ev) {
  return isPointerOverColumn(ev.clientX, ev.clientY);
}

function isPointerOverColumn(x, y) {
  if (!els.boardList) return false;
  const columns = Array.from(els.boardList.querySelectorAll('.column'));
  return columns.some(col => {
    const rect = col.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
}

function renderBoard() {
  const list = els.boardList;
  list.innerHTML = '';
  const boardTitle = els.boardTitle;
  const activeQuery = searchQueryNormalized;

  if (activeProjectId === 'overview') {
    boardTitle.textContent = 'Overview';
    boardTitle.onclick = null; // disable rename on overview
    boardTitle.ondblclick = null;
    const pressing = getPressingTasksAcrossProjects();
    const scoped = activeQuery ? pressing.filter(({ task }) => taskMatchesQuery(task)) : pressing;
    const col = document.createElement('div');
    col.className = 'column';
    const ch = document.createElement('div'); ch.className = 'column-header';
    const ct = document.createElement('div'); ct.className = 'column-title'; ct.textContent = 'Pressing';
    ch.appendChild(ct); col.appendChild(ch);
    const cards = document.createElement('div'); cards.className = 'card-list';
    scoped.forEach(({ projectId, task }) => {
      cards.appendChild(createTaskCard(task, projectId, { matchesQuery: !!activeQuery }));
    });
    col.appendChild(cards);
    list.appendChild(col);
  } else {
    const project = getActiveProject();
    boardTitle.textContent = project?.name || 'Project';
    // Enable dblclick to rename project
    if (project) {
      boardTitle.title = 'Double-click to rename project';
      boardTitle.ondblclick = () => openRenameProjectModal(project.id, project.name);
    }
    if (!project) return;
    project.columns.forEach(col => {
      const colEl = document.createElement('div');
      colEl.className = 'column';
      colEl.dataset.columnId = col.id;

      const header = document.createElement('div'); header.className = 'column-header'; header.setAttribute('draggable', 'true');
      const title = document.createElement('div'); title.className = 'column-title'; title.textContent = col.name;
      title.title = 'Double-click to rename column';
      title.ondblclick = () => openRenameColumnModal(project.id, col.id, col.name);
      const actions = document.createElement('div'); actions.className = 'column-actions';
      const addBtn = document.createElement('button'); addBtn.className = 'icon-btn'; addBtn.title = 'Add Task'; addBtn.textContent = '＋';
      actions.appendChild(addBtn);
      header.appendChild(title); header.appendChild(actions);
      colEl.appendChild(header);

      addBtn.onclick = () => openTaskModal(project.id, null, { defaultColumnId: col.id });

      const listEl = document.createElement('div'); listEl.className = 'card-list'; listEl.dataset.dropzone = 'column'; listEl.dataset.columnId = col.id;
      enableDropzone(listEl, 'column', { columnId: col.id, projectId: project.id });

      project.tasks
        .filter(t => t.columnId === col.id)
        .filter(taskMatchesQuery)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .forEach(task => listEl.appendChild(createTaskCard(task, project.id, { matchesQuery: !!activeQuery })));

      colEl.appendChild(listEl);
      list.appendChild(colEl);
    });

    // Enable column drag for reordering
    enableColumnDrag(list, project);
  }
}

function renderToday() {
  const list = els.todayList;
  list.innerHTML = '';
  todayTaskIds = loadJson(StorageKeys.today, todayTaskIds);
  const activeQuery = searchQueryNormalized;
  const tasks = getAllTasksFlat().filter(t => todayTaskIds.includes(t.task.id));
  const tasksById = new Map();
  tasks.forEach(entry => {
    if (!activeQuery || taskMatchesQuery(entry.task)) {
      tasksById.set(entry.task.id, entry);
    }
  });
  // Preserve explicit order based on todayTaskIds sequence
  todayTaskIds.forEach(id => {
    const match = tasksById.get(id);
    if (match) {
      list.appendChild(createTaskCard(match.task, match.projectId, { compact: true, inToday: true, matchesQuery: !!activeQuery }));
    }
  });
  enableDropzone(list, 'today');
  // Removed outer Today container as a drop target for a cleaner UX
}

function getAllTasksFlat() {
  const acc = [];
  projects.forEach(p => {
    p.tasks.forEach(task => acc.push({ projectId: p.id, task }));
  });
  return acc;
}

function getPressingTasksAcrossProjects() {
  const tasks = getAllTasksFlat();
  const withDue = tasks.filter(x => !!x.task.due);
  withDue.sort((a, b) => new Date(a.task.due) - new Date(b.task.due));
  return withDue;
}

function removeTaskFromToday(taskId) {
  todayTaskIds = todayTaskIds.filter(id => id !== taskId);
  saveJson(StorageKeys.today, todayTaskIds);
  renderToday();
  highlightSelectedTodayCard();
}

// Card creation
function createTaskCard(task, projectId, options = {}) {
  const { compact = false, inToday = false, matchesQuery = false } = options;
  const tpl = /** @type {HTMLTemplateElement} */ (document.getElementById('task-card-template'));
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.taskId = task.id;
  node.dataset.projectId = projectId;
  node.dataset.origin = inToday ? 'today' : 'board';
  if (matchesQuery) node.classList.add('search-hit');
  node.querySelector('.card-title').textContent = task.title || 'Untitled';
  // Insert subtle priority dot next to title
  const titleEl = node.querySelector('.card-title');
  const dot = document.createElement('span');
  dot.className = `priority-dot ${String(task.priority || 'LOW').toLowerCase()}`;
  titleEl.before(dot);
  node.querySelector('.card-due').textContent = task.due ? formatDue(task.due) : '—';
  node.querySelector('.card-notes').textContent = task.notes || '';
  // Priority default
  if (!task.priority) task.priority = 'LOW';
  const timeEl = node.querySelector('.card-time');
  if (timeEl) {
    if (typeof task.timeSpentMs !== 'number') task.timeSpentMs = 0;
    timeEl.textContent = msToHHMMSS(task.timeSpentMs);
  }

  const details = node.querySelector('.card-details');
  const expandBtn = node.querySelector('.expand');
  // Start collapsed by default
  node.classList.add('collapsed');
  expandBtn.addEventListener('click', () => {
    const isHidden = details.classList.toggle('hidden');
    if (isHidden) node.classList.add('collapsed'); else node.classList.remove('collapsed');
  });

  const editBtn = node.querySelector('.edit');
  const deleteBtn = node.querySelector('.delete');
  if (inToday) {
    // Hide edit/delete and add a Today-only remove pill
    if (editBtn) editBtn.classList.add('hidden');
    if (deleteBtn) deleteBtn.classList.add('hidden');
    const removeWrap = node.querySelector('.detail-actions');
    if (removeWrap) {
      removeWrap.classList.add('right');
      const removeBtn = document.createElement('button');
      removeBtn.className = 'pill-btn';
      removeBtn.textContent = 'REMOVE';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Animate, then remove from Today
        node.classList.add('removing');
        setTimeout(() => {
          removeTaskFromToday(task.id);
        }, 160);
      });
      removeWrap.appendChild(removeBtn);
    }
    node.addEventListener('dblclick', (ev) => {
      if (isInteractiveTarget(ev.target)) return;
      openTaskInspector(task.id, projectId);
    });
  } else {
    // Restyle existing actions area to pill buttons on the right
    const actionsWrap = node.querySelector('.detail-actions');
    if (actionsWrap) {
      actionsWrap.classList.add('right');
      if (editBtn) {
        editBtn.classList.remove('btn', 'ghost', 'danger');
        editBtn.classList.add('pill-btn');
        editBtn.textContent = 'EDIT';
      }
      if (deleteBtn) {
        deleteBtn.className = 'icon-btn delete';
        deleteBtn.title = 'Delete';
        deleteBtn.setAttribute('aria-label', 'Delete');
        deleteBtn.textContent = '✕';
      }
    }
    editBtn.addEventListener('click', () => openTaskInspector(task.id, projectId));
    deleteBtn.addEventListener('click', () => deleteTask(projectId, task.id));

    node.addEventListener('click', (ev) => {
      if (isInteractiveTarget(ev.target)) return;
      openTaskInspector(task.id, projectId);
    });
  }

  if (compact) {
    details.classList.add('hidden');
  }

  if (inToday) {
    node.addEventListener('click', (e) => {
      if (e.target.closest('.icon-btn') || e.target.closest('.btn')) return;
      pomodoroState.selectedTaskId = task.id;
      pomodoroState.selectedProjectId = projectId;
      savePomodoroState();
      highlightSelectedTodayCard();
    });
    if (pomodoroState.selectedTaskId === task.id) node.classList.add('selected');
  }

  // Drag handlers
  node.addEventListener('dragstart', onDragStart);
  node.addEventListener('dragend', onDragEnd);

  // Priority controls in details
  const detailsFooter = node.querySelector('.detail-actions');
  if (detailsFooter) {
    const priorityWrap = document.createElement('div');
    priorityWrap.className = 'priority-actions';

    const priorities = [
      { key: 'LOW', cls: 'low' },
      { key: 'MEDIUM', cls: 'medium' },
      { key: 'HIGH', cls: 'high' }
    ];
    const updateActive = () => {
      priorityWrap.querySelectorAll('.pill-btn.priority').forEach(btn => btn.classList.remove('active'));
      const active = priorityWrap.querySelector(`[data-priority="${task.priority}"]`);
      if (active) active.classList.add('active');
      if (dot) {
        dot.className = `priority-dot ${String(task.priority || 'LOW').toLowerCase()}`;
      }
    };
    priorities.forEach(({ key, cls }) => {
      const btn = document.createElement('button');
      btn.className = `pill-btn priority ${cls}`;
      btn.textContent = key;
      btn.dataset.priority = key;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        task.priority = key;
        saveJson(StorageKeys.projects, projects);
        updateActive();
      });
      priorityWrap.appendChild(btn);
    });
    updateActive();
    details.appendChild(priorityWrap);
  }

  return node;
}


function openTaskInspector(taskId, projectId) {
  const project = getProjectById(projectId);
  if (!project) return;
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return;

  closeTaskInspector();

  const columnName = project.columns.find(col => col.id === task.columnId)?.name || '—';

  const backdrop = document.createElement('div');
  backdrop.className = 'task-inspector-backdrop';
  const inspector = document.createElement('div');
  inspector.className = 'task-inspector';

  const header = document.createElement('div');
  header.className = 'task-inspector-header';
  const headerTop = document.createElement('div');
  headerTop.className = 'task-inspector-top';

  const titleDisplay = document.createElement('h2');
  titleDisplay.className = 'task-inspector-title';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'task-inspector-title-input hidden';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'task-inspector-title-wrap';
  titleWrap.append(titleDisplay, titleInput);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'task-inspector-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close task panel');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => closeTaskInspector());

  headerTop.append(titleWrap, closeBtn);
  header.append(headerTop);

  const meta = document.createElement('div');
  meta.className = 'task-inspector-meta';
  const addMeta = (label, value) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    const strong = document.createElement('strong');
    strong.textContent = label;
    pill.appendChild(strong);
    if (value instanceof Node) {
      pill.appendChild(document.createTextNode(' '));
      pill.appendChild(value);
    } else {
      pill.appendChild(document.createTextNode(` ${value}`));
    }
    meta.appendChild(pill);
  };

  addMeta('Project', project.name || '—');
  addMeta('Column', columnName);

  const priorityDisplay = document.createElement('span');
  priorityDisplay.className = 'meta-value';
  const prioritySelect = document.createElement('select');
  prioritySelect.className = 'priority-select hidden';
  for (const p of ['LOW', 'MEDIUM', 'HIGH']) {
    const option = document.createElement('option');
    option.value = p;
    option.textContent = p;
    prioritySelect.appendChild(option);
  }
  const priorityWrap = document.createElement('span');
  priorityWrap.className = 'meta-priority';
  priorityWrap.append(priorityDisplay, prioritySelect);
  addMeta('Priority', priorityWrap);
  addMeta('Time Tracked', msToHHMMSS(task.timeSpentMs || 0));

  header.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'task-inspector-body';

  const createSection = (label, nodes) => {
    const wrap = document.createElement('div');
    wrap.className = 'task-inspector-section';
    const lab = document.createElement('label');
    lab.textContent = label;
    wrap.appendChild(lab);
    if (Array.isArray(nodes)) {
      nodes.forEach(node => wrap.appendChild(node));
    } else if (nodes instanceof Node) {
      wrap.appendChild(nodes);
    } else {
      const textEl = document.createElement('div');
      textEl.className = 'task-inspector-value';
      textEl.textContent = nodes;
      wrap.appendChild(textEl);
    }
    return wrap;
  };

  const dueDisplay = document.createElement('div');
  dueDisplay.className = 'task-inspector-value';
  const dueInput = document.createElement('input');
  dueInput.type = 'datetime-local';
  dueInput.className = 'datetime hidden';
  body.appendChild(createSection('Due', [dueDisplay, dueInput]));

  const notesDisplay = document.createElement('div');
  notesDisplay.className = 'task-inspector-notes';
  const notesArea = document.createElement('textarea');
  notesArea.className = 'textarea hidden';
  body.appendChild(createSection('Notes', [notesDisplay, notesArea]));

  const footer = document.createElement('div');
  footer.className = 'task-inspector-footer';
  const info = document.createElement('div');
  info.className = 'task-inspector-info';
  const actions = document.createElement('div');
  actions.className = 'task-inspector-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn ghost hidden';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn primary';
  editBtn.type = 'button';
  editBtn.textContent = 'Edit Task';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn danger';
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    closeTaskInspector();
    deleteTask(projectId, task.id);
  });

  actions.append(cancelBtn, editBtn, deleteBtn);
  footer.append(info, actions);

  inspector.append(header, body, footer);
  backdrop.appendChild(inspector);
  document.body.appendChild(backdrop);
  document.body.classList.add('body-lock-scroll');

  const state = { editing: false, snapshot: null };

  const syncFromTask = () => {
    const title = task.title || 'Untitled';
    titleDisplay.textContent = title;
    titleInput.value = title;

    const priorityValue = (task.priority || 'LOW').toUpperCase();
    priorityDisplay.textContent = priorityValue;
    prioritySelect.value = priorityValue;

    const dueText = (() => {
      if (!task.due) return 'No due date';
      const d = new Date(task.due);
      return Number.isNaN(d.getTime())
        ? 'Invalid date'
        : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    })();
    dueDisplay.textContent = dueText;
    if (task.due) {
      dueInput.value = toLocalDatetime(task.due);
    } else {
      dueInput.value = '';
    }

    const trimmedNotes = (task.notes || '').trim();
    notesDisplay.textContent = trimmedNotes || 'No notes yet.';
    notesDisplay.classList.toggle('empty', !trimmedNotes);
    notesArea.value = task.notes || '';

    info.textContent = `Created ${formatRelativeDate(task.createdAt)}`;
  };

  const setEditing = (enabled) => {
    state.editing = enabled;
    titleDisplay.classList.toggle('hidden', enabled);
    titleInput.classList.toggle('hidden', !enabled);
    dueDisplay.classList.toggle('hidden', enabled);
    dueInput.classList.toggle('hidden', !enabled);
    notesDisplay.classList.toggle('hidden', enabled);
    notesArea.classList.toggle('hidden', !enabled);
    priorityDisplay.classList.toggle('hidden', enabled);
    prioritySelect.classList.toggle('hidden', !enabled);
    cancelBtn.classList.toggle('hidden', !enabled);
    editBtn.textContent = enabled ? 'Save' : 'Edit Task';
  };

  syncFromTask();
  setEditing(false);

  cancelBtn.addEventListener('click', () => {
    if (!state.editing) return;
    if (state.snapshot) {
      titleInput.value = state.snapshot.title;
      notesArea.value = state.snapshot.notes;
      dueInput.value = state.snapshot.due ? toLocalDatetime(state.snapshot.due) : '';
      prioritySelect.value = state.snapshot.priority;
    }
    setEditing(false);
    syncFromTask();
    state.snapshot = null;
  });

  editBtn.addEventListener('click', () => {
    if (!state.editing) {
      state.snapshot = {
        title: task.title || '',
        notes: task.notes || '',
        due: task.due || null,
        priority: (task.priority || 'LOW').toUpperCase()
      };
      setEditing(true);
      titleInput.focus();
      titleInput.select();
      return;
    }

    const trimmed = titleInput.value.trim();
    if (!trimmed) {
      titleInput.focus();
      return;
    }

    task.title = trimmed;
    task.notes = notesArea.value.trim();
    const dueVal = dueInput.value;
    task.due = dueVal ? new Date(dueVal).toISOString() : null;
    task.priority = prioritySelect.value;
    saveJson(StorageKeys.projects, projects);
    renderBoard();
    renderToday();
    syncFromTask();
    setEditing(false);
    state.snapshot = null;
  });

  const onKeydown = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (state.editing) {
        cancelBtn.click();
      } else {
        closeTaskInspector();
      }
    }
  };
  document.addEventListener('keydown', onKeydown);

  const onBackdropClick = (ev) => {
    if (ev.target === backdrop) closeTaskInspector();
  };
  backdrop.addEventListener('click', onBackdropClick);

  currentTaskInspector = {
    backdrop,
    onKeydown,
    onBackdropClick
  };

  setTimeout(() => closeBtn.focus(), 0);
}

function closeTaskInspector() {
  if (!currentTaskInspector) return;
  const { backdrop, onKeydown, onBackdropClick } = currentTaskInspector;
  if (backdrop?.parentElement) {
    backdrop.removeEventListener('click', onBackdropClick);
    backdrop.remove();
  }
  if (onKeydown) document.removeEventListener('keydown', onKeydown);
  document.body.classList.remove('body-lock-scroll');
  currentTaskInspector = null;
}

function formatRelativeDate(timestamp) {
  if (!timestamp) return 'Unknown';
  const now = Date.now();
  const diffMs = now - Number(timestamp || 0);
  if (!Number.isFinite(diffMs)) return 'Unknown';
  const dayMs = 86400000;
  if (diffMs < dayMs) return 'Today';
  if (diffMs < dayMs * 2) return 'Yesterday';
  const d = new Date(Number(timestamp));
  return Number.isNaN(d.getTime())
    ? 'Unknown'
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDue(iso) {
  try {
    const d = new Date(iso);
    const nowYear = new Date().getFullYear();
    const dateStr = d.getFullYear() !== nowYear
      ? d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric' })
      : d.toLocaleString([], { month: 'short', day: 'numeric' });
    // Display only the date (remove time)
    return `${dateStr}`;
  } catch { return '—'; }
}

// Drag-and-drop
let dragPayload = null;

function onDragStart(ev) {
  const el = ev.currentTarget;
  const taskId = el.dataset.taskId;
  const projectId = el.dataset.projectId;
  const fromToday = el.dataset.origin === 'today';
  dragPayload = { taskId, projectId, fromToday };
  ev.dataTransfer.effectAllowed = 'move';
  const payloadStr = JSON.stringify(dragPayload);
  ev.dataTransfer.setData('text/plain', payloadStr);
  try { ev.dataTransfer.setData('application/json', payloadStr); } catch {}
  el.classList.add('dragging');
  document.querySelectorAll('[data-dropzone]').forEach(dz => {
    const type = dz.dataset.dropzone;
    if (fromToday) {
      if (type === 'today') dz.classList.add('highlight'); else dz.classList.remove('highlight');
    } else {
      dz.classList.add('highlight');
    }
  });
}
function onDragEnd() {
  dragPayload = null;
  document.querySelectorAll('.card.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('[data-dropzone]').forEach(dz => dz.classList.remove('highlight'));
  document.querySelectorAll('.drop-marker').forEach(m => m.remove());
  document.querySelectorAll('.drop-marker-col').forEach(m => m.remove());
}

function enableDropzone(el, zone, meta = {}) {
  el.addEventListener('dragover', ev => {
    const payload = dragPayload;
    if (zone === 'column' && payload?.fromToday) {
      ev.dataTransfer.dropEffect = 'none';
      return;
    }
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    // Show insertion marker
    const containerEl = (zone === 'today' && el.id === 'today-dropzone') ? document.getElementById('today-list') : el;
    const cards = Array.from(containerEl.querySelectorAll('.card'));
    const beforeCard = cards.find(card => {
      const r = card.getBoundingClientRect();
      return ev.clientY < r.top + r.height / 2;
    });
    containerEl.querySelectorAll('.drop-marker').forEach(m => m.remove());
    const marker = document.createElement('div');
    marker.className = 'drop-marker';
    if (beforeCard) {
      containerEl.insertBefore(marker, beforeCard);
    } else {
      containerEl.appendChild(marker);
    }
  });
  el.addEventListener('drop', ev => {
    const transferData = ev.dataTransfer.getData('application/json') || ev.dataTransfer.getData('text/plain');
    let parsed = null;
    if (transferData) {
      try { parsed = JSON.parse(transferData); } catch {}
    }
    const data = dragPayload || parsed;
    if (!data) return;
    const { taskId, projectId, fromToday } = data;
    el.querySelectorAll('.drop-marker').forEach(m => m.remove());
    if (zone === 'column' && fromToday) {
      ev.dataTransfer.dropEffect = 'none';
      return;
    }
    ev.preventDefault();
    if (zone === 'today') {
      // Reorder within Today by pointer position
      const containerEl = (el.id === 'today-dropzone') ? document.getElementById('today-list') : el;
      const cards = Array.from(containerEl.querySelectorAll('.card'));
      const beforeCard = cards.find(card => {
        const r = card.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      // Remove if already present
      todayTaskIds = todayTaskIds.filter(id => id !== taskId);
      if (beforeCard) {
        const idx = todayTaskIds.indexOf(beforeCard.dataset.taskId);
        todayTaskIds.splice(idx >= 0 ? idx : 0, 0, taskId);
      } else {
        todayTaskIds.push(taskId);
      }
      saveJson(StorageKeys.today, todayTaskIds);
      renderToday();
    } else if (zone === 'column') {
      // Move task and set precise order in column based on pointer position
      const project = getProjectById(projectId);
      const task = project?.tasks.find(t => t.id === taskId);
      if (!task) return;
      task.columnId = meta.columnId;
      const cards = Array.from(el.querySelectorAll('.card'));
      const beforeCard = cards.find(card => {
        const r = card.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      const inCol = project.tasks
        .filter(t => t.columnId === meta.columnId && t.id !== taskId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      let insertIdx = beforeCard ? inCol.findIndex(t => t.id === beforeCard.dataset.taskId) : inCol.length;
      if (insertIdx < 0) insertIdx = inCol.length;
      inCol.splice(insertIdx, 0, task);
      inCol.forEach((t, i) => { t.order = i; });
      saveJson(StorageKeys.projects, projects);
      renderBoard();
      renderToday();
    }
  });
}

function enableColumnDrag(container, project) {
  let draggingColId = null;
  container.querySelectorAll('.column .column-header').forEach(headerEl => {
    headerEl.addEventListener('dragstart', (ev) => {
      const colEl = headerEl.parentElement;
      draggingColId = colEl?.dataset.columnId || null;
      if (!draggingColId) return;
      colEl.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'move';
    });
    headerEl.addEventListener('dragend', () => {
      const colEl = headerEl.parentElement;
      draggingColId = null;
      colEl?.classList.remove('dragging');
      container.querySelectorAll('.drop-marker-col').forEach(m => m.remove());
    });
  });

  container.addEventListener('dragover', (ev) => {
    if (!draggingColId) return;
    ev.preventDefault();
    const cols = Array.from(container.querySelectorAll('.column'));
    let beforeEl = null;
    for (const c of cols) {
      const r = c.getBoundingClientRect();
      if (ev.clientX < r.left + r.width / 2) { beforeEl = c; break; }
    }
    container.querySelectorAll('.drop-marker-col').forEach(m => m.remove());
    const marker = document.createElement('div');
    marker.className = 'drop-marker-col';
    marker.style.height = container.offsetHeight + 'px';
    if (beforeEl) container.insertBefore(marker, beforeEl); else container.appendChild(marker);
  });

  container.addEventListener('drop', (ev) => {
    if (!draggingColId) return;
    ev.preventDefault();
    const cols = Array.from(container.querySelectorAll('.column'));
    let beforeEl = null;
    for (const c of cols) {
      const r = c.getBoundingClientRect();
      if (ev.clientX < r.left + r.width / 2) { beforeEl = c; break; }
    }
    const fromIdx = project.columns.findIndex(c => c.id === draggingColId);
    if (fromIdx === -1) return;
    const col = project.columns.splice(fromIdx, 1)[0];
    let toIdx = beforeEl ? project.columns.findIndex(c => c.id === beforeEl.dataset.columnId) : project.columns.length;
    if (toIdx < 0) toIdx = project.columns.length;
    project.columns.splice(toIdx, 0, col);
    saveJson(StorageKeys.projects, projects);
    renderBoard();
  });
}

// Task CRUD
function addTask(projectId, task) {
  const project = getProjectById(projectId);
  const columnId = project.columns?.[0]?.id;
  project.tasks.unshift({
    id: generateId('task'),
    title: task.title?.trim() || 'Untitled',
    notes: task.notes?.trim() || '',
    due: task.due || null,
    createdAt: Date.now(),
    pinned: !!task.pinned,
    columnId,
    priority: String(task.priority || 'LOW').toUpperCase()
  });
  saveJson(StorageKeys.projects, projects);
  renderBoard();
}

function addTaskInColumn(projectId, columnId, task) {
  const project = getProjectById(projectId);
  // Determine next order at the top of the column
  const inCol = project.tasks.filter(t => t.columnId === columnId).sort((a,b)=>(a.order??0)-(b.order??0));
  const newTask = {
    id: generateId('task'),
    title: task.title?.trim() || 'Untitled',
    notes: task.notes?.trim() || '',
    due: task.due || null,
    createdAt: Date.now(),
    pinned: !!task.pinned,
    columnId,
    order: 0,
    priority: String(task.priority || 'LOW').toUpperCase()
  };
  inCol.forEach((t, i) => { t.order = i + 1; });
  project.tasks.unshift(newTask);
  saveJson(StorageKeys.projects, projects);
  renderBoard();
}

function updateTask(projectId, updatedTask) {
  const project = getProjectById(projectId);
  const idx = project.tasks.findIndex(t => t.id === updatedTask.id);
  if (idx !== -1) {
    project.tasks[idx] = { ...project.tasks[idx], ...updatedTask };
    saveJson(StorageKeys.projects, projects);
    render();
  }
}

function deleteTask(projectId, taskId) {
  const project = getProjectById(projectId);
  project.tasks = project.tasks.filter(t => t.id !== taskId);
  saveJson(StorageKeys.projects, projects);
  todayTaskIds = todayTaskIds.filter(id => id !== taskId);
  saveJson(StorageKeys.today, todayTaskIds);
  render();
}

// Columns CRUD
function addColumn(projectId, name) {
  const project = getProjectById(projectId);
  project.columns.push({ id: generateId('col'), name: name.trim() || 'New Column' });
  saveJson(StorageKeys.projects, projects);
  renderBoard();
}

function renameColumn(projectId, columnId, name) {
  const project = getProjectById(projectId);
  const col = project.columns.find(c => c.id === columnId);
  if (!col) return;
  col.name = name.trim() || col.name;
  saveJson(StorageKeys.projects, projects);
  renderBoard();
}

function attemptDeleteColumn(projectId, columnId) {
  const project = getProjectById(projectId);
  if (project.columns.length <= 1) return;
  const fallback = project.columns.find(c => c.id !== columnId)?.id;
  project.tasks.forEach(t => { if (t.columnId === columnId) t.columnId = fallback; });
  project.columns = project.columns.filter(c => c.id !== columnId);
  saveJson(StorageKeys.projects, projects);
  renderBoard();
}

function moveTaskToColumn(projectId, taskId, columnId) {
  const project = getProjectById(projectId);
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.columnId = columnId;
  saveJson(StorageKeys.projects, projects);
  renderBoard();
  renderToday();
}

// Project CRUD
function addProject(name) {
  const project = {
    id: generateId('project'),
    name: name.trim() || 'Untitled',
    columns: [
      { id: generateId('col'), name: 'To-do' },
      { id: generateId('col'), name: 'In progress' },
      { id: generateId('col'), name: 'Done' }
    ],
    tasks: []
  };
  projects.push(project);
  saveJson(StorageKeys.projects, projects);
  setActiveProject(project.id);
}

function renameProject(projectId, name) {
  const project = getProjectById(projectId);
  project.name = name.trim() || project.name;
  saveJson(StorageKeys.projects, projects);
  renderProjectSwitcher();
  els.boardTitle.textContent = project.name;
}

function deleteProject(projectId) {
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) return;
  const removed = projects.splice(idx, 1)[0];
  // Remove any of its tasks from Today
  if (removed && Array.isArray(removed.tasks)) {
    const removedIds = new Set(removed.tasks.map(t => t.id));
    todayTaskIds = todayTaskIds.filter(id => !removedIds.has(id));
    saveJson(StorageKeys.today, todayTaskIds);
  }
  saveJson(StorageKeys.projects, projects);
  // Reset active project
  activeProjectId = projects[0]?.id || 'overview';
  localStorage.setItem(StorageKeys.activeProjectId, activeProjectId);
  render();
}

// Modals
function openModal({ title, body, onClose, footer }) {
  const tpl = /** @type {HTMLTemplateElement} */ (document.getElementById('modal-template'));
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.querySelector('.modal-title').textContent = title;
  const bodyEl = node.querySelector('.modal-body');
  const footerEl = node.querySelector('.modal-footer');
  if (typeof body === 'function') bodyEl.appendChild(body()); else bodyEl.innerHTML = body || '';
  footer?.forEach(btn => footerEl.appendChild(btn));

  function close() {
    node.remove();
    onClose?.();
  }
  node.querySelector('.close').addEventListener('click', close);
  node.addEventListener('click', (e) => { if (e.target === node) close(); });
  document.body.appendChild(node);
  return { close };
}

function inputField(label, type = 'text', value = '') {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label'); l.textContent = label; wrap.appendChild(l);
  const input = document.createElement('input'); input.className = 'input'; input.type = type; input.value = value; wrap.appendChild(input);
  return { wrap, input };
}
function textareaField(label, value = '') {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label'); l.textContent = label; wrap.appendChild(l);
  const ta = document.createElement('textarea'); ta.className = 'textarea'; ta.value = value; wrap.appendChild(ta);
  return { wrap, ta };
}
function datetimeField(label, value = '') {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label'); l.textContent = label; wrap.appendChild(l);
  const dt = document.createElement('input'); dt.className = 'datetime'; dt.type = 'datetime-local'; if (value) dt.value = toLocalDatetime(value); wrap.appendChild(dt);
  return { wrap, dt };
}

function openTaskModal(projectId, task = null, options = {}) {
  if (task) {
    openTaskInspector(task.id, projectId);
    return;
  }
  const { defaultColumnId = null } = options || {};
  const project = getProjectById(projectId);
  if (!project) return;

  closeTaskInspector();

  const backdrop = document.createElement('div');
  backdrop.className = 'task-inspector-backdrop';
  const inspector = document.createElement('div');
  inspector.className = 'task-inspector';

  const header = document.createElement('div');
  header.className = 'task-inspector-header';
  const headerTop = document.createElement('div');
  headerTop.className = 'task-inspector-top';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'task-inspector-title-input';
  titleInput.placeholder = 'New task title';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'task-inspector-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close create task');
  closeBtn.textContent = '✕';

  headerTop.append(titleInput, closeBtn);
  header.append(headerTop);

  const meta = document.createElement('div'); meta.className = 'task-inspector-meta';
  const addMeta = (label, node) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    const strong = document.createElement('strong');
    strong.textContent = label;
    pill.appendChild(strong);
    if (node instanceof Node) {
      pill.appendChild(document.createTextNode(' '));
      pill.appendChild(node);
    } else {
      pill.appendChild(document.createTextNode(` ${node}`));
    }
    meta.appendChild(pill);
  };

  addMeta('Project', project.name || '—');

  const columnSelect = document.createElement('select');
  columnSelect.className = 'priority-select column-select';
  (project.columns || []).forEach(col => {
    const option = document.createElement('option');
    option.value = col.id;
    option.textContent = col.name;
    columnSelect.appendChild(option);
  });
  if (defaultColumnId) columnSelect.value = defaultColumnId;
  addMeta('Column', columnSelect);

  const prioritySelect = document.createElement('select');
  prioritySelect.className = 'priority-select';
  ['LOW', 'MEDIUM', 'HIGH'].forEach(p => {
    const option = document.createElement('option');
    option.value = p;
    option.textContent = p;
    prioritySelect.appendChild(option);
  });
  addMeta('Priority', prioritySelect);

  header.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'task-inspector-body';

  const dueInput = document.createElement('input');
  dueInput.type = 'datetime-local';
  dueInput.className = 'datetime';
  const dueWrap = document.createElement('div'); dueWrap.className = 'task-inspector-section';
  const dueLabel = document.createElement('label'); dueLabel.textContent = 'Due';
  dueWrap.append(dueLabel, dueInput);

  const notesArea = document.createElement('textarea');
  notesArea.className = 'textarea';
  const notesWrap = document.createElement('div'); notesWrap.className = 'task-inspector-section';
  const notesLabel = document.createElement('label'); notesLabel.textContent = 'Notes';
  notesWrap.append(notesLabel, notesArea);

  body.append(dueWrap, notesWrap);

  const footer = document.createElement('div');
  footer.className = 'task-inspector-footer';
  const info = document.createElement('div');
  info.className = 'task-inspector-info';
  info.textContent = project.name ? `Project ${project.name}` : '';
  const actions = document.createElement('div'); actions.className = 'task-inspector-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn ghost';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';

  const createBtn = document.createElement('button');
  createBtn.className = 'btn primary';
  createBtn.type = 'button';
  createBtn.textContent = 'Create';

  actions.append(cancelBtn, createBtn);
  footer.append(info, actions);

  inspector.append(header, body, footer);
  backdrop.appendChild(inspector);
  document.body.appendChild(backdrop);
  document.body.classList.add('body-lock-scroll');

  const close = () => {
    backdrop.removeEventListener('click', onBackdropClick);
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    document.body.classList.remove('body-lock-scroll');
    currentTaskInspector = null;
  };

  const onKeydown = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  };
  const onBackdropClick = (ev) => {
    if (ev.target === backdrop) close();
  };

  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeydown);

  currentTaskInspector = { backdrop, onKeydown, onBackdropClick };

  createBtn.addEventListener('click', () => {
    const trimmed = titleInput.value.trim();
    if (!trimmed) {
      titleInput.focus();
      return;
    }
    const dueVal = dueInput.value;
    const payload = {
      title: trimmed,
      notes: notesArea.value.trim(),
      due: dueVal ? new Date(dueVal).toISOString() : null,
      priority: prioritySelect.value
    };
    const targetColumn = columnSelect.value || project.columns?.[0]?.id;
    if (targetColumn) {
      addTaskInColumn(projectId, targetColumn, payload);
    } else {
      addTask(projectId, payload);
    }
    close();
  });

  setTimeout(() => titleInput.focus(), 0);
}

function openProjectModal() {
  const { wrap: nameWrap, input: nameInput } = inputField('Project name');
  function body() {
    const frag = document.createDocumentFragment();
    frag.appendChild(nameWrap);
    return frag;
  }
  const createBtn = document.createElement('button'); createBtn.className = 'btn primary'; createBtn.textContent = 'Create';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn ghost'; cancelBtn.textContent = 'Cancel';
  const modal = openModal({ title: 'New Project', body, footer: [cancelBtn, createBtn] });
  cancelBtn.onclick = () => modal.close();
  createBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    addProject(name);
    modal.close();
  };
}

function openRenameProjectModal(projectId, currentName) {
  const { wrap: nameWrap, input: nameInput } = inputField('Project name', 'text', currentName || '');
  function body() {
    const frag = document.createDocumentFragment();
    frag.appendChild(nameWrap);
    return frag;
  }
  const saveBtn = document.createElement('button'); saveBtn.className = 'btn primary'; saveBtn.textContent = 'Save';
  const deleteBtn = document.createElement('button'); deleteBtn.className = 'btn danger'; deleteBtn.textContent = 'Delete';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn ghost'; cancelBtn.textContent = 'Cancel';
  const modal = openModal({ title: 'Rename Project', body, footer: [cancelBtn, deleteBtn, saveBtn] });
  cancelBtn.onclick = () => modal.close();
  deleteBtn.onclick = () => {
    const ok = confirm('Delete this project and its tasks?');
    if (!ok) return;
    modal.close();
    deleteProject(projectId);
  };
  saveBtn.onclick = () => { const name = nameInput.value.trim(); if (!name) { nameInput.focus(); return; } renameProject(projectId, name); modal.close(); };
}

function openAddColumnModal(projectId) {
  const { wrap: nameWrap, input: nameInput } = inputField('Column name');
  function body() { const frag = document.createDocumentFragment(); frag.appendChild(nameWrap); return frag; }
  const createBtn = document.createElement('button'); createBtn.className = 'btn primary'; createBtn.textContent = 'Create';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn ghost'; cancelBtn.textContent = 'Cancel';
  const modal = openModal({ title: 'New Column', body, footer: [cancelBtn, createBtn] });
  cancelBtn.onclick = () => modal.close();
  createBtn.onclick = () => { const name = nameInput.value.trim(); if (!name) { nameInput.focus(); return; } addColumn(projectId, name); modal.close(); };
}

function openRenameColumnModal(projectId, columnId, currentName) {
  const { wrap: nameWrap, input: nameInput } = inputField('Column name', 'text', currentName || '');
  function body() { const frag = document.createDocumentFragment(); frag.appendChild(nameWrap); return frag; }
  const saveBtn = document.createElement('button'); saveBtn.className = 'btn primary'; saveBtn.textContent = 'Save';
  const deleteBtn = document.createElement('button'); deleteBtn.className = 'btn danger'; deleteBtn.textContent = 'Delete';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn ghost'; cancelBtn.textContent = 'Cancel';
  const modal = openModal({ title: 'Rename Column', body, footer: [cancelBtn, deleteBtn, saveBtn] });
  cancelBtn.onclick = () => modal.close();
  deleteBtn.onclick = () => { const ok = confirm('Delete this column? Tasks in it will be moved to another column.'); if (ok) { modal.close(); attemptDeleteColumn(projectId, columnId); } };
  saveBtn.onclick = () => { const name = nameInput.value.trim(); if (!name) { nameInput.focus(); return; } renameColumn(projectId, columnId, name); modal.close(); };
}

function openPomodoroSettingsModal() {
  const { wrap: focusWrap, input: focusInput } = inputField('Focus minutes', 'number', pomodoroSettings.focusMinutes);
  const { wrap: shortWrap, input: shortBreakInput } = inputField('Short break minutes', 'number', pomodoroSettings.shortBreakMinutes);
  const { wrap: longWrap, input: longBreakInput } = inputField('Long break minutes', 'number', pomodoroSettings.longBreakMinutes);
  const { wrap: everyWrap, input: longEveryInput } = inputField('Long break every (focus cycles)', 'number', pomodoroSettings.longEvery);

  [focusInput, shortBreakInput, longBreakInput, longEveryInput].forEach(input => {
    input.min = '1';
    input.step = '1';
    input.inputMode = 'numeric';
  });

  function body() {
    const frag = document.createDocumentFragment();
    frag.appendChild(focusWrap);
    frag.appendChild(shortWrap);
    frag.appendChild(longWrap);
    frag.appendChild(everyWrap);
    return frag;
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn ghost';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = 'Save';

  const modal = openModal({ title: 'Pomodoro Settings', body, footer: [cancelBtn, saveBtn] });
  cancelBtn.onclick = () => modal.close();
  saveBtn.onclick = () => {
    const nextSettings = normalizePomodoroSettings({
      focusMinutes: focusInput.value,
      shortBreakMinutes: shortBreakInput.value,
      longBreakMinutes: longBreakInput.value,
      longEvery: longEveryInput.value
    });
    const keys = ['focusMinutes', 'shortBreakMinutes', 'longBreakMinutes', 'longEvery'];
    const changed = keys.some(key => nextSettings[key] !== pomodoroSettings[key]);
    if (!changed) {
      modal.close();
      return;
    }
    pomodoroSettings = nextSettings;
    pomodoroState.isRunning = false;
    pomodoroState.startedAt = null;
    pomodoroState.lastTickAt = null;
    pomodoroState.remainingMs = totalMsForMode(pomodoroState.mode);
    pomodoroState.remainingMsStart = pomodoroState.remainingMs;
    cancelAnimationFrame(rafId);
    savePomodoroState();
    renderPomodoro();
    modal.close();
  };

  setTimeout(() => focusInput.focus(), 0);
}

// Project menu toggle
els.currentProjectBtn.addEventListener('click', () => {
  els.projectMenu.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!els.projectMenu.contains(e.target) && e.target !== els.currentProjectBtn) {
    els.projectMenu.classList.add('hidden');
  }
});

// Actions
if (els.addTask) {
  els.addTask.addEventListener('click', () => {
    const pid = activeProjectId === 'overview' ? getActiveProject().id : activeProjectId;
    openTaskModal(pid);
  });
}
els.addProject.addEventListener('click', openProjectModal);
const addColumnBtn = document.getElementById('add-column');
addColumnBtn.addEventListener('click', () => {
  if (activeProjectId === 'overview') return;
  openAddColumnModal(getActiveProject().id);
});

// Pomodoro timer
const PomodoroSettingsDefaults = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longEvery: 4
};

function normalizePomodoroSettings(rawSettings) {
  const defaults = PomodoroSettingsDefaults;
  const clampInt = (value, fallback, min = 1) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min) return fallback;
    return Math.floor(n);
  };
  if (!rawSettings || typeof rawSettings !== 'object') {
    return { ...defaults };
  }
  return {
    focusMinutes: clampInt(rawSettings.focusMinutes, defaults.focusMinutes),
    shortBreakMinutes: clampInt(rawSettings.shortBreakMinutes, defaults.shortBreakMinutes),
    longBreakMinutes: clampInt(rawSettings.longBreakMinutes, defaults.longBreakMinutes),
    longEvery: clampInt(rawSettings.longEvery, defaults.longEvery)
  };
}

const storedPomodoro = loadJson(StorageKeys.pomodoro, null);
let pomodoroSettings = normalizePomodoroSettings(storedPomodoro?.settings);

const basePomodoroState = {
  mode: 'focus', // 'focus' | 'break'
  isRunning: false,
  startedAt: null,
  remainingMs: pomodoroSettings.focusMinutes * 60 * 1000,
  cyclesCompleted: 0,
  selectedTaskId: null,
  selectedProjectId: null,
  lastTickAt: null,
  taskBaseTimeMs: 0,
  taskStartedAt: null,
  remainingMsStart: null
};

let pomodoroState = { ...basePomodoroState, ...(storedPomodoro || {}) };
delete pomodoroState.settings;
if (!['focus', 'break'].includes(pomodoroState.mode)) {
  pomodoroState.mode = 'focus';
}
if (typeof pomodoroState.remainingMs !== 'number' || !Number.isFinite(pomodoroState.remainingMs) || pomodoroState.remainingMs <= 0) {
  pomodoroState.remainingMs = pomodoroSettings.focusMinutes * 60 * 1000;
}

function savePomodoroState() {
  saveJson(StorageKeys.pomodoro, { ...pomodoroState, settings: pomodoroSettings });
}

// Hydrate/normalize timer state on load to avoid ghost-running sessions
if (pomodoroState.isRunning) {
  pomodoroState.isRunning = false;
  pomodoroState.startedAt = null;
  pomodoroState.lastTickAt = null;
  savePomodoroState();
} else if (!storedPomodoro || !storedPomodoro.settings) {
  // Persist normalized defaults so settings exist even for legacy state
  savePomodoroState();
}

const ring = document.getElementById('ring-progress');
const timerDisplay = document.getElementById('timer-display');
const timerMode = document.getElementById('timer-mode');
const startBtn = document.getElementById('timer-start');
const pauseBtn = document.getElementById('timer-pause');
const skipBtn = document.getElementById('timer-skip');
const resetBtn = document.getElementById('timer-reset');
const settingsBtn = document.getElementById('timer-settings');

// Remove the visual timer ring entirely so only the digits remain
const ringSvg = document.querySelector('.ring');
if (ringSvg && ringSvg.parentElement) {
  ringSvg.remove();
}

let rafId = null;

function totalMsForMode(mode) {
  if (mode === 'focus') {
    return pomodoroSettings.focusMinutes * 60 * 1000;
  }
  const longEvery = Math.max(1, pomodoroSettings.longEvery);
  const isLong = pomodoroState.cyclesCompleted > 0 && (pomodoroState.cyclesCompleted % longEvery === 0);
  const breakMinutes = isLong ? pomodoroSettings.longBreakMinutes : pomodoroSettings.shortBreakMinutes;
  return breakMinutes * 60 * 1000;
}

function setMode(mode) {
  pomodoroState.mode = mode;
  pomodoroState.remainingMs = totalMsForMode(mode);
  pomodoroState.remainingMsStart = pomodoroState.remainingMs;
  pomodoroState.startedAt = null;
  pomodoroState.isRunning = false;
  savePomodoroState();
  renderPomodoro();
}

function renderPomodoro() {
  const total = totalMsForMode(pomodoroState.mode);
  // Quantize to whole seconds to keep UI in lockstep
  const remaining = Math.max(0, Math.floor(pomodoroState.remainingMs / 1000) * 1000);
  const pct = 1 - (remaining / total);
  const dash = 339.292;
  if (ring) ring.style.strokeDashoffset = String(dash * pct);
  if (timerMode) {
    if (pomodoroState.mode === 'focus') {
      timerMode.textContent = `Focus • ${pomodoroSettings.focusMinutes} min`;
    } else {
      const longEvery = Math.max(1, pomodoroSettings.longEvery);
      const isLong = pomodoroState.cyclesCompleted > 0 && (pomodoroState.cyclesCompleted % longEvery === 0);
      const minutes = isLong ? pomodoroSettings.longBreakMinutes : pomodoroSettings.shortBreakMinutes;
      timerMode.textContent = `${isLong ? 'Long break' : 'Break'} • ${minutes} min`;
    }
  }
  timerDisplay.textContent = msToMMSS(remaining);
  updateSelectedTaskTimePill();
  updateRunningTimerHighlight();
}

function tick() {
  if (!pomodoroState.isRunning) return;
  const now = Date.now();
  // Quantize both remaining time and task accumulation to the SAME whole-second boundary
  const elapsedWholeSec = Math.floor((now - pomodoroState.startedAt) / 1000);
  const remainingSeconds = Math.max(0, Math.floor(pomodoroState.remainingMsStart / 1000) - elapsedWholeSec);
  pomodoroState.remainingMs = remainingSeconds * 1000;
  // Quantize task accumulation to whole seconds aligned to same clock
  if (pomodoroState.mode === 'focus' && pomodoroState.selectedTaskId && pomodoroState.selectedProjectId) {
    const project = getProjectById(pomodoroState.selectedProjectId);
    const task = project?.tasks.find(t => t.id === pomodoroState.selectedTaskId);
    if (task) {
      const base = (pomodoroState.taskBaseTimeMs ?? (task.timeSpentMs ?? 0));
      task.timeSpentMs = base + elapsedWholeSec * 1000;
      saveJson(StorageKeys.projects, projects);
    }
  }
  pomodoroState.lastTickAt = now;
  if (pomodoroState.remainingMs === 0) {
    // Switch modes
    if (pomodoroState.mode === 'focus') {
      pomodoroState.cyclesCompleted += 1;
      pomodoroState.mode = 'break';
    } else {
      pomodoroState.mode = 'focus';
    }
    pomodoroState.isRunning = false;
    pomodoroState.startedAt = null;
    pomodoroState.remainingMs = totalMsForMode(pomodoroState.mode);
    pomodoroState.remainingMsStart = pomodoroState.remainingMs;
    savePomodoroState();
  }
  renderPomodoro();
  rafId = requestAnimationFrame(tick);
}

startBtn.addEventListener('click', () => {
  if (pomodoroState.isRunning) return; // already running
  pomodoroState.isRunning = true;
  pomodoroState.startedAt = Date.now();
  pomodoroState.remainingMsStart = pomodoroState.remainingMs;
  pomodoroState.lastTickAt = pomodoroState.startedAt;
  // capture baseline for accumulation at the start
  if (pomodoroState.mode === 'focus' && pomodoroState.selectedTaskId && pomodoroState.selectedProjectId) {
    const project = getProjectById(pomodoroState.selectedProjectId);
    const task = project?.tasks.find(t => t.id === pomodoroState.selectedTaskId);
    pomodoroState.taskBaseTimeMs = (task?.timeSpentMs ?? 0);
    pomodoroState.taskStartedAt = pomodoroState.startedAt;
  }
  savePomodoroState();
  renderPomodoro();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
});

pauseBtn.addEventListener('click', () => {
  if (!pomodoroState.isRunning) return; // already paused
  pomodoroState.isRunning = false;
  // finalize accumulation baseline
  if (pomodoroState.mode === 'focus' && pomodoroState.selectedTaskId && pomodoroState.selectedProjectId) {
    const project = getProjectById(pomodoroState.selectedProjectId);
    const task = project?.tasks.find(t => t.id === pomodoroState.selectedTaskId);
    if (task) pomodoroState.taskBaseTimeMs = task.timeSpentMs || 0;
  }
  savePomodoroState();
  renderPomodoro();
  cancelAnimationFrame(rafId);
});

skipBtn.addEventListener('click', () => {
  if (pomodoroState.mode === 'focus') {
    pomodoroState.mode = 'break';
  } else {
    pomodoroState.mode = 'focus';
  }
  pomodoroState.isRunning = false;
  pomodoroState.startedAt = null;
  pomodoroState.remainingMs = totalMsForMode(pomodoroState.mode);
  // reset task accumulation anchors when switching modes
  pomodoroState.taskBaseTimeMs = 0;
  pomodoroState.taskStartedAt = null;
  pomodoroState.remainingMsStart = pomodoroState.remainingMs;
  savePomodoroState();
  renderPomodoro();
});

resetBtn.addEventListener('click', () => {
  pomodoroState.isRunning = false;
  pomodoroState.startedAt = null;
  pomodoroState.remainingMs = totalMsForMode(pomodoroState.mode);
  pomodoroState.remainingMsStart = pomodoroState.remainingMs;
  savePomodoroState();
  renderPomodoro();
});

if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    openPomodoroSettingsModal();
  });
}

function msToMMSS(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function msToHHMMSS(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
  const seconds = (totalSec % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function toLocalDatetime(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

// Initialize
render();
renderPomodoro();

function updateSelectedTaskTimePill() {
  if (!pomodoroState.selectedTaskId) return;
  const pid = pomodoroState.selectedProjectId;
  const project = pid ? getProjectById(pid) : null;
  const task = project?.tasks.find(t => t.id === pomodoroState.selectedTaskId);
  if (!task) return;
  // Update ALL instances of this task card across the UI (Today list and Board columns)
  const time = msToHHMMSS(task.timeSpentMs || 0);
  document.querySelectorAll(`.card[data-task-id="${pomodoroState.selectedTaskId}"] .card-time`).forEach(el => {
    el.textContent = time;
  });
}

function updateRunningTimerHighlight() {
  // Clear previous highlights
  document.querySelectorAll('.card-time.running').forEach(el => el.classList.remove('running'));
  if (!pomodoroState.isRunning || !pomodoroState.selectedTaskId) return;
  // Add highlight to all instances of the selected task's time pill
  document.querySelectorAll(`.card[data-task-id="${pomodoroState.selectedTaskId}"] .card-time`).forEach(el => {
    el.classList.add('running');
  });
}

function highlightSelectedTodayCard() {
  document.querySelectorAll('#today-list .card').forEach(el => el.classList.remove('selected'));
  if (!pomodoroState.selectedTaskId) return;
  const card = document.querySelector(`#today-list .card[data-task-id="${pomodoroState.selectedTaskId}"]`);
  if (card) card.classList.add('selected');
}
