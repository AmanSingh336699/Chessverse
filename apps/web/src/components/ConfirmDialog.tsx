import { AnimatePresence, motion } from "framer-motion";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[85] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-[rgba(3,8,15,0.62)] backdrop-blur-[6px]" />
          <motion.div
            className="relative z-[1] w-full max-w-[440px] rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,20,33,0.96),rgba(8,16,28,0.98))] p-6 shadow-[0_28px_100px_rgba(2,8,20,0.58)] sm:p-7"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gradient-gold">
              Confirmation
            </p>
            <h3 className="font-display mt-3 text-3xl text-brand-100">
              {title}
            </h3>
            <p className="mt-3 text-sm leading-7 text-stone-300/86">
              {description}
            </p>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-stone-200 transition hover:bg-white/8"
                onClick={onCancel}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-2xl btn-premium px-4 py-3 text-sm font-bold"
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
