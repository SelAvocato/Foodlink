import {
  allergenCodesFromDraftList,
  allergenLabel,
  parseChecklistLoad,
  type AllergenOption,
} from "./checklist-logic";
import { parseDraftDetails, parsePickupLoad } from "./details-logic";
import { PLACEHOLDER_FOOD_NAME } from "./photo-step-logic";
import { parseChecklistComplete } from "./resume-logic";
import { pickupLines, safetyLines, summaryLine } from "./review-logic";

export type ReviewInput = {
  donationId: string;
  draftsBody: unknown;
  checklistBody: unknown;
  pickupBody: unknown;
  categoryName: string;
  requiresPreparedTime: boolean;
  donorLabel: string;
  allergenOptions: AllergenOption[];
  timeZone?: string;
};

/** ready: show it; needs: send the donor to the step that is not finished; failed: a read was unusable. */
export type ReviewDecision =
  | {
      kind: "ready";
      foodName: string;
      summary: string;
      safetyLines: string[];
      pickupLines: string[];
    }
  | { kind: "needs"; step: "checklist" | "details" }
  | { kind: "failed" };

/**
 * An unreadable body is "failed" (retryable), never a guessed answer. The
 * checklist is judged before the details, the order the wizard walks them in.
 */
export function decideReview(input: ReviewInput): ReviewDecision {
  const details = parseDraftDetails(input.draftsBody, input.donationId);
  const allergenCodes = allergenCodesFromDraftList(input.draftsBody, input.donationId);
  const checklistLoad = parseChecklistLoad(input.checklistBody);
  const complete = parseChecklistComplete(input.checklistBody);
  const pickupLoad = parsePickupLoad(input.pickupBody);
  if (
    details === null ||
    allergenCodes === null ||
    !checklistLoad.ok ||
    complete === null ||
    !pickupLoad.ok
  ) {
    return { kind: "failed" };
  }

  const checklist = checklistLoad.checklist;
  if (checklist === null || !complete) return { kind: "needs", step: "checklist" };
  if (details.foodName === PLACEHOLDER_FOOD_NAME || pickupLoad.pickup === null) {
    return { kind: "needs", step: "details" };
  }

  // A code the options list does not know is shown as itself, never dropped.
  const allergenNames = allergenCodes.map((code) => {
    const option = input.allergenOptions.find((entry) => entry.code === code);
    return option === undefined ? code : allergenLabel(option);
  });

  return {
    kind: "ready",
    foodName: details.foodName,
    summary: summaryLine({
      portions: details.portions,
      categoryName: input.categoryName,
      donorLabel: input.donorLabel,
    }),
    safetyLines: safetyLines({
      checklist,
      requiresPreparedTime: input.requiresPreparedTime,
      allergenNames,
      timeZone: input.timeZone,
    }),
    pickupLines: pickupLines(pickupLoad.pickup, input.timeZone),
  };
}
