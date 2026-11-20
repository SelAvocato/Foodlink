import { DataTableSkeleton } from "@/components/shared/table-skeleton";
import { PageHeader } from "@/components/shared/page-header";

export default function AdminPeopleLoading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Donors & volunteers"
        description="Manage account status and inspect activity without changing distribution records."
      />
      <DataTableSkeleton rows={5} columns={5} label="Loading people" />
    </div>
  );
}
