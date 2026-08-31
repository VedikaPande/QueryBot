import { Check, Loader2 } from 'lucide-react';
import { STEP_LABELS, WORKFLOW_STEPS } from '@/types/playground';
import type { WorkflowStep } from '@/types/playground';
import { cn } from '@/lib/utils';

interface ProcessingLoaderProps {
  currentStep?: WorkflowStep;
}

/**
 * Progress indicator for a running analysis.
 *
 * Steps are driven by the shared `WORKFLOW_STEPS` list, so the sequence cannot
 * drift from the agent's actual graph the way two hand-maintained copies did.
 */
const ProcessingLoader = ({ currentStep }: ProcessingLoaderProps) => {
  const currentIndex = currentStep ? WORKFLOW_STEPS.indexOf(currentStep) : -1;
  const percent = Math.round(((currentIndex + 1) / WORKFLOW_STEPS.length) * 100);

  // Show a window around the current step rather than all twelve at once.
  const windowStart = Math.max(0, currentIndex - 1);
  const visibleSteps = WORKFLOW_STEPS.slice(windowStart, windowStart + 4);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="relative">
        <Loader2 className="text-primary h-10 w-10 animate-spin" />
      </div>

      <div className="w-full max-w-xs">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Analysing</span>
          <span className="text-muted-foreground tabular-nums">{Math.max(percent, 5)}%</span>
        </div>
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(percent, 5)}%` }}
          />
        </div>
      </div>

      <ul className="flex w-full max-w-xs flex-col gap-1.5">
        {visibleSteps.map((step) => {
          const index = WORKFLOW_STEPS.indexOf(step);
          const isDone = currentIndex > index;
          const isCurrent = currentIndex === index;

          return (
            <li
              key={step}
              className={cn(
                'flex items-center gap-2 text-sm transition-colors',
                isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground',
                !isDone && !isCurrent && 'opacity-50'
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {isDone ? (
                  <Check className="text-primary h-3.5 w-3.5" />
                ) : isCurrent ? (
                  <span className="bg-primary h-1.5 w-1.5 animate-pulse rounded-full" />
                ) : (
                  <span className="bg-muted-foreground/40 h-1.5 w-1.5 rounded-full" />
                )}
              </span>
              {STEP_LABELS[step]}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default ProcessingLoader;
