import { Link, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LayoutGrid, LogOut, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppDispatch, useAppSelector } from '@/hooks/redux';
import { logoutUser } from '@/store/slices/authSlice';

/** Derive up to two initials from a name. */
const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Account menu shown once the user is signed in. */
const UserMenu = () => {
  const { user, isAuthenticated } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  if (!isAuthenticated || !user) {
    return (
      <Button asChild size="sm">
        <Link to="/auth">Sign in</Link>
      </Button>
    );
  }

  const handleLogout = async () => {
    await dispatch(logoutUser());
    toast.success('Signed out');
    navigate('/');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="bg-primary/10 text-primary hover:bg-primary/20 rounded-full text-xs font-semibold"
          aria-label="Account menu"
        >
          {initialsOf(user.fullname)}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-foreground font-normal">
          <p className="truncate text-sm font-medium">{user.fullname}</p>
          <p className="text-muted-foreground truncate text-xs">{user.email}</p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to="/playground">
            <LayoutGrid className="h-4 w-4" />
            Playground
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboards">
            <LayoutDashboard className="h-4 w-4" />
            Dashboards
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/">
            <User className="h-4 w-4" />
            Home
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;
