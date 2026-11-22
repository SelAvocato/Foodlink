import { StorageCondition } from "@/contracts/enums";
import type { VolunteerChecklistResponse } from "@/contracts/volunteer-checklist";
import type { TaskDetail } from "./inspection/pickup-inspection-logic";
import { buildSafetyLines, buildTaskView } from "./task-detail-logic";
import { TaskDetailView } from "./task-detail-view";

/**
 * Static p45 body: sample data typed as the real contracts, and the id in the
 * URL is ignored until this screen reads the task-detail route.
 */
export default function TaskDetailPage() {
  const now = new Date();
  const todayAt = (hour: number): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0);

  const task: TaskDetail = {
    donationId: "00000000-0000-4000-8000-000000000045",
    shortCode: "FL-0268",
    foodName: "Vegetable rice bowls",
    category: "Cooked meal",
    portions: 40,
    status: "ASSIGNED",
    pickupAddress: "18 Mabini Street, Brgy. Central, Quezon City",
    pickupStart: todayAt(14).toISOString(),
    pickupEnd: todayAt(16).toISOString(),
    donorName: "Green Table Kitchen",
    donorPhone: "+63 917 555 0128",
  };

  const checklist: VolunteerChecklistResponse = {
    preparedAt: todayAt(9).toISOString(),
    consumeByAt: todayAt(18).toISOString(),
    storageCondition: StorageCondition.HOT_HELD,
    storageTemperatureC: 63,
    packagingIntact: true,
    allergensConfirmed: true,
    notCustomerPlateLeftovers: true,
    allergens: ["Soy"],
  };

  return (
    <TaskDetailView view={buildTaskView(task)} safetyLines={buildSafetyLines(checklist, now)} />
  );
}
