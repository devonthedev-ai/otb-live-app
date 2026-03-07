// app/(app)/page.tsx - Redirect to dashboard
import { redirect } from 'next/navigation';

export default function AppPage() {
  redirect('/dashboard');
}
