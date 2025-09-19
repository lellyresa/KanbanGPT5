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

export interface BoardData {
  project: ProjectRecord;
  columns: ColumnRecord[];
  tasks: TaskRecord[];
}

export interface CreateTaskInput {
  projectId: string;
  columnId: string;
  title: string;
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

export async function createTask({ projectId, columnId, title }: CreateTaskInput): Promise<TaskRecord> {
  const { data: existing, error: lookupError } = await supabase
    .from('tasks')
    .select('position')
    .eq('column_id', columnId)
    .order('position', { ascending: false })
    .limit(1);

  if (lookupError) {
    throw wrapError('Unable to determine next task position', lookupError);
  }

  const nextPosition = (existing?.[0]?.position ?? 0) + 1;

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      project_id: projectId,
      column_id: columnId,
      title,
      position: nextPosition,
    })
    .select('id, project_id, column_id, title, position, description')
    .single();

  if (error) {
    throw wrapError('Unable to create task', error);
  }

  return data;
}

function wrapError(message: string, error: PostgrestError): Error {
  const err = new Error(`${message}: ${error.message}`);
  (err as { cause?: unknown }).cause = error;
  return err;
}
