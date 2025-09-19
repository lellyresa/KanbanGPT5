import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

const ModalHarness: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Edit task">
        <p data-testid="modal-content">Task body</p>
      </Modal>
      <span data-testid="modal-state">{isOpen ? 'open' : 'closed'}</span>
    </>
  );
};

describe('Modal backdrop pointer logic', () => {
  it('closes when pointer down and up both happen on the backdrop', () => {
    render(<ModalHarness />);
    const backdrop = screen.getByTestId('modal-backdrop');

    fireEvent.pointerDown(backdrop, { pointerId: 1 });
    fireEvent.pointerUp(backdrop, { pointerId: 1 });

    expect(screen.getByTestId('modal-state').textContent).toBe('closed');
  });

  it('stays open if pointer down started inside the modal and finished on backdrop', () => {
    render(<ModalHarness />);
    const dialog = screen.getByTestId('modal-dialog');
    const backdrop = screen.getByTestId('modal-backdrop');

    fireEvent.pointerDown(dialog, { pointerId: 1 });
    fireEvent.pointerUp(backdrop, { pointerId: 1 });

    expect(screen.getByTestId('modal-state').textContent).toBe('open');
  });

  it('stays open if pointer down starts on backdrop but pointer up is inside modal content', () => {
    render(<ModalHarness />);
    const dialog = screen.getByTestId('modal-dialog');
    const backdrop = screen.getByTestId('modal-backdrop');

    fireEvent.pointerDown(backdrop, { pointerId: 1 });
    fireEvent.pointerUp(dialog, { pointerId: 1 });

    expect(screen.getByTestId('modal-state').textContent).toBe('open');
  });

  it('closes on Escape key press', async () => {
    render(<ModalHarness />);
    const user = userEvent.setup();

    await user.keyboard('{Escape}');

    expect(screen.getByTestId('modal-state').textContent).toBe('closed');
  });
});
