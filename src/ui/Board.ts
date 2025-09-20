import type { BoardData, ColumnRecord, TaskRecord } from '../data/supabase';
import { createTask, getBoard, moveTask } from '../data/supabase';

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

const TOAST_HOST_ID = 'board-toast-container';

export function renderBoard(rootEl: HTMLElement, initialData: BoardData): void {
  rootEl.innerHTML = '';
  rootEl.classList.add('board-root');

  let boardState = buildBoardState(initialData);
  const columnLookup = new Map<string, ColumnState>();
  let columnOrder: string[] = [];

  const boardTitle = document.createElement('h1');
  boardTitle.className = 'board-title';
  boardTitle.textContent = boardState.project.name;
  rootEl.appendChild(boardTitle);

  const boardEl = document.createElement('div');
  boardEl.className = 'board-columns';
  rootEl.appendChild(boardEl);

  const toastHost = ensureToastHost();

  let pointerDrag: PointerDragState | null = null;
  let keyboardDrag: KeyboardDragState | null = null;
  let activeDropColumnId: string | null = null;
  let keyboardHintShown = false;

  rebuildColumnLookup();
  renderColumns();

  function rebuildColumnLookup(): void {
    columnLookup.clear();
    boardState.columns.forEach((columnState) => {
      columnLookup.set(columnState.column.id, columnState);
    });
    columnOrder = boardState.columns.map((columnState) => columnState.column.id);
  }

  function renderColumns(): void {
    boardTitle.textContent = boardState.project.name;
    boardEl.innerHTML = '';

    if (boardState.columns.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'app-shell empty';
      const heading = document.createElement('h2');
      heading.textContent = 'No columns yet';
      const copy = document.createElement('p');
      copy.textContent = 'Create columns in Supabase to start managing tasks.';
      empty.appendChild(heading);
      empty.appendChild(copy);
      boardEl.appendChild(empty);
      setDropTarget(null);
      return;
    }

    for (const columnState of boardState.columns) {
      const columnEl = document.createElement('section');
      columnEl.className = 'board-column';
      columnEl.dataset.columnId = columnState.column.id;

      columnEl.addEventListener('dragover', handleColumnDragOver);
      columnEl.addEventListener('dragenter', handleColumnDragEnter);
      columnEl.addEventListener('dragleave', handleColumnDragLeave);
      columnEl.addEventListener('drop', handleColumnDrop);

      const header = document.createElement('header');
      header.className = 'board-column-header';

      const heading = document.createElement('h2');
      heading.id = `column-${columnState.column.id}`;
      heading.textContent = columnState.column.title;
      header.appendChild(heading);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'board-column-add';
      addButton.textContent = '+ Add task';
      addButton.addEventListener('click', () => handleAddTask(columnState.column, addButton));

      header.appendChild(addButton);
      columnEl.appendChild(header);

      const taskList = document.createElement('ul');
      taskList.className = 'board-task-list';
      taskList.setAttribute('role', 'list');
      taskList.setAttribute('aria-labelledby', heading.id);

      renderTaskList(columnState, taskList);
      columnEl.appendChild(taskList);
      boardEl.appendChild(columnEl);
    }

    if (keyboardDrag) {
      const remembered = keyboardDrag.currentColumnId;
      activeDropColumnId = null;
      setDropTarget(remembered);
      focusTask(keyboardDrag.taskId);
    }
  }

  function renderTaskList(columnState: ColumnState, taskList: HTMLUListElement): void {
    taskList.innerHTML = '';

    columnState.tasks.forEach((task) => {
      const item = document.createElement('li');
      item.className = 'board-task';
      item.draggable = true;
      item.tabIndex = 0;
      item.dataset.taskId = task.id;
      item.dataset.columnId = columnState.column.id;
      item.setAttribute('role', 'listitem');
      item.setAttribute('aria-grabbed', keyboardDrag?.taskId === task.id ? 'true' : 'false');
      item.textContent = task.title;

      if (keyboardDrag?.taskId === task.id) {
        item.classList.add('is-dragging', 'is-keyboard-dragging');
      }

      item.addEventListener('dragstart', handleTaskDragStart);
      item.addEventListener('dragend', handleTaskDragEnd);
      item.addEventListener('keydown', handleTaskKeydown);

      taskList.appendChild(item);
    });
  }

  async function handleAddTask(column: ColumnRecord, button: HTMLButtonElement): Promise<void> {
    const taskTitle = window.prompt('Task title');
    if (!taskTitle) {
      return;
    }

    const trimmedTitle = taskTitle.trim();
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
      });

      await refreshBoardState();
    } catch (error) {
      const message = resolveErrorMessage(error, 'Failed to create task.');
      showToast(message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = initialLabel;
    }
  }

  async function refreshBoardState(): Promise<void> {
    const fresh = await getBoard(boardState.project.id);
    boardState = buildBoardState(fresh);
    rebuildColumnLookup();
    renderColumns();
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

    const list = columnEl.querySelector<HTMLUListElement>('.board-task-list');
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
      showToast('Use arrow keys to move, Space to drop, Escape to cancel.', 'info', 2600, true);
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

    const { taskId, fromColumnId, fromIndex, currentColumnId, currentIndex, snapshot } = keyboardDrag;
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

  function moveTaskInState(taskId: string, targetColumnId: string, requestedIndex: number): MoveResult | null {
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

  function getDropIndex(
    list: HTMLUListElement | null,
    clientY: number,
    draggingTaskId: string,
  ): number {
    if (!list) {
      return 0;
    }

    const items = Array.from(list.querySelectorAll<HTMLLIElement>('.board-task'));
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
      const previous = rootEl.querySelector<HTMLElement>(`[data-column-id="${activeDropColumnId}"]`);
      previous?.classList.remove('is-drop-target');
    }

    activeDropColumnId = columnId;

    if (columnId) {
      const next = rootEl.querySelector<HTMLElement>(`[data-column-id="${columnId}"]`);
      next?.classList.add('is-drop-target');
    }
  }

  function createDragPreview(taskEl: HTMLLIElement): HTMLElement | null {
    const clone = taskEl.cloneNode(true) as HTMLElement;
    clone.classList.add('board-task-drag-preview');
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

  function showToast(
    message: string,
    type: 'info' | 'error' = 'info',
    duration = 3200,
    replace = false,
  ): void {
    if (replace) {
      toastHost.querySelectorAll('.toast').forEach((toast) => toast.remove());
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast--error' : 'toast--info'}`;
    toast.textContent = message;
    toastHost.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });

    window.setTimeout(() => {
      toast.classList.remove('is-visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, duration);
  }
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

function ensureToastHost(): HTMLDivElement {
  let host = document.querySelector<HTMLDivElement>(`#${TOAST_HOST_ID}`);
  if (!host) {
    host = document.createElement('div');
    host.id = TOAST_HOST_ID;
    host.className = 'toast-container';
    document.body.appendChild(host);
  }
  return host;
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
