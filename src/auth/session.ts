import type { Session } from '@supabase/supabase-js';

import { showLoginModal } from '../ui/LoginModal';

import { supabase } from './supabase';

const AUTH_TIMEOUT_MS = 2 * 60 * 1000;

interface AuthResult {
  userId: string;
  email?: string;
}

export async function requireSession(): Promise<AuthResult> {
  const existing = await getActiveSession();
  if (existing?.user) {
    return mapSession(existing);
  }

  let modalMessage: string | undefined;

  while (true) {
    let email: string;
    try {
      email = await showLoginModal({ message: modalMessage });
    } catch {
      throw new Error(
        'Sign-in is required to continue. Refresh the page when you are ready to log in.',
      );
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (!error) {
      break;
    }

    console.warn('Supabase OTP sign-in failed', error);
    modalMessage = error.message || 'Unable to send the magic link. Please try again.';
  }

  const session = await waitForSignedInSession(AUTH_TIMEOUT_MS);
  return mapSession(session);
}

async function getActiveSession(): Promise<Session | null> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw new Error(`Unable to fetch Supabase session: ${error.message}`);
  }

  return session ?? null;
}

function waitForSignedInSession(timeoutMs: number): Promise<Session> {
  return new Promise<Session>((resolve, reject) => {
    void (async () => {
      try {
        const existing = await getActiveSession();
        if (existing?.user) {
          resolve(existing);
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
    })();

    let settled = false;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          'Timed out waiting for sign-in. Check your email for the magic link and try again.',
        ),
      );
    }, timeoutMs);

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        cleanup();
        resolve(session);
      }
    });

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      data.subscription.unsubscribe();
    };
  });
}

function mapSession(session: Session): AuthResult {
  if (!session.user) {
    throw new Error('Supabase session is missing user details.');
  }

  return {
    userId: session.user.id,
    email: session.user.email ?? undefined,
  };
}
