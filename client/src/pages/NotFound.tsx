import { Link, useLocation } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

const NotFound = () => {
  const { pathname } = useLocation();

  return (
    <div className="bg-background flex min-h-dvh flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="bg-muted rounded-2xl p-4">
        <Compass className="text-muted-foreground h-8 w-8" />
      </div>

      <div>
        <p className="gradient-text text-5xl font-bold">404</p>
        <h1 className="mt-3 text-xl font-semibold">This page does not exist</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Nothing lives at{' '}
          <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{pathname}</code>
        </p>
      </div>

      <div className="flex gap-2">
        <Button asChild>
          <Link to="/">
            <Home className="h-4 w-4" />
            Go home
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/playground">Open the playground</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
