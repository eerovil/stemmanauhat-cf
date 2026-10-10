// PROTOTYPE ONLY: which of the three designs is shown (A calm + sheet, B warm + compact
// rows, C dark + side panel). Set on <html> so the CSS themes apply everywhere.
export const UIS = ["a", "b", "c"] as const;
export type Ui = (typeof UIS)[number];
const stored = localStorage.getItem("stemmanauhat:ui");
export const ui: Ui = (UIS as readonly string[]).includes(stored ?? "") ? (stored as Ui) : "a";
document.documentElement.dataset.ui = ui;
