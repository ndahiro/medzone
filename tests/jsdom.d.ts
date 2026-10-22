/**
 * Minimal jsdom typings.
 *
 * The package ships none and @types/jsdom is dead weight for the couple of
 * surfaces the DOM journey test actually uses (a window and a constructor
 * option). Add the real types if the suite grows.
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; pretendToBeVisual?: boolean });
    window: Window & typeof globalThis;
  }
}
