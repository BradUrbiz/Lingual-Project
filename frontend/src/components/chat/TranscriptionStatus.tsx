import { motion, AnimatePresence } from 'framer-motion';

interface TranscriptionStatusProps {
  isTranscribing: boolean;
  pendingTranscript: string | null;
}

export function TranscriptionStatus({ isTranscribing, pendingTranscript }: TranscriptionStatusProps) {
  return (
    <AnimatePresence mode="wait">
      {isTranscribing && (
        <motion.div
          key="transcribing"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="px-6 py-3 bg-secondary border-3 border-border rounded-2xl max-w-md"
        >
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-2 h-2 bg-primary rounded-full"
                  animate={{ scale: [1, 1.5, 1] }}
                  transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    delay: i * 0.15,
                  }}
                />
              ))}
            </div>
            <span className="text-sm font-medium text-muted-foreground">
              Transcribing...
            </span>
          </div>
        </motion.div>
      )}

      {!isTranscribing && pendingTranscript && (
        <motion.div
          key="transcript"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="px-6 py-4 bg-primary/10 border-3 border-primary rounded-2xl max-w-md shadow-stamp-sm"
        >
          <p className="text-sm font-medium text-foreground">
            {pendingTranscript}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
