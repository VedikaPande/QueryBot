import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Database, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { clearError, loginUser, signupUser } from '@/store/slices/authSlice';

/** Mirrors the server's marshmallow rules so failures surface before the request. */
const validatePassword = (password: string): string | null => {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/\d/.test(password)) return 'Password must contain a number';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return 'Password must contain a special character';
  return null;
};

const EMPTY_FORM = { fullname: '', email: '', password: '', confirm_password: '' };

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);

  const dispatch = useAppDispatch();
  const { isLoading, error } = useAppSelector((state) => state.auth);

  // Redirection is handled by ProtectedRoute, which knows where the user was
  // originally headed; this component only clears stale errors.
  useEffect(() => {
    dispatch(clearError());
  }, [isLogin, dispatch]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFormData((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    dispatch(clearError());

    const { fullname, email, password, confirm_password: confirmPassword } = formData;

    if (!email.trim() || !password) {
      toast.error('Enter your email and password');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email address');
      return;
    }

    if (isLogin) {
      const result = await dispatch(loginUser({ email, password }));
      if (loginUser.fulfilled.match(result)) {
        toast.success('Welcome back');
      } else {
        toast.error(result.payload ?? 'Could not sign in');
      }
      return;
    }

    if (!fullname.trim()) {
      toast.error('Enter your full name');
      return;
    }

    const passwordProblem = validatePassword(password);
    if (passwordProblem) {
      toast.error(passwordProblem);
      return;
    }
    if (password !== confirmPassword) {
      toast.error('The passwords do not match');
      return;
    }

    const result = await dispatch(
      signupUser({ fullname, email, password, confirm_password: confirmPassword })
    );
    if (signupUser.fulfilled.match(result)) {
      toast.success('Account created. Welcome to QueryBot.');
    } else {
      toast.error(result.payload ?? 'Could not create the account');
    }
  };

  const toggleMode = () => {
    setIsLogin((previous) => !previous);
    // Keep the email so switching mode does not mean retyping it.
    setFormData((previous) => ({ ...EMPTY_FORM, email: previous.email }));
  };

  return (
    <div className="flex min-h-dvh">
      {/* Brand panel, desktop only */}
      <div className="relative hidden overflow-hidden lg:flex lg:w-1/2" style={{ background: 'var(--gradient-hero)' }}>
        <div className="floating-shape animate-float h-72 w-72 bg-white/20" style={{ top: '10%', left: '-4rem' }} />
        <div
          className="floating-shape animate-float h-80 w-80 bg-white/10"
          style={{ bottom: '10%', right: '-5rem', animationDelay: '2s' }}
        />

        <div className="relative z-10 flex w-full flex-col items-center justify-center p-12 text-center text-white">
          <div className="mb-8 rounded-2xl bg-white/15 p-4 backdrop-blur-sm">
            <Database className="h-14 w-14" />
          </div>
          <h2 className="mb-4 text-4xl font-bold">
            {isLogin ? 'Welcome back' : 'Ask your data anything'}
          </h2>
          <p className="max-w-sm text-lg text-white/90">
            {isLogin
              ? 'Sign in to pick up where you left off.'
              : 'Upload a spreadsheet or database and get answers, charts and insights in plain English.'}
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="bg-background flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="animate-fade-in w-full max-w-md">
          <div className="mb-8 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="bg-primary/10 rounded-lg p-2">
                <Database className="text-primary h-5 w-5" />
              </div>
              <span className="text-xl font-bold">QueryBot</span>
            </Link>
            <ThemeToggle />
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-bold">{isLogin ? 'Sign in' : 'Create an account'}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {isLogin ? 'Enter your details to continue' : 'It takes less than a minute'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            {!isLogin && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fullname">Full name</Label>
                <Input
                  id="fullname"
                  name="fullname"
                  type="text"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  value={formData.fullname}
                  onChange={handleChange}
                  required
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  className="pr-10"
                  value={formData.password}
                  onChange={handleChange}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((previous) => !previous)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {!isLogin && (
                <p className="text-muted-foreground text-xs">
                  At least 8 characters, with upper and lower case, a number and a symbol.
                </p>
              )}
            </div>

            {!isLogin && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm_password">Confirm password</Label>
                <Input
                  id="confirm_password"
                  name="confirm_password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={formData.confirm_password}
                  onChange={handleChange}
                  required
                />
              </div>
            )}

            {error && (
              <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm whitespace-pre-line">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" disabled={isLoading} className="mt-1 w-full">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLoading ? 'Please wait...' : isLogin ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="text-muted-foreground mt-6 text-center text-sm">
            {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={toggleMode}
              className="text-primary font-medium hover:underline"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
