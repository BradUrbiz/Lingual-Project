import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { clsx } from 'clsx';

const colorStyles: Record<string, { border: string; bg: string; hover: string; iconBg: string }> = {
  primary: {
    border: 'border-primary/30',
    bg: 'bg-primary/5',
    hover: 'hover:border-primary hover:bg-primary/10',
    iconBg: 'bg-primary text-primary-foreground',
  },
  accent: {
    border: 'border-accent/30',
    bg: 'bg-accent/5',
    hover: 'hover:border-accent hover:bg-accent/10',
    iconBg: 'bg-accent text-accent-foreground',
  },
  success: {
    border: 'border-success/30',
    bg: 'bg-success/5',
    hover: 'hover:border-success hover:bg-success/10',
    iconBg: 'bg-success text-white',
  },
  secondary: {
    border: 'border-border',
    bg: 'bg-secondary',
    hover: 'hover:border-foreground hover:bg-secondary/80',
    iconBg: 'bg-foreground text-background',
  },
};

interface ServiceNavigationCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  color: 'primary' | 'accent' | 'success' | 'secondary';
}

export function ServiceNavigationCard({ title, description, icon, href, color }: ServiceNavigationCardProps) {
  const navigate = useNavigate();
  const styles = colorStyles[color];

  return (
    <motion.button
      type="button"
      onClick={() => navigate(href)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={clsx(
        'group w-full min-h-[188px] cursor-pointer rounded-xl border-2 p-5 text-left transition-all',
        styles.border,
        styles.bg,
        styles.hover,
        'hover:shadow-stamp-sm'
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <div
          className={clsx(
            'flex h-11 w-11 items-center justify-center rounded-xl border',
            styles.iconBg
          )}
        >
          {icon}
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {href.replace('/app/', '')}
        </span>
      </div>
      <h3 className="text-xl font-display font-bold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </motion.button>
  );
}
