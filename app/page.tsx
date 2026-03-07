// app/page.tsx - Redirect to app or login
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/login');
}
