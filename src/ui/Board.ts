import type { BoardData, ColumnRecord, TaskRecord } from '../data/supabase';
import {
  createColumn,
  createTask,
  deleteTask,
  getBoard,
  moveTask,
  renameColumn,
  reorderColumns,
  updateTask,
} from '../data/supabase';

import {
  createTaskMetadataStore,
  generateLocalId,
  type TaskChecklist,
  type TaskMetadata,
} from './taskMetadataStore';
import { showTaskModal } from './taskModal';
import { showTextPrompt } from './TextPrompt';
import { showToast } from './toast';

const LABEL_OPTIONS = [
  { id: 'priority-high', name: 'High priority', color: '#f97316' },
  { id: 'priority-medium', name: 'Medium priority', color: '#facc15' },
  { id: 'feature', name: 'Feature', color: '#34d399' },
  { id: 'bug', name: 'Bug', color: '#f87171' },
  { id: 'design', name: 'Design', color: '#60a5fa' },
] as const;

type TaskLabelId = (typeof LABEL_OPTIONS)[number]['id'];

interface TaskDrawerControls {
  open(taskId: string): void;
  close(): void;
  refresh(): void;
  isOpen(): boolean;
  getActiveTaskId(): string | null;
}

export interface BoardFilterState {
  query: string;
  columnIds: string[];
}

export interface BoardController {
  setSearchQuery(query: string): void;
  setColumnFilter(columnIds: string[] | null): void;
  getColumns(): ColumnRecord[];
  getFilterState(): BoardFilterState;
  onColumnsChange(listener: (columns: ColumnRecord[]) => void): () => void;
  createColumn(title: string): Promise<void>;
  renameColumn(columnId: string, title: string): Promise<void>;
  moveColumn(columnId: string, direction: 'left' | 'right'): Promise<void>;
  setColumnHidden(columnId: string, hidden: boolean): void;
  setColumnCollapsed(columnId: string, collapsed: boolean): void;
  getColumnPreferences(): ColumnPreferencesSnapshot[];
  getBoardStats(): BoardStats;
  onBoardMetricsChange(listener: (stats: BoardStats) => void): () => void;
  startTaskCreation(columnId?: string): Promise<void>;
}

export interface BoardStats {
  columnCount: number;
  visibleColumnCount: number;
  hiddenColumnCount: number;
  collapsedColumnCount: number;
  taskCount: number;
}

interface ColumnState {
  column: ColumnRecord;
  tasks: TaskRecord[];
}

interface BoardState {
  project: BoardData['project'];
  columns: ColumnState[];
  taskById: Map<string, TaskRecord>;
}

interface BoardSnapshot {
  columns: Array<{ columnId: string; taskIds: string[] }>;
}

interface PointerDragState {
  taskId: string;
  fromColumnId: string;
  snapshot: BoardSnapshot;
  element: HTMLLIElement;
  preview: HTMLElement | null;
  dropHandled: boolean;
}

interface KeyboardDragState {
  taskId: string;
  fromColumnId: string;
  fromIndex: number;
  currentColumnId: string;
  currentIndex: number;
  snapshot: BoardSnapshot;
}

interface MoveResult {
  fromColumnId: string;
  toColumnId: string;
  fromIndex: number;
  toIndex: number;
}

interface ColumnPreferences {
  hidden?: boolean;
  collapsed?: boolean;
}

export interface ColumnPreferencesSnapshot {
  id: string;
  title: string;
  hidden: boolean;
  collapsed: boolean;
  position: number;
}

const COLUMN_PREF_KEY_PREFIX = 'kanban:column-prefs:';

function getColumnPrefsKey(projectId: string): string {
  return `${COLUMN_PREF_KEY_PREFIX}${projectId}`;
}

function loadColumnPreferences(projectId: string): Record<string, ColumnPreferences> {
  if (typeof window === 'undefined') {
    return {};
  }
  const key = getColumnPrefsKey(projectId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, ColumnPreferences>;
    }
  } catch (error) {
    console.warn('Failed to load column preferences', error);
  }
  return {};
}

function saveColumnPreferences(
  projectId: string,
  prefs: Record<string, ColumnPreferences>,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  const key = getColumnPrefsKey(projectId);
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch (error) {
    console.warn('Failed to persist column preferences', error);
  }
}

