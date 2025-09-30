import { getPomodoroSettings, upsertPomodoroSettings } from '../data/supabase';
import type { PomodoroSettingsRecord, PomodoroSettingsInput } from '../data/supabase';

const STORAGE_KEY_PREFIX = 'pomodoro-state';
const DEFAULT_SETTINGS: PomodoroSettingsInput = {
  owner_id: '',
  work_minutes: 25,
  short_break_minutes: 5,
  long_break_minutes: 15,
  long_break_every: 4,
};

const PHASE_NAMES: Record<Phase, string> = {
  work: 'Work',
  short: 'Short break',
  long: 'Long break',
};

type Phase = 'work' | 'short' | 'long';

const SETTINGS_FIELDS: Array<keyof PomodoroSettingsInput> = [
  'work_minutes',
  'short_break_minutes',
  'long_break_minutes',
  'long_break_every',
];

export function validatePomodoroSettings(nextSettings: PomodoroSettingsInput): void {
  for (const field of SETTINGS_FIELDS) {
    const value = nextSettings[field];
    if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value) || value <= 0) {
      throw new Error('All settings must be positive numbers.');
    }
  }
}

interface TimerState {
  phase: Phase;
  remainingSeconds: number;
  running: boolean;
  completedWorkSessions: number;
}

interface StoredState {
  phase: Phase;
  remainingSeconds: number;
  running: boolean;
  completedWorkSessions: number;
}

