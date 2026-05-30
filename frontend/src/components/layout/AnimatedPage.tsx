import { m } from 'framer-motion';
import type { ReactNode } from 'react';
import { pageVariants } from '@/lib/animations';

interface AnimatedPageProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedPage({ children, className = '' }: AnimatedPageProps) {
  return (
    <m.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={className}
    >
      {children}
    </m.div>
  );
}
