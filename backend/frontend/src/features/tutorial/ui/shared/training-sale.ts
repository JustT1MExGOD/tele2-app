/** Локальная касса: ввод никогда не отправляется в рабочие продажи. */
export function openTrainingSale(container: HTMLElement, target: Record<string, number>, signal: AbortSignal): Promise<{ matched: boolean; cancelled?: boolean }> {
  if (signal.aborted) return Promise.resolve({ matched: false, cancelled: true });
  return new Promise((resolve) => {
    const form = document.createElement('form'); form.className = 'academy-training-terminal';
    const title = document.createElement('h3'); title.textContent = 'Учебная касса';
    const description = document.createElement('p'); description.textContent = 'Собери продажу по заданию. Эти данные не попадут в рабочие отчёты.';
    form.append(title, description);
    const names: Record<string, string> = { sim: 'SIM', mnp: 'MNP', accessories: 'Аксессуары', devices: 'Устройства' };
    const fields = Object.entries(target).map(([key, expected]) => { const label = document.createElement('label'), input = document.createElement('input'); label.textContent = `${names[key] || key} · нужно ${expected}`; input.type = 'number'; input.min = '0'; input.max = '999'; input.step = '1'; input.required = true; input.value = '0'; input.name = key; input.inputMode = 'numeric'; label.append(input); form.append(label); return { input, expected }; });
    const feedback = document.createElement('div'); feedback.className = 'academy-training-feedback'; feedback.setAttribute('role', 'status');
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'btn-main'; submit.textContent = 'Провести учебную продажу';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-secondary'; cancel.textContent = 'Отмена'; form.append(feedback, submit, cancel);
    const finish = (matched: boolean, cancelled = false) => { signal.removeEventListener('abort', abort); form.remove(); resolve({ matched, cancelled }); };
    const abort = () => finish(false, true); signal.addEventListener('abort', abort, { once: true }); cancel.onclick = abort;
    form.onsubmit = (event) => { event.preventDefault(); const valid = fields.every(({ input, expected }) => input.value.trim() !== '' && Number.isInteger(input.valueAsNumber) && input.valueAsNumber >= 0 && input.valueAsNumber === expected); if (!valid) { feedback.textContent = 'Проверь состав продажи: количества должны точно совпадать с заданием.'; return; } finish(true); };
    container.append(form); fields[0]?.input.focus();
  });
}
