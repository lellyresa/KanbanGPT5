interface LoginModalOptions {
  message?: string;
}

const FOCUSABLE_SELECTORS = [
  'button',
  '[href]',
  'input',
  'select',
  'textarea',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function showLoginModal(options: LoginModalOptions = {}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const previousActive = document.activeElement as HTMLElement | null;

    const overlay = document.createElement('div');
    overlay.className = 'login-modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'login-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'login-modal-title');

    const title = document.createElement('h2');
    title.id = 'login-modal-title';
    title.textContent = 'Sign in';

    const description = document.createElement('p');
    description.id = 'login-modal-description';
    description.textContent = 'Enter your email to receive a magic link.';

    dialog.setAttribute('aria-describedby', description.id);

    const form = document.createElement('form');
    form.noValidate = true;

    const label = document.createElement('label');
    label.setAttribute('for', 'login-email-input');
    label.textContent = 'Email';

    const input = document.createElement('input');
    input.type = 'email';
    input.id = 'login-email-input';
    input.name = 'email';
    input.placeholder = 'you@example.com';
    input.autocomplete = 'email';
    input.required = true;

    const message = document.createElement('p');
    message.className = 'login-modal-message';
    message.setAttribute('role', 'alert');
    if (options.message) {
      message.textContent = options.message;
    } else {
      message.textContent = '';
      message.style.display = 'none';
    }

    const actions = document.createElement('div');
    actions.className = 'login-modal-actions';

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = 'Send magic link';

    actions.appendChild(submitButton);

    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(message);
    form.appendChild(actions);

    dialog.appendChild(title);
    dialog.appendChild(description);
    dialog.appendChild(form);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = () => {
      overlay.removeEventListener('keydown', handleKeyDown, true);
      form.removeEventListener('submit', handleSubmit);
      document.removeEventListener('keydown', handleEscape, true);
      overlay.remove();
      if (previousActive) {
        previousActive.focus();
      }
    };

    const closeWithRejection = (reason: unknown) => {
      cleanup();
      reject(reason);
    };

    const closeWithResolve = (emailValue: string) => {
      cleanup();
      resolve(emailValue);
    };

    const focusableElements = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }

      const focusable = Array.from(focusableElements).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

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

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWithRejection(new Error('Login cancelled by user.'));
      }
    };

    const setMessage = (text: string) => {
      message.textContent = text;
      message.style.display = text ? 'block' : 'none';
    };

    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const emailValue = input.value.trim();

      if (!emailValue) {
        setMessage('Please enter your email address.');
        input.focus();
        return;
      }

      if (!input.checkValidity()) {
        setMessage('Enter a valid email address.');
        input.focus();
        return;
      }

      setMessage('');
      closeWithResolve(emailValue);
    };

    overlay.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', handleEscape, true);
    form.addEventListener('submit', handleSubmit);

    // Prevent pointer events on the background from triggering.
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    input.focus();
  });
}
