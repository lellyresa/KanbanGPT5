import './style.css';

import { requireSession } from './auth/session';
import type { BoardData } from './data/supabase';
import { createStarterProject, getBoard, getMyLatestProject } from './data/supabase';
import { mountPomodoro } from './features/pomodoro';
import { renderBoard } from './ui/Board';
import { mountDevAuthBadge } from './ui/DevAuthBadge';
import { showToast } from './ui/toast';
import { resolveErrorMessage } from './utils/errors';
import './auth/devProbe';


interface SessionDetails {
  userId: string;
  email?: string;
}

interface AppShellRefs {
  boardRoot: HTMLElement;
  pomodoroHost: HTMLElement;
  projectChip: HTMLSpanElement;
  boardTitle: HTMLHeadingElement;
}

let appShell: AppShellRefs | null = null;

export function bootApp(rootEl: HTMLDivElement, boardData: BoardData): void {
  const shell = ensureAppShell(rootEl);
  shell.projectChip.textContent = boardData.project.name;
  shell.boardTitle.textContent = boardData.project.name;
  renderBoard(shell.boardRoot, boardData);
}

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (appRoot) {
  showLoadingSkeleton(appRoot);
}

void (async () => {
  if (!appRoot) {
    return;
  }

  try {
    const session = await requireSession();

    let project = null;
    try {
      project = await getMyLatestProject();
    } catch (error) {
      const message = resolveErrorMessage(error, 'Failed to load projects.');
      showToast(message, 'error');
      showError(appRoot, message);
      console.error('Failed to load latest project', error);
      return;
    }

    if (!project) {
      showEmptyState(appRoot, session);
      return;
    }

    await loadBoardIntoApp(appRoot, project.id, session);
  } catch (error) {
    const message = resolveErrorMessage(error, 'Unable to sign in.');
    showToast(message, 'error');
    if (appRoot) {
      showError(appRoot, message);
    }
    console.error('App bootstrap failed', error);
  }
})();

async function loadBoardIntoApp(
  rootEl: HTMLDivElement,
  projectId: string,
  session: SessionDetails,
): Promise<boolean> {
  showLoadingSkeleton(rootEl);

  try {
    const board = await getBoard(projectId);
    bootApp(rootEl, board);
    const shell = ensureAppShell(rootEl);
    void mountPomodoro(shell.pomodoroHost, projectId, session.userId);
    if (import.meta.env.DEV && session.email) {
      mountDevAuthBadge(document.body, session.email);
    }
    return true;
  } catch (error) {
    const message = resolveErrorMessage(error, 'Failed to load board.');
    showToast(message, 'error');
    showError(rootEl, message);
    console.error('Failed to load board', error);
    return false;
  }
}

function showEmptyState(rootEl: HTMLDivElement, session: SessionDetails): void {
  const shell = ensureAppShell(rootEl);
  shell.boardTitle.textContent = 'Create your first board';
  shell.boardRoot.innerHTML = '';

  const emptyColumn = document.createElement('section');
  emptyColumn.className = 'column';

  const heading = document.createElement('h2');
  heading.textContent = 'Create your first board';

  const message = document.createElement('p');
  message.textContent = session.email
    ? `${session.email}, let’s start with a starter Kanban board.`
    : 'Begin with a starter Kanban board to organize your tasks.';

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'btn btn--primary focus-ring';
  action.textContent = 'Create board';
  action.addEventListener('click', () => {
    void handleCreateFirstBoard(action, rootEl, session);
  });

  emptyColumn.appendChild(heading);
  emptyColumn.appendChild(message);
  emptyColumn.appendChild(action);
  shell.boardRoot.appendChild(emptyColumn);
}

