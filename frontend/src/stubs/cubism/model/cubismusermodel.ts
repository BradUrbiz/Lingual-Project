export class CubismUserModel {
  protected _lipsync = false;
  protected _debugMode = false;
  protected _motionManager = {
    isFinished: () => true,
    setReservePriority: (_priority: number) => {},
    reserveMotion: (_priority: number) => true,
    startMotionPriority: () => -1,
  };
  protected _expressionManager = {
    startMotion: (_motion: unknown, _autoDelete: boolean) => {},
  };
}
