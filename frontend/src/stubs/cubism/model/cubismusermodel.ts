/* eslint-disable @typescript-eslint/no-unused-vars */

import { CubismMatrix44 } from '../math/cubismmatrix44';
import { ACubismMotion } from '../motion/acubismmotion';
import { CubismMotion } from '../motion/cubismmotion';

class StubCubismModel {
  getCanvasWidth() { return 1; }
  getCanvasHeight() { return 1; }
  getParameterValueById(_id: string) { return 0; }
  loadParameters() {}
  saveParameters() {}
  setParameterValueById(_id: string, _value: number) {}
  update() {}
}

class StubCubismRenderer {
  startUp(_gl: WebGLRenderingContext) {}
  setIsPremultipliedAlpha(_value: boolean) {}
  setRenderState(_frameBuffer: WebGLFramebuffer, _viewport: [number, number, number, number]) {}
  setMvpMatrix(_matrix: CubismMatrix44) {}
  drawModel() {}
  bindTexture(_index: number, _texture: WebGLTexture) {}
}

export class CubismUserModel {
  protected _lipsync = false;
  protected _debugMode = false;
  protected _motionManager = {
    isFinished: () => true,
    setReservePriority: (_priority: number) => {},
    reserveMotion: (_priority: number) => true,
    startMotionPriority: (_motion: unknown, _autoDelete: boolean, _priority: number) => -1,
    updateMotion: (_model: StubCubismModel, _deltaSeconds: number) => {},
  };
  protected _expressionManager = {
    startMotion: (_motion: unknown, _autoDelete: boolean) => {},
    updateMotion: (_model: StubCubismModel, _deltaSeconds: number) => {},
  };
  protected _physics = {
    evaluate: (_model: StubCubismModel, _deltaSeconds: number) => {},
  };
  protected _pose = {
    updateParameters: (_model: StubCubismModel, _deltaSeconds: number) => {},
  };
  private readonly model = new StubCubismModel();
  private readonly modelMatrix = new CubismMatrix44();
  private readonly renderer = new StubCubismRenderer();

  loadModel(_buffer: ArrayBuffer) {}
  createRenderer() {}
  getRenderer() { return this.renderer; }
  setInitialized(_value: boolean) {}
  setUpdating(_value: boolean) {}
  getModel() { return this.model; }
  getModelMatrix() { return this.modelMatrix; }
  isHit(_id: string, _viewX: number, _viewY: number) { return false; }
  loadExpression(_buffer: ArrayBuffer, _size: number, _name: string) {
    return new ACubismMotion();
  }
  loadMotion(
    _buffer: ArrayBuffer,
    _size: number,
    _name: string,
    _onFinishedMotionHandler?: unknown,
    _onBeganMotionHandler?: unknown,
    _modelSetting?: unknown,
    _groupName?: string,
    _motionIndex?: number,
  ) {
    return new CubismMotion();
  }
  loadPhysics(_buffer: ArrayBuffer, _size: number) {}
  loadPose(_buffer: ArrayBuffer, _size: number) {}
  loadUserData(_buffer: ArrayBuffer, _size: number) {}
  release() {}
}
