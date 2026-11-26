import type { Metadata } from "next";
import { CommandCenterView } from "./command-center-view";

export const metadata: Metadata = {
  title: "Command center",
};

export default function AdminCommandCenterPage() {
  return <CommandCenterView />;
}
