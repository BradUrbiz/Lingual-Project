import { m } from 'framer-motion';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceRecorderProps {
  isRecording: boolean;
  onToggleRecording: () => void;
  disabled?: boolean;
}

export function VoiceRecorder({
  isRecording,
  onToggleRecording,
  disabled = false,
}: VoiceRecorderProps) {
  return (
    <m.button
      onClick={onToggleRecording}
      disabled={disabled}
      className={cn(
        'w-16 h-16 flex items-center justify-center rounded-full transition-colors',
        isRecording ? 'bg-destructive' : 'bg-success hover:bg-success/90',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      animate={
        isRecording
          ? {
              scale: [1, 1.05, 1],
              transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' },
            }
          : { scale: 1 }
      }
      whileTap={{ scale: 0.95 }}
    >
      {isRecording ? (
        <Square className="size-8 text-white fill-white" />
      ) : (
        <Mic className="size-8 text-white" />
      )}
    </m.button>
  );
}
