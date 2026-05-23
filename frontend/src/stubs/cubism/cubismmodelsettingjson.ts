/* eslint-disable @typescript-eslint/no-unused-vars */

export class CubismModelSettingJson {
  constructor(_buffer?: ArrayBuffer, _size?: number) {}

  getModelFileName() { return ''; }
  getExpressionCount() { return 0; }
  getExpressionName(_index: number) { return ''; }
  getExpressionFileName(_index: number) { return ''; }
  getPhysicsFileName() { return ''; }
  getPoseFileName() { return ''; }
  getUserDataFile() { return ''; }
  getEyeBlinkParameterCount() { return 0; }
  getEyeBlinkParameterId(_index: number) { return ''; }
  getLipSyncParameterCount() { return 0; }
  getLipSyncParameterId(_index: number) { return ''; }
  getMotionGroupCount() { return 0; }
  getMotionGroupName(_index: number) { return ''; }
  getMotionCount(_groupName: string) { return 0; }
  getMotionFileName(_groupName: string, _index: number) { return ''; }
  getTextureCount() { return 0; }
  getTextureFileName(_index: number) { return ''; }
  getLayoutMap(_layout: unknown) {}
  getHitAreasCount() { return 0; }
  getHitAreaName(_index: number) { return ''; }
  getHitAreaId(_index: number) { return ''; }
}
