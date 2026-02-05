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
      onClick={() => navigate(href)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={clsx(
        'w-full text-left p-6 rounded-2xl border-3 transition-all cursor-pointer',
        styles.border,
        styles.bg,
        styles.hover,
        'hover:shadow-stamp'
      )}
    >
      <div className={clsx('w-12 h-12 rounded-xl flex items-center justify-center border-2 border-foreground mb-4', styles.iconBg)}>
        {icon}
      </div>
      <h3 className="text-lg font-display font-bold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </motion.button>
  );
}
