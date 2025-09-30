import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '../auth/supabase';

export interface ProjectRecord {
  id: string;
  name: string;
  created_at?: string;
  owner_id?: string | null;
}

export interface ColumnRecord {
  id: string;
  project_id: string;
  title: string;
  position: number;
}

export interface TaskRecord {
  id: string;
  project_id: string;
  column_id: string;
  title: string;
  position: number;
  description?: string | null;
}

export interface PomodoroSettingsRecord {
  project_id: string;
  owner_id: string;
  work_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  long_break_every: number;
}

export interface PomodoroSettingsInput {
  owner_id: string;
  work_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  long_break_every: number;
}

export interface BoardData {
  project: ProjectRecord;
  columns: ColumnRecord[];
  tasks: TaskRecord[];
}

export interface CreateTaskInput {
  projectId: string;
  columnId: string;
  title: string;
  description?: string;
}

export interface MoveTaskInput {
  projectId: string;
  taskId: string;
  fromColumnId: string;
  toColumnId: string;
  newOrderInFrom: string[];
  newOrderInTo: string[];
}

export async function getMyLatestProject(): Promise<ProjectRecord | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, owner_id, created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw wrapError('Unable to load latest project', error);
  }

  if (!data || data.length === 0) {
    return null;
  }

  const [{ id, name, owner_id, created_at }] = data;

  return {
    id,
    name,
    owner_id: owner_id ?? null,
    created_at: created_at ?? undefined,
  };
}

export async function getBoard(projectId: string): Promise<BoardData> {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name, created_at, owner_id')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError) {
    throw wrapError('Unable to load project', projectError);
  }

  if (!project) {
    throw new Error('Project not found.');
  }

  const [columnsResult, tasksResult] = await Promise.all([
    supabase
      .from('columns')
      .select('id, project_id, title, position')
      .eq('project_id', projectId)
      .order('position', { ascending: true }),
    supabase
      .from('tasks')
      .select('id, project_id, column_id, title, position, description')
      .eq('project_id', projectId)
      .order('position', { ascending: true }),
  ]);

  if (columnsResult.error) {
    throw wrapError('Unable to load board columns', columnsResult.error);
  }

  if (tasksResult.error) {
    throw wrapError('Unable to load board tasks', tasksResult.error);
  }

  return {
    project,
    columns: columnsResult.data ?? [],
    tasks: tasksResult.data ?? [],
  };
}

export async function createTask({
  projectId,
  columnId,
  title,
  description,
}: CreateTaskInput): Promise<TaskRecord> {
  const { count, error: countError } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('column_id', columnId);

  if (countError) {
    throw wrapError('Unable to determine next task position', countError);
  }

  const nextPosition = (count ?? 0) + 1;

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      project_id: projectId,
      column_id: columnId,
      title,
      description: description ?? null,
      position: nextPosition,
    })
    .select('id, project_id, column_id, title, position, description')
    .single();

  if (error) {
    throw wrapError('Unable to create task', error);
  }

  return data;
}

export async function resequenceColumn(
  projectId: string,
  columnId: string,
  orderedTaskIds: string[],
): Promise<void> {
  for (let index = 0; index < orderedTaskIds.length; index++) {
    const taskId = orderedTaskIds[index];
    const { error } = await supabase
      .from('tasks')
      .update({ position: index + 1 })
      .eq('id', taskId)
      .eq('project_id', projectId)
      .eq('column_id', columnId)
      .select('id')
      .single();

    if (error) {
      throw error;
    }
  }
}

export async function moveTask({
  projectId,
  taskId,
  fromColumnId,
  toColumnId,
  newOrderInFrom,
  newOrderInTo,
}: MoveTaskInput): Promise<void> {
  if (fromColumnId !== toColumnId) {
    const { error } = await supabase
      .from('tasks')
      .update({ column_id: toColumnId })
      .eq('id', taskId)
      .eq('project_id', projectId)
      .select('id')
      .single();

    if (error) {
      throw error;
    }
  }

  await resequenceColumn(projectId, fromColumnId, newOrderInFrom);

  if (fromColumnId !== toColumnId) {
    await resequenceColumn(projectId, toColumnId, newOrderInTo);
  }
}

export async function getPomodoroSettings(
  projectId: string,
): Promise<PomodoroSettingsRecord | null> {
  const { data, error } = await supabase
    .from('pomodoro_settings')
    .select(
      'project_id, owner_id, work_minutes, short_break_minutes, long_break_minutes, long_break_every',
    )
    .eq('project_id', projectId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw wrapError('Unable to load Pomodoro settings', error);
  }

  return (data as PomodoroSettingsRecord | null) ?? null;
}

export async function upsertPomodoroSettings(
  projectId: string,
  values: PomodoroSettingsInput,
): Promise<void> {
  const payload = {
    project_id: projectId,
    ...values,
  };

  const { error } = await supabase
    .from('pomodoro_settings')
    .upsert(payload, { onConflict: 'project_id,owner_id' });

  if (error) {
    throw wrapError('Unable to save Pomodoro settings', error);
  }
}

export async function createStarterProject(ownerId: string): Promise<ProjectRecord> {
  const projectName = 'My First Board';

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ name: projectName, owner_id: ownerId })
    .select('id, name, owner_id, created_at')
    .single();

  if (projectError) {
    throw wrapError('Unable to create project', projectError);
  }

  const defaultColumns = ['To do', 'In progress', 'Done'];

  const { error: columnError } = await supabase.from('columns').insert(
    defaultColumns.map((title, index) => ({
      project_id: project.id,
      title,
      position: index + 1,
    })),
  );

  if (columnError) {
    throw wrapError('Unable to create default columns', columnError);
  }

  return project as ProjectRecord;
}

function wrapError(message: string, error: PostgrestError): Error {
  const err = new Error(`${message}: ${error.message}`);
  (err as { cause?: unknown }).cause = error;
  return err;
}
