// app/settings/billing/page.tsx
'use client';

import { useState } from 'react';
import { useWorkspace } from '@/app/context/WorkspaceContext';
import { getStripe } from '@/app/lib/stripe/client';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    description: 'For small brands getting started',
    features: [
      'Up to 500 SKUs',
      'CSV import/export',
      'Basic reorder recommendations',
      'Email support',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 99,
    description: 'For growing apparel brands',
    features: [
      'Up to 5,000 SKUs',
      'Shopify integration',
      'Smart projections + trends',
      'Size curve optimization',
      'Priority support',
    ],
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 299,
    description: 'For established brands',
    features: [
      'Unlimited SKUs',
      'ApparelMagic integration',
      'Multi-channel forecasting',
      'API access',
      'Dedicated support',
      'Custom onboarding',
    ],
  },
];

export default function BillingPage() {
  const { currentWorkspace } = useWorkspace();
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const handleSubscribe = async (planId: string) => {
    if (!currentWorkspace) return;

    setIsLoading(planId);

    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId: planId,
          workspaceId: currentWorkspace.id,
        }),
      });

      const { url, error } = await response.json();

      if (error) {
        alert(error);
        return;
      }

      if (url) {
        window.location.href = url;
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setIsLoading(null);
    }
  };

  const currentPlan = currentWorkspace?.plan || 'free';

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Billing & Plans</h1>
        <p className="text-gray-500 mt-2">Choose the plan that fits your business</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`bg-white rounded-2xl shadow-sm border p-6 relative ${
              plan.popular ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200'
            }`}
          >
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  Most Popular
                </span>
              </div>
            )}

            <div className="text-center mb-6">
              <h3 className="font-semibold text-gray-900">{plan.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
              <div className="mt-4">
                <span className="text-4xl font-bold text-gray-900">${plan.price}</span>
                <span className="text-gray-500">/month</span>
              </div>
            </div>

            <ul className="space-y-3 mb-6">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleSubscribe(plan.id)}
              disabled={isLoading === plan.id || currentPlan === plan.id}
              className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                currentPlan === plan.id
                  ? 'bg-green-100 text-green-700 cursor-default'
                  : plan.popular
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-900 text-white hover:bg-gray-800'
              } disabled:opacity-50`}
            >
              {isLoading === plan.id
                ? 'Loading...'
                : currentPlan === plan.id
                ? 'Current Plan'
                : 'Subscribe'}
            </button>
          </div>
        ))}
      </div>

      {currentPlan === 'free' && (
        <div className="mt-8 bg-blue-50 rounded-xl p-4 text-center">
          <p className="text-blue-800">
            You&apos;re currently on the Free plan. Upgrade to unlock more features.
          </p>
        </div>
      )}
    </div>
  );
}
