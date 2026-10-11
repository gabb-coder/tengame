/**
 * A phone or tablet: played with fingers, so it gets an on-screen stick and buttons.
 * Computers don't, even ones with a touch screen (their main pointer is a mouse).
 * iPads ask for the desktop site and call themselves Macs, but Macs have no touch screen.
 */
export const touchDevice = isTouchDevice();

function isTouchDevice(): boolean {
  // Not in a browser (tests): no fingers.
  if (typeof matchMedia === 'undefined') return false;
  const agent = navigator.userAgent;
  return matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
}

/** The buttons on a phone or tablet that do what these keys do. */
const BUTTON_FOR: Record<string, string> = { J: 'Journal', G: 'Dance', T: 'New car' };

/** Words that name keys ("Press J", "hold Space"), as the buttons they are on a phone or tablet. */
export function fingerWords(text: string): string {
  if (!touchDevice) return text;
  return text
    .replace(/Press Enter to chat/g, 'Tap Chat to talk')
    .replace(/Press ([JGT])\b/g, (_, key: string) => `Tap ${BUTTON_FOR[key]}`)
    .replace(/([Hh])old Space/g, '$1old Jump');
}
