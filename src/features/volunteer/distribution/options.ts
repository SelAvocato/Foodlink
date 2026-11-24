import type { GroupServed, UnusableReason } from "@/contracts/volunteer-distribution";

export const GROUP_SERVED_OPTIONS: { value: GroupServed; label: string }[] = [
  { value: "families", label: "Families" },
  { value: "children", label: "Children" },
  { value: "elderly", label: "Elderly" },
  { value: "persons_with_disabilities", label: "Persons with disabilities" },
  { value: "students", label: "Students" },
  { value: "mixed_community", label: "Mixed community" },
];
// TODO-CONFIRM: confirm labels with product before p52 ships.

export const UNUSABLE_REASON_OPTIONS: { value: UnusableReason; label: string }[] = [
  { value: "spoiled_on_arrival", label: "Spoiled on arrival" },
  { value: "damaged", label: "Damaged" },
  { value: "other", label: "Other" },
];
// TODO-CONFIRM: confirm labels with product before p52 ships.
