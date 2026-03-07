// app/components/StatusBadge.tsx
interface StatusBadgeProps {
  status: 'critical' | 'reorder' | 'healthy' | string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-800 border-red-200',
    reorder: 'bg-amber-100 text-amber-800 border-amber-200',
    healthy: 'bg-green-100 text-green-800 border-green-200',
  };

  const labels: Record<string, string> = {
    critical: 'Critical',
    reorder: 'Reorder',
    healthy: 'Healthy',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] || styles.healthy}`}>
      {labels[status] || status}
    </span>
  );
}
