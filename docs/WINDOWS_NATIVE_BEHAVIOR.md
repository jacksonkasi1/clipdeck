# Windows native behavior

Clipdeck uses one reusable, normally decorated main window and one programmatic
notification-area icon.

- The main window is the only Clipdeck window shown in the taskbar.
- The settings window is centered on first creation, remains independently
  movable and resizable, and intentionally skips the taskbar.
- The Win32 clipboard-listener window is a hidden tool window and never appears
  in the taskbar or Alt+Tab.
- The main window uses the standard Windows frame, preserving title-bar drag,
  edge resize, Snap, minimize, maximize, restore, and `Alt+F4` behavior.
- Initial placement is centered. Hiding and reopening preserves the user’s
  current size and position. If a display is disconnected, Clipdeck recenters
  only when its title bar is no longer reachable.
- Always-on-top is disabled at startup. It changes only when the user explicitly
  toggles the pin action.
- With preview hidden, the main window may compact to 520 logical pixels while
  keeping a 420-pixel minimum. Enabling preview restores the 920-pixel minimum
  and expands the window when necessary.

## Manual verification

1. Launch Clipdeck twice and confirm the second launch reuses the existing main
   window and does not add another taskbar or notification-area entry.
2. Drag, resize, Snap, minimize, restore, and move the main window between
   displays. Hide and reopen it and confirm the position is retained.
3. Disconnect the display containing Clipdeck and reopen it; the title bar must
   be reachable on the primary display.
4. Open settings and confirm the taskbar still shows only the main window.
5. Put another application over Clipdeck, then enable and disable the pin action
   to confirm topmost behavior is opt-in.
6. Hide and show preview and confirm compact/full sizing without moving the
   window to a screen corner.
