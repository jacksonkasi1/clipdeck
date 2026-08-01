// ** import lib
//
// Tiny toast surface. Stack of one-liners that fade after a few seconds,
// rendered through a portal at document.body. No dependencies.

import { createElement, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: 'info' | 'error';
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
}

const TOAST_LIFETIME_MS = 4_000;

let nextId = 1;
const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'info') => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) }));
    }, TOAST_LIFETIME_MS);
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) })),
}));

export function toast(message: string, tone: Toast['tone'] = 'info'): void {
  useToastStore.getState().push(message, tone);
}

export function ToastSurface() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.body);
  }, []);

  if (!host) return null;
  return createPortal(
    createElement(
      'div',
      { className: 'toast-surface', role: 'status', 'aria-live': 'polite' },
      ...toasts.map((entry) =>
        createElement(
          'button',
          {
            key: entry.id,
            type: 'button',
            className: `toast is-${entry.tone}`,
            onClick: () => dismiss(entry.id),
          },
          entry.message,
        ),
      ),
    ),
    host,
  );
}
