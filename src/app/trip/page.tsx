import type { Metadata } from "next";
import { TripShell } from "@/components/jobs/flight/TripShell";

export const metadata: Metadata = {
  title: "Say the trip once · Shapeshift",
  description: "One sentence books the whole trip: it searches, checks, books on Enter, and watches your flights until you land.",
};

export default function TripPage() {
  return <TripShell />;
}
