import { CubismFramework, LogLevel, Option } from '@cubism/live2dcubismframework';
import { CubismRenderer } from '@cubism/rendering/cubismrenderer';

let activeConsumers = 0;
let initialized = false;

function logFunction(message: string) {
  if (import.meta.env.DEV) {
    console.info(message);
  }
}

export function acquireCubismFramework() {
  activeConsumers += 1;

  if (!initialized) {
    const option = new Option();
    option.logFunction = logFunction;
    option.loggingLevel = import.meta.env.DEV
      ? LogLevel.LogLevel_Warning
      : LogLevel.LogLevel_Error;

    CubismFramework.startUp(option);
    CubismFramework.initialize();
    initialized = true;
  }

  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeConsumers = Math.max(0, activeConsumers - 1);

    if (activeConsumers === 0 && initialized) {
      CubismFramework.dispose();
      CubismRenderer.staticRelease?.();
      initialized = false;
    }
  };
}
