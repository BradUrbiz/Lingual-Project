/* eslint-disable @typescript-eslint/no-unused-vars */

export class CubismMatrix44 {
  private readonly values = new Float32Array(16);

  loadIdentity() {}
  setHeight(_height: number) {}
  getScaleX() { return 1; }
  getScaleY() { return 1; }
  left(_value: number) {}
  top(_value: number) {}
  setupFromLayout(_layout: unknown) {}
  scale(_x: number, _y: number) {}
  setMatrix(values: Float32Array) {
    this.values.set(values.slice(0, 16));
  }
  getArray() { return this.values; }
  multiplyByMatrix(_matrix: CubismMatrix44) {}
}
