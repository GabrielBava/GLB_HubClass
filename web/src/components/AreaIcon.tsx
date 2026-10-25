import {
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  GraduationCap,
  HeartHandshake,
  Landmark,
  Library,
  Lightbulb,
  LineChart,
  Megaphone,
  Scale,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

export const AREA_ICONS: Record<string, LucideIcon> = {
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  GraduationCap,
  HeartHandshake,
  Landmark,
  Library,
  Lightbulb,
  LineChart,
  Megaphone,
  Scale,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
};

export function AreaIcon({ name, className }: { name: string; className?: string }) {
  const Icon = AREA_ICONS[name] ?? BookOpen;
  return <Icon className={className} aria-hidden />;
}
