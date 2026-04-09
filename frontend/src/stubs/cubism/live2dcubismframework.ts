export class Option {
  logFunction?: (message: string) => void;
  loggingLevel?: number;
}

export const LogLevel = {
  LogLevel_Error: 1,
  LogLevel_Warning: 2,
} as const;

export class CubismFramework {
  static startUp(_option?: Option) {}
  static initialize() {}
  static dispose() {}
}
