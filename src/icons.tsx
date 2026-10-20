/**
 * Shared SVG icon components. Used by both server-side components and client-side code.
 * Returns SafeHtml so they can be used directly as JSX children without raw().
 */
import type { SafeHtml } from 'kerfjs';

// --- Common icon props ---
const S14 = { xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" } as const;
const S12 = { ...S14, width: "12", height: "12" } as const;
const S16 = { ...S14, width: "16", height: "16" } as const;

// --- Action icons ---

export function IconEdit(): SafeHtml {
  return <svg {...S14}><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;
}

export function IconTrash(): SafeHtml {
  return <svg {...S14}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
}

export function IconTrash16(): SafeHtml {
  return <svg {...S16}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
}

export function IconCheck(): SafeHtml {
  return <svg {...S14}><path d="M20 6 9 17l-5-5"/></svg>;
}

export function IconCircle(): SafeHtml {
  return <svg {...S14}><circle cx="12" cy="12" r="10"/></svg>;
}

export function IconReveal(): SafeHtml {
  return <svg {...S12}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 11 15 14"/></svg>;
}

/** Message-square-text icon (lucide) — marks a file that carries AI review
 *  notes (doc 20 §20.6, GB-1136). */
export function IconMessageSquareText(): SafeHtml {
  return <svg {...S12}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/></svg>;
}

/** External-link icon (lucide) — open a note's origin commit as a full review (doc 34). */
export function IconExternalLink(): SafeHtml {
  return <svg {...S12}><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/></svg>;
}

/** Maximize icon (lucide) — open an image-diff side full-screen in the lightbox (doc 24/25). */
export function IconMaximize(): SafeHtml {
  return <svg {...S14}><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>;
}

// --- Zoom icons ---

export function IconZoomOut(): SafeHtml {
  return <svg {...S14}><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}

export function IconZoomIn(): SafeHtml {
  return <svg {...S14}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}

export function IconFit(): SafeHtml {
  return <svg {...S14}><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>;
}

export function IconActualSize(): SafeHtml {
  return <svg {...S14}><rect x="3" y="3" width="18" height="18" rx="2"/><text x="12" y="15.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor" stroke="none">1:1</text></svg>;
}

// --- Sidebar icons ---

export function IconDiff(): SafeHtml {
  return <svg {...S12}><path d="M12 3v6M9 6h6M9 18h6"/><rect x="3" y="1" width="18" height="22" rx="2"/></svg>;
}

export function IconFolder(): SafeHtml {
  return <svg {...S14}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>;
}

export function IconShield(): SafeHtml {
  return <svg {...S14}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>;
}

export function IconBook(): SafeHtml {
  return <svg {...S14}><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>;
}

export function IconRefresh(): SafeHtml {
  return <svg {...S14}><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/></svg>;
}

export function IconGear(): SafeHtml {
  return <svg {...S14}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>;
}

// --- Settings tab icons ---

// GitHub mark: https://github.com/primer/octicons/blob/main/icons/mark-github-16.svg
export function IconGitHub(): SafeHtml {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
  </svg>;
}

// Slack mark: https://a.slack-edge.com/9cc0056/marketing/img/nav/logo.svg
export function IconSlack(): SafeHtml {
  return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 54 54" fill="currentColor" aria-hidden="true">
    <path d="M11.379 33.9993C11.379 37.1358 8.84512 39.6507 5.7276 39.6507C2.61008 39.6507 0.0572205 37.1168 0.0572205 33.9993C0.0572205 30.8817 2.5911 28.3479 5.70862 28.3479H11.36V33.9993H11.379Z" />
    <path d="M14.1962 33.9997C14.1962 30.8632 16.7301 28.3483 19.8476 28.3483C22.9651 28.3483 25.499 30.8822 25.499 33.9997V48.1353C25.499 51.2718 22.9651 53.7867 19.8476 53.7867C16.7301 53.7867 14.1962 51.2718 14.1962 48.1353V33.9997Z" />
    <path d="M19.8662 11.2673C16.7296 11.2673 14.2148 8.73347 14.2148 5.61594C14.2148 2.49842 16.7486 -0.0354538 19.8662 -0.0354538C22.9837 -0.0354538 25.5175 2.49842 25.5175 5.61594V11.2673H19.8662Z" />
    <path d="M19.8682 14.1334C23.0047 14.1334 25.5196 16.6673 25.5196 19.7848C25.5196 22.9023 22.9857 25.4362 19.8682 25.4362H5.67566C2.53916 25.4362 0.0242615 22.9023 0.0242615 19.7848C0.0242615 16.6673 2.55814 14.1334 5.67566 14.1334H19.8682Z" />
    <path d="M42.5323 19.7853C42.5323 16.6488 45.0662 14.1339 48.1837 14.1339C51.3012 14.1339 53.8351 16.6678 53.8351 19.7853C53.8351 22.9028 51.3012 25.4367 48.1837 25.4367H42.5323V19.7853Z" />
    <path d="M39.7126 19.7934C39.7126 22.9299 37.1787 25.4448 34.0612 25.4448C30.9436 25.4448 28.4098 22.911 28.4098 19.7934V5.61986C28.4098 2.48336 30.9436 -0.0315399 34.0612 -0.0315399C37.1787 -0.0315399 39.7126 2.48336 39.7126 5.61986V19.7934Z" />
    <path d="M34.0376 42.482C37.1741 42.482 39.689 45.0158 39.689 48.1334C39.689 51.2509 37.1552 53.7848 34.0376 53.7848C30.9201 53.7848 28.3862 51.2509 28.3862 48.1334V42.482H34.0376Z" />
    <path d="M34.0381 39.6507C30.9016 39.6507 28.3867 37.1168 28.3867 33.9993C28.3867 30.8818 30.9206 28.3479 34.0381 28.3479H48.2306C51.3671 28.3479 53.882 30.8818 53.882 33.9993C53.882 37.1168 51.3482 39.6507 48.2306 39.6507H34.0381Z" />
  </svg>;
}

export function IconSliders(): SafeHtml {
  return <svg {...S16}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>;
}

export function IconFlask(): SafeHtml {
  return <svg {...S16}><path d="M9 3h6"/><path d="M10 3v7.4a2 2 0 0 1-.6 1.4L4.2 17a2 2 0 0 0 1.4 3.4h12.8a2 2 0 0 0 1.4-3.4l-5.2-5.2a2 2 0 0 1-.6-1.4V3"/></svg>;
}

export function IconPlug(): SafeHtml {
  return <svg {...S16}><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>;
}

export function IconDownload(): SafeHtml {
  return <svg {...S16}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}

export function IconUser(): SafeHtml {
  return <svg {...S16}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}

export function IconCopy(): SafeHtml {
  return <svg {...S14}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>;
}

export function IconPalette(): SafeHtml {
  return <svg {...S14}><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12" r="0.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>;
}

export function IconMoreHorizontal(): SafeHtml {
  return <svg {...S14}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;
}

/** Apple-style share icon (box with arrow up) — for macOS/iOS */
export function IconShareApple(): SafeHtml {
  return <svg {...S14}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>;
}

/** Network-style share icon (nodes with lines) — for Windows/Linux */
export function IconShareGeneric(): SafeHtml {
  return <svg {...S14}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
}

/** Heart icon (lucide) — used for the sponsor link. */
export function IconHeart(): SafeHtml {
  return <svg {...S14}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>;
}

/** Paperclip icon (lucide) — marks an AI review-note artifact (doc 20). */
export function IconPaperclip(): SafeHtml {
  return <svg {...S12}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
}

/** Grip (vertical) icon (lucide) — a drag handle. */
export function IconGripVertical(): SafeHtml {
  return <svg {...S14}><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>;
}

/** Corner-down-right icon (lucide) — marks a reply to an AI review note. */
export function IconCornerDownRight(): SafeHtml {
  return <svg {...S12}><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>;
}

/** Chevrons up/down icon (lucide) — the "show remaining lines" hunk expander. */
export function IconChevronsUpDown(): SafeHtml {
  return <svg {...S14}><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>;
}

/** Chevron-down icon (lucide) — folder disclosure caret (rotated when collapsed). */
export function IconChevronDown(): SafeHtml {
  return <svg {...S12}><path d="m6 9 6 6 6-6"/></svg>;
}

/** Chevron-up icon (lucide) — previous-match in the find bar. */
export function IconChevronUp(): SafeHtml {
  return <svg {...S12}><path d="m18 15-6-6-6 6"/></svg>;
}

/** Chevron-left icon (lucide) — previous step in a ground-truth set (doc 26). */
export function IconChevronLeft(): SafeHtml {
  return <svg {...S14}><path d="m15 18-6-6 6-6"/></svg>;
}

/** Chevron-right icon (lucide) — next step in a ground-truth set (doc 26). */
export function IconChevronRight(): SafeHtml {
  return <svg {...S14}><path d="m9 18 6-6-6-6"/></svg>;
}

/** Square-dashed icon (lucide) — "draw a region" on an image (doc 23). */
export function IconSquareDashed(): SafeHtml {
  return <svg {...S14}><path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/></svg>;
}

/** File icon (lucide) — a generic attachment chip (doc 25). */
export function IconFile(): SafeHtml {
  return <svg {...S12}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v6h6"/></svg>;
}

/** X / close icon (lucide) — dismiss the lightbox (doc 25 / GB-953). */
export function IconX(): SafeHtml {
  return <svg {...S14}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
}
