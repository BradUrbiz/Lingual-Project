import type { Variants, Transition } from 'framer-motion';

// Warm Brutalism spring physics - elements have weight and bounce
const springBouncy: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 25,
  mass: 1,
};

const springHeavy: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 1.2,
};

// Page transition variants - blocks slide into place with weight
export const pageVariants: Variants = {
  initial: {
    opacity: 0,
    y: 40,
    scale: 0.98,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      ...springHeavy,
      opacity: { duration: 0.3 },
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: {
      duration: 0.2,
      ease: 'easeIn',
    },
  },
};

// Card entrance variants - satisfying pop with bounce
export const cardVariants: Variants = {
  initial: {
    opacity: 0,
    scale: 0.9,
    y: 30,
  },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springBouncy,
  },
};

// Stagger children variants - sequential reveal
export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: springBouncy,
  },
};