async function handleCreateFirstBoard(
  button: HTMLButtonElement,
  rootEl: HTMLDivElement,
  session: SessionDetails,
): Promise<void> {
  const originalText = button.textContent ?? 'Create board';
  button.disabled = true;
  button.textContent = 'Creating…';

  try {
    const project = await createStarterProject(session.userId);
    showToast('Board created successfully.', 'success');
    const loaded = await loadBoardIntoApp(rootEl, project.id, session);
    if (!loaded) {
      button.disabled = false;
      button.textContent = originalText;
    }
  } catch (error) {
    const message = resolveErrorMessage(error, 'Unable to create board.');
    showToast(message, 'error');
    console.error('Failed to create starter project', error);
    button.disabled = false;
    button.textContent = originalText;
  }
}

function showError(rootEl: HTMLDivElement, message: string): void {
  const shell = ensureAppShell(rootEl);
  shell.boardTitle.textContent = 'Something went wrong';
  shell.boardRoot.innerHTML = '';
  const errorEl = document.createElement('section');
  errorEl.className = 'column';
  errorEl.textContent = message;
  shell.boardRoot.appendChild(errorEl);
}

function showLoadingSkeleton(rootEl: HTMLDivElement, columnCount = 3): void {
  const shell = ensureAppShell(rootEl);
  shell.boardTitle.textContent = 'Loading board…';
  shell.boardRoot.innerHTML = '';

  for (let index = 0; index < columnCount; index++) {
    const placeholder = document.createElement('section');
    placeholder.className = 'column';
    placeholder.style.minHeight = '200px';
    shell.boardRoot.appendChild(placeholder);
  }
}

function ensureAppShell(rootEl: HTMLDivElement): AppShellRefs {
  if (appShell && rootEl.contains(appShell.boardRoot)) {
    return appShell;
  }

  rootEl.innerHTML = '';

  const shellContainer = document.createElement('div');
  shellContainer.className = 'app-shell';
  rootEl.appendChild(shellContainer);

  const topbar = document.createElement('header');
  topbar.className = 'topbar';
  shellContainer.appendChild(topbar);

  const brandGroup = document.createElement('div');
  brandGroup.className = 'brand';

  const brandLabel = document.createElement('span');
  brandLabel.textContent = 'Kanban';
  brandGroup.appendChild(brandLabel);

  const overviewChip = document.createElement('button');
  overviewChip.type = 'button';
  overviewChip.className = 'pill focus-ring';
  overviewChip.textContent = 'Overview';
  brandGroup.appendChild(overviewChip);

  const projectChip = document.createElement('span');
  projectChip.className = 'pill pill--active';
  projectChip.dataset.projectChip = 'true';
  projectChip.textContent = 'Project';
  projectChip.setAttribute('aria-current', 'page');
  brandGroup.appendChild(projectChip);

  topbar.appendChild(brandGroup);

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search tasks';
  search.className = 'search focus-ring';
  search.setAttribute('aria-label', 'Search tasks');
  topbar.appendChild(search);

  const actionsGroup = document.createElement('div');
  actionsGroup.className = 'brand';

  const newProjectButton = document.createElement('button');
  newProjectButton.type = 'button';
  newProjectButton.className = 'icon-btn focus-ring';
  newProjectButton.textContent = '+';
  newProjectButton.setAttribute('aria-label', 'Create project');
  newProjectButton.title = 'Create project';
  actionsGroup.appendChild(newProjectButton);

  topbar.appendChild(actionsGroup);

  const boardContainer = document.createElement('div');
  boardContainer.className = 'container';
  rootEl.appendChild(boardContainer);

  const boardHeader = document.createElement('div');
  boardHeader.className = 'board-header';
  boardContainer.appendChild(boardHeader);

  const boardTitle = document.createElement('h1');
  boardTitle.className = 'board-title';
  boardHeader.appendChild(boardTitle);

  const grid = document.createElement('div');
  grid.className = 'grid-boards';
  boardContainer.appendChild(grid);

  const boardRoot = document.createElement('div');
  boardRoot.dataset.boardRoot = 'true';
  boardRoot.style.display = 'contents';
  grid.appendChild(boardRoot);

  const rightRail = document.createElement('aside');
  rightRail.className = 'right-rail';
  grid.appendChild(rightRail);

  appShell = {
    boardRoot,
    pomodoroHost: rightRail,
    projectChip,
    boardTitle,
  };

  return appShell;
}
