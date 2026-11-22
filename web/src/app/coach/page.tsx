"use client";

import { ChatScreen } from "@/components/ChatScreen";

const STARTERS = [
  "What should I lift next session?",
  "How has my lat pulldown progressed?",
  "Review my last two weeks of training",
  "Am I doing enough weekly volume?",
];

export default function CoachPage() {
  return (
    <ChatScreen
      agent="coach"
      title="Coach"
      subtitle="Ask about your training"
      heading="Your training coach"
      intro="It reads your plan and logs to answer questions. It never changes anything without your approval, and it isn’t a doctor."
      starters={STARTERS}
      placeholder="Ask your coach…"
      headerLinks={[
        { href: "/nutrition", label: "Nutrition" },
        { href: "/memory", label: "Notes" },
      ]}
    />
  );
}
