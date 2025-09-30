import { describe, expect, it } from 'vitest';

import type { PomodoroSettingsInput } from '../../data/supabase';
import { validatePomodoroSettings } from '../pomodoro';

describe('validatePomodoroSettings', () => {
  const baseSettings: PomodoroSettingsInput = {
    owner_id: 'owner',
    work_minutes: 25,
    short_break_minutes: 5,
    long_break_minutes: 15,
    long_break_every: 4,
  };

  it('accepts positive numeric values', () => {
    expect(() => validatePomodoroSettings(baseSettings)).not.toThrow();
  });

  it('rejects zero or negative values', () => {
    expect(() =>
      validatePomodoroSettings({
        ...baseSettings,
        work_minutes: 0,
      }),
    ).toThrow();

    expect(() =>
      validatePomodoroSettings({
        ...baseSettings,
        short_break_minutes: -1,
      }),
    ).toThrow();
  });

  it('rejects non-numeric values', () => {
    expect(() =>
      validatePomodoroSettings({
        ...baseSettings,
        long_break_every: Number.NaN,
      }),
    ).toThrow();
  });
});
