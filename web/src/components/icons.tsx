type P = { className?: string };
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const CheckIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const PlusIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const ChevronIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M6 9l6 6 6-6" /></svg>
);
export const BookIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16z" /><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /></svg>
);
export const HomeIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></svg>
);
export const ClockIcon = ({ className }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const ExternalIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
export const ChartIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const ChatIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" /></svg>
);
export const SendIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
export const BellIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>
);
