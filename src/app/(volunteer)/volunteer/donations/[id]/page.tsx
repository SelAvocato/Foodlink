import { TaskDetailScreen } from "./task-detail-screen";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskDetailScreen donationId={id} />;
}
