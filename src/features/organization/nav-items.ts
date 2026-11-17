import {
  BarChart3, ClipboardCheck, Clock, LayoutGrid, Package, ScrollText,
  ShieldAlert, ShieldCheck, UserCheck, UserRound, Users, type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon };

/**
 * Labels are verbatim from the PDF sidebar (p29-p39).
 * hrefs target the planned /admin/* route map (PROJECT_NOTES routes: /admin/login,
 * /admin/*). Exact paths are NOT confirmed yet — no /admin pages exist. Confirm
 * with Arwin and Braylle before wiring screens to these routes.
 */
export const organizationNav: NavItem[] = [
  { label: "Command center", href: "/admin", icon: LayoutGrid },
  { label: "Registrations", href: "/admin/registrations", icon: ClipboardCheck },
  { label: "Screening reviews", href: "/admin/screening", icon: ShieldCheck },
  { label: "Donation queue", href: "/admin/queue", icon: Package },
  { label: "Assignments", href: "/admin/assignments", icon: UserCheck },
  { label: "Donation monitor", href: "/admin/monitor", icon: Clock },
  { label: "Donors & volunteers", href: "/admin/people", icon: Users },
  { label: "Staff accounts", href: "/admin/staff", icon: UserRound },
  { label: "Incidents", href: "/admin/incidents", icon: ShieldAlert },
  { label: "Analytics & reports", href: "/admin/analytics", icon: BarChart3 },
  { label: "Audit log", href: "/admin/audit", icon: ScrollText },
];
