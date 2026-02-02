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

const springSnappy: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 30,
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

// Chat message variants - slide in with momentum
export const messageVariants: Variants = {
  initial: {
    opacity: 0,
    x: -20,
    scale: 0.95,
  },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: springSnappy,
  },
};

// Button interactions - satisfying press with depth
export const buttonTapVariants = {
  tap: {
    scale: 0.95,
    y: 2,
    transition: { duration: 0.1 },
  },
  hover: {
    scale: 1.02,
    y: -2,
    transition: springSnappy,
  },
};

// Stamp button - press down effect like a rubber stamp
export const stampButtonVariants = {
  tap: {
    scale: 0.96,
    y: 4,
    boxShadow: '2px 2px 0 0 var(--foreground)',
    transition: { duration: 0.1 },
  },
  hover: {
    y: -2,
    boxShadow: '6px 6px 0 0 var(--foreground)',
    transition: springSnappy,
  },
};

// Fade in variants
export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.25 },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15 },
  },
};

// Slide variants for sidebars - heavy swing in
export const slideInRight: Variants = {
  initial: { x: '100%', opacity: 0 },
  animate: {
    x: 0,
    opacity: 1,
    transition: springHeavy,
  },
  exit: {
    x: '100%',
    opacity: 0,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 40,
    },
  },
};

export const slideInLeft: Variants = {
  initial: { x: '-100%', opacity: 0 },
  animate: {
    x: 0,
    opacity: 1,
    transition: springHeavy,
  },
  exit: {
    x: '-100%',
    opacity: 0,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 40,
    },
  },
};

// Pulse animation for recording - organic breathing
export const pulseVariants: Variants = {
  initial: { scale: 1 },
  animate: {
    scale: [1, 1.08, 1],
    transition: {
      duration: 1.2,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// Spinner variants
export const spinnerVariants: Variants = {
  animate: {
    rotate: 360,
    transition: {
      duration: 0.8,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

// Float animation - gentle bob
export const floatVariants: Variants = {
  initial: { y: 0 },
  animate: {
    y: [0, -6, 0],
    transition: {
      duration: 2.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// Scale on hover - chunky interaction
export const scaleOnHover = {
  whileHover: {
    scale: 1.03,
    transition: springSnappy,
  },
  whileTap: {
    scale: 0.97,
    transition: { duration: 0.1 },
  },
};

// Header slide down animation - drops into place
export const headerVariants: Variants = {
  initial: { y: -80, opacity: 0 },
  animate: {
    y: 0,
    opacity: 1,
    transition: {
      ...springBouncy,
      delay: 0.1,
    },
  },
};

// Dropdown menu animation - pops open with bounce
export const dropdownVariants: Variants = {
  initial: { opacity: 0, scale: 0.9, y: -8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springSnappy,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: -4,
    transition: { duration: 0.1 },
  },
};

// Card lift effect - for feature cards
export const cardLiftVariants: Variants = {
  initial: { y: 0, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' },
  hover: {
    y: -8,
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)',
    transition: springBouncy,
  },
};

// Block stack animation - for brutalist stacked elements
export const blockStackVariants: Variants = {
  initial: {
    opacity: 0,
    y: 60,
    rotateX: -15,
  },
  animate: {
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: {
      ...springHeavy,
      opacity: { duration: 0.3 },
    },
  },
};

// Shake animation for errors
export const shakeVariants: Variants = {
  shake: {
    x: [0, -10, 10, -10, 10, 0],
    transition: {
      duration: 0.4,
      ease: 'easeInOut',
    },
  },
};

// Success pop - stamp of approval
export const successPopVariants: Variants = {
  initial: { scale: 0, rotate: -20 },
  animate: {
    scale: 1,
    rotate: 0,
    transition: {
      type: 'spring',
      stiffness: 500,
      damping: 15,
    },
  },
};

// Typing indicator dots
export const typingDotVariants: Variants = {
  initial: { y: 0 },
  animate: {
    y: [0, -8, 0],
    transition: {
      duration: 0.6,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};
