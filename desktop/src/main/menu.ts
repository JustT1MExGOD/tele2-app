/**
 * 20.56.7 — production Desktop UI must have no File/Edit/View/Window
 * application menu. `Menu.setApplicationMenu(null)` removes the menu
 * object entirely (no menu exists to show), unlike
 * `autoHideMenuBar: true`, which keeps the default menu around merely
 * hidden — on Windows/Linux that leaves it reachable by pressing Alt.
 * Deliberately not using autoHideMenuBar for exactly that reason.
 */
import { Menu } from 'electron';

export function disableApplicationMenu(): void {
  Menu.setApplicationMenu(null);
}
