import { Separator } from "@/components/ui/separator";

interface DetailRowProps {
  label: string;
  value: string;
}

export default function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs font-medium text-muted-foreground w-35 shrink-0">
        {label}
      </span>
      <Separator orientation="vertical" className="h-4" />
      <span className="text-xs font-mono break-all">{value}</span>
    </div>
  );
}
