import type { BoardData, ColumnRecord } from '../data/supabase';
import { createTask, getBoard } from '../data/supabase';

export function renderBoard(rootEl: HTMLElement, initialData: BoardData): void {
  let boardData = initialData;

  rootEl.innerHTML = '';
  rootEl.classList.add('board-root');

  const boardTitle = document.createElement('h1');
  boardTitle.className = 'board-title';
  boardTitle.textContent = boardData.project.name;
  rootEl.appendChild(boardTitle);

  const boardEl = document.createElement('div');
  boardEl.className = 'board-columns';
  rootEl.appendChild(boardEl);

  const renderColumns = () => {
    boardEl.innerHTML = '';

    const tasksByColumn = new Map<string, { id: string; title: string }[]>();
    for (const task of boardData.tasks) {
      const collection = tasksByColumn.get(task.column_id) ?? [];
      collection.push({ id: task.id, title: task.title });
      tasksByColumn.set(task.column_id, collection);
    }

    const sortedColumns = [...boardData.columns].sort((a, b) => a.position - b.position);

    for (const column of sortedColumns) {
      const columnEl = document.createElement('section');
      columnEl.className = 'board-column';

      const header = document.createElement('header');
      header.className = 'board-column-header';

      const heading = document.createElement('h2');
      heading.textContent = column.title;
      header.appendChild(heading);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'board-column-add';
      addButton.textContent = '+ Add task';
      addButton.addEventListener('click', () => handleAddTask(column, addButton));

      header.appendChild(addButton);
      columnEl.appendChild(header);

      const taskList = document.createElement('ul');
      taskList.className = 'board-task-list';

      const tasks = [...(tasksByColumn.get(column.id) ?? [])];
      for (const task of tasks) {
        const item = document.createElement('li');
        item.className = 'board-task';
        item.textContent = task.title;
        taskList.appendChild(item);
      }

      columnEl.appendChild(taskList);
      boardEl.appendChild(columnEl);
    }
  };

  const handleAddTask = async (column: ColumnRecord, button: HTMLButtonElement) => {
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
        projectId: boardData.project.id,
        columnId: column.id,
        title: trimmedTitle,
      });

      boardData = await getBoard(boardData.project.id);
      boardTitle.textContent = boardData.project.name;
      renderColumns();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create task.';
      window.alert(message);
    } finally {
      button.disabled = false;
      button.textContent = initialLabel;
    }
  };

  renderColumns();
}
