export type ToastType = 'success' | 'error';

const TOAST_CONTAINER_ID = 'app-toast-container';

export function showToast(message: string, type: ToastType = 'success', duration = 3200): void {
  if (!message) {
    return;
  }

  const container = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('toast--visible');
  });

  window.setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener(
      'transitionend',
      () => {
        toast.remove();
        if (container.childElementCount === 0) {
          container.remove();
        }
      },
      { once: true },
    );
  }, duration);
}

function ensureContainer(): HTMLDivElement {
  let container = document.getElementById(TOAST_CONTAINER_ID) as HTMLDivElement | null;
  if (!container) {
    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}
