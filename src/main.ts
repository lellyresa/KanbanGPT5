import './style.css';

import { requireSession } from './auth/session';
import type { BoardData, ColumnRecord, ProjectRecord } from './data/supabase';
import {
  createProject,
  createStarterProject,
  getBoard,
  getMyLatestProject,
  getMyProjects,
} from './data/supabase';
import { mountPomodoro } from './features/pomodoro';
import { renderBoard, type BoardController } from './ui/Board';
import { mountDevAuthBadge } from './ui/DevAuthBadge';
import { showProjectSwitcher } from './ui/ProjectSwitcher';
import { mountOnboardingChecklist } from './ui/OnboardingChecklist';
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
  projectButton: HTMLButtonElement;
  boardTitle: HTMLHeadingElement;
  searchInput: HTMLInputElement;
  filtersHost: HTMLDivElement;
  newProjectButton: HTMLButtonElement;
}

let appShell: AppShellRefs | null = null;
let currentBoard: BoardController | null = null;
let detachColumnObserver: (() => void) | null = null;
let pendingSearchQuery = '';
let pendingColumnFilters: string[] | null = null;
let sessionDetails: SessionDetails | null = null;
let currentProject: ProjectRecord | null = null;
let currentBoardData: BoardData | null = null;
let onboardingHandle: { destroy: () => void } | null = null;

export function bootApp(rootEl: HTMLDivElement, boardData: BoardData): void {
  const shell = ensureAppShell(rootEl);
  currentBoardData = boardData;
  setActiveProject(boardData.project);
  shell.boardTitle.textContent = boardData.project.name;
  detachColumnObserver?.();
  detachColumnObserver = null;

  currentBoard = renderBoard(shell.boardRoot, boardData);
  applyPendingSearch(shell, currentBoard);
  configureBoardFilters(shell, currentBoard);
  mountOnboarding(boardData.project.id);
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
    sessionDetails = session;

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
  currentBoard = null;
  currentBoardData = null;
  teardownOnboarding();
  detachColumnObserver?.();
  detachColumnObserver = null;
  shell.filtersHost.innerHTML = '';
  shell.boardTitle.textContent = 'Create your first board';
  shell.boardRoot.innerHTML = '';
  setActiveProject(null);

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

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'btn btn--ghost focus-ring';
  importButton.textContent = 'Import board';
  importButton.addEventListener('click', () => {
    openProjectSwitcher();
  });

  emptyColumn.appendChild(heading);
  emptyColumn.appendChild(message);
  emptyColumn.appendChild(action);
  emptyColumn.appendChild(importButton);
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
  currentBoard = null;
  currentBoardData = null;
  teardownOnboarding();
  detachColumnObserver?.();
  detachColumnObserver = null;
  shell.filtersHost.innerHTML = '';
  shell.boardTitle.textContent = 'Something went wrong';
  shell.boardRoot.innerHTML = '';
  setActiveProject(null);
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

  const projectButton = document.createElement('button');
  projectButton.type = 'button';
  projectButton.className = 'pill focus-ring';
  projectButton.dataset.projectButton = 'true';
  projectButton.textContent = 'Boards';
  projectButton.setAttribute('aria-haspopup', 'dialog');
  projectButton.setAttribute('aria-label', 'Open board switcher');
  projectButton.addEventListener('click', openProjectSwitcher);
  brandGroup.appendChild(projectButton);

  topbar.appendChild(brandGroup);

  const searchGroup = document.createElement('div');
  searchGroup.className = 'search-group';
  topbar.appendChild(searchGroup);

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search tasks';
  search.className = 'search focus-ring';
  search.setAttribute('aria-label', 'Search tasks');
  search.value = pendingSearchQuery;
  search.addEventListener('input', handleSearchInput);
  search.addEventListener('search', handleSearchInput);
  searchGroup.appendChild(search);

  const filtersHost = document.createElement('div');
  filtersHost.className = 'topbar-filters';
  filtersHost.setAttribute('role', 'group');
  filtersHost.setAttribute('aria-label', 'Filter columns');
  searchGroup.appendChild(filtersHost);

  const actionsGroup = document.createElement('div');
  actionsGroup.className = 'topbar-actions';

  const newProjectButton = document.createElement('button');
  newProjectButton.type = 'button';
  newProjectButton.className = 'icon-btn focus-ring';
  newProjectButton.textContent = '+';
  newProjectButton.setAttribute('aria-label', 'Create project');
  newProjectButton.title = 'Create project';
  newProjectButton.addEventListener('click', openProjectSwitcher);
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
    projectButton,
    boardTitle,
    searchInput: search,
    filtersHost,
    newProjectButton,
  };

  return appShell;
}

function setActiveProject(project: ProjectRecord | null): void {
  currentProject = project ?? null;
  if (!appShell) {
    return;
  }

  const { projectButton } = appShell;
  if (project) {
    projectButton.textContent = project.name;
    projectButton.classList.add('pill--active');
    projectButton.setAttribute(
      'aria-label',
      `Open board switcher. Current board: ${project.name}`,
    );
    projectButton.dataset.projectId = project.id;
  } else {
    projectButton.textContent = 'Boards';
    projectButton.classList.remove('pill--active');
    projectButton.setAttribute('aria-label', 'Open board switcher');
    delete projectButton.dataset.projectId;
  }
}

function handleSearchInput(event: Event): void {
  const input = event.currentTarget as HTMLInputElement | null;
  if (!input) {
    return;
  }

  pendingSearchQuery = input.value;
  currentBoard?.setSearchQuery(pendingSearchQuery);
}

