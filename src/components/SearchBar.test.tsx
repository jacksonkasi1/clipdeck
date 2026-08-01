/** @vitest-environment jsdom */
// ** import lib
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  listItems: vi.fn(async () => []),
  counts: vi.fn(async () => ({ all: 0, text: 0, link: 0, email: 0, color: 0, image: 0, files: 0, favorites: 0 })),
  hideWindow: vi.fn(async () => undefined),
  setAlwaysOnTop: vi.fn(async () => undefined),
  setQuickPinned: vi.fn(async () => undefined),
  openSettingsWindow: vi.fn(async () => undefined),
}));

vi.mock('../lib/tauri', () => ({
  api: apiMock,
  on: async () => () => undefined,
  fileSrc: (path: string) => `asset://${path}`,
}));

import { SearchBar } from './SearchBar';
import { useStore } from '../lib/store';

function setMode(mode: 'quick' | 'full') {
  useStore.setState({ mode, search: '', showPreview: false, showCommands: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  setMode('full');
});

afterEach(cleanup);

describe('SearchBar header', () => {
  it('renders the search input directly in the header, with no inner input card', () => {
    const { container } = render(<SearchBar />);

    // The old design nested a bordered `.search-field` box inside the header.
    // The header element itself is now the search surface.
    expect(container.querySelector('.search-field')).toBeNull();
    const header = container.querySelector('header.search-header');
    expect(header).not.toBeNull();
    expect(header?.querySelector(':scope > input[type="search"]')).not.toBeNull();
    expect(header?.querySelector(':scope > .search-glyph')).not.toBeNull();
  });

  it('omits the pin and commands actions in the quick flyout', () => {
    setMode('quick');
    render(<SearchBar />);
    fireEvent.blur(screen.getByRole('searchbox', { name: /search clipboard history/i }));

    // Not merely hidden: absent from the DOM, so they take no width, no tab
    // stop and no accessible name.
    expect(screen.queryByRole('button', { name: /pin/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /commands/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /preview pane/i })).toBeTruthy();
  });

  it('exposes the full application actions while search is idle', () => {
    render(<SearchBar />);
    // The field takes focus on mount, which is the focused (search-only)
    // state; blurring is what an idle header looks like.
    fireEvent.blur(screen.getByRole('searchbox', { name: /search clipboard history/i }));

    expect(screen.getByRole('button', { name: /keep window on top/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /commands/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /settings/i })).toBeTruthy();
  });

  it('hands the header to search on focus and restores the actions on blur', async () => {
    render(<SearchBar />);
    const input = screen.getByRole('searchbox', { name: /search clipboard history/i });

    fireEvent.blur(input);
    expect(screen.getByRole('button', { name: /commands/i })).toBeTruthy();

    fireEvent.focus(input);
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    fireEvent.blur(input);
    expect(screen.getByRole('button', { name: /commands/i })).toBeTruthy();
  });

  it('keeps only a clear affordance while a query is applied', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    const input = screen.getByRole('searchbox', { name: /search clipboard history/i });

    await user.type(input, 'note');

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Clear search');
  });

  it('focuses the input when the header surface itself is clicked', () => {
    const { container } = render(<SearchBar />);
    const header = container.querySelector('header.search-header') as HTMLElement;
    const input = screen.getByRole('searchbox', { name: /search clipboard history/i });
    input.blur();

    fireEvent.mouseDown(header);

    expect(document.activeElement).toBe(input);
  });
});

describe('SearchBar Escape behaviour', () => {
  it('dismisses the flyout on the first press in quick mode, even with a query', () => {
    setMode('quick');
    useStore.setState({ search: 'note' });
    render(<SearchBar />);
    const input = screen.getByRole('searchbox', { name: /search clipboard history/i });

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(apiMock.hideWindow).toHaveBeenCalledTimes(1);
  });

  it('clears the query but never hides the full application', () => {
    useStore.setState({ search: 'note' });
    render(<SearchBar />);
    const input = screen.getByRole('searchbox', { name: /search clipboard history/i });

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(apiMock.hideWindow).not.toHaveBeenCalled();
    expect(useStore.getState().search).toBe('');
  });

  it('releases search focus instead of hiding when the query is already empty', () => {
    render(<SearchBar />);
    const input = screen.getByRole('searchbox', { name: /search clipboard history/i });
    input.focus();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(apiMock.hideWindow).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
  });
});
