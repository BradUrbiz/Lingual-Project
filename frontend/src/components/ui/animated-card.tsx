import { m, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { cardVariants } from '@/lib/animations';

interface AnimatedCardProps extends HTMLMotionProps<'div'> {
  className?: string;
}

export function AnimatedCard({
  className,
  children,
  ...props
}: AnimatedCardProps) {
  return (
    <m.div
      variants={cardVariants}
      initial="initial"
      animate="animate"
      className={cn(
        'rounded-2xl bg-card text-card-foreground shadow-xl',
        className
      )}
      {...props}
    >
      {children}
    </m.div>
  );
}