export function renderBoard(rootEl: HTMLElement, initialData: BoardData): BoardController {
  rootEl.innerHTML = '';

  let boardState = buildBoardState(initialData);
  let columnPreferences = loadColumnPreferences(boardState.project.id);
  const metadataStore = createTaskMetadataStore(boardState.project.id);
  const reminderFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const columnLookup = new Map<string, ColumnState>();
  let columnOrder: string[] = [];
  const columnChangeListeners = new Set<(columns: ColumnRecord[]) => void>();
  let activeColumnMenu: { element: HTMLDivElement; cleanup: () => void } | null = null;
  const metricsListeners = new Set<(stats: BoardStats) => void>();

  const filterState = {
    query: '',
    normalizedQuery: '',
    columnIds: null as Set<string> | null,
  };

  const boardTitleEl = rootEl.closest('.container')?.querySelector<HTMLHeadingElement>(
    '.board-title',
  );
  if (boardTitleEl) {
    boardTitleEl.textContent = boardState.project.name;
  }

  const boardEl = rootEl as HTMLDivElement;

  let pointerDrag: PointerDragState | null = null;
  let keyboardDrag: KeyboardDragState | null = null;
  let activeDropColumnId: string | null = null;
  let keyboardHintShown = false;
  const taskDrawer = initializeTaskDrawer();

  pruneTaskMetadata();
  rebuildColumnLookup();
  renderColumns();
  notifyColumnsChange();

  const controller: BoardController = {
    setSearchQuery,
    setColumnFilter,
    getColumns,
    getFilterState,
    onColumnsChange,
    createColumn: handleCreateColumn,
    renameColumn: handleRenameColumn,
    moveColumn: handleMoveColumn,
    setColumnHidden,
    setColumnCollapsed,
    getColumnPreferences: getColumnPreferencesSnapshot,
    getBoardStats,
    onBoardMetricsChange,
    startTaskCreation,
  };

  function setSearchQuery(query: string): void {
    const normalized = query.trim().toLowerCase();
    if (filterState.query === query && filterState.normalizedQuery === normalized) {
      return;
    }
    filterState.query = query;
    filterState.normalizedQuery = normalized;
    refreshViewAfterFilter();
  }

  function setColumnFilter(columnIds: string[] | null): void {
    const nextSet =
      columnIds && columnIds.length > 0
        ? new Set(columnIds.filter((identifier) => columnLookup.has(identifier)))
        : null;

    if (areSetsEqual(filterState.columnIds, nextSet)) {
      return;
    }

    filterState.columnIds = nextSet;
    refreshViewAfterFilter();
  }

  function getColumns(): ColumnRecord[] {
    return boardState.columns
      .filter((columnState) => !isColumnHidden(columnState.column.id))
      .map((columnState) => ({ ...columnState.column }));
  }

  function getFilterState(): BoardFilterState {
    return {
      query: filterState.query,
      columnIds: filterState.columnIds ? Array.from(filterState.columnIds) : [],
    };
  }

  function onColumnsChange(listener: (columns: ColumnRecord[]) => void): () => void {
    columnChangeListeners.add(listener);
    return () => {
      columnChangeListeners.delete(listener);
    };
  }

  function notifyColumnsChange(): void {
    if (columnChangeListeners.size === 0) {
      return;
    }
    const snapshot = boardState.columns
      .filter((columnState) => !isColumnHidden(columnState.column.id))
      .map((columnState) => ({ ...columnState.column }));
    columnChangeListeners.forEach((listener) => listener(snapshot));
  }

  function closeActiveColumnMenu(): void {
    if (!activeColumnMenu) {
      return;
    }
    activeColumnMenu.cleanup();
    activeColumnMenu = null;
  }

  function getBoardStats(): BoardStats {
    const visibleColumns = boardState.columns.filter(
      (columnState) => !isColumnHidden(columnState.column.id),
    );
    const hiddenColumnCount = boardState.columns.length - visibleColumns.length;
    const collapsedColumnCount = boardState.columns.filter((columnState) =>
      isColumnCollapsed(columnState.column.id),
    ).length;
    const taskCount = boardState.columns.reduce(
      (total, columnState) => total + columnState.tasks.length,
      0,
    );

    return {
      columnCount: boardState.columns.length,
      visibleColumnCount: visibleColumns.length,
      hiddenColumnCount,
      collapsedColumnCount,
      taskCount,
    };
  }

  function onBoardMetricsChange(listener: (stats: BoardStats) => void): () => void {
    metricsListeners.add(listener);
    listener(getBoardStats());
    return () => {
      metricsListeners.delete(listener);
    };
  }

  function notifyBoardMetricsChange(): void {
    if (metricsListeners.size === 0) {
      return;
    }
    const snapshot = getBoardStats();
    metricsListeners.forEach((listener) => listener(snapshot));
  }

  function pruneColumnPreferencesIfNeeded(): void {
    const validIds = new Set(boardState.columns.map((columnState) => columnState.column.id));
    let dirty = false;
    Object.keys(columnPreferences).forEach((columnId) => {
      if (!validIds.has(columnId)) {
        delete columnPreferences[columnId];
        dirty = true;
      }
    });
    if (dirty) {
      saveColumnPreferences(boardState.project.id, columnPreferences);
    }
  }

  function getColumnPreference(columnId: string): ColumnPreferences {
    const existing = columnPreferences[columnId];
    if (existing) {
      return existing;
    }
    const created: ColumnPreferences = {};
    columnPreferences[columnId] = created;
    return created;
  }

  function isColumnHidden(columnId: string): boolean {
    return Boolean(getColumnPreference(columnId).hidden);
  }

  function isColumnCollapsed(columnId: string): boolean {
    return Boolean(getColumnPreference(columnId).collapsed);
  }

  function setColumnHidden(columnId: string, hidden: boolean): void {
    const prefs = getColumnPreference(columnId);
    if (prefs.hidden === hidden) {
      return;
    }

    prefs.hidden = hidden;
    saveColumnPreferences(boardState.project.id, columnPreferences);

    if (hidden) {
      if (filterState.columnIds?.has(columnId)) {
        const next = Array.from(filterState.columnIds).filter((id) => id !== columnId);
        setColumnFilter(next.length > 0 ? next : null);
      }
    }

    renderColumns();
    notifyColumnsChange();
  }

  function setColumnCollapsed(columnId: string, collapsed: boolean): void {
    const prefs = getColumnPreference(columnId);
    if (prefs.collapsed === collapsed) {
      return;
    }
    prefs.collapsed = collapsed;
    saveColumnPreferences(boardState.project.id, columnPreferences);
    renderColumns();
  }

  function getColumnPreferencesSnapshot(): ColumnPreferencesSnapshot[] {
    return boardState.columns.map((columnState, index) => ({
      id: columnState.column.id,
      title: columnState.column.title,
      hidden: isColumnHidden(columnState.column.id),
      collapsed: isColumnCollapsed(columnState.column.id),
      position: index,
    }));
  }

  function refreshViewAfterFilter(): void {
    let renderHandled = false;
    if (keyboardDrag) {
      cancelKeyboardDrag();
      renderHandled = true;
    }
    if (pointerDrag) {
      clearPointerDragState();
    }
    if (!renderHandled) {
      renderColumns();
    }
  }

  function pruneTaskMetadata(): void {
    const tracked = metadataStore.getAll();
    Object.keys(tracked).forEach((taskId) => {
      if (!boardState.taskById.has(taskId)) {
        metadataStore.remove(taskId);
      }
    });
  }

  function rebuildColumnLookup(): void {
    columnLookup.clear();
    boardState.columns.forEach((columnState) => {
      columnLookup.set(columnState.column.id, columnState);
    });
    columnOrder = boardState.columns.map((columnState) => columnState.column.id);
    pruneColumnPreferencesIfNeeded();
  }

  function renderColumns(): void {
    if (boardTitleEl) {
      boardTitleEl.textContent = boardState.project.name;
    }
    boardEl.innerHTML = '';
    closeActiveColumnMenu();

    const hasColumnFilter = Boolean(filterState.columnIds && filterState.columnIds.size > 0);
    const filtersActive = hasColumnFilter || filterState.normalizedQuery.length > 0;
    const hiddenColumns: ColumnState[] = [];

    if (boardState.columns.length === 0) {
      boardEl.appendChild(createEmptyColumnMessage());
      appendAddColumnCard();
      setDropTarget(null);
      notifyBoardMetricsChange();
      return;
    }

    let renderedColumnCount = 0;

    for (const columnState of boardState.columns) {
      const columnId = columnState.column.id;

      if (isColumnHidden(columnId)) {
        hiddenColumns.push(columnState);
      }

      if (!isColumnVisible(columnId)) {
        continue;
      }

      const columnEl = document.createElement('section');
      columnEl.className = 'column';
      columnEl.dataset.columnId = columnId;

      columnEl.addEventListener('dragover', handleColumnDragOver);
      columnEl.addEventListener('dragenter', handleColumnDragEnter);
      columnEl.addEventListener('dragleave', handleColumnDragLeave);
      columnEl.addEventListener('drop', handleColumnDrop);

      const header = document.createElement('div');
      header.className = 'column__title';

      const heading = document.createElement('h2');
      heading.id = `column-${columnId}`;
      heading.textContent = columnState.column.title;
      header.appendChild(heading);

      const actions = document.createElement('div');
      actions.className = 'column__actions';

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'icon-btn focus-ring';
      addButton.textContent = '+';
      addButton.setAttribute('aria-label', `Add task to ${columnState.column.title}`);
      addButton.addEventListener('click', () => handleAddTask(columnState.column, addButton));
      actions.appendChild(addButton);

      const collapsed = isColumnCollapsed(columnId);
      columnEl.classList.toggle('column--collapsed', collapsed);

      const collapseButton = document.createElement('button');
      collapseButton.type = 'button';
      collapseButton.className = 'icon-btn focus-ring column__collapse-btn';
      collapseButton.textContent = collapsed ? '>' : 'v';
      collapseButton.setAttribute(
        'aria-label',
        collapsed ? `Expand ${columnState.column.title}` : `Collapse ${columnState.column.title}`,
      );
      collapseButton.addEventListener('click', () => {
        setColumnCollapsed(columnId, !collapsed);
      });
      actions.appendChild(collapseButton);

      const menuButton = document.createElement('button');
      menuButton.type = 'button';
      menuButton.className = 'icon-btn focus-ring column__menu-btn';
      menuButton.textContent = '...';
      menuButton.setAttribute('aria-label', `Column options for ${columnState.column.title}`);
      menuButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openColumnMenu(menuButton, columnState);
      });
      actions.appendChild(menuButton);

      header.appendChild(actions);
      columnEl.appendChild(header);

      const taskList = document.createElement('ul');
      taskList.className = 'column__list';
      taskList.setAttribute('role', 'list');
      taskList.setAttribute('aria-labelledby', heading.id);

      const filteredTasks = renderTaskList(columnState, taskList);
      taskList.hidden = collapsed;
      columnEl.appendChild(taskList);

      if (collapsed) {
        const summary = document.createElement('button');
        summary.type = 'button';
        summary.className = 'column__collapsed-summary focus-ring';
        summary.textContent =
          filteredTasks.length === 1 ? '1 task hidden' : `${filteredTasks.length} tasks hidden`;
        summary.addEventListener('click', () => {
          setColumnCollapsed(columnId, false);
        });
        columnEl.appendChild(summary);
      } else if (filteredTasks.length === 0 && filtersActive) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'column__empty';
        emptyMessage.textContent = 'No tasks match your filters.';
        columnEl.appendChild(emptyMessage);
      }

      boardEl.appendChild(columnEl);
      renderedColumnCount += 1;
    }

    if (renderedColumnCount === 0) {
      boardEl.appendChild(createFilteredEmptyState(filtersActive));
      setDropTarget(null);
    } else {
      if (taskDrawer.isOpen()) {
        taskDrawer.refresh();
      }

      if (keyboardDrag) {
        const remembered = keyboardDrag.currentColumnId;
        if (isColumnVisible(remembered)) {
          activeDropColumnId = null;
          setDropTarget(remembered);
          focusTask(keyboardDrag.taskId);
        } else {
          setDropTarget(null);
        }
      }
    }

    if (hiddenColumns.length > 0) {
      appendHiddenColumnsPanel(hiddenColumns);
    }

    appendAddColumnCard();
    notifyBoardMetricsChange();
  }

  function createEmptyColumnMessage(): HTMLElement {
    const empty = document.createElement('section');
    empty.className = 'column column--empty';

    const heading = document.createElement('h2');
    heading.textContent = 'No columns yet';

    const copy = document.createElement('p');
    copy.textContent = 'Add your first workflow column to begin organizing tasks.';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary focus-ring';
    button.textContent = 'Add column';
    button.addEventListener('click', handleCreateColumnRequest);

    empty.appendChild(heading);
    empty.appendChild(copy);
    empty.appendChild(button);
    return empty;
  }

  function createFilteredEmptyState(filtersActive: boolean): HTMLElement {
    const placeholder = document.createElement('section');
    placeholder.className = 'column column--empty';

    const heading = document.createElement('h2');
    heading.textContent = filtersActive ? 'No columns match your filters' : 'All columns are hidden';

    const copy = document.createElement('p');
    copy.textContent = filtersActive
      ? 'Adjust or clear your column filters to bring the board back.'
      : 'Hidden columns appear below—show them again or add a new column.';

    placeholder.appendChild(heading);
    placeholder.appendChild(copy);
    return placeholder;
  }

  function appendAddColumnCard(): void {
    const card = document.createElement('section');
    card.className = 'column column--adder';

    const title = document.createElement('h2');
    title.textContent = 'Add column';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost focus-ring';
    button.textContent = 'New column';
    button.addEventListener('click', handleCreateColumnRequest);

    card.appendChild(title);
    card.appendChild(button);

    boardEl.appendChild(card);
  }

  function appendHiddenColumnsPanel(columns: ColumnState[]): void {
    if (columns.length === 0) {
      return;
    }

    const panel = document.createElement('section');
    panel.className = 'column column--hidden';

    const heading = document.createElement('h2');
    heading.textContent =
      columns.length === 1 ? '1 hidden column' : `${columns.length} hidden columns`;
    panel.appendChild(heading);

    const copy = document.createElement('p');
    copy.className = 'column-hidden__copy';
    copy.textContent = 'Hidden columns stay synced—select one to bring it back into view.';
    panel.appendChild(copy);

    const list = document.createElement('div');
    list.className = 'column-hidden__list';
    columns.forEach((columnState) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pill focus-ring';
      button.textContent = columnState.column.title;
      button.addEventListener('click', () => {
        setColumnHidden(columnState.column.id, false);
        showToast(`"${columnState.column.title}" is visible again.`, 'success');
      });
      list.appendChild(button);
    });

    panel.appendChild(list);
    boardEl.appendChild(panel);
  }

  function handleCreateColumnRequest(): void {
    closeActiveColumnMenu();
    void (async () => {
      try {
        const name = await showTextPrompt({
          title: 'New column',
          placeholder: 'Column name',
          confirmLabel: 'Create column',
        });
        await handleCreateColumn(name);
      } catch (error) {
        if (error instanceof Error && error.message === 'Prompt cancelled.') {
          return;
        }
        showToast(resolveErrorMessage(error, 'Unable to create column.'), 'error');
      }
    })();
  }

  async function handleCreateColumn(title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) {
      showToast('Column name cannot be empty.', 'error');
      return;
    }

    try {
      const record = await createColumn(boardState.project.id, trimmed);
      boardState.columns.push({ column: record, tasks: [] });
      boardState.columns.sort((a, b) => a.column.position - b.column.position);
      rebuildColumnLookup();
      notifyColumnsChange();
      if (filterState.columnIds) {
        filterState.columnIds.add(record.id);
        setColumnFilter(Array.from(filterState.columnIds));
      } else {
        renderColumns();
      }
      showToast('Column created.', 'success');
    } catch (error) {
      showToast(resolveErrorMessage(error, 'Unable to create column.'), 'error');
    }
  }

  async function handleRenameColumn(columnId: string, nextTitle: string): Promise<void> {
    const columnState = columnLookup.get(columnId);
    if (!columnState) {
      return;
    }

    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === columnState.column.title) {
      return;
    }

    const originalTitle = columnState.column.title;
    columnState.column.title = trimmed;
    renderColumns();
    notifyColumnsChange();

    try {
      const updated = await renameColumn(boardState.project.id, columnId, trimmed);
      columnState.column.title = updated.title;
      rebuildColumnLookup();
      renderColumns();
      notifyColumnsChange();
      showToast('Column renamed.', 'success');
    } catch (error) {
      columnState.column.title = originalTitle;
      rebuildColumnLookup();
      renderColumns();
      notifyColumnsChange();
      showToast(resolveErrorMessage(error, 'Unable to rename column.'), 'error');
    }
  }

  async function startTaskCreation(preferredColumnId?: string): Promise<void> {
    let targetColumnId: string | null = null;

    if (preferredColumnId && isColumnVisible(preferredColumnId)) {
      targetColumnId = preferredColumnId;
    } else {
      const firstVisible = boardState.columns.find((columnState) =>
        isColumnVisible(columnState.column.id),
      );
      targetColumnId = firstVisible?.column.id ?? null;
    }

    if (!targetColumnId) {
      showToast('Add a column before creating tasks.', 'info');
      return;
    }

    const columnState = columnLookup.get(targetColumnId);
    if (!columnState) {
      return;
    }

    const tempButton = document.createElement('button');
    tempButton.textContent = '+ Add task';
    await handleAddTask(columnState.column, tempButton);
  }

  async function promptRenameColumn(columnState: ColumnState): Promise<void> {
    try {
      const value = await showTextPrompt({
        title: 'Rename column',
        placeholder: 'Column name',
        defaultValue: columnState.column.title,
        confirmLabel: 'Save',
      });
      await handleRenameColumn(columnState.column.id, value);
    } catch (error) {
      if (error instanceof Error && error.message === 'Prompt cancelled.') {
        return;
      }
      showToast(resolveErrorMessage(error, 'Unable to rename column.'), 'error');
    }
  }

  function canMoveColumn(columnId: string, direction: 'left' | 'right'): boolean {
    const visibleOrder = buildVisibleColumnOrder();
    const index = visibleOrder.indexOf(columnId);
    if (index === -1) {
      return false;
    }
    return direction === 'left' ? index > 0 : index < visibleOrder.length - 1;
  }

  function buildVisibleColumnOrder(): string[] {
    return boardState.columns
      .filter((columnState) => !isColumnHidden(columnState.column.id))
      .map((columnState) => columnState.column.id);
  }

  async function handleMoveColumn(columnId: string, direction: 'left' | 'right'): Promise<void> {
    const visibleOrder = buildVisibleColumnOrder();
    const currentIndex = visibleOrder.indexOf(columnId);
    if (currentIndex === -1) {
      showToast('Unhide the column before reordering it.', 'error');
      return;
    }

    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= visibleOrder.length) {
      return;
    }

    const reorderedVisible = visibleOrder.slice();
    reorderedVisible.splice(currentIndex, 1);
    reorderedVisible.splice(targetIndex, 0, columnId);

    const originalColumns = boardState.columns.slice();
    const stateById = new Map(boardState.columns.map((state) => [state.column.id, state]));
    const newOrder: ColumnState[] = [];
    let visiblePointer = 0;

    for (const state of originalColumns) {
      if (isColumnHidden(state.column.id)) {
        newOrder.push(state);
      } else {
        const nextId = reorderedVisible[visiblePointer++];
        const nextState = stateById.get(nextId);
        if (nextState) {
          newOrder.push(nextState);
        }
      }
    }

    boardState.columns = newOrder;
    boardState.columns.forEach((state, index) => {
      state.column.position = index + 1;
    });
    rebuildColumnLookup();
    renderColumns();
    notifyColumnsChange();

    const orderedIds = boardState.columns.map((state) => state.column.id);

    try {
      await reorderColumns(boardState.project.id, orderedIds);
      showToast('Column order updated.', 'success');
    } catch (error) {
      boardState.columns = originalColumns;
      boardState.columns.forEach((state, index) => {
        state.column.position = index + 1;
      });
      rebuildColumnLookup();
      renderColumns();
      notifyColumnsChange();
      showToast(resolveErrorMessage(error, 'Unable to reorder columns.'), 'error');
    }
  }

  function openColumnMenu(anchor: HTMLButtonElement, columnState: ColumnState): void {
    closeActiveColumnMenu();

    const menu = document.createElement('div');
    menu.className = 'column-menu';
    menu.style.position = 'absolute';
    menu.style.visibility = 'hidden';

    const list = document.createElement('div');
    list.className = 'column-menu__list';
    menu.appendChild(list);

    const addOption = (label: string, handler: () => void, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'column-menu__button';
      button.textContent = label;
      button.disabled = disabled;
      button.addEventListener('click', () => {
        handler();
      });
      list.appendChild(button);
    };

    addOption('Rename column', () => {
      closeActiveColumnMenu();
      void promptRenameColumn(columnState);
    });

    addOption(
      'Move left',
      () => {
        closeActiveColumnMenu();
        void handleMoveColumn(columnState.column.id, 'left');
      },
      !canMoveColumn(columnState.column.id, 'left'),
    );

    addOption(
      'Move right',
      () => {
        closeActiveColumnMenu();
        void handleMoveColumn(columnState.column.id, 'right');
      },
      !canMoveColumn(columnState.column.id, 'right'),
    );

    addOption('Hide column', () => {
      closeActiveColumnMenu();
      setColumnHidden(columnState.column.id, true);
      showToast(`"${columnState.column.title}" hidden.`, 'success');
    });

    document.body.appendChild(menu);

    const cleanup = () => {
      document.removeEventListener('click', handleOutside, true);
      document.removeEventListener('keydown', handleEscape, true);
      menu.remove();
      activeColumnMenu = null;
    };

    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!menu.contains(target) && target !== anchor) {
        cleanup();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
      }
    };

    document.addEventListener('click', handleOutside, true);
    document.addEventListener('keydown', handleEscape, true);

    const rect = anchor.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    let left = rect.right + window.scrollX - menuWidth;
    let top = rect.bottom + window.scrollY + 4;

    if (left < 16) {
      left = 16;
    }
    const maxLeft = window.scrollX + window.innerWidth - menuWidth - 16;
    if (left > maxLeft) {
      left = maxLeft;
    }

    const maxTop = window.scrollY + window.innerHeight - menuHeight - 16;
    if (top > maxTop) {
      top = maxTop;
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = 'visible';

    activeColumnMenu = {
      element: menu,
      cleanup,
    };
  }

  function renderBoardSkeleton(target: HTMLElement, columnCount = 3): void {
    target.innerHTML = '';
    for (let index = 0; index < columnCount; index++) {
      const column = document.createElement('section');
      column.className = 'column';
      column.style.minHeight = '200px';
      target.appendChild(column);
    }
  }

  function renderTaskList(columnState: ColumnState, taskList: HTMLUListElement): TaskRecord[] {
    taskList.innerHTML = '';

    const visibleRecords: Array<{ task: TaskRecord; metadata: TaskMetadata }> = [];

    columnState.tasks.forEach((task) => {
      const metadata = metadataStore.get(task.id);
      if (!matchesActiveFilters(task, metadata)) {
        return;
      }
      visibleRecords.push({ task, metadata });
    });

    visibleRecords.forEach(({ task, metadata }) => {
      const item = document.createElement('li');
      item.className = 'task focus-ring';
      item.draggable = true;
      item.tabIndex = 0;
      item.dataset.taskId = task.id;
      item.dataset.columnId = columnState.column.id;
      item.setAttribute('role', 'listitem');
      item.setAttribute('aria-grabbed', keyboardDrag?.taskId === task.id ? 'true' : 'false');

      const title = document.createElement('span');
      title.className = 'task__title';
      title.textContent = task.title;
      item.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'task__meta';

      const timerChip = document.createElement('span');
      timerChip.className = 'chip chip--timer';
      timerChip.textContent = '00:00:00';
      meta.appendChild(timerChip);

      if (metadata.archived) {
        item.classList.add('task--archived');
        item.draggable = false;
        item.setAttribute('aria-disabled', 'true');
        const archivedChip = document.createElement('span');
        archivedChip.className = 'chip chip--archived';
        archivedChip.textContent = 'Archived';
        meta.appendChild(archivedChip);
      }

      const checklistSummary = summarizeChecklists(metadata.checklists);
      if (checklistSummary) {
        const checklistChip = document.createElement('span');
        checklistChip.className = 'chip chip--checklist';
        checklistChip.textContent = checklistSummary;
        meta.appendChild(checklistChip);
      }

      if (metadata.reminder) {
        const reminderChip = document.createElement('span');
        reminderChip.className = 'chip chip--reminder';
        reminderChip.textContent = formatReminder(metadata.reminder);
        meta.appendChild(reminderChip);
      }

      if (metadata.labels.length > 0) {
        metadata.labels.forEach((labelId) => {
          const option = LABEL_OPTIONS.find((entry) => entry.id === labelId);
          if (!option) {
            return;
          }
          const labelChip = document.createElement('span');
          labelChip.className = 'task-label';
          labelChip.textContent = option.name;
          labelChip.title = option.name;
          labelChip.style.setProperty('--task-label-color', option.color);
          meta.appendChild(labelChip);
        });
      }

      item.appendChild(meta);

      if (keyboardDrag?.taskId === task.id) {
        item.classList.add('is-dragging', 'is-keyboard-dragging');
      }

      if (!metadata.archived) {
        item.addEventListener('dragstart', handleTaskDragStart);
        item.addEventListener('dragend', handleTaskDragEnd);
      }
      item.addEventListener('keydown', handleTaskKeydown);
      item.addEventListener('click', (event) => {
        if (pointerDrag) {
          return;
        }
        if ((event.target as HTMLElement | null)?.closest('button')) {
          return;
        }
        taskDrawer.open(task.id);
      });

      taskList.appendChild(item);
    });

    return visibleRecords.map((record) => record.task);
  }

  function matchesActiveFilters(task: TaskRecord, metadata?: TaskMetadata): boolean {
    if (!task) {
      return false;
    }

    if (filterState.normalizedQuery) {
      const extendedTask = task as TaskRecord & { notes?: unknown };
      const notesValue = typeof extendedTask.notes === 'string' ? extendedTask.notes : '';
      const haystack = [
        task.title,
        task.description ?? '',
        notesValue,
        ...((metadata?.checklists ?? []).flatMap((checklist) => [
          checklist.title,
          ...checklist.items.map((item) => item.text),
        ])),
        ...(metadata?.labels ?? []).map((labelId) => {
          const option = LABEL_OPTIONS.find((entry) => entry.id === labelId);
          return option ? option.name : '';
        }),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(filterState.normalizedQuery)) {
        return false;
      }
    }

    return true;
  }

  function summarizeChecklists(checklists: TaskChecklist[]): string | null {
    let total = 0;
    let completed = 0;
    checklists.forEach((checklist) => {
      checklist.items.forEach((item) => {
        total += 1;
        if (item.completed) {
          completed += 1;
        }
      });
    });

    if (total === 0) {
      return null;
    }

    return `Checklist ${completed}/${total}`;
  }

  function formatReminder(reminderIso: string): string {
    if (!reminderIso) {
      return '';
    }
    const date = new Date(reminderIso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return reminderFormatter.format(date);
  }

  function isColumnVisible(columnId: string): boolean {
    if (isColumnHidden(columnId)) {
      return false;
    }
    if (!filterState.columnIds || filterState.columnIds.size === 0) {
      return true;
    }
    return filterState.columnIds.has(columnId);
  }

  function areSetsEqual(a: Set<string> | null, b: Set<string> | null): boolean {
    if (!a && !b) {
      return true;
    }
    if (!a || !b || a.size !== b.size) {
      return false;
    }
    for (const value of a) {
      if (!b.has(value)) {
        return false;
      }
    }
    return true;
  }

  async function handleAddTask(column: ColumnRecord, button: HTMLButtonElement): Promise<void> {
    let modalResult: Awaited<ReturnType<typeof showTaskModal>> | null = null;
    try {
      modalResult = await showTaskModal({ columnTitle: column.title });
    } catch (error) {
      if (error instanceof Error && error.message !== 'Task creation cancelled.') {
        showToast(resolveErrorMessage(error, 'Unable to open task creator.'), 'error');
      }
      return;
    }

    const trimmedTitle = modalResult?.title.trim();
    if (!trimmedTitle) {
      return;
    }

    const initialLabel = button.textContent ?? '+ Add task';
    button.disabled = true;
    button.textContent = 'Adding…';

    try {
      await createTask({
        projectId: boardState.project.id,
        columnId: column.id,
        title: trimmedTitle,
        description: modalResult?.description,
      });

      await refreshBoardState(false);
      showToast('Task created.', 'success');
    } catch (error) {
      const message = resolveErrorMessage(error, 'Failed to create task.');
      showToast(message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = initialLabel;
    }
  }

  async function refreshBoardState(showLoading = true): Promise<void> {
    if (showLoading && boardTitleEl) {
      boardTitleEl.textContent = 'Loading board…';
      renderBoardSkeleton(boardEl, Math.max(boardState.columns.length, 3));
    }

    try {
      const fresh = await getBoard(boardState.project.id);
      boardState = buildBoardState(fresh);
      pruneTaskMetadata();
      rebuildColumnLookup();
      notifyColumnsChange();
    } catch (error) {
      showToast(resolveErrorMessage(error, 'Unable to refresh board.'), 'error');
      console.error('Unable to refresh board', error);
    } finally {
      renderColumns();
    }
  }

  function handleTaskDragStart(event: DragEvent): void {
    if (keyboardDrag) {
      event.preventDefault();
      return;
    }

    const taskEl = event.currentTarget as HTMLLIElement;
    const taskId = taskEl.dataset.taskId;
    const columnId = taskEl.dataset.columnId;

    if (!taskId || !columnId) {
      return;
    }

    pointerDrag = {
      taskId,
      fromColumnId: columnId,
      snapshot: createSnapshot(),
      element: taskEl,
      preview: createDragPreview(taskEl),
      dropHandled: false,
    };

    taskEl.classList.add('is-dragging');
    taskEl.setAttribute('aria-grabbed', 'true');
    rootEl.classList.add('is-pointer-dragging');

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', taskId);
      if (pointerDrag.preview) {
        event.dataTransfer.setDragImage(
          pointerDrag.preview,
          pointerDrag.preview.offsetWidth / 2,
          pointerDrag.preview.offsetHeight / 2,
        );
      }
    }
  }

  function handleTaskDragEnd(): void {
    if (!pointerDrag) {
      return;
    }

    if (!pointerDrag.dropHandled) {
      restoreSnapshot(pointerDrag.snapshot);
      updateLocalPositions();
      renderColumns();
    }

    clearPointerDragState();
  }

  function handleColumnDragOver(event: DragEvent): void {
    if (!pointerDrag) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    const columnId = getColumnIdFromEvent(event.currentTarget);
    if (columnId) {
      setDropTarget(columnId);
    }
  }

  function handleColumnDragEnter(event: DragEvent): void {
    if (!pointerDrag) {
      return;
    }

    const columnId = getColumnIdFromEvent(event.currentTarget);
    if (columnId) {
      setDropTarget(columnId);
    }
  }

  function handleColumnDragLeave(event: DragEvent): void {
    if (!pointerDrag) {
      return;
    }

    const columnEl = event.currentTarget as HTMLElement;
    if (columnEl.contains((event.relatedTarget as Node) ?? null)) {
      return;
    }

    if (columnEl.dataset.columnId === activeDropColumnId) {
      setDropTarget(null);
    }
  }

  function handleColumnDrop(event: DragEvent): void {
    if (!pointerDrag) {
      return;
    }

    event.preventDefault();
    pointerDrag.dropHandled = true;

    const columnEl = event.currentTarget as HTMLElement;
    const columnId = columnEl.dataset.columnId;
    if (!columnId) {
      clearPointerDragState();
      return;
    }

    const list = columnEl.querySelector<HTMLUListElement>('.column__list');
    const dropIndex = getDropIndex(list, event.clientY, pointerDrag.taskId);

    void finalizePointerDrop(pointerDrag, columnId, dropIndex);
  }

  async function finalizePointerDrop(
    drag: PointerDragState,
    targetColumnId: string,
    targetIndex: number,
  ): Promise<void> {
    const moveResult = moveTaskInState(drag.taskId, targetColumnId, targetIndex);

    if (!moveResult) {
      clearPointerDragState();
      renderColumns();
      return;
    }

    updateLocalPositions();
    renderColumns();
    focusTask(drag.taskId);

    const newOrderInFrom = getTaskOrder(moveResult.fromColumnId);
    const newOrderInTo = getTaskOrder(moveResult.toColumnId);

    try {
      await moveTask({
        projectId: boardState.project.id,
        taskId: drag.taskId,
        fromColumnId: moveResult.fromColumnId,
        toColumnId: moveResult.toColumnId,
        newOrderInFrom,
        newOrderInTo,
      });
    } catch (error) {
      restoreSnapshot(drag.snapshot);
      updateLocalPositions();
      renderColumns();
      focusTask(drag.taskId);
      showToast(resolveErrorMessage(error, 'Unable to reorder tasks. Changes reverted.'), 'error');
    } finally {
      clearPointerDragState();
    }
  }

  function handleTaskKeydown(event: KeyboardEvent): void {
    const taskEl = event.currentTarget as HTMLLIElement;
    const taskId = taskEl.dataset.taskId;
    const columnId = taskEl.dataset.columnId;

    if (!taskId || !columnId) {
      return;
    }

    if (!keyboardDrag && (event.key === 'Enter' || event.key === 'NumpadEnter')) {
      event.preventDefault();
      taskDrawer.open(taskId);
      return;
    }

    const isSpace = event.key === ' ' || event.code === 'Space';

    if (!keyboardDrag) {
      if (isSpace) {
        event.preventDefault();
        startKeyboardDrag(taskId, columnId);
      }
      return;
    }

    if (keyboardDrag.taskId !== taskId) {
      return;
    }

    if (isSpace) {
      event.preventDefault();
      void commitKeyboardDrag();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelKeyboardDrag();
      return;
    }

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        handleKeyboardMovement('up');
        break;
      case 'ArrowDown':
        event.preventDefault();
        handleKeyboardMovement('down');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        handleKeyboardMovement('left');
        break;
      case 'ArrowRight':
        event.preventDefault();
        handleKeyboardMovement('right');
        break;
      default:
        break;
    }
  }

  function startKeyboardDrag(taskId: string, columnId: string): void {
    const columnState = columnLookup.get(columnId);
    if (!columnState) {
      return;
    }

    const index = columnState.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      return;
    }

    keyboardDrag = {
      taskId,
      fromColumnId: columnId,
      fromIndex: index,
      currentColumnId: columnId,
      currentIndex: index,
      snapshot: createSnapshot(),
    };

    rootEl.classList.add('is-keyboard-dragging');
    setDropTarget(columnId);
    renderColumns();
    focusTask(taskId);

    if (!keyboardHintShown) {
      keyboardHintShown = true;
      showToast('Use arrow keys to move, Space to drop, Escape to cancel.', 'success', 2600);
    }
  }

  function cancelKeyboardDrag(): void {
    if (!keyboardDrag) {
      return;
    }

    const { snapshot, taskId } = keyboardDrag;
    keyboardDrag = null;
    rootEl.classList.remove('is-keyboard-dragging');
    setDropTarget(null);
    restoreSnapshot(snapshot);
    updateLocalPositions();
    renderColumns();
    focusTask(taskId);
  }

  async function commitKeyboardDrag(): Promise<void> {
    if (!keyboardDrag) {
      return;
    }

    const { taskId, fromColumnId, fromIndex, currentColumnId, currentIndex, snapshot } =
      keyboardDrag;
    keyboardDrag = null;
    rootEl.classList.remove('is-keyboard-dragging');
    setDropTarget(null);

    const targetColumnState = columnLookup.get(currentColumnId);
    const finalIndex = targetColumnState
      ? targetColumnState.tasks.findIndex((task) => task.id === taskId)
      : currentIndex;

    renderColumns();
    focusTask(taskId);

    if (fromColumnId === currentColumnId && fromIndex === finalIndex) {
      return;
    }

    updateLocalPositions();

    const newOrderInFrom = getTaskOrder(fromColumnId);
    const newOrderInTo = getTaskOrder(currentColumnId);

    try {
      await moveTask({
        projectId: boardState.project.id,
        taskId,
        fromColumnId,
        toColumnId: currentColumnId,
        newOrderInFrom,
        newOrderInTo,
      });
    } catch (error) {
      restoreSnapshot(snapshot);
      updateLocalPositions();
      renderColumns();
      focusTask(taskId);
      showToast(resolveErrorMessage(error, 'Unable to reorder tasks. Changes reverted.'), 'error');
    }
  }

  function handleKeyboardMovement(direction: 'up' | 'down' | 'left' | 'right'): void {
    if (!keyboardDrag) {
      return;
    }

    const { taskId, currentColumnId } = keyboardDrag;
    const currentColumnState = columnLookup.get(currentColumnId);
    if (!currentColumnState) {
      return;
    }

    const currentIndex = currentColumnState.tasks.findIndex((task) => task.id === taskId);
    if (currentIndex === -1) {
      return;
    }

    let targetColumnId = currentColumnId;
    let targetIndex = currentIndex;

    if (direction === 'up') {
      targetIndex = Math.max(0, currentIndex - 1);
    } else if (direction === 'down') {
      targetIndex = Math.min(currentColumnState.tasks.length, currentIndex + 1);
    } else if (direction === 'left' || direction === 'right') {
      const currentColumnOrderIndex = columnOrder.indexOf(currentColumnId);
      const offset = direction === 'left' ? -1 : 1;
      const nextColumnIndex = currentColumnOrderIndex + offset;
      if (nextColumnIndex < 0 || nextColumnIndex >= columnOrder.length) {
        return;
      }
      targetColumnId = columnOrder[nextColumnIndex];
      const nextColumnState = columnLookup.get(targetColumnId);
      if (!nextColumnState) {
        return;
      }
      targetIndex = Math.min(nextColumnState.tasks.length, currentIndex);
    }

    const moveResult = moveTaskInState(taskId, targetColumnId, targetIndex);
    if (!moveResult) {
      return;
    }

    updateLocalPositions();
    keyboardDrag.currentColumnId = moveResult.toColumnId;
    keyboardDrag.currentIndex = moveResult.toIndex;
    renderColumns();
    focusTask(taskId);
  }

  function moveTaskInState(
    taskId: string,
    targetColumnId: string,
    requestedIndex: number,
  ): MoveResult | null {
    const task = boardState.taskById.get(taskId);
    if (!task) {
      return null;
    }

    const fromColumnId = task.column_id;
    const sourceColumnState = columnLookup.get(fromColumnId);
    if (!sourceColumnState) {
      return null;
    }

    const fromIndex = sourceColumnState.tasks.findIndex((entry) => entry.id === taskId);
    if (fromIndex === -1) {
      return null;
    }

    if (targetColumnId === fromColumnId) {
      const originalLength = sourceColumnState.tasks.length;
      const boundedIndex = clampNumber(requestedIndex, 0, originalLength - 1);
      if (boundedIndex === fromIndex) {
        return null;
      }

      const [removed] = sourceColumnState.tasks.splice(fromIndex, 1);
      const insertionIndex = clampNumber(requestedIndex, 0, sourceColumnState.tasks.length);
      sourceColumnState.tasks.splice(insertionIndex, 0, removed);
      return { fromColumnId, toColumnId: fromColumnId, fromIndex, toIndex: insertionIndex };
    }

    const targetColumnState = columnLookup.get(targetColumnId);
    if (!targetColumnState) {
      return null;
    }

    const [removed] = sourceColumnState.tasks.splice(fromIndex, 1);
    const insertionIndex = clampNumber(requestedIndex, 0, targetColumnState.tasks.length);
    targetColumnState.tasks.splice(insertionIndex, 0, removed);
    removed.column_id = targetColumnId;
    return { fromColumnId, toColumnId: targetColumnId, fromIndex, toIndex: insertionIndex };
  }

  function clearPointerDragState(): void {
    if (!pointerDrag) {
      return;
    }

    const { element, preview } = pointerDrag;
    if (element && element.isConnected) {
      element.classList.remove('is-dragging');
      element.setAttribute('aria-grabbed', 'false');
    }

    preview?.remove();

    pointerDrag = null;
    rootEl.classList.remove('is-pointer-dragging');
    setDropTarget(null);
  }

  function createSnapshot(): BoardSnapshot {
    return {
      columns: boardState.columns.map((columnState) => ({
        columnId: columnState.column.id,
        taskIds: columnState.tasks.map((task) => task.id),
      })),
    };
  }

  function restoreSnapshot(snapshot: BoardSnapshot): void {
    snapshot.columns.forEach(({ columnId, taskIds }) => {
      const columnState = columnLookup.get(columnId);
      if (!columnState) {
        return;
      }

      const tasks: TaskRecord[] = [];
      taskIds.forEach((taskId) => {
        const task = boardState.taskById.get(taskId);
        if (task) {
          task.column_id = columnId;
          tasks.push(task);
        }
      });

      columnState.tasks = tasks;
    });
  }

  function updateLocalPositions(): void {
    boardState.columns.forEach((columnState) => {
      columnState.tasks.forEach((task, index) => {
        task.position = index + 1;
        task.column_id = columnState.column.id;
      });
    });
  }

  function removeTaskFromState(taskId: string): void {
    boardState.columns.forEach((columnState) => {
      const index = columnState.tasks.findIndex((task) => task.id === taskId);
      if (index !== -1) {
        columnState.tasks.splice(index, 1);
      }
    });
    boardState.taskById.delete(taskId);
  }

  function getDropIndex(
    list: HTMLUListElement | null,
    clientY: number,
    draggingTaskId: string,
  ): number {
    if (!list) {
      return 0;
    }

    const items = Array.from(list.querySelectorAll<HTMLLIElement>('.task'));
    let index = 0;

    for (const item of items) {
      if (item.dataset.taskId === draggingTaskId) {
        continue;
      }

      const rect = item.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        break;
      }

      index += 1;
    }

    return index;
  }

  function getTaskOrder(columnId: string): string[] {
    const columnState = columnLookup.get(columnId);
    if (!columnState) {
      return [];
    }
    return columnState.tasks.map((task) => task.id);
  }

  function resolveErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }
    }

    return fallback;
  }

  function focusTask(taskId: string): void {
    requestAnimationFrame(() => {
      const element = rootEl.querySelector<HTMLLIElement>(`[data-task-id="${taskId}"]`);
      element?.focus();
    });
  }

  function setDropTarget(columnId: string | null): void {
    if (activeDropColumnId === columnId) {
      return;
    }

    if (activeDropColumnId) {
      const previous = rootEl.querySelector<HTMLElement>(
        `[data-column-id="${activeDropColumnId}"]`,
      );
      previous?.classList.remove('is-drop-target');
    }

    activeDropColumnId = columnId;

    if (columnId) {
      const next = rootEl.querySelector<HTMLElement>(`[data-column-id="${columnId}"]`);
      next?.classList.add('is-drop-target');
    }
  }

  function initializeTaskDrawer(): TaskDrawerControls {
    const overlay = document.createElement('div');
    overlay.className = 'task-drawer-overlay';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('aside');
    panel.className = 'task-drawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const header = document.createElement('header');
    header.className = 'task-drawer__header';
    panel.appendChild(header);

    const heading = document.createElement('h2');
    heading.className = 'task-drawer__heading';
    heading.id = 'task-drawer-heading';
    heading.textContent = 'Task details';
    header.appendChild(heading);
    panel.setAttribute('aria-labelledby', heading.id);

    const columnBadge = document.createElement('span');
    columnBadge.className = 'task-drawer__column';
    header.appendChild(columnBadge);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'task-drawer__close';
    closeButton.textContent = 'Close';
    closeButton.setAttribute('aria-label', 'Close task details');
    header.appendChild(closeButton);

    const archivedBanner = document.createElement('div');
    archivedBanner.className = 'task-drawer__banner';
    archivedBanner.textContent = 'This task is archived and hidden from the board.';
    archivedBanner.hidden = true;
    panel.appendChild(archivedBanner);

    const titleField = document.createElement('div');
    titleField.className = 'task-drawer__field';
    const titleLabel = document.createElement('label');
    titleLabel.className = 'task-drawer__label';
    titleLabel.textContent = 'Title';
    titleLabel.htmlFor = 'task-drawer-title';
    const titleInput = document.createElement('input');
    titleInput.id = 'task-drawer-title';
    titleInput.type = 'text';
    titleInput.className = 'task-drawer__input task-drawer__input--title';
    titleInput.placeholder = 'Task title';
    titleField.appendChild(titleLabel);
    titleField.appendChild(titleInput);
    panel.appendChild(titleField);

    const descriptionField = document.createElement('div');
    descriptionField.className = 'task-drawer__field';
    const descriptionLabel = document.createElement('label');
    descriptionLabel.className = 'task-drawer__label';
    descriptionLabel.textContent = 'Description';
    descriptionLabel.htmlFor = 'task-drawer-description';
    const descriptionInput = document.createElement('textarea');
    descriptionInput.id = 'task-drawer-description';
    descriptionInput.className = 'task-drawer__textarea';
    descriptionInput.rows = 5;
    descriptionInput.placeholder = 'Add details, links, or context.';
    descriptionField.appendChild(descriptionLabel);
    descriptionField.appendChild(descriptionInput);
    panel.appendChild(descriptionField);

    const checklistSection = document.createElement('section');
    checklistSection.className = 'task-drawer__section';
    const checklistHeader = document.createElement('div');
    checklistHeader.className = 'task-drawer__section-header';
    const checklistHeading = document.createElement('h3');
    checklistHeading.className = 'task-drawer__section-title';
    checklistHeading.textContent = 'Checklists';
    checklistHeader.appendChild(checklistHeading);
    const addChecklistButton = document.createElement('button');
    addChecklistButton.type = 'button';
    addChecklistButton.className = 'task-drawer__section-action';
    addChecklistButton.textContent = 'Add checklist';
    checklistHeader.appendChild(addChecklistButton);
    checklistSection.appendChild(checklistHeader);
    const checklistsContainer = document.createElement('div');
    checklistsContainer.className = 'task-drawer__checklists';
    checklistSection.appendChild(checklistsContainer);
    panel.appendChild(checklistSection);

    const labelsSection = document.createElement('section');
    labelsSection.className = 'task-drawer__section';
    const labelsHeader = document.createElement('div');
    labelsHeader.className = 'task-drawer__section-header';
    const labelsHeading = document.createElement('h3');
    labelsHeading.className = 'task-drawer__section-title';
    labelsHeading.textContent = 'Labels';
    labelsHeader.appendChild(labelsHeading);
    labelsSection.appendChild(labelsHeader);
    const labelsContainer = document.createElement('div');
    labelsContainer.className = 'task-drawer__labels';
    labelsSection.appendChild(labelsContainer);
    panel.appendChild(labelsSection);

    const labelInputs = new Map<TaskLabelId, HTMLInputElement>();
    LABEL_OPTIONS.forEach((option) => {
      const labelWrap = document.createElement('label');
      labelWrap.className = 'task-drawer__label-option';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = option.id;
      checkbox.className = 'task-drawer__checkbox';
      checkbox.dataset.labelId = option.id;
      labelInputs.set(option.id, checkbox);

      const swatch = document.createElement('span');
      swatch.className = 'task-drawer__label-swatch';
      swatch.style.setProperty('--task-label-color', option.color);

      const text = document.createElement('span');
      text.className = 'task-drawer__label-text';
      text.textContent = option.name;

      labelWrap.appendChild(checkbox);
      labelWrap.appendChild(swatch);
      labelWrap.appendChild(text);

      labelsContainer.appendChild(labelWrap);

      checkbox.addEventListener('change', () => {
        handleLabelToggle(option.id, checkbox.checked);
      });
    });

    const reminderSection = document.createElement('section');
    reminderSection.className = 'task-drawer__section';
    const reminderLabel = document.createElement('label');
    reminderLabel.className = 'task-drawer__label';
    reminderLabel.textContent = 'Reminder';
    reminderLabel.htmlFor = 'task-drawer-reminder';
    const reminderInput = document.createElement('input');
    reminderInput.type = 'datetime-local';
    reminderInput.id = 'task-drawer-reminder';
    reminderInput.className = 'task-drawer__input';
    const reminderActions = document.createElement('div');
    reminderActions.className = 'task-drawer__reminder-actions';
    const clearReminderButton = document.createElement('button');
    clearReminderButton.type = 'button';
    clearReminderButton.className = 'task-drawer__link-btn';
    clearReminderButton.textContent = 'Clear reminder';
    reminderActions.appendChild(clearReminderButton);
    reminderSection.appendChild(reminderLabel);
    reminderSection.appendChild(reminderInput);
    reminderSection.appendChild(reminderActions);
    panel.appendChild(reminderSection);

    const footer = document.createElement('footer');
    footer.className = 'task-drawer__footer';
    const archiveButton = document.createElement('button');
    archiveButton.type = 'button';
    archiveButton.className = 'task-drawer__archive-btn';
    archiveButton.textContent = 'Archive task';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'task-drawer__delete-btn';
    deleteButton.textContent = 'Delete task';
    footer.appendChild(archiveButton);
    footer.appendChild(deleteButton);
    panel.appendChild(footer);

    let activeTaskId: string | null = null;
    let previouslyFocused: HTMLElement | null = null;
    let titleSaving = false;
    let descriptionSaving = false;

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    const open = (taskId: string): void => {
      const task = boardState.taskById.get(taskId);
      if (!task) {
        showToast('Task not found.', 'error');
        return;
      }

      activeTaskId = taskId;
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      overlay.classList.add('is-visible');
      renderContent(taskId);
      document.addEventListener('keydown', handleEscape, true);
      requestAnimationFrame(() => {
        titleInput.focus();
        titleInput.select();
      });
    };

    const close = (): void => {
      if (!activeTaskId) {
        return;
      }
      activeTaskId = null;
      overlay.classList.remove('is-visible');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.hidden = true;
      document.removeEventListener('keydown', handleEscape, true);
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };

    const refresh = (): void => {
      if (activeTaskId) {
        renderContent(activeTaskId);
      }
    };

    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close();
      }
    });

    titleInput.addEventListener('blur', () => {
      void commitTitle();
    });
    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        titleInput.blur();
      }
    });

    descriptionInput.addEventListener('blur', () => {
      void commitDescription();
    });

    addChecklistButton.addEventListener('click', () => addChecklist());
    checklistsContainer.addEventListener('click', handleChecklistClick);
    checklistsContainer.addEventListener('change', handleChecklistChange);
    checklistsContainer.addEventListener('blur', handleChecklistBlur, true);

    reminderInput.addEventListener('change', () => persistReminder(reminderInput.value));
    clearReminderButton.addEventListener('click', () => {
      reminderInput.value = '';
      persistReminder('');
    });

    archiveButton.addEventListener('click', () => toggleArchive());
    deleteButton.addEventListener('click', () => {
      void handleDelete();
    });

    function renderContent(taskId: string): void {
      const task = boardState.taskById.get(taskId);
      if (!task) {
        close();
        return;
      }

      const metadata = metadataStore.get(taskId);
      const columnState = columnLookup.get(task.column_id);
      columnBadge.textContent = columnState ? columnState.column.title : 'Unknown column';

      if (!titleSaving) {
        titleInput.value = task.title;
        titleInput.disabled = false;
      }
      if (!descriptionSaving) {
        descriptionInput.value = task.description ?? '';
        descriptionInput.disabled = false;
      }

      archivedBanner.hidden = !metadata.archived;
      archiveButton.textContent = metadata.archived ? 'Unarchive task' : 'Archive task';
      archiveButton.dataset.state = metadata.archived ? 'archived' : 'active';

      renderChecklists(metadata.checklists);
      syncLabelInputs(metadata.labels);
      syncReminder(metadata.reminder);
    }

    async function commitTitle(): Promise<void> {
      if (!activeTaskId || titleSaving) {
        return;
      }
      const task = boardState.taskById.get(activeTaskId);
      if (!task) {
        close();
        return;
      }

      const nextTitle = titleInput.value.trim();
      if (!nextTitle) {
        titleInput.value = task.title;
        showToast('Enter a task title to continue.', 'error');
        titleInput.focus();
        return;
      }
      if (nextTitle === task.title.trim()) {
        titleInput.value = task.title;
        return;
      }

      titleSaving = true;
      titleInput.disabled = true;
      const previousTitle = task.title;
      task.title = nextTitle;
      renderColumns();

      try {
        await updateTask({ projectId: boardState.project.id, taskId: activeTaskId, title: nextTitle });
      } catch (error) {
        task.title = previousTitle;
        renderColumns();
        titleInput.value = previousTitle;
        showToast(resolveErrorMessage(error, 'Unable to update the title.'), 'error');
      } finally {
        titleSaving = false;
        titleInput.disabled = false;
        refresh();
      }
    }

    async function commitDescription(): Promise<void> {
      if (!activeTaskId || descriptionSaving) {
        return;
      }
      const task = boardState.taskById.get(activeTaskId);
      if (!task) {
        close();
        return;
      }

      const nextDescription = descriptionInput.value.trim();
      const existingDescription = task.description ?? '';
      if (nextDescription === existingDescription.trim()) {
        descriptionInput.value = existingDescription;
        return;
      }

      descriptionSaving = true;
      descriptionInput.disabled = true;
      const previousDescription = task.description ?? '';
      task.description = nextDescription.length > 0 ? nextDescription : null;
      renderColumns();

      try {
        await updateTask({
          projectId: boardState.project.id,
          taskId: activeTaskId,
          description: nextDescription,
        });
      } catch (error) {
        task.description = previousDescription;
        renderColumns();
        descriptionInput.value = previousDescription;
        showToast(resolveErrorMessage(error, 'Unable to update the description.'), 'error');
      } finally {
        descriptionSaving = false;
        descriptionInput.disabled = false;
        refresh();
      }
    }

    function renderChecklists(checklists: TaskChecklist[]): void {
      checklistsContainer.innerHTML = '';
      if (checklists.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'task-drawer__empty';
        empty.textContent = 'No checklist items yet.';
        checklistsContainer.appendChild(empty);
        return;
      }

      checklists.forEach((checklist) => {
        const wrapper = document.createElement('section');
        wrapper.className = 'task-drawer__checklist';
        wrapper.dataset.checklistId = checklist.id;

        const headerRow = document.createElement('div');
        headerRow.className = 'task-drawer__checklist-header';

        const checklistTitle = document.createElement('input');
        checklistTitle.type = 'text';
        checklistTitle.className = 'task-drawer__checklist-title';
        checklistTitle.value = checklist.title;
        checklistTitle.dataset.role = 'checklist-title';
        checklistTitle.dataset.checklistId = checklist.id;

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'task-drawer__icon-btn';
        removeButton.textContent = 'Remove';
        removeButton.dataset.role = 'checklist-remove';
        removeButton.dataset.checklistId = checklist.id;

        headerRow.appendChild(checklistTitle);
        headerRow.appendChild(removeButton);
        wrapper.appendChild(headerRow);

        const list = document.createElement('ul');
        list.className = 'task-drawer__checklist-items';

        checklist.items.forEach((item) => {
          const entry = document.createElement('li');
          entry.className = 'task-drawer__checklist-item';
          entry.dataset.itemId = item.id;

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'task-drawer__checklist-toggle';
          checkbox.checked = item.completed;
          checkbox.dataset.role = 'checklist-item-toggle';
          checkbox.dataset.checklistId = checklist.id;
          checkbox.dataset.itemId = item.id;

          const textInput = document.createElement('input');
          textInput.type = 'text';
          textInput.className = 'task-drawer__checklist-input';
          textInput.placeholder = 'Add checklist item';
          textInput.value = item.text;
          textInput.dataset.role = 'checklist-item';
          textInput.dataset.checklistId = checklist.id;
          textInput.dataset.itemId = item.id;

          const deleteItemButton = document.createElement('button');
          deleteItemButton.type = 'button';
          deleteItemButton.className = 'task-drawer__icon-btn';
          deleteItemButton.textContent = 'Remove';
          deleteItemButton.dataset.role = 'checklist-item-remove';
          deleteItemButton.dataset.checklistId = checklist.id;
          deleteItemButton.dataset.itemId = item.id;

          entry.appendChild(checkbox);
          entry.appendChild(textInput);
          entry.appendChild(deleteItemButton);
          list.appendChild(entry);
        });

        wrapper.appendChild(list);

        const addItemButton = document.createElement('button');
        addItemButton.type = 'button';
        addItemButton.className = 'task-drawer__add-item';
        addItemButton.textContent = 'Add item';
        addItemButton.dataset.role = 'checklist-add-item';
        addItemButton.dataset.checklistId = checklist.id;
        wrapper.appendChild(addItemButton);

        checklistsContainer.appendChild(wrapper);
      });
    }

    function handleChecklistClick(event: MouseEvent): void {
      const target = event.target as HTMLElement | null;
      if (!target || !activeTaskId) {
        return;
      }
      const action = target.dataset.role;
      if (!action) {
        return;
      }
      const checklistId = target.dataset.checklistId;
      if (!checklistId) {
        return;
      }

      if (action === 'checklist-remove') {
        metadataStore.update(activeTaskId, (meta) => ({
          ...meta,
          checklists: meta.checklists.filter((entry) => entry.id !== checklistId),
        }));
        renderColumns();
        refresh();
        return;
      }

      if (action === 'checklist-item-remove') {
        const itemId = target.dataset.itemId;
        if (!itemId) {
          return;
        }
        metadataStore.update(activeTaskId, (meta) => ({
          ...meta,
          checklists: meta.checklists.map((entry) => {
            if (entry.id !== checklistId) {
              return entry;
            }
            return {
              ...entry,
              items: entry.items.filter((item) => item.id !== itemId),
            };
          }),
        }));
        renderColumns();
        refresh();
        return;
      }

      if (action === 'checklist-add-item') {
        const newItemId = generateLocalId();
        metadataStore.update(activeTaskId, (meta) => ({
          ...meta,
          checklists: meta.checklists.map((entry) => {
            if (entry.id !== checklistId) {
              return entry;
            }
            return {
              ...entry,
              items: [...entry.items, { id: newItemId, text: '', completed: false }],
            };
          }),
        }));
        renderColumns();
        refresh();
        requestAnimationFrame(() => {
          const freshlyAdded = checklistsContainer.querySelector<HTMLInputElement>(
            `[data-role="checklist-item"][data-item-id="${newItemId}"]`,
          );
          freshlyAdded?.focus();
        });
      }
    }

    function handleChecklistChange(event: Event): void {
      const target = event.target as HTMLInputElement | null;
      if (!target || !activeTaskId) {
        return;
      }
      if (target.dataset.role !== 'checklist-item-toggle') {
        return;
      }
      const checklistId = target.dataset.checklistId;
      const itemId = target.dataset.itemId;
      if (!checklistId || !itemId) {
        return;
      }

      const checked = target.checked;
      metadataStore.update(activeTaskId, (meta) => ({
        ...meta,
        checklists: meta.checklists.map((entry) => {
          if (entry.id !== checklistId) {
            return entry;
          }
          return {
            ...entry,
            items: entry.items.map((item) =>
              item.id === itemId ? { ...item, completed: checked } : item,
            ),
          };
        }),
      }));
      renderColumns();
      refresh();
    }

    function handleChecklistBlur(event: FocusEvent): void {
      const target = event.target as HTMLInputElement | null;
      if (!target || !activeTaskId) {
        return;
      }
      const role = target.dataset.role;
      if (!role) {
        return;
      }
      const checklistId = target.dataset.checklistId;
      if (!checklistId) {
        return;
      }
      const trimmed = target.value.trim();
      if (role === 'checklist-title') {
        metadataStore.update(activeTaskId, (meta) => ({
          ...meta,
          checklists: meta.checklists.map((entry) =>
            entry.id === checklistId ? { ...entry, title: trimmed || 'Checklist' } : entry,
          ),
        }));
        renderColumns();
        refresh();
        return;
      }
      if (role === 'checklist-item') {
        const itemId = target.dataset.itemId;
        if (!itemId) {
          return;
        }
        metadataStore.update(activeTaskId, (meta) => ({
          ...meta,
          checklists: meta.checklists.map((entry) => {
            if (entry.id !== checklistId) {
              return entry;
            }
            return {
              ...entry,
              items: entry.items.map((item) =>
                item.id === itemId ? { ...item, text: trimmed } : item,
              ),
            };
          }),
        }));
        renderColumns();
        refresh();
      }
    }

    function addChecklist(): void {
      if (!activeTaskId) {
        return;
      }
      const newChecklistId = generateLocalId();
      metadataStore.update(activeTaskId, (meta) => ({
        ...meta,
        checklists: [
          ...meta.checklists,
          { id: newChecklistId, title: `Checklist ${meta.checklists.length + 1}`, items: [] },
        ],
      }));
      renderColumns();
      refresh();
      requestAnimationFrame(() => {
        const input = checklistsContainer.querySelector<HTMLInputElement>(
          `[data-role="checklist-title"][data-checklist-id="${newChecklistId}"]`,
        );
        input?.focus();
        input?.select();
      });
    }

    function handleLabelToggle(labelId: TaskLabelId, checked: boolean): void {
      if (!activeTaskId) {
        return;
      }
      metadataStore.update(activeTaskId, (meta) => {
        const labels = new Set(meta.labels);
        if (checked) {
          labels.add(labelId);
        } else {
          labels.delete(labelId);
        }
        return {
          ...meta,
          labels: Array.from(labels),
        };
      });
      renderColumns();
      refresh();
    }

    function syncLabelInputs(labels: string[]): void {
      labelInputs.forEach((input, key) => {
        input.checked = labels.includes(key);
      });
    }

    function syncReminder(reminder: string | null): void {
      const value = reminder ? toInputValue(reminder) : '';
      reminderInput.value = value;
      clearReminderButton.disabled = !value;
    }

    function persistReminder(value: string): void {
      if (!activeTaskId) {
        return;
      }
      const iso = fromInputValue(value);
      metadataStore.update(activeTaskId, (meta) => ({
        ...meta,
        reminder: iso,
      }));
      renderColumns();
      refresh();
    }

    function toggleArchive(): void {
      if (!activeTaskId) {
        return;
      }
      metadataStore.update(activeTaskId, (meta) => ({
        ...meta,
        archived: !meta.archived,
      }));
      renderColumns();
      refresh();
      showToast('Task archive state updated.', 'success');
    }

    async function handleDelete(): Promise<void> {
      if (!activeTaskId) {
        return;
      }
      const confirmed = window.confirm('Delete this task? This cannot be undone.');
      if (!confirmed) {
        return;
      }
      const snapshot = createSnapshot();
      const targetId = activeTaskId;

      removeTaskFromState(targetId);
      metadataStore.remove(targetId);
      renderColumns();

      try {
        await deleteTask({ projectId: boardState.project.id, taskId: targetId });
        showToast('Task deleted.', 'success');
        close();
        await refreshBoardState(false);
      } catch (error) {
        restoreSnapshot(snapshot);
        renderColumns();
        focusTask(targetId);
        showToast(resolveErrorMessage(error, 'Unable to delete the task.'), 'error');
        refresh();
      }
    }

    function toInputValue(iso: string): string {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) {
        return '';
      }
      const offset = date.getTimezoneOffset();
      const local = new Date(date.getTime() - offset * 60000);
      return local.toISOString().slice(0, 16);
    }

    function fromInputValue(value: string): string | null {
      if (!value) {
        return null;
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      return date.toISOString();
    }

    return {
      open,
      close,
      refresh,
      isOpen: () => activeTaskId !== null,
      getActiveTaskId: () => activeTaskId,
    };
  }

  function createDragPreview(taskEl: HTMLLIElement): HTMLElement | null {
    const clone = taskEl.cloneNode(true) as HTMLElement;
    clone.classList.add('task', 'task--preview', 'board-task-drag-preview');
    clone.style.position = 'absolute';
    clone.style.top = '-9999px';
    clone.style.left = '-9999px';
    clone.style.width = `${taskEl.offsetWidth}px`;
    document.body.appendChild(clone);
    return clone;
  }

  function getColumnIdFromEvent(target: EventTarget | null): string | null {
    const columnEl = target instanceof HTMLElement ? target : null;
    return columnEl?.dataset.columnId ?? null;
  }

  return controller;
}

function buildBoardState(data: BoardData): BoardState {
  const sortedColumns = [...data.columns].sort((a, b) => a.position - b.position);
  const taskById = new Map<string, TaskRecord>();
  const tasksByColumn = new Map<string, TaskRecord[]>();

  data.tasks.forEach((task) => {
    const copy = { ...task };
    taskById.set(copy.id, copy);
    const bucket = tasksByColumn.get(copy.column_id) ?? [];
    bucket.push(copy);
    tasksByColumn.set(copy.column_id, bucket);
  });

  const columns: ColumnState[] = sortedColumns.map((column) => {
    const tasks = (tasksByColumn.get(column.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position);
    return {
      column: { ...column },
      tasks,
    };
  });

  return {
    project: { ...data.project },
    columns,
    taskById,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
