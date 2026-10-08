const SHOW_MS = 4500;
const MAX_VISIBLE = 3;

/** Short announcements that pop up at the top of the screen and fade away. */
export function showNotice(text: string): void {
  const box = document.getElementById('notices')!;
  const el = document.createElement('div');
  el.className = 'notice';
  el.textContent = text;
  box.append(el);
  while (box.children.length > MAX_VISIBLE) box.firstElementChild!.remove();
  setTimeout(() => el.classList.add('leaving'), SHOW_MS);
  setTimeout(() => el.remove(), SHOW_MS + 600);
}
