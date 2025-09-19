import React, { useState } from 'react';
import { Modal } from './Modal';

export const TaskEditorModalExample: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center gap-6">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-sky-500 px-4 py-2 font-medium text-white shadow-md hover:bg-sky-400"
      >
        New Task
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Create Task"
        size="lg"
      >
        <form className="flex flex-col gap-4" aria-label="Task editor form">
          <label className="flex flex-col text-sm font-medium text-slate-600 gap-1">
            Title
            <input
              className="rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="Add integration tests for modal"
            />
          </label>
          <label className="flex flex-col text-sm font-medium text-slate-600 gap-1">
            Description
            <textarea
              rows={4}
              className="rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="Write down acceptance criteria, owners, and checklist items."
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-sky-400"
            >
              Save Task
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
