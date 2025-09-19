import React, { ReactNode, useEffect, useRef } from 'react';

type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: ModalSize;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
}) => {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pointerDownOnBackdrop = useRef(false);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !dialogRef.current) {
      return;
    }

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    dialogRef.current.focus({ preventScroll: true });

    return () => {
      pointerDownOnBackdrop.current = false;
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  const handleBackdropPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target === backdropRef.current) {
      // Remember if the initial pointer down originated on the backdrop
      pointerDownOnBackdrop.current = true;
    } else {
      pointerDownOnBackdrop.current = false;
    }
  };

  const handleBackdropPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const releasedOnBackdrop = event.target === backdropRef.current;

    // We only close if the pointer both started and ended on the backdrop while the modal is open
    if (releasedOnBackdrop && pointerDownOnBackdrop.current && isOpen) {
      onClose();
    }

    pointerDownOnBackdrop.current = false;
  };

  const handleDialogPointerDown = () => {
    pointerDownOnBackdrop.current = false;
  };

  if (!isOpen) {
    return null;
  }

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
  }[size];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center"
      onPointerDown={handleBackdropPointerDown}
      onPointerUp={handleBackdropPointerUp}
      ref={backdropRef}
      data-testid="modal-backdrop"
      style={{
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        aria-label={title}
        className={`shadow-xl rounded-xl bg-white text-slate-900 w-full ${sizeClass}`}
        onPointerDown={handleDialogPointerDown}
        data-testid="modal-dialog"
      >
        {title ? (
          <div className="border-b border-slate-200 px-6 py-4 font-semibold text-lg">
            {title}
          </div>
        ) : null}
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
};
