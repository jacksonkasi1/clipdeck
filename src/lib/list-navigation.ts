export type ListKeyboardAction =
  | { type: 'select'; index: number }
  | { type: 'copy' }
  | { type: 'paste' };

/** Maps listbox keys to deterministic actions, including the Enter preference. */
export function getListKeyboardAction(
  key: string,
  selectedIndex: number,
  itemCount: number,
  pasteOnEnter: boolean,
): ListKeyboardAction | null {
  if (itemCount <= 0) return null;

  switch (key) {
    case 'ArrowDown':
      return { type: 'select', index: clampIndex(selectedIndex + 1, itemCount) };
    case 'ArrowUp':
      return { type: 'select', index: clampIndex(selectedIndex - 1, itemCount) };
    case 'Home':
      return { type: 'select', index: 0 };
    case 'End':
      return { type: 'select', index: itemCount - 1 };
    case 'PageDown':
      return { type: 'select', index: clampIndex(selectedIndex + 8, itemCount) };
    case 'PageUp':
      return { type: 'select', index: clampIndex(selectedIndex - 8, itemCount) };
    case 'Enter':
      return { type: pasteOnEnter ? 'paste' : 'copy' };
    default:
      return null;
  }
}

function clampIndex(index: number, itemCount: number): number {
  return Math.max(0, Math.min(itemCount - 1, index));
}
