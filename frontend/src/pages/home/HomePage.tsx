import { Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from 'cn';

function HomePage() {
  return (
    <main className="flex justify-center pt-4">
      <Link
        to="/studio"
        className={cn(buttonVariants({ size: 'lg' }), 'h-11 rounded-full bg-slate-900 px-5 text-white hover:bg-slate-800')}
      >
        <Play className="fill-current" />
        Enter Studio
      </Link>
    </main>
  );
}

export default HomePage;