export async function mountPomodoro(
  root: HTMLElement,
  projectId: string,
  ownerId: string,
): Promise<void> {
  if (!root) {
    return;
  }

  const existing = root.querySelector<HTMLDivElement>(`[data-pomodoro-project='${projectId}']`);
  if (existing) {
    return;
  }

  const container = document.createElement('div');
  container.className = 'pomo-card';
  container.dataset.pomodoroProject = projectId;
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');

  root.appendChild(container);

  let todayCard = root.querySelector<HTMLDivElement>('[data-today-card="true"]');
  if (!todayCard) {
    todayCard = document.createElement('div');
    todayCard.className = 'today-card';
    todayCard.dataset.todayCard = 'true';
    root.appendChild(todayCard);
  }

  if (todayCard && !todayCard.hasChildNodes()) {
    const todayHeading = document.createElement('p');
    todayHeading.textContent = 'Today';
    todayCard.appendChild(todayHeading);
  }

  const storageKey = `${STORAGE_KEY_PREFIX}:${ownerId}:${projectId}`;

  let settings = await loadSettings();
  let timerState = initializeTimerState(settings);
  let intervalId: number | null = null;

  const headerEl = document.createElement('div');
  headerEl.className = 'pomodoro-header';

  const phaseEl = document.createElement('span');
  phaseEl.className = 'chip';

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'btn btn--ghost focus-ring';
  settingsButton.setAttribute('aria-label', 'Pomodoro settings');
  settingsButton.textContent = '⚙️';

  headerEl.appendChild(phaseEl);
  headerEl.appendChild(settingsButton);

  const timeDisplayEl = document.createElement('span');
  timeDisplayEl.className = 'pomo-time';

  const controlsEl = document.createElement('div');
  controlsEl.className = 'pomo-controls';

  const startPauseButton = document.createElement('button');
  startPauseButton.type = 'button';
  startPauseButton.className = 'btn btn--primary focus-ring';

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'btn btn--ghost focus-ring';
  resetButton.textContent = 'Reset';

  controlsEl.appendChild(startPauseButton);
  controlsEl.appendChild(resetButton);

  container.appendChild(headerEl);
  container.appendChild(timeDisplayEl);
  container.appendChild(controlsEl);

  startPauseButton.addEventListener('click', () => {
    if (timerState.running) {
      pauseTimer();
    } else {
      startTimer();
    }
  });

  resetButton.addEventListener('click', () => {
    pauseTimer();
    setPhase(timerState.phase, false);
    updateUI();
    persistState();
  });

  settingsButton.addEventListener('click', () => {
    openSettingsModal();
  });

  loadPersistedState();
  updateUI();

  if (timerState.running && timerState.remainingSeconds > 0) {
    startTimer();
  }

  function initializeTimerState(currentSettings: PomodoroSettingsInput): TimerState {
    return {
      phase: 'work',
      remainingSeconds: getPhaseDuration('work', currentSettings),
      running: false,
      completedWorkSessions: 0,
    };
  }

  async function loadSettings(): Promise<PomodoroSettingsInput> {
    try {
      const record = await getPomodoroSettings(projectId);
      if (record) {
        return normalizeRecord(record);
      }
    } catch (error) {
      console.warn('Unable to load Pomodoro settings, using defaults.', error);
    }

    return { ...DEFAULT_SETTINGS, owner_id: ownerId };
  }

  function normalizeRecord(record: PomodoroSettingsRecord): PomodoroSettingsInput {
    return {
      owner_id: record.owner_id,
      work_minutes: record.work_minutes,
      short_break_minutes: record.short_break_minutes,
      long_break_minutes: record.long_break_minutes,
      long_break_every: record.long_break_every,
    };
  }

  function loadPersistedState(): void {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<StoredState> | null;
      if (!parsed) {
        return;
      }

      if (parsed.phase && isPhase(parsed.phase)) {
        timerState.phase = parsed.phase;
      }

      const targetDuration = getPhaseDuration(timerState.phase, settings);
      if (typeof parsed.remainingSeconds === 'number' && parsed.remainingSeconds > 0) {
        timerState.remainingSeconds = Math.min(parsed.remainingSeconds, targetDuration);
      } else {
        timerState.remainingSeconds = targetDuration;
      }

      if (typeof parsed.running === 'boolean') {
        timerState.running = parsed.running;
      }

      if (typeof parsed.completedWorkSessions === 'number' && parsed.completedWorkSessions >= 0) {
        timerState.completedWorkSessions = parsed.completedWorkSessions;
      }
    } catch (error) {
      console.warn('Unable to restore Pomodoro state.', error);
    }
  }

  function persistState(): void {
    const payload: StoredState = {
      phase: timerState.phase,
      remainingSeconds: timerState.remainingSeconds,
      running: timerState.running,
      completedWorkSessions: timerState.completedWorkSessions,
    };

    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (error) {
      console.warn('Unable to persist Pomodoro state.', error);
    }
  }

  function startTimer(): void {
    if (timerState.running) {
      return;
    }

    timerState.running = true;
    updateUI();
    persistState();

    if (intervalId === null) {
      intervalId = window.setInterval(tick, 1000);
    }
  }

  function pauseTimer(): void {
    if (!timerState.running) {
      return;
    }

    timerState.running = false;
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }

    updateUI();
    persistState();
  }

  function tick(): void {
    if (!timerState.running) {
      return;
    }

    timerState.remainingSeconds -= 1;

    if (timerState.remainingSeconds <= 0) {
      timerState.remainingSeconds = 0;
      updateUI();
      persistState();
      handlePhaseComplete();
      return;
    }

    updateUI();
    persistState();
  }

  function handlePhaseComplete(): void {
    playBeep();

    if (timerState.phase === 'work') {
      timerState.completedWorkSessions += 1;
    }

    advancePhase();
    updateUI();
    persistState();
  }

  function advancePhase(): void {
    if (timerState.phase === 'work') {
      const shouldLongBreak = timerState.completedWorkSessions % settings.long_break_every === 0;
      setPhase(shouldLongBreak ? 'long' : 'short');
      return;
    }

    setPhase('work');
  }

  function setPhase(nextPhase: Phase, resetCycle = false): void {
    timerState.phase = nextPhase;
    const targetDuration = getPhaseDuration(nextPhase, settings);
    timerState.remainingSeconds = targetDuration;

    if (resetCycle && nextPhase === 'work') {
      timerState.completedWorkSessions = 0;
    }

    container.dataset.phase = nextPhase;
  }

  function updateUI(): void {
    phaseEl.textContent = PHASE_NAMES[timerState.phase];
    timeDisplayEl.textContent = formatTime(timerState.remainingSeconds);
    startPauseButton.textContent = timerState.running ? 'Pause' : 'Start';
    container.classList.toggle('is-running', timerState.running);
  }

  function getPhaseDuration(phase: Phase, currentSettings: PomodoroSettingsInput): number {
    switch (phase) {
      case 'work':
        return Math.max(1, currentSettings.work_minutes) * 60;
      case 'short':
        return Math.max(1, currentSettings.short_break_minutes) * 60;
      case 'long':
        return Math.max(1, currentSettings.long_break_minutes) * 60;
      default:
        return Math.max(1, currentSettings.work_minutes) * 60;
    }
  }

  function formatTime(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function isPhase(value: string): value is Phase {
    return value === 'work' || value === 'short' || value === 'long';
  }

  function playBeep(): void {
    try {
      const audio = new Audio(
        'data:audio/wav;base64,UklGRhQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQcAAAAA/////wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///wAAAP///w==',
      );
      audio.volume = 0.3;
      void audio.play();
    } catch (error) {
      console.debug('Pomodoro beep failed.', error);
    }
  }

  function openSettingsModal(): void {
    if (document.querySelector('.pomodoro-settings-backdrop')) {
      return;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'pomodoro-settings-backdrop';

    const modal = document.createElement('div');
    modal.className = 'pomodoro-settings-modal';

    const title = document.createElement('h2');
    title.className = 'pomodoro-settings-title';
    title.textContent = 'Pomodoro settings';

    const description = document.createElement('p');
    description.className = 'pomodoro-settings-description';
    description.textContent = 'Adjust session lengths and long break frequency.';

    const form = document.createElement('form');
    form.className = 'pomodoro-settings-form';

    const workField = createNumberField('Work minutes', settings.work_minutes, {
      min: 1,
      max: 180,
    });
    const shortField = createNumberField('Short break minutes', settings.short_break_minutes, {
      min: 1,
      max: 60,
    });
    const longField = createNumberField('Long break minutes', settings.long_break_minutes, {
      min: 1,
      max: 180,
    });
    const everyField = createNumberField('Long break every (sessions)', settings.long_break_every, {
      min: 1,
      max: 12,
    });

    const errorEl = document.createElement('p');
    errorEl.className = 'pomodoro-settings-error';
    errorEl.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'pomodoro-settings-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.textContent = 'Save';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    form.appendChild(workField.wrapper);
    form.appendChild(shortField.wrapper);
    form.appendChild(longField.wrapper);
    form.appendChild(everyField.wrapper);
    form.appendChild(errorEl);
    form.appendChild(actions);

    modal.appendChild(title);
    modal.appendChild(description);
    modal.appendChild(form);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const close = () => {
      if (backdrop.isConnected) {
        backdrop.remove();
      }
    };

    cancelBtn.addEventListener('click', () => close());
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        close();
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.hidden = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      const nextSettings: PomodoroSettingsInput = {
        owner_id: ownerId,
        work_minutes: workField.input.valueAsNumber,
        short_break_minutes: shortField.input.valueAsNumber,
        long_break_minutes: longField.input.valueAsNumber,
        long_break_every: everyField.input.valueAsNumber,
      };

      try {
        validatePomodoroSettings(nextSettings);
        await upsertPomodoroSettings(projectId, nextSettings);
        settings = nextSettings;
        normalizeTimerStateAfterSettingsChange();
        updateUI();
        persistState();
        close();
      } catch (error) {
        errorEl.textContent = resolveErrorMessage(error, 'Unable to save settings.');
        errorEl.hidden = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        return;
      }
    });
  }

  function normalizeTimerStateAfterSettingsChange(): void {
    const targetDuration = getPhaseDuration(timerState.phase, settings);
    timerState.remainingSeconds = Math.min(
      Math.max(timerState.remainingSeconds, 1),
      targetDuration,
    );
    if (timerState.remainingSeconds <= 0) {
      timerState.remainingSeconds = targetDuration;
    }
  }

  function createNumberField(
    labelText: string,
    value: number,
    options: { min?: number; max?: number },
  ): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
    const wrapper = document.createElement('label');
    wrapper.className = 'pomodoro-settings-field';
    wrapper.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'pomodoro-settings-input';
    input.value = String(value);
    if (typeof options.min === 'number') {
      input.min = String(options.min);
    }
    if (typeof options.max === 'number') {
      input.max = String(options.max);
    }

    wrapper.appendChild(input);
    return { wrapper, input };
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
}
