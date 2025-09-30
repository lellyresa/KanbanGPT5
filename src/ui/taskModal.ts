interface TaskModalOptions {
  columnTitle?: string;
  defaultTitle?: string;
}

interface TaskModalResult {
  title: string;
  description?: string;
}

const FOCUSABLE_SELECTORS = [
  'button',
  '[href]',
  'input',
  'textarea',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function showTaskModal(options: TaskModalOptions = {}): Promise<TaskModalResult> {
  return new Promise<TaskModalResult>((resolve, reject) => {
    const previousActive = document.activeElement as HTMLElement | null;

    const overlay = document.createElement('div');
    overlay.className = 'task-modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'task-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'task-modal-title');

    const title = document.createElement('h2');
    title.id = 'task-modal-title';
    title.textContent = 'New task';

    const description = document.createElement('p');
    description.id = 'task-modal-description';
    description.textContent = options.columnTitle
      ? `Add a card to “${options.columnTitle}”.`
      : 'Add a card to your board.';

    dialog.setAttribute('aria-describedby', description.id);

    const form = document.createElement('form');
    form.noValidate = true;

    const label = document.createElement('label');
    label.setAttribute('for', 'task-modal-title-input');
    label.textContent = 'Title';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'task-modal-title-input';
    input.name = 'title';
    input.placeholder = 'Describe the task';
    input.autocomplete = 'off';
    input.required = true;
    if (options.defaultTitle) {
      input.value = options.defaultTitle;
    }

    const message = document.createElement('p');
    message.className = 'task-modal-message';
    message.setAttribute('role', 'alert');
    message.style.display = 'none';

    const textareaLabel = document.createElement('label');
    textareaLabel.setAttribute('for', 'task-modal-description-input');
    textareaLabel.textContent = 'Notes (optional)';

    const textarea = document.createElement('textarea');
    textarea.id = 'task-modal-description-input';
    textarea.name = 'description';
    textarea.rows = 4;
    textarea.placeholder = 'Add details, links, or checklist items.';

    const actions = document.createElement('div');
    actions.className = 'task-modal-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.className = 'task-modal-button task-modal-button--ghost';

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = 'Add task';
    submitButton.className = 'task-modal-button task-modal-button--primary';

    actions.appendChild(cancelButton);
    actions.appendChild(submitButton);

    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(textareaLabel);
    form.appendChild(textarea);
    form.appendChild(message);
    form.appendChild(actions);

    dialog.appendChild(title);
    dialog.appendChild(description);
    dialog.appendChild(form);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const focusableElements = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);

    const cleanup = () => {
      overlay.removeEventListener('keydown', handleKeyDown, true);
      overlay.removeEventListener('click', handleOverlayClick);
      form.removeEventListener('submit', handleSubmit);
      cancelButton.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleEscape, true);
      overlay.remove();
      previousActive?.focus?.();
    };

    const closeWithReject = (reason: unknown) => {
      cleanup();
      reject(reason);
    };

    const closeWithResolve = (result: TaskModalResult) => {
      cleanup();
      resolve(result);
    };

    const setMessage = (text: string) => {
      if (!text) {
        message.style.display = 'none';
        message.textContent = '';
        return;
      }
      message.style.display = 'block';
      message.textContent = text;
    };

    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const trimmed = input.value.trim();
      if (!trimmed) {
        setMessage('Enter a task title to continue.');
        input.focus();
        return;
      }

      setMessage('');
      closeWithResolve({
        title: trimmed,
        description: textarea.value.trim() || undefined,
      });
    };

    const handleCancel = () => {
      closeWithReject(new Error('Task creation cancelled.'));
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWithReject(new Error('Task creation cancelled.'));
      }
    };

    const handleOverlayClick = (event: MouseEvent) => {
      if (event.target === overlay) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }

      const enabled = Array.from(focusableElements).filter(
        (element) => !element.hasAttribute('disabled'),
      );
      if (enabled.length === 0) {
        event.preventDefault();
        return;
      }

      const first = enabled[0];
      const last = enabled[enabled.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    overlay.addEventListener('keydown', handleKeyDown, true);
    overlay.addEventListener('click', handleOverlayClick);
    form.addEventListener('submit', handleSubmit);
    cancelButton.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleEscape, true);

    input.focus();
  });
}
