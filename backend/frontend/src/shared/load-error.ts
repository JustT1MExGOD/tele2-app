/** Shared UI for a failed page-level load. The retry callback stays in the owning page module. */
export function renderLoadError(
  container: HTMLElement,
  message: string,
  retry: () => void | Promise<void>
): void {
  container.replaceChildren();

  const messageEl = document.createElement('div');
  messageEl.className = 'empty';
  messageEl.setAttribute('role', 'alert');
  messageEl.textContent = message;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-main';
  button.textContent = 'Повторить';
  button.style.marginTop = '12px';

  button.addEventListener('click', () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Повторяем…';
    Promise.resolve().then(retry).catch(() => {
      // The owning page renders the next failure state; never leave an
      // unhandled rejection behind if a page-level retry callback throws.
    }).finally(() => {
      if (container.contains(button)) {
        button.disabled = false;
        button.textContent = 'Повторить';
      }
    });
  });

  container.append(messageEl, button);
}
