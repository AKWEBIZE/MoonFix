/**
 * Shared scroll timeline for the 3D story, so the 3D scene and the page text move together.
 *
 * progress p goes 0 -> 1 while the visitor scrolls through the story section:
 *   0.00 - 0.30  chapter 0: AC
 *   0.30 - 0.60  chapter 1: Fridge
 *   0.60 - 0.90  chapter 2: Washing machine
 *   0.90 - 1.00  outro: "Book a technician"
 *
 * Inside a chapter, local time q (0 -> 1):
 *   0.00 - 0.14  appliance arrives, big words slide in
 *   0.14 - 0.34  words hold (appliance centred, turning)
 *   0.34 - 0.46  words slide out, appliance moves aside
 *   0.44 - 0.86  info cards come in one by one
 *   0.86 - 1.00  cards leave, colour wipe to the next chapter
 */
export const CHAPTERS = 3;
export const CHAPTER_SPAN = 0.3;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 before a, 1 after b, linear in between */
export const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
/** smooth start and end */
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** local time of chapter i (may be < 0 before it or > 1 after it) */
export const local = (p: number, i: number) => (p - i * CHAPTER_SPAN) / CHAPTER_SPAN;
/** which chapter is on screen */
export const chapterAt = (p: number) => Math.min(CHAPTERS - 1, Math.max(0, Math.floor(p / CHAPTER_SPAN)));
/** outro 0 -> 1 */
export const outroAt = (p: number) => ease(seg(p, 0.9, 0.97));

export const words = (q: number) => ease(seg(q, 0.04, 0.16)) * (1 - ease(seg(q, 0.34, 0.46)));
export const aside = (q: number) => ease(seg(q, 0.34, 0.48)) * (1 - ease(seg(q, 0.86, 0.98)));
/** card k of n: in, hold, out */
export const card = (q: number, k: number) => ease(seg(q, 0.44 + k * 0.07, 0.54 + k * 0.07)) * (1 - ease(seg(q, 0.84, 0.94)));

/** colours per chapter (logo blue, cool teal, deep indigo) */
export const CHAPTER_COLORS = [0x0b98ee, 0x14c3b4, 0x6366f1];
