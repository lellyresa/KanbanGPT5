import { supabase } from '../auth/supabase';

const BADGE_ID = 'dev-auth-badge';
const STYLE_ID = 'dev-auth-badge-style';

export function mountDevAuthBadge(root: HTMLElement, email: string): void {
  if (!root || !email) {
    return;
  }

  ensureStyles();

  let badge = document.getElementById(BADGE_ID) as HTMLDivElement | null;
  if (!badge) {
    badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.className = 'dev-auth-badge';
    root.appendChild(badge);
  }

  badge.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'dev-auth-badge__label';
  label.textContent = `Signed in as ${email}`;

  const separator = document.createElement('span');
  separator.className = 'dev-auth-badge__separator';
  separator.textContent = ' · ';

  const signOutButton = document.createElement('button');
  signOutButton.type = 'button';
  signOutButton.className = 'dev-auth-badge__button';
  signOutButton.textContent = 'Sign out';
  signOutButton.addEventListener('click', handleSignOut, { once: true });

  badge.appendChild(label);
  badge.appendChild(separator);
  badge.appendChild(signOutButton);
}

async function handleSignOut(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.warn('Supabase sign-out failed', error);
  } finally {
    window.location.reload();
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .dev-auth-badge {
      position: fixed;
      left: var(--space-4);
      bottom: var(--space-4);
      background: color-mix(in srgb, var(--color-surface) 80%, var(--color-bg));
      color: var(--color-text);
      border-radius: var(--r-lg);
      padding: 0.5rem 0.85rem;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      border: 1px solid var(--color-border);
      box-shadow: var(--shadow-2);
      z-index: 1500;
      font-weight: 500;
      backdrop-filter: blur(6px);
    }

    .dev-auth-badge__button {
      background: none;
      border: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      text-decoration: underline;
      padding: 0;
    }

    .dev-auth-badge__button:hover,
    .dev-auth-badge__button:focus-visible {
      text-decoration: none;
      outline: none;
      color: color-mix(in srgb, var(--color-brand) 80%, currentColor);
    }
  `;

  document.head.appendChild(style);
}
