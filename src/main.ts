import './style.css';
import { requireSession } from './auth/session';
import type { BoardData } from './data/supabase';
import { getBoard, getMyLatestProject } from './data/supabase';
import { renderBoard } from './ui/Board';

interface SessionDetails {
  userId: string;
  email?: string;
}

export function bootApp(rootEl: HTMLDivElement, boardData: BoardData): void {
  renderBoard(rootEl, boardData);
}

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (appRoot) {
  appRoot.textContent = 'Checking authentication…';
}

void (async () => {
  try {
    const session = await requireSession();
    if (!appRoot) {
      return;
    }

    const project = await getMyLatestProject();
    if (!project) {
      showEmptyState(appRoot, session);
      return;
    }

    appRoot.textContent = `Loading ${project.name}…`;

    const board = await getBoard(project.id);
    bootApp(appRoot, board);
  } catch (error) {
    if (appRoot) {
      const message = error instanceof Error ? error.message : 'Unable to sign in.';
      showError(appRoot, message);
    }
    console.error('App bootstrap failed', error);
  }
})();

function showEmptyState(rootEl: HTMLDivElement, session: SessionDetails): void {
  rootEl.innerHTML = '';

  const container = document.createElement('main');
  container.className = 'app-shell empty';

  const heading = document.createElement('h1');
  heading.textContent = session.email ? `Welcome, ${session.email}` : 'Welcome';

  const message = document.createElement('p');
  message.textContent = 'Create a project with columns and tasks in Supabase to view your board here.';

  container.appendChild(heading);
  container.appendChild(message);
  rootEl.appendChild(container);
}

function showError(rootEl: HTMLDivElement, message: string): void {
  rootEl.innerHTML = '';
  const errorEl = document.createElement('div');
  errorEl.className = 'app-error';
  errorEl.textContent = message;
  rootEl.appendChild(errorEl);
}
