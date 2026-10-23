// Pipeline stage-machine hooks. `card.step.after` is the primary driver
// (advance the stage machine when a stage's card reaches its terminal step);
// `timer.tick` is the safety net for a stage that stalled without a card
// transition. Both are notifications — the host ignores the verdict's
// payload, only whether it cancelled — so a stub that always skips is
// correct (if inert) scaffolding; the real stage machine (create the next
// stage's cards via peckboard_create_card, unblock parallel chapter cards via
// peckboard_update_card) lands in a later card.

import { skip } from "./verdict";

export function onCardStepAfter(_payload: any): string {
  return skip();
}

export function onTimerTick(_payload: any): string {
  return skip();
}
