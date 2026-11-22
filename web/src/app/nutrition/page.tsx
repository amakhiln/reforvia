"use client";

import { ChatScreen } from "@/components/ChatScreen";

const STARTERS = [
  "What are my daily targets?",
  "Which foods are high in protein?",
  "How much protein is in 100 g of chana dal?",
  "How are my targets worked out?",
];

export default function NutritionPage() {
  return (
    <ChatScreen
      agent="nutrition"
      title="Nutrition"
      subtitle="Food and daily targets"
      heading="Your nutrition guide"
      intro="It works out your targets from your profile and training, and looks up food values. It isn’t a doctor or a dietitian, and it never changes anything without your approval."
      starters={STARTERS}
      placeholder="Ask about food or targets…"
      headerLinks={[
        { href: "/nutrition/profile", label: "Profile" },
        { href: "/coach", label: "Coach" },
      ]}
    />
  );
}
