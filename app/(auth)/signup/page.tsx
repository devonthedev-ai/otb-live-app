// app/(auth)/signup/page.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { createClient } from '@/app/lib/supabase/client';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { signUp } = useAuth();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    console.log('Signup step 1: Creating user...');
    // 1. Sign up user
    const { error: signUpError } = await signUp(email, password, name);

    if (signUpError) {
      console.log('Signup error:', signUpError);
      setError(signUpError.message);
      setIsLoading(false);
      return;
    }

    console.log('Signup step 2: Signing in...');
    // 2. Sign in immediately (to get session)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    
    if (signInError) {
      console.log('Sign in error:', signInError);
      setError('Account created! Please sign in with your credentials.');
      setIsLoading(false);
      router.push('/login');
      return;
    }

    console.log('Signup step 3: Getting user...');
    // 3. Get current user (now we have a session)
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    console.log('User result:', { user: user?.id, error: userError });
    
    if (!user) {
      setError('Account created! Please sign in with your credentials.');
      setIsLoading(false);
      router.push('/login');
      return;
    }

    console.log('Signup step 4: Creating workspace...');
    // 4. Create workspace
    const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .insert({ name: workspaceName, slug })
      .select()
      .single();

    console.log('Workspace result:', { workspace: workspace?.id, error: workspaceError });

    if (workspaceError) {
      console.log('Workspace error:', workspaceError);
      setError('Account created but workspace setup failed. Please contact support.');
      setIsLoading(false);
      return;
    }

    console.log('Signup step 5: Creating membership...');
    // 5. Add user as workspace owner
    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: 'owner',
        status: 'active',
      });

    console.log('Membership result:', { error: memberError });

    if (memberError) {
      console.log('Membership error:', memberError);
      setError('Account and workspace created but membership failed. Please contact support.');
      setIsLoading(false);
      return;
    }

    console.log('Signup complete! Redirecting...');
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Create your account</h1>
        <p className="text-gray-500 mt-2">Start your 14-day free trial</p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="John Doe"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="you@company.com"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="••••••••"
            minLength={6}
            required
          />
          <p className="text-xs text-gray-400 mt-1">Must be at least 6 characters</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company/Workspace Name</label>
          <input
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Acme Apparel"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        Already have an account?{' '}
        <Link href="/login" className="text-blue-600 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
