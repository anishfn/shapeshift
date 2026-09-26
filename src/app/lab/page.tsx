import type { Metadata } from "next";
import { FlightLab } from "@/components/jobs/flight/FlightLab";

export const metadata: Metadata = {
  title: "Flight job lab · Shapeshift",
  description: "A workbench for the flight job: one sentence to a rebooked flight, in seven beats.",
  robots: { index: false, follow: false },
};

export default function LabPage() {
  return <FlightLab />;
}