function applyPendingSearch(shell: AppShellRefs, controller: BoardController): void {
  shell.searchInput.value = pendingSearchQuery;
  controller.setSearchQuery(pendingSearchQuery);
}

function configureBoardFilters(shell: AppShellRefs, controller: BoardController): void {
  const host = shell.filtersHost;
  const buttonByColumn = new Map<string, HTMLButtonElement>();
  let allButton: HTMLButtonElement | null = null;

  const toggleButtonState = (button: HTMLButtonElement | null, active: boolean) => {
    if (!button) {
      return;
    }
    button.classList.toggle('pill--active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  };

  const updateActiveStates = () => {
    const { columnIds } = controller.getFilterState();
    const activeSet = new Set(columnIds);
    const hasSpecific = activeSet.size > 0;
    toggleButtonState(allButton, !hasSpecific);
    buttonByColumn.forEach((button, columnId) => {
      toggleButtonState(button, activeSet.has(columnId));
    });
  };

  const handleAllClick = () => {
    pendingColumnFilters = null;
    controller.setColumnFilter(null);
    const applied = controller.getFilterState().columnIds;
    pendingColumnFilters = applied.length > 0 ? [...applied] : null;
    updateActiveStates();
  };

  const handleColumnClick = (columnId: string) => {
    const { columnIds } = controller.getFilterState();
    const next = new Set(columnIds);
    if (next.has(columnId)) {
      next.delete(columnId);
    } else {
      next.add(columnId);
    }
    const updated = next.size > 0 ? Array.from(next) : null;
    controller.setColumnFilter(updated);
    const applied = controller.getFilterState().columnIds;
    pendingColumnFilters = applied.length > 0 ? [...applied] : null;
    updateActiveStates();
  };

  const buildButtons = (columns: ColumnRecord[]) => {
    buttonByColumn.clear();
    host.innerHTML = '';

    allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.className = 'pill focus-ring';
    allButton.textContent = 'All columns';
    allButton.setAttribute('aria-pressed', 'true');
    allButton.addEventListener('click', handleAllClick);
    host.appendChild(allButton);

    columns.forEach((column) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pill focus-ring';
      button.textContent = column.title;
      button.dataset.columnId = column.id;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => handleColumnClick(column.id));
      buttonByColumn.set(column.id, button);
      host.appendChild(button);
    });
  };

  const initialColumns = controller.getColumns();
  buildButtons(initialColumns);
  applyPendingColumnFilters(controller, initialColumns);
  updateActiveStates();

  detachColumnObserver?.();
  detachColumnObserver = controller.onColumnsChange((columns) => {
    buildButtons(columns);
    applyPendingColumnFilters(controller, columns);
    updateActiveStates();
  });
}

function applyPendingColumnFilters(
  controller: BoardController,
  columns: ColumnRecord[],
): void {
  if (!pendingColumnFilters || pendingColumnFilters.length === 0) {
    pendingColumnFilters = null;
    controller.setColumnFilter(null);
    return;
  }

  const allowed = new Set(columns.map((column) => column.id));
  const next = pendingColumnFilters.filter((identifier) => allowed.has(identifier));

  if (next.length === 0) {
    pendingColumnFilters = null;
    controller.setColumnFilter(null);
    return;
  }

  controller.setColumnFilter(next);
  const applied = controller.getFilterState().columnIds;
  pendingColumnFilters = applied.length > 0 ? [...applied] : null;
}

function mountOnboarding(projectId: string): void {
  if (!appShell || !currentBoard) {
    return;
  }

  teardownOnboarding();
  onboardingHandle = mountOnboardingChecklist(appShell.pomodoroHost, currentBoard, projectId);
}

function teardownOnboarding(): void {
  onboardingHandle?.destroy();
  onboardingHandle = null;
}

function openProjectSwitcher(): void {
  if (!sessionDetails) {
    showToast('Sign in to manage your boards.', 'error');
    return;
  }

  if (!appRoot) {
    return;
  }

  const { userId } = sessionDetails;
  const activeProject = currentProject ?? currentBoardData?.project ?? null;

  showProjectSwitcher({
    currentProjectId: activeProject?.id,
    loadProjects: async () => {
      const projects = await getMyProjects(userId, 100);
      if (activeProject && !projects.some((project) => project.id === activeProject.id)) {
        return [activeProject, ...projects];
      }
      return projects;
    },
    onSelectProject: async (projectId) => {
      if (!sessionDetails) {
        throw new Error('Sign-in expired. Please refresh.');
      }

      const loaded = await loadBoardIntoApp(appRoot, projectId, sessionDetails);
      if (!loaded) {
        throw new Error('Unable to switch to that board right now.');
      }
      showToast('Board switched.', 'success');
    },
    onCreateProject: async ({ name, template }) => {
      if (!sessionDetails) {
        throw new Error('Sign-in expired. Please refresh.');
      }

      const trimmedName = name.trim() || 'Untitled board';
      const project =
        template === 'starter'
          ? await createStarterProject(sessionDetails.userId, trimmedName)
          : await createProject(sessionDetails.userId, trimmedName);

      const loaded = await loadBoardIntoApp(appRoot, project.id, sessionDetails);
      if (!loaded) {
        throw new Error('Board created but failed to load. Try again.');
      }
      showToast('Board created.', 'success');
      return project;
    },
    onImportProject: async (projectId) => {
      if (!sessionDetails) {
        throw new Error('Sign-in expired. Please refresh.');
      }

      const loaded = await loadBoardIntoApp(appRoot, projectId, sessionDetails);
      if (!loaded) {
        throw new Error('Unable to import that board. Check the ID and try again.');
      }
      showToast('Board loaded.', 'success');
    },
  });
}
