import { choice, noul } from "@typesafe-ai/sdk";

/**
 * The Jev questions for the flight job. Jev only judges: who is going, who needs help, what matters,
 * what a mid-booking sentence is asking for. Cities, dates, times and names are read by code.
 *
 * Criteria rules: self-contained, non-overlapping, every question has an escape option, and never
 * ask Jev to extract values.
 */
export const tripQuestions = {
  wantsFlight: noul("The text asks to find, plan or book flights for a trip"),
  party: choice("Who is travelling", {
    self: "Only the person writing",
    self_and_others: "The person writing plus other people they name or describe",
    others_only: "Other people but not the person writing",
    unspecified: "Not said",
  }),
  assistanceFor: choice("Who needs mobility assistance such as a wheelchair", {
    nobody: "No assistance is mentioned",
    self: "The person writing needs it",
    companion: "Someone travelling with them needs it",
    everyone: "Everyone travelling needs it",
  }),
  avoidsOvernight: noul("The person does not want overnight layovers, red-eyes or waiting through the night"),
  priority: choice("What matters most to the person about the flights", {
    cheapest: "Lowest price above all",
    fastest: "Shortest travel time above all",
    balanced: "No single priority, or not said",
  }),
  followUp: choice("What a sentence said in the middle of booking is asking for", {
    pick_option: "Choosing one of the offered options",
    change_day: "Leaving on a different day",
    seat: "A seat preference such as aisle or window for someone",
    relax_rule: "Allowing something previously ruled out, like overnight layovers",
    go_back: "Going back to see the options again",
    book: "Confirming and paying for the trip",
    take_fix: "Accepting one of the replacement flights after a disruption",
    other: "None of these, or not a follow-up",
  }),
  optionPick: choice("Which offered option the person means", {
    first: "The first one",
    second: "The second one",
    third: "The third one",
    cheapest: "The cheapest one",
    fastest: "The fastest one",
    balanced: "The balanced or recommended one",
    none: "No option is referred to",
  }),
};

export const TRIP_QUESTION_COUNT = Object.keys(tripQuestions).length;
