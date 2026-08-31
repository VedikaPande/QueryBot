import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/theme/ThemeToggle';
import UserMenu from '@/components/UserMenu';
import { useAppSelector } from '@/hooks/redux';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#workflow', label: 'How it works' },
];

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { isAuthenticated } = useAppSelector((state) => state.auth);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    handleScroll();

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        isScrolled ? 'glass-card py-2.5 shadow-sm' : 'bg-transparent py-4'
      )}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="group flex items-center gap-2">
            <div className="bg-primary/10 group-hover:bg-primary/20 rounded-lg p-2 transition-colors">
              <Database className="text-primary h-5 w-5" />
            </div>
            <span className="text-lg font-bold">QueryBot</span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="text-foreground/75 hover:text-primary text-sm font-medium transition-colors"
              >
                {label}
              </a>
            ))}
            <Link
              to="/playground"
              className="text-foreground/75 hover:text-primary text-sm font-medium transition-colors"
            >
              Playground
            </Link>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            {isAuthenticated ? (
              <UserMenu />
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/auth">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/auth">Get started</Link>
                </Button>
              </>
            )}
          </div>

          <button
            type="button"
            className="p-2 md:hidden"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            aria-label={isMobileMenuOpen ? 'Close the menu' : 'Open the menu'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {isMobileMenuOpen && (
          <div className="animate-slide-in mt-4 flex flex-col gap-3 pb-4 md:hidden">
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-foreground/80 hover:text-primary py-1 font-medium transition-colors"
              >
                {label}
              </a>
            ))}
            <Link
              to="/playground"
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-foreground/80 hover:text-primary py-1 font-medium transition-colors"
            >
              Playground
            </Link>

            <div className="flex items-center justify-between gap-2 pt-2">
              <ThemeToggle />
              {isAuthenticated ? (
                <UserMenu />
              ) : (
                <Button asChild size="sm">
                  <Link to="/auth">Get started</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
