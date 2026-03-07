// app/components/MetricCard.tsx
interface MetricCardProps {
  title: string;
  value: string;
  trend: string;
  icon: string;
  variant?: 'default' | 'danger' | 'warning' | 'success';
}

export function MetricCard({ title, value, trend, icon, variant = 'default' }: MetricCardProps) {
  const variantStyles = {
    default: 'bg-white border-gray-200',
    danger: 'bg-red-50 border-red-200',
    warning: 'bg-amber-50 border-amber-200',
    success: 'bg-green-50 border-green-200',
  };

  return (
    <div className={`rounded-xl border p-6 ${variantStyles[variant]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          <p className="mt-1 text-sm text-gray-500">{trend}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}
